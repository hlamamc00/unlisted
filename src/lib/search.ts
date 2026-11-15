import "server-only";
import type { Person, Prisma } from "@prisma/client";
import { db } from "./db";
import type { Brief, RoleRules } from "./brief";
import { GitHubError, fetchProfile, searchRepoOwners, searchUsers, type Profile, type Repo } from "./github";
import { scorePerson, type ScorablePerson } from "./score";

type Query = { key: string; kind: "repos" | "users"; q: string };
/** Pages read per query (-1 when a query has no more results) and people found but not yet looked at. */
type SearchState = { pages?: Record<string, number>; pending?: string[]; v?: number };

const BATCH = 12; // people looked at per run, so a run stays well inside a web request's time limit
const MAX_SEARCHES = 3; // GitHub searches per run
export const MIN_SCORE = 60; // below this a person stays out of the queue
/** Bump when scoring changes: each role re-scores its candidates the next time it's opened. */
export const SCORE_VERSION = 2;
const FRESH_MS = 7 * 86_400_000; // reuse a fetched profile for a week
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** GitHub searches for a brief: repositories about each search term, then people by language and city. */
export function buildQueries(brief: Brief): Query[] {
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
    bio: p.bio, company: p.company, location: p.location, followers: p.followers, hireable: p.hireable,
    languages: p.languages as Record<string, number>, topRepos: p.topRepos as Repo[],
    totalStars: p.totalStars, lastPushAt: p.lastPushAt,
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

export type SearchResult = { added: number; looked: number; message?: string };

/** One run: find up to BATCH new people for a role, score them and add the good ones to its queue. */
export async function runSearch(roleId: string, userId: string): Promise<SearchResult> {
  const role = await db.role.findFirst({ where: { id: roleId, userId } });
  if (!role) throw new Error("Role not found");
  const brief = role.brief as unknown as Brief;
  const rules = (role.rules ?? {}) as RoleRules;
  const state = (role.searchState ?? {}) as SearchState;
  const pages = { ...(state.pages ?? {}) };
  let pending = [...(state.pending ?? [])];

  const [known, optedOut] = await Promise.all([
    db.match.findMany({ where: { roleId }, select: { person: { select: { githubLogin: true } } } }),
    db.optOut.findMany({ select: { githubLogin: true } }),
  ]);
  const seen = new Set([...known.map((m) => m.person.githubLogin), ...optedOut.map((o) => o.githubLogin)].map((l) => l.toLowerCase()));
  pending = pending.filter((l) => !seen.has(l.toLowerCase()));
  pending.forEach((l) => seen.add(l.toLowerCase()));

  let message: string | undefined;
  const queries = buildQueries(brief)
    .filter((q) => pages[q.key] !== -1)
    .sort((a, b) => (pages[a.key] ?? 0) - (pages[b.key] ?? 0));
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
    message = e.message;
  }
  if (!pending.length && !queries.length) message ??= "There are no more GitHub results for this brief. Edit the brief to search differently.";

  const batch = pending.slice(0, BATCH);
  pending = pending.slice(BATCH);
  const cached = new Map(
    (await db.person.findMany({ where: { githubLogin: { in: batch } } }))
      .filter((p) => Date.now() - p.fetchedAt.getTime() < FRESH_MS)
      .map((p) => [p.githubLogin.toLowerCase(), p]),
  );

  let added = 0, looked = 0;
  const leftover: string[] = [];
  await mapLimit(batch, 6, async (login) => {
    let person = cached.get(login.toLowerCase());
    if (!person) {
      let profile: Profile | null;
      try { profile = await fetchProfile(login); }
      catch (e) {
        if (e instanceof GitHubError) { message = e.message; leftover.push(login); return; }
        return; // a profile that can't be read is skipped
      }
      if (!profile) return;
      const data = { ...profile, languages: json(profile.languages), topRepos: json(profile.topRepos), fetchedAt: new Date() };
      person = await db.person.upsert({ where: { githubLogin: profile.githubLogin }, create: data, update: data });
    }
    looked++;
    const { score, checks, status } = assess(person, brief, rules);
    await db.match.upsert({
      where: { roleId_personId: { roleId, personId: person.id } },
      create: { roleId, personId: person.id, score, checks: json(checks), status },
      update: {},
    });
    if (status === "review") added++;
  });

  await db.role.update({
    where: { id: roleId },
    data: { searchState: json({ pages, pending: [...leftover, ...pending], v: SCORE_VERSION }), lastSearchAt: new Date() },
  });
  return { added, looked, message };
}

/** Score a person for a role and decide whether they belong in its queue. */
function assess(person: Person, brief: Brief, rules: RoleRules) {
  const { score, checks, outOfArea } = scorePerson(toScorable(person), brief);
  const excluded = rules.excludedLocations?.some((x) => person.location?.toLowerCase().includes(x.toLowerCase()));
  return { score, checks, status: score >= MIN_SCORE && !outOfArea && !excluded ? "review" : "filtered" };
}

/** Re-scores a role's undecided candidates when scoring or the role's rules have changed. Uses stored data only. */
export async function rescoreIfStale(roleId: string, userId: string) {
  const role = await db.role.findFirst({ where: { id: roleId, userId }, select: { brief: true, rules: true, searchState: true } });
  const state = (role?.searchState ?? {}) as SearchState;
  if (!role || state.v === SCORE_VERSION) return;
  const brief = role.brief as unknown as Brief;
  const rules = (role.rules ?? {}) as RoleRules;
  const matches = await db.match.findMany({ where: { roleId, status: { in: ["review", "filtered"] } }, include: { person: true } });
  await db.$transaction([
    ...matches.map((m) => {
      const { score, checks, status } = assess(m.person, brief, rules);
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
