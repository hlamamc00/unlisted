"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Person, Prisma } from "@prisma/client";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BriefSchema, readBriefLocally, splitList, type Brief, type RoleContext, type RoleRules } from "@/lib/brief";
import { draftMessageWithClaude, hasClaude, readBriefWithClaude } from "@/lib/claude";
import { canEmail, sendEmail } from "@/lib/email";
import { GitHubError } from "@/lib/github";
import { fileToText } from "@/lib/jd-file";
import { normalizeLinkedIn } from "@/lib/linkedin";
import { PdlError, enrichLinkedIn, hasPdl } from "@/lib/pdl";
import { MAX_FOLLOW_UPS, isStage, type Stage } from "@/lib/pipeline";
import { evidenceFor } from "@/lib/score";
import { assess, loadGithubPerson, markForRescore, matchFromPool, resetSearch, runSearch, savePerson, toScorable, type SearchResult } from "@/lib/search";
import { answerQuestion, startAgentRun, type Note } from "@/lib/agent";

const MAX_JD_CHARS = 30_000;
const DAILY_EMAIL_LIMIT = 40; // per recruiter, to protect the sending domain's reputation
const SHARE_DAYS = 14;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const site = () => (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");

// ---------- roles ----------

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

/** What a job description doesn't say: pay, an example person, companies to look in or stay away from. */
export type RoleExtras = { pay?: string; like?: string; target?: string; avoid?: string };

function contextFrom(extras: RoleExtras, brief: Brief): RoleContext {
  const clean = (v: string | undefined, n: number) => v?.trim().slice(0, n) || undefined;
  return { pay: clean(extras.pay, 100) || brief.payRange || undefined, like: clean(extras.like, 300), target: clean(extras.target, 300), avoid: clean(extras.avoid, 300) };
}

/** Saves a new role, matches people already found for other roles, runs the first search and starts the agent. */
export async function createRole(input: { jdText: string; brief: Brief; extras: RoleExtras }) {
  const user = await requireUser();
  const brief = BriefSchema.parse(input.brief);
  const context = contextFrom(input.extras, brief);
  const role = await db.role.create({
    data: {
      userId: user.id, title: brief.title.slice(0, 120) || "New role", jdText: input.jdText.slice(0, MAX_JD_CHARS),
      brief: json(brief), context: json(context), rules: json({ avoidCompanies: splitList(context.avoid) }),
    },
  });
  try { await matchFromPool(role.id); } catch (e) { console.error("Matching from the pool failed", e); }
  try { await runSearch(role.id, user.id); } catch (e) { console.error("First search failed", e); }
  await startAgentRun(role.id, "manual").catch((e) => console.error("The agent didn't start", e));
  redirect(`/app/roles/${role.id}`);
}

/** Saves changes to a role's requirements. Candidates are re-scored and searches start over. */
export async function updateRole(roleId: string, input: { brief: Brief; extras: RoleExtras }) {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const brief = BriefSchema.parse(input.brief);
  const context = contextFrom(input.extras, brief);
  const rules = (role.rules ?? {}) as RoleRules;
  await db.role.update({
    where: { id: roleId },
    data: { title: brief.title.slice(0, 120) || role.title, brief: json(brief), context: json(context), rules: json({ ...rules, avoidCompanies: splitList(context.avoid) }) },
  });
  await resetSearch(roleId);
  revalidatePath(`/app/roles/${roleId}`);
}

export type FindResult = SearchResult & { agent: { started: boolean; message?: string } };

/** The quick search (results in seconds), and the agent, which keeps working in the background for a few minutes. */
export async function findCandidates(roleId: string): Promise<FindResult> {
  const user = await requireUser();
  if (!(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) throw new Error("Role not found");
  let result: SearchResult;
  try { result = await runSearch(roleId, user.id); }
  catch (e) { console.error("Search failed", e); result = { added: 0, looked: 0, message: "The quick search couldn't finish." }; }
  const agent = await startAgentRun(roleId, "manual").catch((e) => { console.error("The agent didn't start", e); return { runId: undefined, message: "The agent couldn't start." }; });
  revalidatePath(`/app/roles/${roleId}`);
  return { ...result, agent: { started: Boolean(agent.runId), message: agent.message } };
}

/** Yes or no to a question the agent asked. A yes changes the role's brief. */
export async function answerAgentQuestion(roleId: string, questionId: string, yes: boolean) {
  const user = await requireUser();
  if (!(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) throw new Error("Role not found");
  await answerQuestion(roleId, questionId, yes);
  revalidatePath(`/app/roles/${roleId}`);
}

/** Switches the overnight top-up on or off for a role. */
export async function setNightly(roleId: string, on: boolean) {
  const user = await requireUser();
  await db.role.updateMany({ where: { id: roleId, userId: user.id }, data: { nightly: on } });
  revalidatePath(`/app/roles/${roleId}`);
}

export async function deleteRole(roleId: string) {
  const user = await requireUser();
  await db.role.deleteMany({ where: { id: roleId, userId: user.id } });
  redirect("/app");
}

/** Adds someone the recruiter already has in mind, from their GitHub or LinkedIn profile link. */
export async function addPerson(roleId: string, link: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const raw = link.trim();
  if (!raw) return { ok: false, message: "Paste a GitHub or LinkedIn profile link." };
  const declined = { ok: false, message: "This person asked not to be included, so they can't be added." };

  let person: Person | null;
  try {
    const linkedinUrl = normalizeLinkedIn(raw);
    if (linkedinUrl) {
      if (await db.optOut.findUnique({ where: { linkedinUrl } })) return declined;
      person = await db.person.findUnique({ where: { linkedinUrl } });
      if (!person) {
        if (!hasPdl()) return { ok: false, message: "Adding someone by LinkedIn link needs People Data Labs set up. Paste their GitHub link instead." };
        const lp = await enrichLinkedIn(linkedinUrl);
        if (!lp) return { ok: false, message: "We couldn't find that LinkedIn profile." };
        person = await savePerson({
          source: "linkedin", pdlId: lp.pdlId, linkedinUrl: lp.linkedinUrl, githubLogin: lp.githubLogin, name: lp.name, location: lp.location,
          headline: lp.headline, company: lp.company, bio: lp.bio, email: lp.email, hasLinkedIn: true,
          skills: json(lp.skills), experience: json(lp.experience), fetchedAt: new Date(),
        });
      }
    } else {
      const login = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
      if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) return { ok: false, message: "That doesn't look like a GitHub or LinkedIn profile link." };
      if (await db.optOut.findUnique({ where: { githubLogin: login.toLowerCase() } })) return declined;
      person = await loadGithubPerson(login);
      if (!person) return { ok: false, message: "We couldn't find that GitHub profile." };
    }
  } catch (e) {
    if (e instanceof GitHubError || e instanceof PdlError) return { ok: false, message: e.message };
    throw e;
  }

  const name = person.name || person.githubLogin || "They";
  const existing = await db.match.findUnique({ where: { roleId_personId: { roleId, personId: person.id } } });
  if (existing && existing.status !== "filtered") {
    const where = existing.status === "approved" ? "in your pipeline" : existing.status === "skipped" ? "in Skipped" : "waiting for review";
    return { ok: true, message: `${name} is already ${where} for this role.` };
  }
  const { score, checks, blocked } = assess(person, role.brief as unknown as Brief, (role.rules ?? {}) as RoleRules);
  // The recruiter chose this person, so they're added either way, with a heads-up when a rule would have hidden them.
  const headsUp = blocked === "company" ? " They work at a company on your avoid list." : blocked ? " They're outside this role's locations." : "";
  await db.match.upsert({
    where: { roleId_personId: { roleId, personId: person.id } },
    create: { roleId, personId: person.id, score, checks: json(checks), status: "review", foundBy: "you" },
    update: { score, checks: json(checks), status: "review", foundBy: "you" },
  });
  revalidatePath(`/app/roles/${roleId}`);
  return { ok: true, message: `Added ${name} to review.${headsUp}` };
}

/** A link a hiring manager can open without an account to rate the shortlist. Lasts two weeks. */
export async function createShareLink(roleId: string): Promise<{ path: string; expires: string }> {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const valid = role.shareToken && role.shareExpiresAt && role.shareExpiresAt > new Date();
  const shareToken = valid ? role.shareToken! : randomBytes(18).toString("base64url");
  const shareExpiresAt = valid ? role.shareExpiresAt! : new Date(Date.now() + SHARE_DAYS * 86_400_000);
  if (!valid) await db.role.update({ where: { id: roleId }, data: { shareToken, shareExpiresAt } });
  revalidatePath(`/app/roles/${roleId}`);
  return { path: `/r/${shareToken}`, expires: shareExpiresAt.toISOString() };
}

export async function revokeShareLink(roleId: string) {
  const user = await requireUser();
  await db.role.updateMany({ where: { id: roleId, userId: user.id }, data: { shareToken: null, shareExpiresAt: null } });
  revalidatePath(`/app/roles/${roleId}`);
}

// ---------- candidates ----------

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

/** Moves someone in the pipeline: contacted, replied, interviewing and so on. */
export async function setStage(matchId: string, stage: Stage) {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  if (!isStage(stage)) throw new Error("Unknown stage");
  await db.match.update({ where: { id: matchId }, data: { stage, contactedAt: stage !== "new" && !match.contactedAt ? new Date() : undefined } });
  revalidatePath(`/app/roles/${match.roleId}`);
}

export async function saveNotes(matchId: string, notes: string) {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  await db.match.update({ where: { id: matchId }, data: { notes: notes.trim().slice(0, 4000) || null } });
  revalidatePath(`/app/roles/${match.roleId}`);
}

// ---------- messages ----------

export type MessageKind = "first" | "followup";
export type Draft = { draft: string; subject: string; to: string | null; canSend: boolean; usedClaude: boolean };

/** The lines every message ends with: how to opt out, and the recruiter's business address when they've set one. */
function footer(user: CurrentUser) {
  return [`If you'd rather not hear about roles like this, reply "no thanks" or remove yourself at ${site()}/opt-out.`, user.mailingAddress?.trim()]
    .filter(Boolean).join("\n");
}
const withoutFooter = (body: string) => body.split("\nIf you'd rather not hear about roles like this")[0].trim();

/** A first message citing the person's own work, or a follow-up to what was already sent. Signed, with an opt-out line. */
export async function draftMessage(matchId: string, kind: MessageKind = "first"): Promise<Draft> {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  const brief = match.role.brief as unknown as Brief;
  const context = (match.role.context ?? {}) as RoleContext;
  const person = match.person;
  const sent = await db.message.findMany({ where: { matchId }, orderBy: { sentAt: "asc" } });
  const followUp = kind === "followup" && sent.length > 0;
  const firstName = person.name?.split(" ")[0] || person.githubLogin || "there";
  const evidence = evidenceFor(toScorable(person)).map((e) => e.text);
  const pay = context.pay || brief.payRange;
  const opener = (match.note as Note | null)?.opener || undefined;
  const topRepo = (person.topRepos as { name: string }[])[0]?.name;
  const signature = [user.name, user.company].filter(Boolean).join("\n");

  let body: string | null = null;
  if (hasClaude()) {
    try {
      body = await draftMessageWithClaude({
        firstName, roleTitle: brief.title, roleSummary: brief.summary, pay, evidence, opener,
        recruiterName: user.name, recruiterCompany: user.company, schedulingUrl: user.schedulingUrl,
        previous: followUp ? sent.map((m) => withoutFooter(m.body)) : undefined,
      });
    } catch (e) { console.error("Claude couldn't draft the message; using the template", e); }
  }
  const usedClaude = Boolean(body);
  const call = user.schedulingUrl ? `You can pick a time here: ${user.schedulingUrl}` : "Would you be open to a 15-minute call?";
  if (!body && followUp) {
    body = [
      `Hi ${firstName},`,
      `I wrote a few days ago about the ${brief.title} role${topRepo ? `, after seeing your work on ${topRepo}` : ""}. Is the timing wrong, or is it worth a short call? ${call}`,
      sent.length >= MAX_FOLLOW_UPS ? "This is my last note, so I won't write again." : "",
      signature,
    ].filter(Boolean).join("\n\n");
  }
  body ??= [
    `Hi ${firstName},`,
    `${opener ? opener : topRepo ? `I came across your work on GitHub, including ${topRepo}.` : person.headline ? `I came across your profile and your experience as ${person.headline}${person.company ? ` at ${person.company}` : ""}.` : "I came across your profile."} I'm hiring for a ${brief.title} role, and your background is close to what the team needs.${pay ? ` The pay range is ${pay}.` : ""}`,
    `${call} If the timing's wrong, no problem.`,
    signature,
  ].join("\n\n");

  const firstSubject = sent[0]?.subject || (topRepo ? `Your work on ${topRepo}` : `${brief.title} role`);
  const draft = `${body}\n\n${footer(user)}`;
  if (!followUp) await db.match.update({ where: { id: matchId }, data: { draft } });
  return { draft, subject: followUp ? `Re: ${firstSubject.replace(/^Re:\s*/i, "")}` : firstSubject, to: person.email, canSend: canEmail() && Boolean(person.email), usedClaude };
}

async function logMessage(match: Awaited<ReturnType<typeof ownMatch>>, msg: { kind: MessageKind; channel: "email" | "manual"; subject?: string; body: string }) {
  await db.message.create({ data: { matchId: match.id, kind: msg.kind, channel: msg.channel, subject: msg.subject || null, body: msg.body } });
  await db.match.update({ where: { id: match.id }, data: { stage: match.stage === "new" ? "contacted" : undefined, contactedAt: match.contactedAt ?? new Date() } });
  revalidatePath(`/app/roles/${match.roleId}`);
}

/** Emails the message to the candidate from the recruiter (replies go to the recruiter's inbox) and logs it. */
export async function sendMessage(matchId: string, input: { subject: string; body: string; kind: MessageKind }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  const to = match.person.email?.trim();
  if (!canEmail()) return { ok: false, error: "Email sending isn't set up yet. Copy the message and send it yourself." };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "There's no email address for this person. Copy the message and send it another way." };
  const subject = input.subject.trim().slice(0, 150), body = input.body.trim().slice(0, 5000);
  if (!subject || body.length < 20) return { ok: false, error: "Add a subject and a message first." };

  const [sentToday, sentToThem] = await Promise.all([
    db.message.count({ where: { channel: "email", sentAt: { gt: new Date(Date.now() - 86_400_000) }, match: { role: { userId: user.id } } } }),
    db.message.count({ where: { matchId } }),
  ]);
  if (sentToday >= DAILY_EMAIL_LIMIT) return { ok: false, error: `You've sent ${DAILY_EMAIL_LIMIT} emails in the last day, which is the daily limit. Try again tomorrow.` };
  if (sentToThem > MAX_FOLLOW_UPS) return { ok: false, error: "You've already followed up twice. It's best to leave it there." };

  const text = body.includes("/opt-out") ? body : `${body}\n\n${footer(user)}`;
  const res = await sendEmail({ to, subject, text, fromName: user.name, replyTo: user.email, unsubscribeUrl: `${site()}/opt-out` });
  if (!res.ok) return res;
  await logMessage(match, { kind: input.kind, channel: "email", subject, body: text });
  return { ok: true };
}

/** The recruiter sent the message themselves (LinkedIn, their own email): log it and start the follow-up clock. */
export async function markContacted(matchId: string, input: { body: string; kind: MessageKind }) {
  const user = await requireUser();
  const match = await ownMatch(matchId, user.id);
  await logMessage(match, { kind: input.kind, channel: "manual", body: input.body.trim().slice(0, 5000) || "(Sent outside Unlisted)" });
}

// ---------- settings ----------

export type SettingsState = { saved?: boolean; error?: string };

const SettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  company: z.string().trim().max(120),
  schedulingUrl: z.string().trim().max(300).refine((v) => !v || /^https?:\/\/\S+\.\S+/.test(v), "The scheduling link should start with https://"),
  mailingAddress: z.string().trim().max(300),
});

export async function updateSettings(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = SettingsSchema.safeParse({
    name: form.get("name") ?? "", company: form.get("company") ?? "", schedulingUrl: form.get("schedulingUrl") ?? "", mailingAddress: form.get("mailingAddress") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, company, schedulingUrl, mailingAddress } = parsed.data;
  await db.user.update({ where: { id: user.id }, data: { name, company: company || null, schedulingUrl: schedulingUrl || null, mailingAddress: mailingAddress || null } });
  revalidatePath("/app", "layout");
  return { saved: true };
}
