import "server-only";
import { stateName, type Brief } from "./brief";
import { normalizeLinkedIn } from "./linkedin";
import { searchTitles } from "./score";

// LinkedIn profiles come from People Data Labs (PDL), a licensed provider of professional
// profile data. Unlisted never scrapes LinkedIn itself. Each person returned costs one PDL credit.
const BASE = (process.env.PDL_API_BASE || "https://api.peopledatalabs.com/v5").replace(/\/$/, "");

export const hasPdl = () => Boolean(process.env.PDL_API_KEY);

/** A PDL problem the recruiter should see: a rejected key, used-up credits or rate limits. */
export class PdlError extends Error {}

type PdlExperience = {
  company?: { name?: string | null } | null; title?: { name?: string | null } | null;
  is_primary?: boolean | null; start_date?: string | null; end_date?: string | null;
};
type PdlPerson = {
  id?: string | null; full_name?: string | null; job_title?: string | null; job_company_name?: string | null;
  headline?: string | null; summary?: string | null; location_name?: string | boolean | null;
  linkedin_url?: string | null; github_username?: string | null; skills?: string[] | null; experience?: PdlExperience[] | null;
  inferred_years_experience?: number | null;
  work_email?: string | boolean | null; recommended_personal_email?: string | boolean | null; personal_emails?: string[] | boolean | null;
};

/** A job someone has held. `start` and `end` are "2019-10" or "2019" when the profile gives them. */
export type Role = { title: string; company: string | null; current: boolean; start?: string | null; end?: string | null };
export type LinkedInPerson = {
  pdlId: string | null; linkedinUrl: string; githubLogin: string | null; name: string | null; location: string | null;
  headline: string | null; company: string | null; bio: string | null; email: string | null; skills: string[]; experience: Role[];
  yearsExperience: number | null;
};

// On the free plan PDL sends `true` in place of some values it hides; treat those as missing.
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const LEVELS = /\b(senior|sr|junior|jr|staff|lead|principal|head|chief|ii|iii|iv)\b\.?/gi;

/**
 * What to look for on LinkedIn: job titles (any of them), skills that must be listed, places
 * (ignored when remote), skills that rank higher, the employers to look in, a minimum number of
 * years, and words that rule a job title out.
 */
export type PdlSearch = {
  titles: string[]; skills: string[]; places: string[]; remote: boolean; boost: string[];
  companies?: string[];
  /** True when the employers may be earlier in someone's career, not only where they work now. */
  pastCompanies?: boolean;
  minYears?: number | null; exclude?: string[];
  /** For briefs saved before job titles existed: loose title words, any of which may match. */
  looseTitle?: string;
};

export function paramsFromBrief(brief: Brief): PdlSearch {
  const titles = searchTitles(brief);
  return {
    titles,
    looseTitle: titles.length ? undefined : brief.title.split(/[–—\-,(|:]/)[0].replace(LEVELS, " ").replace(/\s+/g, " ").trim(),
    skills: [...new Set(brief.criteria.filter((c) => c.importance === "must").flatMap((c) => c.languages))],
    places: brief.locations,
    remote: brief.remoteOk,
    boost: [...new Set(brief.criteria.flatMap((c) => c.signals).filter(Boolean))].slice(0, 12),
    companies: brief.companies, pastCompanies: true,
    minYears: brief.minYears, exclude: brief.exclude,
  };
}

/** People in the US with a LinkedIn profile who fit the search. Written in PDL's Elasticsearch-style query language. */
export function buildPdlQuery(s: PdlSearch): object {
  const lower = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const anyOf = (clauses: object[]) => ({ bool: { should: clauses } });
  const must: object[] = [{ term: { location_country: "united states" } }, { exists: { field: "linkedin_url" } }];

  const titles = lower(s.titles.map((t) => t.replace(LEVELS, " ").replace(/\s+/g, " "))).slice(0, 6);
  const loose = s.looseTitle?.replace(LEVELS, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (titles.length) must.push(anyOf(titles.map((t) => ({ match_phrase: { job_title: t } }))));
  else if (loose) must.push({ match: { job_title: loose } });

  if (s.skills.length) must.push({ terms: { skills: lower(s.skills) } });

  // "Alpharetta, GA" is the city (in that state); "Texas" or "TX" alone is the whole state.
  const places = s.remote ? [] : lower(s.places).slice(0, 6).map((p) => {
    const [city, st] = p.split(",").map((x) => x.trim());
    const wholeState = st ? null : stateName(city);
    if (wholeState) return { term: { location_region: wholeState } };
    const region = st ? stateName(st) : null;
    const locality = { match_phrase: { location_locality: city } };
    return region ? { bool: { must: [locality, { term: { location_region: region } }] } } : locality;
  });
  if (places.length) must.push(anyOf(places));

  const companies = lower(s.companies).slice(0, 8);
  if (companies.length) {
    must.push(anyOf(companies.flatMap((c) => [
      { match_phrase: { job_company_name: c } },
      ...(s.pastCompanies ? [{ match_phrase: { "experience.company.name": c } }] : []),
    ])));
  }
  if (s.minYears && s.minYears > 0) must.push({ range: { inferred_years_experience: { gte: Math.min(40, Math.round(s.minYears)) } } });

  const mustNot = lower(s.exclude).slice(0, 8).map((w) => ({ match_phrase: { job_title: w } }));
  return {
    bool: {
      must,
      ...(mustNot.length ? { must_not: mustNot } : {}),
      should: lower(s.boost).slice(0, 12).map((b) => ({ match_phrase: { skills: b } })),
    },
  };
}

// PDL's title-casing turns "hp" into "Hp" and "vp of sales" into "Vp Of Sales"; put the usual spellings back.
const UPPER = new Set(("hp ibm ncr ups sap amd kpmg pwc ey bmw ge gm usaa adp aws bp cvs dhl hsbc ubs nasa at&t llc llp usa " +
  "bi rn lpn cna np md cpa vp svp evp avp ceo cto cfo coo cio ciso hr it qa ui ux sre ml ai ii iii iv erp crm sql etl seo").split(" "));
const SMALL = new Set(["of", "and", "the", "for", "in", "at", "to", "a", "an", "on"]);
const fixCase = (text: string | null) =>
  text && text.split(" ").map((w, i) => {
    const bare = w.toLowerCase().replace(/[^a-z0-9&]/g, "");
    return UPPER.has(bare) ? w.toUpperCase() : i > 0 && SMALL.has(bare) ? w.toLowerCase() : w;
  }).join(" ");

const month = (d: string | null) => (d && /^\d{4}(-\d{2})?/.test(d) ? d.slice(0, 7) : null);

function toPerson(p: PdlPerson): LinkedInPerson | null {
  const linkedinUrl = normalizeLinkedIn(str(p.linkedin_url));
  if (!linkedinUrl) return null;
  const experience = (p.experience ?? [])
    .flatMap((e): Role[] => {
      const title = fixCase(str(e.title?.name));
      if (!title) return [];
      const start = month(str(e.start_date)), end = month(str(e.end_date));
      return [{ title, company: fixCase(str(e.company?.name)), current: Boolean(e.is_primary) || Boolean(start && !end), start, end }];
    })
    // Newest first: jobs they hold now, then by when each started.
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.start ?? "").localeCompare(a.start ?? ""))
    .slice(0, 6);
  const years = p.inferred_years_experience;
  return {
    pdlId: str(p.id),
    linkedinUrl,
    githubLogin: str(p.github_username),
    name: str(p.full_name),
    location: str(p.location_name),
    headline: fixCase(str(p.job_title)),
    company: fixCase(str(p.job_company_name)),
    bio: str(p.headline) ?? str(p.summary)?.slice(0, 400) ?? null,
    // Contact emails only come with PDL plans that include them.
    email: str(p.work_email) ?? str(p.recommended_personal_email) ?? (Array.isArray(p.personal_emails) ? str(p.personal_emails[0]) : null),
    skills: (p.skills ?? []).filter((s): s is string => typeof s === "string").slice(0, 40),
    experience,
    yearsExperience: typeof years === "number" && years >= 0 && years < 70 ? Math.round(years) : null,
  };
}

function check(res: Response) {
  if (res.status === 401 || res.status === 403) throw new PdlError("People Data Labs rejected the PDL_API_KEY. Check it in your site's environment variables.");
  if (res.status === 402) throw new PdlError("Your People Data Labs credits are used up, so LinkedIn profiles weren't searched.");
  if (res.status === 429) throw new PdlError("People Data Labs is limiting requests right now. Try again in a minute.");
  if (!res.ok) throw new PdlError(`People Data Labs couldn't answer right now (error ${res.status}).`);
}

const post = (search: PdlSearch, size: number, scrollToken?: string | null) =>
  fetch(`${BASE}/person/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": process.env.PDL_API_KEY ?? "" },
    body: JSON.stringify({ query: buildPdlQuery(search), size, titlecase: true, ...(scrollToken ? { scroll_token: scrollToken } : {}) }),
    cache: "no-store",
  });

/** One page of LinkedIn profiles. Pass the returned scrollToken to get the next page of the same search. */
export async function searchLinkedIn(search: PdlSearch, size: number, scrollToken?: string | null) {
  let res = await post(search, size, scrollToken);
  // If PDL won't search earlier employers, fall back to where people work now rather than finding no one.
  if (res.status === 400 && search.companies?.length && search.pastCompanies) res = await post({ ...search, pastCompanies: false }, size, scrollToken);
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
