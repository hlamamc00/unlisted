import "server-only";
import type { Brief } from "./brief";
import { normalizeLinkedIn } from "./linkedin";

// LinkedIn profiles come from People Data Labs (PDL), a licensed provider of professional
// profile data. Unlisted never scrapes LinkedIn itself. Each person returned costs one PDL credit.
const BASE = (process.env.PDL_API_BASE || "https://api.peopledatalabs.com/v5").replace(/\/$/, "");

export const hasPdl = () => Boolean(process.env.PDL_API_KEY);

/** A PDL problem the recruiter should see: a rejected key, used-up credits or rate limits. */
export class PdlError extends Error {}

type PdlExperience = { company?: { name?: string | null } | null; title?: { name?: string | null } | null; is_primary?: boolean | null };
type PdlPerson = {
  id?: string | null; full_name?: string | null; job_title?: string | null; job_company_name?: string | null;
  headline?: string | null; summary?: string | null; location_name?: string | boolean | null;
  linkedin_url?: string | null; github_username?: string | null; skills?: string[] | null; experience?: PdlExperience[] | null;
  work_email?: string | boolean | null; recommended_personal_email?: string | boolean | null; personal_emails?: string[] | boolean | null;
};

export type Role = { title: string; company: string | null; current: boolean };
export type LinkedInPerson = {
  pdlId: string | null; linkedinUrl: string; githubLogin: string | null; name: string | null; location: string | null;
  headline: string | null; company: string | null; bio: string | null; email: string | null; skills: string[]; experience: Role[];
};

// On the free plan PDL sends `true` in place of some values it hides; treat those as missing.
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const LEVELS = /\b(senior|sr|junior|jr|staff|lead|principal|head|chief|ii|iii|iv)\b\.?/gi;

/**
 * What to look for on LinkedIn: job title words, skills that must be listed, cities (ignored when
 * remote), skills that rank higher, and optionally the employers to look in.
 */
export type PdlSearch = { title: string; skills: string[]; cities: string[]; remote: boolean; boost: string[]; companies?: string[] };

export function paramsFromBrief(brief: Brief): PdlSearch {
  return {
    title: brief.title.split(/[–—\-,(|:]/)[0].replace(LEVELS, " ").replace(/\s+/g, " ").trim(),
    skills: [...new Set(brief.criteria.filter((c) => c.importance === "must").flatMap((c) => c.languages))],
    cities: brief.locations.map((l) => l.split(",")[0].trim()).filter(Boolean),
    remote: brief.remoteOk,
    boost: [...new Set(brief.criteria.flatMap((c) => c.signals).filter(Boolean))].slice(0, 12),
  };
}

/** People in the US with a LinkedIn profile, in the right kind of job, listing the must-have skills. */
export function buildPdlQuery(s: PdlSearch): object {
  const lower = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const title = s.title.replace(LEVELS, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const must: object[] = [{ term: { location_country: "united states" } }, { exists: { field: "linkedin_url" } }];
  if (title) must.push({ match: { job_title: title } });
  if (s.skills.length) must.push({ terms: { skills: lower(s.skills) } });
  if (s.cities.length && !s.remote) must.push({ bool: { should: lower(s.cities).map((c) => ({ match: { location_locality: c } })) } });
  if (s.companies?.length) must.push({ bool: { should: lower(s.companies).slice(0, 8).map((c) => ({ match_phrase: { job_company_name: c } })) } });
  return { bool: { must, should: lower(s.boost).slice(0, 12).map((b) => ({ match_phrase: { skills: b } })) } };
}

function toPerson(p: PdlPerson): LinkedInPerson | null {
  const linkedinUrl = normalizeLinkedIn(str(p.linkedin_url));
  if (!linkedinUrl) return null;
  const experience = (p.experience ?? []).slice(0, 5).flatMap((e) => {
    const title = str(e.title?.name);
    return title ? [{ title, company: str(e.company?.name), current: Boolean(e.is_primary) }] : [];
  });
  return {
    pdlId: str(p.id),
    linkedinUrl,
    githubLogin: str(p.github_username),
    name: str(p.full_name),
    location: str(p.location_name),
    headline: str(p.job_title),
    company: str(p.job_company_name),
    bio: str(p.headline) ?? str(p.summary)?.slice(0, 400) ?? null,
    // Contact emails only come with PDL plans that include them.
    email: str(p.work_email) ?? str(p.recommended_personal_email) ?? (Array.isArray(p.personal_emails) ? str(p.personal_emails[0]) : null),
    skills: (p.skills ?? []).filter((s): s is string => typeof s === "string").slice(0, 40),
    experience,
  };
}

function check(res: Response) {
  if (res.status === 401 || res.status === 403) throw new PdlError("People Data Labs rejected the PDL_API_KEY. Check it in your site's environment variables.");
  if (res.status === 402) throw new PdlError("Your People Data Labs credits are used up, so LinkedIn profiles weren't searched.");
  if (res.status === 429) throw new PdlError("People Data Labs is limiting requests right now. Try again in a minute.");
  if (!res.ok) throw new PdlError(`People Data Labs couldn't answer right now (error ${res.status}).`);
}

/** One page of LinkedIn profiles. Pass the returned scrollToken to get the next page of the same search. */
export async function searchLinkedIn(search: PdlSearch, size: number, scrollToken?: string | null) {
  const res = await fetch(`${BASE}/person/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": process.env.PDL_API_KEY ?? "" },
    body: JSON.stringify({ query: buildPdlQuery(search), size, titlecase: true, ...(scrollToken ? { scroll_token: scrollToken } : {}) }),
    cache: "no-store",
  });
  if (res.status === 404) return { people: [], scrollToken: null, total: 0 }; // PDL answers 404 when nothing matches
  check(res);
  const body = (await res.json()) as { data?: PdlPerson[]; scroll_token?: string | null; total?: number };
  const people = (body.data ?? []).flatMap((p) => toPerson(p) ?? []);
  return { people, scrollToken: body.scroll_token ?? null, total: body.total ?? people.length };
}

/** One person by their LinkedIn profile address (uses one credit). Null when PDL doesn't know them. */
export async function enrichLinkedIn(linkedinUrl: string): Promise<LinkedInPerson | null> {
  const res = await fetch(`${BASE}/person/enrich?${new URLSearchParams({ profile: linkedinUrl, titlecase: "true" })}`, {
    headers: { "X-Api-Key": process.env.PDL_API_KEY ?? "" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  check(res);
  const body = (await res.json()) as { data?: PdlPerson };
  if (!body.data) return null;
  // PDL may hide the address on some plans; we asked for this exact profile, so keep it.
  return toPerson({ ...body.data, linkedin_url: str(body.data.linkedin_url) ?? linkedinUrl });
}
