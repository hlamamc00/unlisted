"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Person, Prisma } from "@prisma/client";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BriefSchema, briefFromProfile, describeChange, isSearchable, readBooleanLocally, readBriefLocally, refineBriefLocally, splitList, toBrief,
  type Brief, type RoleContext, type RoleRules,
} from "@/lib/brief";
import { draftMessageWithClaude, hasClaude, readBriefWithClaude, refineBriefWithClaude } from "@/lib/claude";
import { canEmail, sendEmail } from "@/lib/email";
import { GitHubError } from "@/lib/github";
import { fileToText } from "@/lib/jd-file";
import { normalizeLinkedIn } from "@/lib/linkedin";
import { PdlError, enrichLinkedIn, hasPdl } from "@/lib/pdl";
import { MAX_FOLLOW_UPS, isStage, type Stage } from "@/lib/pipeline";
import { evidenceFor } from "@/lib/score";
import {
  BLOCKED_REASON, assess, loadGithubPerson, markForRescore, matchFromPool, rescoreIfStale, resetSearch, runSearch, saveLinkedInPerson, toScorable,
  type SearchResult,
} from "@/lib/search";
import { answerQuestion, startAgentRun, type Note } from "@/lib/agent";

const MAX_JD_CHARS = 30_000;
const DAILY_EMAIL_LIMIT = 40; // per recruiter, to protect the sending domain's reputation
const SHARE_DAYS = 14;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const site = () => (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");

// ---------- roles ----------

/** How the recruiter said who they want: in their own words, a job description, a Boolean string, or a profile to find more like. */
export type SearchMode = "describe" | "jd" | "boolean" | "similar";
export type ReadResult = { brief?: Brief; jdText?: string; usedClaude?: boolean; like?: string; error?: string; at?: number };

const EXAMPLE = "data analyst in Atlanta who worked at HP";

/** A person from their GitHub or LinkedIn profile link: from our store when we have them, otherwise fetched. */
async function loadPersonByLink(link: string): Promise<{ person: Person } | { error: string }> {
  const raw = link.trim();
  if (!raw) return { error: "Paste a GitHub or LinkedIn profile link." };
  const declined = { error: "This person asked not to be included, so they can't be used." };
  try {
    const linkedinUrl = normalizeLinkedIn(raw);
    if (linkedinUrl) {
      if (await db.optOut.findUnique({ where: { linkedinUrl } })) return declined;
      const stored = await db.person.findUnique({ where: { linkedinUrl } });
      if (stored) return { person: stored };
      if (!hasPdl()) return { error: "Reading a LinkedIn profile needs People Data Labs connected (see Settings). A GitHub profile link works without it." };
      const lp = await enrichLinkedIn(linkedinUrl);
      return lp ? { person: await saveLinkedInPerson(lp) } : { error: "We couldn't find that LinkedIn profile." };
    }
    const login = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
    if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) return { error: "That doesn't look like a GitHub or LinkedIn profile link." };
    if (await db.optOut.findUnique({ where: { githubLogin: login.toLowerCase() } })) return declined;
    const person = await loadGithubPerson(login);
    return person ? { person } : { error: "We couldn't find that GitHub profile." };
  } catch (e) {
    if (e instanceof GitHubError || e instanceof PdlError) return { error: e.message };
    throw e;
  }
}

/**
 * Reads what the recruiter typed, pasted or uploaded into a brief they can check before anything is
 * searched: a one-line request, a job description, a Boolean string, or a profile to find more like.
 */
export async function readSearch(_prev: ReadResult, form: FormData): Promise<ReadResult> {
  await requireUser();
  const mode = String(form.get("mode") ?? "describe") as SearchMode;
  let text = String(form.get("text") ?? "").trim();
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    try { text = (await fileToText(file)).trim(); }
    catch (e) { return { error: e instanceof Error ? e.message : "That file couldn't be read. Paste the text instead." }; }
  }
  const at = Date.now();

  if (mode === "similar") {
    const found = await loadPersonByLink(text);
    if ("error" in found) return { error: found.error };
    const p = found.person;
    const languages = Object.entries(p.languages as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([l]) => l);
    const brief = briefFromProfile({ name: p.name ?? p.githubLogin, headline: p.headline, skills: p.skills as string[], languages });
    if (!isSearchable(brief)) return { error: "There isn't enough on that profile to search from. Describe who you're looking for instead." };
    return { brief, jdText: `People like ${text}`, like: text, usedClaude: false, at };
  }

  if (text.length < 3) return { error: mode === "boolean" ? 'Type a Boolean search, for example: ("data analyst" OR "BI analyst") AND SQL' : `Describe who you're looking for, for example: ${EXAMPLE}.` };
  if (text.length > MAX_JD_CHARS) return { error: "That's longer than a job description usually is. Paste just the role's description." };

  if (mode === "boolean") {
    const brief = readBooleanLocally(text);
    return isSearchable(brief) ? { brief, jdText: text, usedClaude: false, at } : { error: "There's no job title or skill in that search. Put phrases in quotes and join them with AND, OR and NOT." };
  }
  if (hasClaude()) {
    try {
      const read = await readBriefWithClaude(text);
      const brief = read ? toBrief(read) : null;
      if (brief && isSearchable(brief)) return { brief, jdText: text, usedClaude: true, at };
    } catch (e) {
      console.error("Claude couldn't read the request; using keywords instead", e);
    }
  }
  const brief = readBriefLocally(text);
  if (!isSearchable(brief)) return { error: `I couldn't tell which job or skills you mean. Try something like: ${EXAMPLE}.` };
  return { brief, jdText: text, usedClaude: false, at };
}

/** What a job description doesn't say: pay, an example person, companies to look in or stay away from. */
export type RoleExtras = { pay?: string; like?: string; target?: string; avoid?: string };

function contextFrom(extras: RoleExtras, brief: Brief): RoleContext {
  const clean = (v: string | undefined, n: number) => v?.trim().slice(0, n) || undefined;
  return { pay: clean(extras.pay, 100) || brief.payRange || undefined, like: clean(extras.like, 300), target: clean(extras.target, 300), avoid: clean(extras.avoid, 300) };
}

/**
 * Saves a new search as a role, matches people already found for other roles and runs the first
 * search. The agent waits until the recruiter has reviewed the first matches (see finishCalibrating).
 */
export async function createRole(input: { jdText: string; brief: Brief; extras: RoleExtras }) {
  const user = await requireUser();
  const brief = BriefSchema.parse(input.brief);
  if (!isSearchable(brief)) throw new Error("Add a job title or a requirement first");
  const context = contextFrom(input.extras, brief);
  const role = await db.role.create({
    data: {
      userId: user.id, title: brief.title.slice(0, 120) || "New role", jdText: input.jdText.slice(0, MAX_JD_CHARS),
      brief: json(brief), context: json(context), rules: json({ avoidCompanies: splitList(context.avoid) }),
    },
  });
  try { await matchFromPool(role.id); } catch (e) { console.error("Matching from the pool failed", e); }
  try { await runSearch(role.id, user.id); } catch (e) { console.error("First search failed", e); }
  revalidatePath("/app", "layout"); // the new search joins the sidebar
  redirect(`/app/roles/${role.id}`);
}

/** Saves changes to a role's requirements. Candidates are re-scored and searches start over. */
export async function updateRole(roleId: string, input: { brief: Brief; extras: RoleExtras }) {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const brief = BriefSchema.parse(input.brief);
  if (!isSearchable(brief)) throw new Error("Add a job title or a requirement first");
  const context = contextFrom(input.extras, brief);
  const rules = (role.rules ?? {}) as RoleRules;
  await db.role.update({
    where: { id: roleId },
    data: { title: brief.title.slice(0, 120) || role.title, brief: json(brief), context: json(context), rules: json({ ...rules, avoidCompanies: splitList(context.avoid) }) },
  });
  await resetSearch(roleId);
  await rescoreIfStale(roleId, user.id);
  revalidatePath(`/app/roles/${roleId}`);
}

/**
 * Changes a role's search in plain words ("only people who worked at Dell", "remote is fine"),
 * re-scores the people already found and searches again with the change.
 */
export async function refineSearch(roleId: string, text: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const instruction = text.trim().slice(0, 500);
  const help = "Try: remote is fine, must know Tableau, or only people who worked at Dell. Edit filters also works.";
  if (instruction.length < 3) return { ok: false, message: `Say what to change. ${help}` };
  const before = toBrief(role.brief);
  let after: Brief | null = null;
  if (hasClaude()) {
    try { const read = await refineBriefWithClaude(before, instruction); after = read ? toBrief(read) : null; }
    catch (e) { console.error("Claude couldn't change the search; using keywords instead", e); }
  }
  after ??= refineBriefLocally(before, instruction);
  if (before.jobTitles.join("|") === after.jobTitles.join("|")) after.title = before.title; // the search keeps its name unless the job changes
  const change = describeChange(before, after);
  if (!change) return { ok: false, message: `I couldn't tell what to change. ${help}` };
  if (!isSearchable(after)) return { ok: false, message: "That would leave nothing to search for. Keep a job title or at least one requirement." };

  await db.role.update({ where: { id: roleId }, data: { title: after.title.slice(0, 120) || role.title, brief: json(after) } });
  await resetSearch(roleId);
  await rescoreIfStale(roleId, user.id);
  let result: SearchResult;
  try { result = await runSearch(roleId, user.id); }
  catch (e) { console.error("Search failed", e); result = { added: 0, looked: 0, message: "The search couldn't finish." }; }
  revalidatePath(`/app/roles/${roleId}`);
  const found = result.added ? `Found ${result.added} more.` : result.message ?? "";
  return { ok: true, message: `Changed: ${change}. ${found}`.trim() };
}

/**
 * The recruiter has shortlisted and hidden enough of the first matches to show what they want. From
 * here the agent may search for this role, when it's switched on.
 */
export async function finishCalibrating(roleId: string): Promise<{ started: boolean; paused: boolean; message?: string }> {
  const user = await requireUser();
  if (!(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) throw new Error("Role not found");
  await db.role.update({ where: { id: roleId }, data: { calibratedAt: new Date() } });
  const agent: Awaited<ReturnType<typeof startAgentRun>> = await startAgentRun(roleId, "manual")
    .catch((e) => { console.error("The agent didn't start", e); return { message: "The agent couldn't start." }; });
  revalidatePath(`/app/roles/${roleId}`);
  return { started: Boolean(agent.runId), paused: Boolean(agent.paused), message: agent.message };
}

export type FindResult = SearchResult & { agent: { started: boolean; paused: boolean; message?: string } };

/** More people with the same filters: the quick search (results in seconds), and the agent in the background when it's on. */
export async function findCandidates(roleId: string): Promise<FindResult> {
  const user = await requireUser();
  if (!(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) throw new Error("Role not found");
  let result: SearchResult;
  try { result = await runSearch(roleId, user.id); }
  catch (e) { console.error("Search failed", e); result = { added: 0, looked: 0, message: "The quick search couldn't finish." }; }
  // The agent joins in when Claude is connected, it's switched on, and the role is calibrated; otherwise it stays quiet.
  const agent: Awaited<ReturnType<typeof startAgentRun>> = !hasClaude() ? {} : await startAgentRun(roleId, "manual")
    .catch((e) => { console.error("The agent didn't start", e); return { message: "The agent couldn't start." }; });
  revalidatePath(`/app/roles/${roleId}`);
  return { ...result, agent: { started: Boolean(agent.runId), paused: Boolean(agent.paused), message: agent.message } };
}

/** Yes or no to a question the agent asked. A yes changes the role's brief. */
export async function answerAgentQuestion(roleId: string, questionId: string, yes: boolean) {
  const user = await requireUser();
  if (!(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) throw new Error("Role not found");
  await answerQuestion(roleId, questionId, yes);
  revalidatePath(`/app/roles/${roleId}`);
}

/** Pauses or resumes the sourcing agent for this recruiter. Paused, it never runs: no background searches, nothing overnight. */
export async function setAgentPaused(paused: boolean) {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { agentPaused: paused } });
  revalidatePath("/app", "layout");
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
  revalidatePath("/app", "layout");
  redirect("/app");
}

/** Adds someone the recruiter already has in mind, from their GitHub or LinkedIn profile link. */
export async function addPerson(roleId: string, link: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const role = await db.role.findFirst({ where: { id: roleId, userId: user.id } });
  if (!role) throw new Error("Role not found");
  const found = await loadPersonByLink(link);
  if ("error" in found) return { ok: false, message: found.error };
  const { person } = found;

  const name = person.name || person.githubLogin || "They";
  const existing = await db.match.findUnique({ where: { roleId_personId: { roleId, personId: person.id } } });
  if (existing && existing.status !== "filtered") {
    const where = existing.status === "approved" ? "on your shortlist" : existing.status === "skipped" ? "in Hidden" : "in your matches";
    return { ok: true, message: `${name} is already ${where} for this role.` };
  }
  const { score, checks, blocked } = assess(person, toBrief(role.brief), (role.rules ?? {}) as RoleRules);
  // The recruiter chose this person, so they're added either way, with a heads-up when a rule would have hidden them.
  const headsUp = blocked ? ` Note: this person ${BLOCKED_REASON[blocked]}.` : "";
  await db.match.upsert({
    where: { roleId_personId: { roleId, personId: person.id } },
    create: { roleId, personId: person.id, score, checks: json(checks), status: "review", foundBy: "you" },
    update: { score, checks: json(checks), status: "review", foundBy: "you" },
  });
  revalidatePath(`/app/roles/${roleId}`);
  return { ok: true, message: `Added ${name} to your matches.${headsUp}` };
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
  const brief = toBrief(match.role.brief);
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
