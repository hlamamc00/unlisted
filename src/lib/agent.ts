import "server-only";
import type { Person, Prisma } from "@prisma/client";
import { db } from "./db";
import type { Brief, RoleContext, RoleRules } from "./brief";
import { hasClaude } from "./claude";
import { GitHubError, fetchProfile, searchRepos, searchUsers, type Repo } from "./github";
import { PdlError, hasPdl, searchLinkedIn, type Role } from "./pdl";
import { fitLabel, shortLocation } from "./score";
import { assess, markForRescore, savePerson, toScorable } from "./search";
import { agentToken } from "@/agent/token";

/** What one run may use. The agent is told these and every tool enforces them. */
export const LIMITS = { toolCalls: 30, lookups: 30, githubSearches: 8, pdlProfiles: 20, adds: 10, minutes: 12, manualRunsPerDay: 6 };
const POSSIBLE = 45; // the agent may add someone the rules rate this high or better, with its reasons
const json = (v: unknown) => v as Prisma.InputJsonValue;
const FRESH_MS = 7 * 86_400_000;

export type Change =
  | { type: "allow_remote" }
  | { type: "add_location"; location: string }
  | { type: "make_optional"; requirement: string }
  | { type: "add_requirement"; label: string; signals: string[]; languages: string[] };
export type Question = { id: string; text: string; change: Change; status: "open" | "yes" | "no"; askedAt: string };
export type Note = { why: string; opener: string; evidence: string[] };
type Usage = { toolCalls?: number; lookups?: number; githubSearches?: number; pdlProfiles?: number };

// ---------- starting a run ----------

/** Starts the agent for a role, unless one is already running. Returns the run, or why it couldn't start. */
export async function startAgentRun(roleId: string, trigger: "manual" | "nightly"): Promise<{ runId?: string; message?: string }> {
  if (!hasClaude()) return { message: "Add an ANTHROPIC_API_KEY to let the agent search for you." };
  const active = await db.agentRun.findFirst({ where: { roleId, status: { in: ["queued", "running"] }, createdAt: { gt: new Date(Date.now() - (LIMITS.minutes + 3) * 60_000) } } });
  if (active) return { runId: active.id };
  if (trigger === "manual") {
    const today = await db.agentRun.count({ where: { roleId, trigger: "manual", createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= LIMITS.manualRunsPerDay) return { message: `The agent has searched for this role ${today} times today. It can run again tomorrow.` };
  }
  const run = await db.agentRun.create({ data: { roleId, trigger } });
  const site = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
  const token = agentToken(run.id);
  try {
    if (process.env.AGENT_INLINE === "1") {
      // Local development: run in this server process instead of a Netlify background function.
      void import("@/agent/driver").then((m) => m.runAgent({ site, runId: run.id, token }));
    } else {
      const res = await fetch(`${site}/.netlify/functions/agent-background`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`background function answered ${res.status}`);
    }
  } catch (e) {
    console.error("Couldn't start the agent", e);
    await db.agentRun.update({ where: { id: run.id }, data: { status: "failed", error: "The agent couldn't start.", finishedAt: new Date() } });
    return { message: "The agent couldn't start. Try again in a minute." };
  }
  return { runId: run.id };
}

// ---------- what the agent starts from ----------

const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? null);

/** A short description of a person for the agent: only what's in their stored profile. */
function describe(p: Person, brief: Brief, rules: RoleRules) {
  const sp = toScorable(p);
  const { score, checks, status } = assess(p, brief, rules);
  const loc = checks.find((c) => c.importance === "location");
  return {
    person_id: p.id,
    name: p.name ?? p.githubLogin,
    github: p.githubLogin,
    location: shortLocation(p.location),
    on_linkedin: p.hasLinkedIn,
    current_role: p.headline ? `${p.headline}${p.company ? ` at ${p.company}` : ""}` : undefined,
    roles: sp.experience.slice(0, 3).map((r) => `${r.title}${r.company ? ` at ${r.company}` : ""}`),
    skills: sp.skills.slice(0, 10),
    languages: Object.entries(sp.languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, n]) => `${l} (${n})`),
    repos: sp.topRepos.slice(0, 3).map((r) => ({ name: r.name, about: clip(r.description, 90), stars: r.stars })),
    fit: {
      label: fitLabel(score), score,
      met: checks.filter((c) => c.status === "yes").map((c) => c.label),
      missing: checks.filter((c) => c.status === "no").map((c) => c.label),
      unknown: checks.filter((c) => c.status === "unknown").map((c) => c.label),
    },
    can_add: status === "review" || (score >= POSSIBLE && loc?.status !== "no"),
  };
}

export async function agentContext(runId: string) {
  const run = await db.agentRun.findUnique({ where: { id: runId }, include: { role: true } });
  if (!run) return null;
  const { role } = run;
  const brief = role.brief as unknown as Brief;
  const rules = (role.rules ?? {}) as RoleRules;
  const decided = await db.match.findMany({
    where: { roleId: role.id, status: { in: ["approved", "skipped"] } },
    include: { person: true }, orderBy: { updatedAt: "desc" }, take: 25,
  });
  await db.agentRun.update({ where: { id: runId }, data: { status: "running", progress: "Reading the role" } });
  return {
    role: { title: role.title, summary: brief.summary, payRange: (role.context as RoleContext).pay ?? brief.payRange },
    mustHaves: brief.criteria.filter((c) => c.importance === "must").map((c) => c.label),
    niceToHaves: brief.criteria.filter((c) => c.importance === "nice").map((c) => c.label),
    locations: brief.locations, remoteOk: brief.remoteOk, excludedLocations: rules.excludedLocations ?? [],
    searchTerms: brief.searchTerms,
    languages: [...new Set(brief.criteria.flatMap((c) => c.languages))],
    answers: (role.context as RoleContext),
    approved: decided.filter((m) => m.status === "approved").slice(0, 8).map((m) => ({ ...describe(m.person, brief, rules), agent_note: (m.note as Note | null)?.why })),
    skipped: decided.filter((m) => m.status === "skipped").slice(0, 12).map((m) => ({ name: m.person.name ?? m.person.githubLogin, location: shortLocation(m.person.location), reason: m.skipReason, current_role: m.person.headline, languages: Object.keys(m.person.languages as object).slice(0, 3) })),
    questions: (role.questions as Question[]).map((q) => ({ question: q.text, answer: q.status })),
    linkedinAvailable: hasPdl(),
    limits: LIMITS,
  };
}

// ---------- the tools ----------

type RunWithRole = NonNullable<Awaited<ReturnType<typeof loadRun>>>;
const loadRun = (runId: string) => db.agentRun.findUnique({ where: { id: runId }, include: { role: true } });

async function excludedPeople(roleId: string) {
  const [matched, optedOut] = await Promise.all([
    db.match.findMany({ where: { roleId, status: { in: ["review", "approved", "skipped"] } }, select: { person: { select: { githubLogin: true, linkedinUrl: true } } } }),
    db.optOut.findMany({ select: { githubLogin: true, linkedinUrl: true } }),
  ]);
  const optOutLogins = new Set(optedOut.flatMap((o) => (o.githubLogin ? [o.githubLogin.toLowerCase()] : [])));
  const optOutLinks = new Set(optedOut.flatMap((o) => (o.linkedinUrl ? [o.linkedinUrl] : [])));
  const shown = new Set(matched.flatMap((m) => (m.person.githubLogin ? [m.person.githubLogin.toLowerCase()] : [])));
  return { optOutLogins, optOutLinks, shown };
}

/** Runs one tool for the agent. Returns what the agent should read; problems come back as { error }. */
export async function runTool(runId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  const run = await loadRun(runId);
  if (!run || !["running", "queued"].includes(run.status)) return { error: "This run has finished." };
  const usage = { ...((run.usage ?? {}) as Usage) };
  usage.toolCalls = (usage.toolCalls ?? 0) + 1;
  const overTime = Date.now() - run.createdAt.getTime() > LIMITS.minutes * 60_000;
  if (overTime || usage.toolCalls > LIMITS.toolCalls) return { error: "Time is up for this run. Stop now and write your summary." };

  let progress = run.progress;
  let result: unknown;
  try {
    switch (name) {
      case "search_github": ({ progress, result } = await searchGithubTool(run, input, usage)); break;
      case "search_linkedin": ({ progress, result } = await searchLinkedInTool(run, input, usage)); break;
      case "look_at_people": ({ progress, result } = await lookAtPeopleTool(run, input, usage)); break;
      case "add_candidates": ({ progress, result } = await addCandidatesTool(run, input)); break;
      case "ask_recruiter": ({ progress, result } = await askRecruiterTool(run, input)); break;
      default: result = { error: `There's no tool called ${name}.` };
    }
  } catch (e) {
    if (e instanceof GitHubError || e instanceof PdlError) result = { error: e.message };
    else { console.error(`Agent tool ${name} failed`, e); result = { error: "That didn't work. Try something else." }; }
  }
  const steps = [...((run.steps ?? []) as { at: string; text: string }[]), { at: new Date().toISOString(), text: progress }].slice(-20);
  await db.agentRun.update({ where: { id: runId }, data: { usage: json(usage), progress, steps: json(steps), status: "running" } });
  return result;
}

async function searchGithubTool(run: RunWithRole, input: Record<string, unknown>, usage: Usage) {
  const kind = input.kind === "users" ? "users" : "repos";
  const query = String(input.query ?? "").slice(0, 200);
  const page = Math.min(10, Math.max(1, Number(input.page) || 1));
  usage.githubSearches = (usage.githubSearches ?? 0) + 1;
  if (usage.githubSearches > LIMITS.githubSearches) return { progress: run.progress, result: { error: "You've used all GitHub searches for this run." } };
  const { optOutLogins, shown } = await excludedPeople(run.roleId);
  const fresh = (login: string) => !optOutLogins.has(login.toLowerCase()) && !shown.has(login.toLowerCase());
  if (kind === "repos") {
    const hits = (await searchRepos(query, page)).filter((h) => fresh(h.owner));
    const seen = new Set<string>();
    const people = hits.filter((h) => !seen.has(h.owner) && seen.add(h.owner)).slice(0, 15)
      .map((h) => ({ github: h.owner, repo: h.name, about: clip(h.description, 90), stars: h.stars, language: h.language }));
    return { progress: `Searching GitHub projects: ${query}`, result: { people, note: people.length ? undefined : "No new people for this search." } };
  }
  const logins = (await searchUsers(query, page)).filter(fresh).slice(0, 20);
  return { progress: `Searching GitHub people: ${query}`, result: { people: logins.map((github) => ({ github })) } };
}

async function lookAtPeopleTool(run: RunWithRole, input: Record<string, unknown>, usage: Usage) {
  const logins = (Array.isArray(input.github_logins) ? input.github_logins : []).map(String).slice(0, 6);
  usage.lookups = (usage.lookups ?? 0) + logins.length;
  if (usage.lookups > LIMITS.lookups) return { progress: run.progress, result: { error: "You've looked at as many people as this run allows. Add the best ones you've seen, then finish." } };
  const brief = run.role.brief as unknown as Brief;
  const rules = (run.role.rules ?? {}) as RoleRules;
  const { optOutLogins } = await excludedPeople(run.roleId);
  const out = [];
  for (const login of logins) {
    if (optOutLogins.has(login.toLowerCase())) { out.push({ github: login, error: "This person asked not to be included." }); continue; }
    let person = await db.person.findFirst({ where: { githubLogin: { equals: login, mode: "insensitive" } } });
    if (!person || Date.now() - person.fetchedAt.getTime() > FRESH_MS) {
      const profile = await fetchProfile(login).catch((e) => { if (e instanceof GitHubError) throw e; return null; });
      if (!profile) { out.push({ github: login, error: "Couldn't read this profile." }); continue; }
      person = await savePerson({ ...profile, languages: json(profile.languages), topRepos: json(profile.topRepos), fetchedAt: new Date() });
    }
    out.push(describe(person, brief, rules));
  }
  await db.agentRun.update({ where: { id: run.id }, data: { looked: { increment: out.length } } });
  return { progress: `Looking closely at ${logins.length} ${logins.length === 1 ? "person" : "people"}`, result: { people: out } };
}

async function searchLinkedInTool(run: RunWithRole, input: Record<string, unknown>, usage: Usage) {
  if (!hasPdl()) return { progress: run.progress, result: { error: "LinkedIn search isn't set up for this account. Use GitHub." } };
  const used = usage.pdlProfiles ?? 0;
  const size = Math.min(10, LIMITS.pdlProfiles - used);
  if (size <= 0) return { progress: run.progress, result: { error: "You've used all LinkedIn profiles for this run." } };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);
  const search = { title: String(input.title ?? "").slice(0, 80), skills: list(input.skills), cities: list(input.cities), remote: Boolean(input.remote), boost: list(input.boost) };
  const found = await searchLinkedIn(search, size);
  usage.pdlProfiles = used + found.people.length;
  const brief = run.role.brief as unknown as Brief;
  const rules = (run.role.rules ?? {}) as RoleRules;
  const { optOutLinks, optOutLogins } = await excludedPeople(run.roleId);
  const out = [];
  for (const lp of found.people) {
    if (optOutLinks.has(lp.linkedinUrl) || (lp.githubLogin && optOutLogins.has(lp.githubLogin.toLowerCase()))) continue;
    const person = await savePerson({
      source: "linkedin", pdlId: lp.pdlId, linkedinUrl: lp.linkedinUrl, githubLogin: lp.githubLogin, name: lp.name,
      location: lp.location, headline: lp.headline, company: lp.company, bio: lp.bio, hasLinkedIn: true,
      skills: json(lp.skills), experience: json(lp.experience), fetchedAt: new Date(),
    });
    out.push(describe(person, brief, rules));
  }
  await db.agentRun.update({ where: { id: run.id }, data: { looked: { increment: out.length } } });
  return { progress: `Searching LinkedIn: ${search.title || "people"}${search.cities.length && !search.remote ? ` in ${search.cities.join(", ")}` : ""}`, result: { people: out } };
}

/** Everything in a person's profile the agent may cite: repository names, roles, companies, skills, languages. */
function citable(p: Person): string[] {
  const sp = toScorable(p);
  return [
    ...sp.topRepos.map((r: Repo) => r.name), ...sp.experience.flatMap((r: Role) => [r.title, r.company ?? ""]),
    p.headline ?? "", p.company ?? "", ...sp.skills, ...Object.keys(sp.languages),
  ].map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
}

async function addCandidatesTool(run: RunWithRole, input: Record<string, unknown>) {
  const items = (Array.isArray(input.candidates) ? input.candidates : []).slice(0, 5) as Record<string, unknown>[];
  const brief = run.role.brief as unknown as Brief;
  const rules = (run.role.rules ?? {}) as RoleRules;
  const results = [];
  let added = run.added;
  const names: string[] = [];
  for (const it of items) {
    const personId = String(it.person_id ?? "");
    const person = await db.person.findUnique({ where: { id: personId } });
    if (!person) { results.push({ person_id: personId, added: false, reason: "No person with that id. Use person_id exactly as the tools returned it." }); continue; }
    if (added >= LIMITS.adds) { results.push({ person_id: personId, added: false, reason: "This run has added as many people as it may. Finish now." }); continue; }
    const { score, checks, status } = assess(person, brief, rules);
    if (checks.find((c) => c.importance === "location")?.status === "no") { results.push({ person_id: personId, added: false, reason: "They're outside the role's area." }); continue; }
    if (status !== "review" && score < POSSIBLE) { results.push({ person_id: personId, added: false, reason: "Too weak a match against the brief's must-haves." }); continue; }
    // The safety check: every piece of evidence must be in their actual profile.
    const evidence = (Array.isArray(it.evidence) ? it.evidence : []).map(String).filter((e) => e.trim()).slice(0, 6);
    const known = citable(person);
    const unverified = evidence.filter((e) => { const x = e.trim().toLowerCase(); return !known.some((k) => k.includes(x) || x.includes(k)); });
    if (!evidence.length || unverified.length) {
      results.push({ person_id: personId, added: false, reason: evidence.length ? `Couldn't find ${unverified.map((u) => `"${u}"`).join(", ")} in their profile. Cite only repository names, roles, companies or skills the tools showed.` : "Give at least one piece of evidence from their profile." });
      continue;
    }
    const existing = await db.match.findUnique({ where: { roleId_personId: { roleId: run.roleId, personId } } });
    if (existing && existing.status !== "filtered" && existing.status !== "review") { results.push({ person_id: personId, added: false, reason: "The recruiter has already decided on this person." }); continue; }
    const note: Note = { why: String(it.why ?? "").slice(0, 400), opener: String(it.opener ?? "").slice(0, 300), evidence };
    await db.match.upsert({
      where: { roleId_personId: { roleId: run.roleId, personId } },
      create: { roleId: run.roleId, personId, score, checks: json(checks), status: "review", foundBy: "agent", note: json(note) },
      update: { score, checks: json(checks), status: "review", foundBy: "agent", note: json(note) },
    });
    added++;
    names.push(person.name ?? person.githubLogin ?? "someone");
    results.push({ person_id: personId, added: true });
  }
  await db.agentRun.update({ where: { id: run.id }, data: { added } });
  return { progress: names.length ? `Added ${names.join(", ")}` : run.progress, result: { results, added_this_run: added } };
}

async function askRecruiterTool(run: RunWithRole, input: Record<string, unknown>) {
  const questions = (run.role.questions ?? []) as Question[];
  const change = input.change as Change | undefined;
  const text = String(input.question ?? "").trim().slice(0, 240);
  const valid = change && (change.type === "allow_remote" || (change.type === "add_location" && change.location) ||
    (change.type === "make_optional" && change.requirement) || (change.type === "add_requirement" && change.label));
  if (!text || !valid) return { progress: run.progress, result: { error: "A question needs text and a valid change." } };
  if (questions.filter((q) => q.status === "open").length >= 2) return { progress: run.progress, result: { error: "Two questions are already waiting for the recruiter. Don't ask more." } };
  const key = JSON.stringify(change).toLowerCase();
  if (questions.some((q) => JSON.stringify(q.change).toLowerCase() === key)) return { progress: run.progress, result: { error: "You've asked this before; respect the answer." } };
  const q: Question = { id: crypto.randomUUID(), text, change, status: "open", askedAt: new Date().toISOString() };
  await db.role.update({ where: { id: run.roleId }, data: { questions: json([...questions, q]) } });
  return { progress: "Asked you a question", result: { asked: true } };
}

// ---------- answers and the end of a run ----------

/** What a "yes" to a question changes in the brief. */
export function applyChange(brief: Brief, change: Change): Brief {
  switch (change.type) {
    case "allow_remote": return { ...brief, remoteOk: true };
    case "add_location": return { ...brief, locations: [...new Set([...brief.locations, change.location])] };
    case "make_optional": return { ...brief, criteria: brief.criteria.map((c) => (c.label.toLowerCase() === change.requirement.toLowerCase() ? { ...c, importance: "nice" } : c)) };
    case "add_requirement": return { ...brief, criteria: [...brief.criteria, { label: change.label, importance: "nice", signals: change.signals ?? [], languages: change.languages ?? [] }] };
  }
}

export async function answerQuestion(roleId: string, questionId: string, yes: boolean) {
  const role = await db.role.findUniqueOrThrow({ where: { id: roleId } });
  const questions = (role.questions ?? []) as Question[];
  const q = questions.find((x) => x.id === questionId && x.status === "open");
  if (!q) return;
  const brief = yes ? applyChange(role.brief as unknown as Brief, q.change) : (role.brief as unknown as Brief);
  await db.role.update({ where: { id: roleId }, data: { brief: json(brief), questions: json(questions.map((x) => (x.id === questionId ? { ...x, status: yes ? "yes" : "no" } : x))) } });
  if (yes) await markForRescore(roleId);
}

async function emailRecruiter(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }), signal: AbortSignal.timeout(10_000),
  }).catch((e) => { console.error("Email failed", e); return null; });
  if (res && !res.ok) console.error("Email failed", res.status, await res.text().catch(() => ""));
}

export async function finishRun(runId: string, outcome: { summary?: string; error?: string }) {
  const run = await db.agentRun.findUnique({ where: { id: runId }, include: { role: { include: { user: true } } } });
  if (!run || run.status === "done" || run.status === "failed") return;
  const failed = Boolean(outcome.error);
  const summary = outcome.summary?.trim().slice(0, 1200) || (failed ? null : `Added ${run.added} candidate${run.added === 1 ? "" : "s"}.`);
  await db.agentRun.update({
    where: { id: runId },
    data: { status: failed ? "failed" : "done", summary, error: outcome.error?.slice(0, 300) ?? null, progress: failed ? "Stopped" : "Finished", finishedAt: new Date() },
  });
  const open = ((run.role.questions ?? []) as Question[]).filter((q) => q.status === "open");
  if (!failed && (run.added > 0 || open.length)) {
    const site = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
    await emailRecruiter(
      run.role.user.email,
      run.added ? `${run.added} new candidate${run.added === 1 ? "" : "s"} for ${run.role.title}` : `A question about ${run.role.title}`,
      [summary, ...open.map((q) => `Question: ${q.text}`), "", `Review them: ${site}/app/roles/${run.roleId}`].filter((l) => l !== null).join("\n"),
    );
  }
}
