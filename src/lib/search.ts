import "server-only";
import type { Person, Prisma } from "@prisma/client";
import { db } from "./db";
import { findableOnGithub, toBrief, type Brief, type RoleRules } from "./brief";
import { GitHubError, fetchProfile, searchRepoOwners, searchUsers, type Profile, type Repo } from "./github";
import { PdlError, hasPdl, paramsFromBrief, searchLinkedIn, type LinkedInPerson, type Role } from "./pdl";
import { scorePerson, type ScorablePerson } from "./score";

type Query = { key: string; kind: "repos" | "users"; q: string };
/** Pages read per query (-1 when a query has no more results) and people found but not yet looked at. */
export type SearchState = {
  pages?: Record<string, number>; pending?: string[]; pdlScroll?: string | null; pdlDone?: boolean; pdlTotal?: number; v?: number;
  /** What the last search had to tell the recruiter, if anything. */
  note?: string | null;
};

const BATCH = 12; // people looked at per run, so a run stays well inside a web request's time limit
const MAX_SEARCHES = 3; // GitHub searches per run
const PDL_BATCH = 10; // LinkedIn profiles per run; each one costs a People Data Labs credit
export const MIN_SCORE = 60; // below this a person stays out of the queue
export const POSSIBLE = 45; // the agent may add someone this strong, with its reasons
/** Bump when scoring changes: each role re-scores its candidates the next time it's opened. */
export const SCORE_VERSION = 5;
const FRESH_MS = 7 * 86_400_000; // reuse a fetched profile for a week
const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * GitHub searches for a brief: repositories about each search term, then people by language and city.
 * None when the people can't be found through code: other professions, or a required employer
 * (GitHub profiles rarely say where someone has worked).
 */
export function buildQueries(brief: Brief): Query[] {
  if (!findableOnGithub(brief)) return [];
  const lang =
    brief.criteria.find((c) => c.importance === "must" && c.languages.length)?.languages[0] ??
    brief.criteria.find((c) => c.languages.length)?.languages[0];
  const langQ = lang ? ` language:"${lang}"` : "";
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const phrase = (t: string) => (t.includes(" ") ? `"${t}"` : t);
  const repoQueries: Query[] = brief.searchTerms
    .slice(0, 3)
    .map((t) => ({ key: `r:${t.toLowerCase()}`, kind: "repos", q: `${phrase(t)}${langQ} stars:>3 pushed:>${since}` }));
  const userQueries: Query[] = [];
  const cities = brief.locations.map((l) => l.split(",")[0].trim()).filter(Boolean).slice(0, 2);
  if (lang) {
    for (const c of cities) userQueries.push({ key: `u:${c.toLowerCase()}`, kind: "users", q: `language:"${lang}" location:"${c}" repos:>3 followers:>5` });
    if (!cities.length || brief.remoteOk) userQueries.push({ key: "u:any", kind: "users", q: `language:"${lang}" repos:>5 followers:>30` });
  }
  // When the role is tied to cities, people searched by city come first: they're the ones who can take it.
  return cities.length && !brief.remoteOk ? [...userQueries, ...repoQueries] : [...repoQueries, ...userQueries];
}

export function toScorable(p: Person): ScorablePerson & { followers: number; hireable: boolean | null } {
  return {
    bio: p.bio, company: p.company, location: p.location, headline: p.headline, followers: p.followers, hireable: p.hireable,
    languages: p.languages as Record<string, number>, topRepos: p.topRepos as Repo[],
    totalStars: p.totalStars, lastPushAt: p.lastPushAt,
    skills: p.skills as string[], experience: p.experience as Role[], yearsExperience: p.yearsExperience,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export type PersonFields = Omit<Prisma.PersonCreateInput, "matches">;
const KEYS = ["githubLogin", "linkedinUrl", "pdlId"] as const;

/**
 * Saves a person found on GitHub or LinkedIn. Someone already stored under the same GitHub username,
 * LinkedIn address or PDL id is updated rather than duplicated, and fields this source doesn't have are kept.
 */
export async function savePerson(data: PersonFields): Promise<Person> {
  const or = KEYS.flatMap((k) => (data[k] ? [{ [k]: data[k] }] : []));
  const found = or.length ? await db.person.findMany({ where: { OR: or } }) : [];
  if (!found.length) return db.person.create({ data });
  const [target, ...others] = found;
  const update: Record<string, unknown> = { ...data };
  delete update.source;
  for (const [k, v] of Object.entries(update)) if (v === null || v === undefined) delete update[k];
  for (const k of KEYS) if (update[k] && others.some((o) => o[k] === update[k])) delete update[k];
  if (target.hasLinkedIn) delete update.hasLinkedIn; // GitHub not linking LinkedIn doesn't undo a LinkedIn profile we found
  return db.person.update({ where: { id: target.id }, data: update as Prisma.PersonUpdateInput });
}

/** Saves a profile that came from People Data Labs. */
export const saveLinkedInPerson = (lp: LinkedInPerson) =>
  savePerson({
    source: "linkedin", pdlId: lp.pdlId, linkedinUrl: lp.linkedinUrl, githubLogin: lp.githubLogin, name: lp.name,
    location: lp.location, headline: lp.headline, company: lp.company, bio: lp.bio, email: lp.email, hasLinkedIn: true,
    skills: json(lp.skills), experience: json(lp.experience), yearsExperience: lp.yearsExperience, fetchedAt: new Date(),
  });

/** What to tell a recruiter whose search can only be answered from LinkedIn profiles when those aren't connected. */
export const NEEDS_LINKEDIN = "This search needs LinkedIn profiles, and they aren't connected yet. Add a People Data Labs key (PDL_API_KEY) to your site's environment variables, then run the search again.";

export type SearchResult = { added: number; looked: number; message?: string };

/**
 * One run for a role: up to BATCH people from GitHub (found through their code, many not on LinkedIn)
 * and, when People Data Labs is set up, up to PDL_BATCH LinkedIn profiles. Good matches join the queue.
 */
export async function runSearch(roleId: string, userId: string): Promise<SearchResult> {
  const role = await db.role.findFirst({ where: { id: roleId, userId } });
  if (!role) throw new Error("Role not found");
  const brief = toBrief(role.brief);
  const rules = (role.rules ?? {}) as RoleRules;
  const state = (role.searchState ?? {}) as SearchState;
  const pages = { ...(state.pages ?? {}) };
  let pending = [...(state.pending ?? [])];
  let pdlScroll = state.pdlScroll ?? null;
  let pdlDone = state.pdlDone ?? false;
  let pdlTotal = state.pdlTotal;

  const [known, optedOut] = await Promise.all([
    db.match.findMany({ where: { roleId }, select: { person: { select: { githubLogin: true, linkedinUrl: true } } } }),
    db.optOut.findMany({ select: { githubLogin: true, linkedinUrl: true } }),
  ]);
  const people = [...known.map((m) => m.person), ...optedOut];
  const seen = new Set(people.flatMap((p) => (p.githubLogin ? [p.githubLogin.toLowerCase()] : [])));
  const seenLinkedIn = new Set(people.flatMap((p) => (p.linkedinUrl ? [p.linkedinUrl] : [])));
  pending = pending.filter((l) => !seen.has(l.toLowerCase()));
  pending.forEach((l) => seen.add(l.toLowerCase()));

  let added = 0, looked = 0;
  const notes: string[] = [];
  const addMatch = async (person: Person) => {
    looked++;
    const { score, checks, status } = assess(person, brief, rules);
    await db.match.upsert({
      where: { roleId_personId: { roleId, personId: person.id } },
      create: { roleId, personId: person.id, score, checks: json(checks), status },
      update: {},
    });
    if (status === "review") added++;
  };

  // GitHub: people found through what they've built.
  const queries = buildQueries(brief)
    .filter((q) => pages[q.key] !== -1)
    .sort((a, b) => (pages[a.key] ?? 0) - (pages[b.key] ?? 0));
  let githubNote: string | undefined;
  try {
    for (const q of queries.slice(0, MAX_SEARCHES)) {
      if (pending.length >= BATCH) break;
      const page = (pages[q.key] ?? 0) + 1;
      const found = q.kind === "repos" ? await searchRepoOwners(q.q, page) : await searchUsers(q.q, page);
      pages[q.key] = found.length && page < 10 ? page : -1;
      for (const login of found) if (!seen.has(login.toLowerCase())) { seen.add(login.toLowerCase()); pending.push(login); }
    }
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e;
    githubNote = e.message;
  }

  const batch = pending.slice(0, BATCH);
  pending = pending.slice(BATCH);
  const cached = new Map(
    (await db.person.findMany({ where: { githubLogin: { in: batch } } }))
      .filter((p) => Date.now() - p.fetchedAt.getTime() < FRESH_MS)
      .map((p) => [(p.githubLogin ?? "").toLowerCase(), p]),
  );
  const leftover: string[] = [];
  await mapLimit(batch, 6, async (login) => {
    let person = cached.get(login.toLowerCase());
    if (!person) {
      let profile: Profile | null;
      try { profile = await fetchProfile(login); }
      catch (e) {
        if (e instanceof GitHubError) { githubNote = e.message; leftover.push(login); return; }
        return; // a profile that can't be read is skipped
      }
      if (!profile) return;
      if (profile.linkedinUrl && seenLinkedIn.has(profile.linkedinUrl)) return; // already in this role, or opted out
      person = await savePerson({ ...profile, languages: json(profile.languages), topRepos: json(profile.topRepos), fetchedAt: new Date() });
    }
    await addMatch(person);
  });
  if (githubNote) notes.push(githubNote);

  // LinkedIn, through People Data Labs.
  if (hasPdl() && !pdlDone) {
    try {
      const found = await searchLinkedIn(paramsFromBrief(brief), PDL_BATCH, pdlScroll);
      if (!pdlScroll) pdlTotal = found.total; // how many people match on LinkedIn, from the first page
      pdlScroll = found.scrollToken;
      pdlDone = !found.scrollToken || !found.people.length;
      for (const lp of found.people) {
        if (seenLinkedIn.has(lp.linkedinUrl) || (lp.githubLogin && seen.has(lp.githubLogin.toLowerCase()))) continue;
        seenLinkedIn.add(lp.linkedinUrl);
        await addMatch(await saveLinkedInPerson(lp));
      }
    } catch (e) {
      if (!(e instanceof PdlError)) throw e;
      notes.push(e.message);
    }
  }
  if (!hasPdl() && !findableOnGithub(brief)) notes.push(NEEDS_LINKEDIN);
  else if (!batch.length && !queries.length && (pdlDone || !hasPdl())) notes.push(looked ? "That's everyone this search finds. Change the filters to look further." : "No one new matches this search. Try widening the filters: fewer job titles or requirements, more places, or any employer.");

  await db.role.update({
    where: { id: roleId },
    data: { searchState: json({ pages, pending: [...leftover, ...pending], pdlScroll, pdlDone, pdlTotal, v: state.v ?? SCORE_VERSION, note: notes.join(" ") || null }), lastSearchAt: new Date() },
  });
  return { added, looked, message: notes.length ? notes.join(" ") : undefined };
}

export type Blocked = "area" | "location" | "company" | "employer" | "excluded";
/** Why someone can't be added, in words for the agent and the recruiter. */
export const BLOCKED_REASON: Record<Blocked, string> = {
  area: "outside the search's locations",
  location: "in a place the recruiter ruled out",
  company: "works at a company the recruiter said to avoid",
  employer: "hasn't worked at any of the required employers",
  excluded: "has a job title the recruiter ruled out",
};

/**
 * Score a person for a role and decide whether they belong in its queue. `blocked` says why someone
 * can't be shown whatever their score: outside the role's area, in a location the recruiter ruled
 * out, working at a company the recruiter said to avoid, never at an employer the search requires,
 * or holding a job title the recruiter ruled out.
 */
export function assess(person: Person, brief: Brief, rules: RoleRules, minScore = MIN_SCORE) {
  const { score, checks, outOfArea, missingEmployer, excluded: ruledOut } = scorePerson(toScorable(person), brief);
  const excluded = rules.excludedLocations?.some((x) => person.location?.toLowerCase().includes(x.toLowerCase()));
  const employers = [person.company, ...(person.experience as Role[]).filter((r) => r.current).map((r) => r.company)]
    .flatMap((c) => (c ? [c.toLowerCase()] : []));
  const avoided = rules.avoidCompanies?.some((a) => a.trim() && employers.some((e) => e.includes(a.trim().toLowerCase())));
  const blocked: Blocked | null = outOfArea ? "area" : excluded ? "location" : avoided ? "company" : missingEmployer ? "employer" : ruledOut ? "excluded" : null;
  return { score, checks, blocked, status: score >= minScore && !blocked ? "review" : "filtered" };
}

/** The status a stored match should have after re-scoring. People the recruiter added themselves always stay. */
function reassess(m: { foundBy: string; person: Person }, brief: Brief, rules: RoleRules) {
  const a = assess(m.person, brief, rules, m.foundBy === "agent" ? POSSIBLE : MIN_SCORE);
  return m.foundBy === "you" ? { ...a, status: "review" } : a;
}

/** A GitHub user from our store when fresh, otherwise fetched and saved. Null for organizations and unreadable profiles. */
export async function loadGithubPerson(login: string): Promise<Person | null> {
  const stored = await db.person.findFirst({ where: { githubLogin: { equals: login, mode: "insensitive" } } });
  if (stored && Date.now() - stored.fetchedAt.getTime() < FRESH_MS) return stored;
  const profile = await fetchProfile(login).catch((e) => { if (e instanceof GitHubError) throw e; return null; });
  if (!profile) return stored;
  return savePerson({ ...profile, languages: json(profile.languages), topRepos: json(profile.topRepos), fetchedAt: new Date() });
}

/**
 * Rediscovery: people already found for other roles who fit this one. Free and instant, because it
 * only uses stored profiles. Adds the best to the role's queue and returns how many.
 */
export async function matchFromPool(roleId: string): Promise<number> {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { brief: true, rules: true, matches: { select: { personId: true } } } });
  if (!role) return 0;
  const brief = toBrief(role.brief);
  const rules = (role.rules ?? {}) as RoleRules;
  const have = new Set(role.matches.map((m) => m.personId));
  const people = await db.person.findMany({ orderBy: { fetchedAt: "desc" }, take: 3000 });
  const fits = people
    .filter((p) => !have.has(p.id))
    .map((p) => ({ p, a: assess(p, brief, rules) }))
    .filter((x) => x.a.status === "review")
    .sort((x, y) => y.a.score - x.a.score)
    .slice(0, 25);
  if (fits.length) {
    await db.match.createMany({
      data: fits.map(({ p, a }) => ({ roleId, personId: p.id, score: a.score, checks: json(a.checks), status: "review", foundBy: "pool" })),
      skipDuplicates: true,
    });
  }
  return fits.length;
}

/** After the brief changes: searches start over and candidates are re-scored the next time the role opens. */
export async function resetSearch(roleId: string) {
  await db.role.update({ where: { id: roleId }, data: { searchState: json({ v: 0 }) } });
}

/** Re-scores a role's undecided candidates when scoring or the role's rules have changed. Uses stored data only. */
export async function rescoreIfStale(roleId: string, userId: string) {
  const role = await db.role.findFirst({ where: { id: roleId, userId }, select: { brief: true, rules: true, searchState: true } });
  const state = (role?.searchState ?? {}) as SearchState;
  if (!role || state.v === SCORE_VERSION) return;
  const brief = toBrief(role.brief);
  const rules = (role.rules ?? {}) as RoleRules;
  const matches = await db.match.findMany({ where: { roleId, status: { in: ["review", "filtered"] } }, include: { person: true } });
  await db.$transaction([
    ...matches.map((m) => {
      const { score, checks, status } = reassess(m, brief, rules);
      return db.match.update({ where: { id: m.id }, data: { score, checks: json(checks), status } });
    }),
    db.role.update({ where: { id: roleId }, data: { searchState: json({ ...state, v: SCORE_VERSION }) } }),
  ]);
}

/** Makes the role re-score its candidates the next time it's opened. */
export async function markForRescore(roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { searchState: true } });
  if (role) await db.role.update({ where: { id: roleId }, data: { searchState: json({ ...((role.searchState ?? {}) as SearchState), v: 0 }) } });
}
