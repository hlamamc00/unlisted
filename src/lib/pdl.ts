import "server-only";
import type { Brief } from "./brief";
import { normalizeLinkedIn } from "./linkedin";

// LinkedIn profiles come from People Data Labs (PDL), a licensed provider of professional
// profile data. Unlisted never scrapes LinkedIn itself. Each person returned costs one PDL credit.
const API = process.env.PDL_API_URL || "https://api.peopledatalabs.com/v5/person/search";

export const hasPdl = () => Boolean(process.env.PDL_API_KEY);

/** A PDL problem the recruiter should see: a rejected key, used-up credits or rate limits. */
export class PdlError extends Error {}

type PdlExperience = { company?: { name?: string | null } | null; title?: { name?: string | null } | null; is_primary?: boolean | null };
type PdlPerson = {
  id?: string | null; full_name?: string | null; job_title?: string | null; job_company_name?: string | null;
  headline?: string | null; summary?: string | null; location_name?: string | boolean | null;
  linkedin_url?: string | null; github_username?: string | null; skills?: string[] | null; experience?: PdlExperience[] | null;
};

export type Role = { title: string; company: string | null; current: boolean };
export type LinkedInPerson = {
  pdlId: string | null; linkedinUrl: string; githubLogin: string | null; name: string | null; location: string | null;
  headline: string | null; company: string | null; bio: string | null; skills: string[]; experience: Role[];
};

// On the free plan PDL sends `true` in place of some values it hides; treat those as missing.
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const LEVELS = /\b(senior|sr|junior|jr|staff|lead|principal|head|chief|ii|iii|iv)\b\.?/gi;

/** People in the US with a LinkedIn profile, in the right kind of job, listing the role's must-have languages. */
export function buildPdlQuery(brief: Brief): object {
  const title = brief.title.split(/[–—\-,(|:]/)[0].replace(LEVELS, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const langs = [...new Set(brief.criteria.filter((c) => c.importance === "must").flatMap((c) => c.languages).map((l) => l.toLowerCase()))];
  const signals = [...new Set(brief.criteria.flatMap((c) => c.signals).map((s) => s.toLowerCase()).filter(Boolean))].slice(0, 12);
  const cities = brief.locations.map((l) => l.split(",")[0].trim().toLowerCase()).filter(Boolean);

  const must: object[] = [{ term: { location_country: "united states" } }, { exists: { field: "linkedin_url" } }];
  if (title) must.push({ match: { job_title: title } });
  if (langs.length) must.push({ terms: { skills: langs } });
  if (cities.length && !brief.remoteOk) must.push({ bool: { should: cities.map((c) => ({ match: { location_locality: c } })) } });
  return { bool: { must, should: signals.map((s) => ({ match_phrase: { skills: s } })) } };
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
    skills: (p.skills ?? []).filter((s): s is string => typeof s === "string").slice(0, 40),
    experience,
  };
}

/** One page of LinkedIn profiles for a brief. Pass the returned scrollToken to get the next page. */
export async function searchLinkedIn(brief: Brief, size: number, scrollToken?: string | null) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": process.env.PDL_API_KEY ?? "" },
    body: JSON.stringify({ query: buildPdlQuery(brief), size, titlecase: true, ...(scrollToken ? { scroll_token: scrollToken } : {}) }),
    cache: "no-store",
  });
  if (res.status === 404) return { people: [], scrollToken: null, total: 0 }; // PDL answers 404 when nothing matches
  if (res.status === 401 || res.status === 403) throw new PdlError("People Data Labs rejected the PDL_API_KEY. Check it in your site's environment variables.");
  if (res.status === 402) throw new PdlError("Your People Data Labs credits are used up, so LinkedIn profiles weren't searched.");
  if (res.status === 429) throw new PdlError("People Data Labs is limiting requests right now. Try again in a minute.");
  if (!res.ok) throw new PdlError(`People Data Labs couldn't search right now (error ${res.status}).`);
  const body = (await res.json()) as { data?: PdlPerson[]; scroll_token?: string | null; total?: number };
  const people = (body.data ?? []).flatMap((p) => toPerson(p) ?? []);
  return { people, scrollToken: body.scroll_token ?? null, total: body.total ?? people.length };
}
