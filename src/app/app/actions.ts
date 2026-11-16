"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BriefSchema, readBriefLocally, type Brief, type RoleContext, type RoleRules } from "@/lib/brief";
import { draftMessageWithClaude, hasClaude, readBriefWithClaude } from "@/lib/claude";
import { fileToText } from "@/lib/jd-file";
import { evidenceFor } from "@/lib/score";
import { markForRescore, runSearch, toScorable, type SearchResult } from "@/lib/search";

const MAX_JD_CHARS = 30_000;
const json = (v: unknown) => v as Prisma.InputJsonValue;

export type ReadResult = { brief?: Brief; jdText?: string; usedClaude?: boolean; error?: string };

/** Reads a pasted or uploaded job description into a brief the recruiter can then adjust. */
export async function readJobDescription(_prev: ReadResult, form: FormData): Promise<ReadResult> {
  await requireUser();
  let text = String(form.get("text") ?? "").trim();
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    try { text = (await fileToText(file)).trim(); }
    catch (e) { return { error: e instanceof Error ? e.message : "That file couldn't be read. Paste the text instead." }; }
  }
  if (text.length < 20) return { error: "Paste the job description, or write a few lines about who you need." };
  if (text.length > MAX_JD_CHARS) return { error: "That's longer than a job description usually is. Paste just the role's description." };

  if (hasClaude()) {
    try {
      const brief = await readBriefWithClaude(text);
      if (brief) return { brief, jdText: text, usedClaude: true };
    } catch (e) {
      console.error("Claude couldn't read the job description; using keywords instead", e);
    }
  }
  return { brief: readBriefLocally(text), jdText: text, usedClaude: false };
}

/** Saves a new role and runs its first search. */
export async function createRole(input: { jdText: string; brief: Brief; context: RoleContext }) {
  const user = await requireUser();
  const brief = BriefSchema.parse(input.brief);
  const context: RoleContext = {
    avoid: input.context.avoid?.trim().slice(0, 300) || undefined,
    like: input.context.like?.trim().slice(0, 300) || undefined,
    pay: input.context.pay?.trim().slice(0, 100) || brief.payRange || undefined,
  };
  const role = await db.role.create({
    data: { userId: user.id, title: brief.title.slice(0, 120) || "New role", jdText: input.jdText.slice(0, MAX_JD_CHARS), brief: json(brief), context: json(context) },
  });
  try { await runSearch(role.id, user.id); } catch (e) { console.error("First search failed", e); }
  redirect(`/app/roles/${role.id}`);
}

export async function findCandidates(roleId: string): Promise<SearchResult> {
  const user = await requireUser();
  try {
    const result = await runSearch(roleId, user.id);
    revalidatePath(`/app/roles/${roleId}`);
    return result;
  } catch (e) {
    console.error("Search failed", e);
    return { added: 0, looked: 0, message: "The search couldn't finish. Try again in a minute." };
  }
}

async function ownMatch(matchId: string, userId: string) {
  const match = await db.match.findFirst({ where: { id: matchId, role: { userId } }, include: { person: true, role: true } });
  if (!match) throw new Error("Candidate not found");
  return match;
}

export type Decision = "approved" | "skipped" | "review";
export type SkipReason = "location" | "work" | "known" | "other";

/** Approve, skip (with a reason) or move a candidate back to review. "Wrong location" teaches the role. */
export async function decide(matchId: string, decision: Decision, reason?: SkipReason) {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  await db.match.update({ where: { id: matchId }, data: { status: decision, skipReason: decision === "skipped" ? reason ?? "other" : null } });

  let learned: string | undefined;
  const city = match.person.location?.split(",")[0].trim();
  if (decision === "skipped" && reason === "location" && city) {
    const rules = (match.role.rules ?? {}) as RoleRules;
    const excludedLocations = [...new Set([...(rules.excludedLocations ?? []), city])];
    await db.role.update({ where: { id: match.roleId }, data: { rules: json({ ...rules, excludedLocations }) } });
    await markForRescore(match.roleId);
    learned = `Learned: no more candidates in ${city}`;
  }
  revalidatePath(`/app/roles/${match.roleId}`);
  return { learned };
}

/** Removes a rule learned from skips, and brings back the people it hid. */
export async function removeLocationRule(roleId: string, city: string) {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const rules = (role.rules ?? {}) as RoleRules;
  await db.role.update({ where: { id: roleId }, data: { rules: json({ ...rules, excludedLocations: (rules.excludedLocations ?? []).filter((c) => c !== city) }) } });
  await markForRescore(roleId);
  revalidatePath(`/app/roles/${roleId}`);
}

/** A first message that cites the person's own work, with an opt-out line. Saved on the match. */
export async function draftMessage(matchId: string): Promise<{ draft: string; usedClaude: boolean }> {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  const brief = match.role.brief as unknown as Brief;
  const context = (match.role.context ?? {}) as RoleContext;
  const person = match.person;
  const firstName = person.name?.split(" ")[0] || person.githubLogin || "there";
  const evidence = evidenceFor(toScorable(person)).map((e) => e.text);
  const pay = context.pay || brief.payRange;

  let body: string | null = null;
  if (hasClaude()) {
    try { body = await draftMessageWithClaude({ firstName, roleTitle: brief.title, roleSummary: brief.summary, pay, evidence }); }
    catch (e) { console.error("Claude couldn't draft the message; using the template", e); }
  }
  const usedClaude = Boolean(body);
  const topRepo = (person.topRepos as { name: string }[])[0]?.name;
  body ??= [
    `Hi ${firstName},`,
    `${topRepo ? `I came across your work on GitHub, including ${topRepo}.` : person.headline ? `I came across your profile and your experience as ${person.headline}${person.company ? ` at ${person.company}` : ""}.` : "I came across your profile."} I'm hiring for a ${brief.title} role, and your background is close to what the team needs.${pay ? ` The pay range is ${pay}.` : ""}`,
    "Would you be open to a 15-minute call? If the timing's wrong, no problem.",
    "[Your name]",
  ].join("\n\n");

  const site = process.env.APP_URL?.replace(/\/$/, "") || "";
  const draft = `${body}\n\nIf you'd rather not hear about roles like this, reply "no thanks" or remove yourself at ${site}/opt-out.`;
  await db.match.update({ where: { id: matchId }, data: { draft } });
  return { draft, usedClaude };
}

export async function deleteRole(roleId: string) {
  const user = await requireUser();
  await db.role.deleteMany({ where: { id: roleId, userId: user.id } });
  redirect("/app");
}
