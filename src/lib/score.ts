// How well a person fits a brief, line by line, from their public work and professional profile only.
// Nothing here uses or guesses age, sex, race or other protected traits, and
// account age is deliberately not used as a stand-in for experience.
import { stateName, type Brief } from "./brief";
import type { Repo } from "./github";
import type { Role } from "./pdl";

export type Check = {
  label: string;
  importance: "must" | "nice" | "location";
  status: "yes" | "no" | "unknown";
  detail?: string;
};

export type ScorablePerson = {
  bio: string | null; company: string | null; location: string | null; headline: string | null;
  languages: Record<string, number>; topRepos: Repo[]; totalStars: number; lastPushAt: Date | null;
  /** From a LinkedIn profile, when we have one. */
  skills: string[]; experience: Role[]; yearsExperience: number | null;
};

/**
 * `missingEmployer`: the brief names employers the person must come from, and they don't.
 * `excluded`: their job title has a word the recruiter ruled out.
 */
export type Score = { score: number; checks: Check[]; outOfArea: boolean; missingEmployer: boolean; excluded: boolean };

const DAY = 86_400_000;
const city = (loc: string) => loc.split(",")[0].trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word (or whole-phrase) match, so "ui" doesn't match "build". Plurals count: "exchange" matches "exchanges". */
const hasPhrase = (text: string, phrase: string) =>
  new RegExp(`(^|[^a-z0-9])${escapeRe(phrase.toLowerCase())}(e?s)?($|[^a-z0-9])`).test(text);

const STOP = new Set(["of", "and", "the", "for", "in", "a", "an"]);
/** "data analyst" matches "Lead Data Analyst" and "Data Analytics Analyst": every word of the wanted title appears. */
export const titleMatches = (theirs: string, wanted: string) =>
  wanted.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w && !STOP.has(w)).every((w) => hasPhrase(theirs.toLowerCase(), w));
/**
 * The part of a wanted title that names the job itself. "Rust Engineer" is an engineer once Rust is
 * its own requirement, so a Senior Software Engineer who writes Rust still has the right title.
 */
function coreTitle(title: string, brief: Brief): string {
  let t = title.toLowerCase();
  for (const c of brief.criteria) for (const w of [c.label, ...c.languages]) {
    if (w.trim()) t = t.replace(new RegExp(`(^|[^a-z0-9])${escapeRe(w.trim().toLowerCase())}(?=$|[^a-z0-9+#])`, "g"), "$1");
  }
  t = t.replace(/\s+/g, " ").trim();
  return t || title.toLowerCase();
}
/** The job titles to look for, without the words that are requirements of their own. */
export const searchTitles = (brief: Brief) => [...new Set(brief.jobTitles.map((t) => coreTitle(t, brief)))];

/** "HP" matches "HP Inc." and "@hp". */
export const employerMatches = (theirs: string, wanted: string) => hasPhrase(theirs.toLowerCase(), wanted.trim().toLowerCase());

/** Locations for display: "Chicago, Illinois, United States" reads as "Chicago, Illinois". */
export const shortLocation = (loc: string | null) => loc?.replace(/,\s*(united states( of america)?|usa)\s*$/i, "").trim() || null;

export const fitLabel = (score: number) => (score >= 85 ? "Strong match" : score >= 70 ? "Good match" : "Possible match");
export const fitLevel = (score: number) => (score >= 85 ? "strong" : score >= 70 ? "good" : "possible");

// ---------- where people are ----------

// Georgia is left out on purpose: it's also a country.
const STATES = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "hawaii",
  "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia"];
// Two-letter codes that are rarely used for another country or region (IN, DE, AL, AR, ID, ME, MT and NE are left out).
const CODES = new Set("AK AZ CA CO CT DC FL GA HI IA IL KS KY LA MA MD MI MN MO MS NC ND NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(" "));
const US_CITIES = ["san francisco", "bay area", "silicon valley", "seattle", "boston", "chicago", "austin", "los angeles", "nyc",
  "brooklyn", "manhattan", "denver", "atlanta", "miami", "dallas", "houston", "philadelphia", "pittsburgh", "san diego", "san jose",
  "minneapolis", "raleigh", "salt lake city", "phoenix", "detroit"];

/** True when a profile location is in the US, false when it's clearly elsewhere, null when there's none. */
export function inUS(location: string | null): boolean | null {
  if (!location?.trim()) return null;
  const l = location.toLowerCase();
  if (/(^|[^a-z])(usa|u\.s\.a?\.?|united states)([^a-z]|$)/.test(l)) return true;
  if (STATES.some((s) => hasPhrase(l, s))) return true;
  if ([...location.matchAll(/,\s*([A-Z]{2})\b/g)].some((m) => CODES.has(m[1]))) return true;
  return US_CITIES.some((c) => hasPhrase(l, c));
}

function locationCheck(p: ScorablePerson, brief: Brief): Check {
  if (!p.location?.trim()) return { label: "Location", importance: "location", status: "unknown", detail: "Not on their profile" };
  const where = p.location.toLowerCase();
  // "Texas" or "TX" on its own means the whole state; otherwise the city has to match.
  const hit = brief.locations.find((l) => { const state = l.includes(",") ? null : stateName(l); return state ? hasPhrase(where, state) : where.includes(city(l)); });
  const label = shortLocation(p.location) ?? p.location;
  if (hit) return { label, importance: "location", status: "yes" };
  if (inUS(p.location) === false) return { label, importance: "location", status: "no", detail: "Outside the US" };
  if (brief.remoteOk || !brief.locations.length) return { label, importance: "location", status: "yes", detail: "In the US" };
  return { label, importance: "location", status: "no", detail: "Outside your locations" };
}

// ---------- the score ----------

export function scorePerson(p: ScorablePerson, brief: Brief): Score {
  const repoText = (r: Repo) => [r.name.replace(/[-_.]/g, " "), r.description ?? "", ...r.topics].join(" ").toLowerCase();
  const corpus = [p.bio ?? "", p.company ?? "", p.headline ?? "", ...p.skills, ...p.experience.flatMap((r) => [r.title, r.company ?? ""]),
    ...p.topRepos.map(repoText)].join(" ").toLowerCase();
  const skills = new Set(p.skills.map((x) => x.toLowerCase()));
  const ranked = Object.entries(p.languages).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const mainLanguages = ranked.slice(0, 2).map(([l]) => l).join(" and ");
  // A language counts when it's one of their top two, or at least a quarter of their repositories.
  const isMain = (lang: string) => {
    const i = ranked.findIndex(([l]) => l.toLowerCase() === lang.toLowerCase());
    return i >= 0 && (i < 2 || ranked[i][1] / total >= 0.25);
  };

  const loc = locationCheck(p, brief);
  const checks: Check[] = [loc];
  let got = loc.status === "yes" && brief.locations.length ? 1.5 : 0;
  let max = got;
  let mustsChecked = 0, mustsMet = 0;
  const must = (yes: boolean) => { max += 3; mustsChecked++; if (yes) { got += 3; mustsMet++; } };

  // The job title, for people whose profile has one. People found only through their code have none, so it isn't held against them.
  let wrongTitle = false;
  if (brief.jobTitles.length) {
    const past = p.experience.map((r) => r.title);
    const core = (t: string) => coreTitle(t, brief);
    // The chip names the job that was checked: "Engineer" for a search for a "Rust Engineer", since Rust has its own chip.
    const shown = (t: string) => (core(t) === t.toLowerCase() ? t : core(t).replace(/(^|[\s-])([a-z])/g, (_, a: string, c: string) => a + c.toUpperCase()));
    const hit = brief.jobTitles.find((t) => (p.headline && titleMatches(p.headline, core(t))) || past.some((x) => titleMatches(x, core(t))));
    if (!p.headline && !past.length) checks.push({ label: shown(brief.jobTitles[0]), importance: "must", status: "unknown", detail: "No job title on their profile" });
    else {
      const current = Boolean(hit && p.headline && titleMatches(p.headline, core(hit)));
      wrongTitle = !hit;
      checks.push({ label: hit ? `${shown(hit)}${current ? "" : " (past)"}` : shown(brief.jobTitles[0]), importance: "must", status: hit ? "yes" : "no", detail: hit ? (current ? "Their title now" : "A title they've held before") : p.headline ? `Now ${p.headline}` : undefined });
      must(Boolean(hit));
    }
  }

  // Employers they must come from: now or earlier in their career.
  let missingEmployer = false;
  if (brief.companies.length) {
    const employers = [{ name: p.company, current: true }, ...p.experience.map((r) => ({ name: r.company, current: r.current }))];
    const found = brief.companies.flatMap((c) => { const e = employers.find((x) => x.name && employerMatches(x.name, c)); return e ? [{ c, e }] : []; })[0];
    checks.push({ label: found ? `${found.c}${found.e.current ? "" : " (past)"}` : brief.companies.join(" or "), importance: "must", status: found ? "yes" : "no", detail: found ? (found.e.current ? "Works there now" : "Used to work there") : "Not in their work history" });
    must(Boolean(found));
    missingEmployer = !found;
  }

  // Words the recruiter ruled out of job titles ("not managers").
  const title = (p.headline ?? p.experience.find((r) => r.current)?.title ?? "").toLowerCase();
  const ruledOut = brief.exclude.find((w) => w.trim() && hasPhrase(title, w.trim()));
  if (ruledOut) checks.push({ label: `Not ${ruledOut}`, importance: "must", status: "no", detail: `Their title is ${p.headline ?? title}` });

  if (brief.minYears) {
    const y = p.yearsExperience;
    checks.push({ label: `${brief.minYears}+ years`, importance: "must", status: y === null ? "unknown" : y >= brief.minYears ? "yes" : "no", detail: y === null ? "Ask in your first conversation" : `About ${y} years` });
    if (y !== null) must(y >= brief.minYears);
  }

  for (const c of brief.criteria) {
    if (!c.signals.length && !c.languages.length) {
      checks.push({ label: c.label, importance: c.importance, status: "unknown", detail: "Ask in your first conversation" });
      continue;
    }
    const aboutLanguage = c.languages.some((l) => c.label.toLowerCase().includes(l.toLowerCase())) || !c.signals.length;
    let yes: boolean, detail: string | undefined;
    if (aboutLanguage) {
      const inCode = c.languages.some(isMain);
      const listed = c.languages.some((l) => skills.has(l.toLowerCase()));
      yes = inCode || listed;
      detail = inCode ? "One of their main languages" : listed ? "Listed as a skill" : mainLanguages ? `Mainly writes ${mainLanguages}` : "Not in their code or skills";
    } else {
      const signal = c.signals.find((s) => s.trim() && hasPhrase(corpus, s));
      const repo = signal ? p.topRepos.find((r) => hasPhrase(repoText(r), signal)) : undefined;
      yes = Boolean(signal);
      detail = repo ? `In ${repo.name}` : signal ? `Mentions "${signal}"` : undefined;
    }
    checks.push({ label: c.label, importance: c.importance, status: yes ? "yes" : "no", detail });
    const w = c.importance === "must" ? 3 : 1;
    max += w;
    if (yes) got += w;
    if (c.importance === "must") { mustsChecked++; if (yes) mustsMet++; }
  }

  // Strength of the public work, a small bonus: stars on their own projects and recent activity.
  const strength = Math.min(6, Math.log10(p.totalStars + 1) * 2) + (p.lastPushAt && Date.now() - p.lastPushAt.getTime() < 90 * DAY ? 3 : 0);
  let score = (max ? 40 + 50 * (got / max) : 50) + strength;
  // Meeting fewer than half of the must-haves public work can show means it isn't a match.
  if (mustsChecked && mustsMet * 2 < mustsChecked) score = Math.min(score, 40);
  // A different job title keeps someone out of the list, though the agent may still make a case for them.
  if (wrongTitle) score = Math.min(score, 55);
  return { score: Math.round(Math.min(99, score)), checks, outOfArea: loc.status === "no", missingEmployer, excluded: Boolean(ruledOut) };
}

/** Plain-language lines about someone's public work, for the review screen and message drafts. */
export function evidenceFor(p: ScorablePerson & { followers: number; hireable: boolean | null }): { src: string; text: string }[] {
  const out: { src: string; text: string }[] = [];
  const at = (r: Role) => `${r.title}${r.company ? ` at ${r.company}` : ""}`;
  const current = p.experience.find((r) => r.current) ?? (p.headline ? { title: p.headline, company: p.company, current: true } : null);
  if (current) out.push({ src: "Role", text: at(current) });
  for (const r of p.experience.filter((r) => r !== current && !r.current).slice(0, 2)) out.push({ src: "Before", text: at(r) });
  if (p.skills.length) out.push({ src: "Skills", text: p.skills.slice(0, 8).join(", ") });
  for (const r of p.topRepos.slice(0, 3)) {
    const bits = [r.stars ? `${r.stars.toLocaleString("en-US")} star${r.stars === 1 ? "" : "s"}` : null, r.language].filter(Boolean).join(", ");
    out.push({ src: "GitHub", text: `${r.name}${r.description ? `: ${r.description}` : ""}${bits ? ` (${bits})` : ""}` });
  }
  const langs = Object.entries(p.languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
  if (langs.length) out.push({ src: "Languages", text: `Mostly writes ${langs.join(", ")}` });
  if (p.lastPushAt) {
    const days = Math.round((Date.now() - p.lastPushAt.getTime()) / DAY);
    out.push({ src: "Activity", text: days <= 1 ? "Pushed code in the last day" : `Last pushed code ${days} days ago` });
  }
  if (p.hireable) out.push({ src: "Availability", text: "Marked available for hire on GitHub" });
  return out;
}
