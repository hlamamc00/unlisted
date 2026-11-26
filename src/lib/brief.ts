// The brief: who a search is for, in a form the search and the scoring can use.
// Claude fills it from a one-line request or a job description (src/lib/claude.ts);
// readBriefLocally is the keyword fallback when no Anthropic key is set, and
// readBooleanLocally reads Boolean search strings.
import { z } from "zod";

export const CriterionSchema = z.object({
  label: z.string().describe("The requirement in 1 to 3 words, e.g. 'Rust', 'Low latency', 'Trading systems', 'Power BI'."),
  importance: z.enum(["must", "nice"]),
  signals: z
    .array(z.string())
    .describe("Lowercase words or short phrases that would appear in the skills, job titles, repository names or bios of someone who meets this requirement."),
  languages: z.array(z.string()).describe("GitHub language names that show this requirement, e.g. 'Rust', 'C++'. Empty when it isn't about a programming language."),
});

export const BriefSchema = z.object({
  title: z.string().describe("The job's name as it would appear on a posting, e.g. 'Data Analyst' or 'Senior Rust Engineer, Trading Systems'. No place or employer."),
  summary: z.string().describe("One sentence describing who the role needs."),
  jobTitles: z.array(z.string()).describe("1 to 4 job titles to search professional profiles for: the title asked for plus close variants people really use, e.g. ['Data Analyst', 'Business Intelligence Analyst']. No seniority words."),
  companies: z.array(z.string()).describe("Employers the person must work at now or have worked at before, only when the recruiter names them, e.g. 'from HP'. Otherwise empty."),
  minYears: z.number().nullable().describe("The minimum years of experience when one is stated, otherwise null."),
  exclude: z.array(z.string()).describe("Words that rule someone out when they are in their job title, only when the recruiter says so: 'not managers' gives ['manager']. Otherwise empty."),
  criteria: z.array(CriterionSchema),
  locations: z.array(z.string()).describe("Cities or regions the person should be in, e.g. 'Chicago, IL'. Empty when location doesn't matter."),
  remoteOk: z.boolean(),
  payRange: z.string().nullable().describe("The pay range as written, or null."),
  workAuthorization: z.string().nullable().describe("What it says about visas or authorization to work, or null."),
  searchTerms: z.array(z.string()).describe("2 to 4 short phrases to search GitHub repositories with, e.g. 'order book', for roles where people publish code. Empty for roles where they don't, such as analysts, sales or nurses."),
  leftOut: z.string().nullable().describe("A short phrase naming what was ignored, e.g. 'benefits, perks and the company description', or null."),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;

/** A stored brief with every field present: roles saved before job titles, companies and years existed lack them. */
export function toBrief(raw: unknown): Brief {
  const b = (raw ?? {}) as Partial<Brief>;
  return {
    title: b.title ?? "", summary: b.summary ?? "", jobTitles: b.jobTitles ?? [], companies: b.companies ?? [], minYears: b.minYears ?? null, exclude: b.exclude ?? [],
    criteria: b.criteria ?? [], locations: b.locations ?? [], remoteOk: b.remoteOk ?? false, payRange: b.payRange ?? null,
    workAuthorization: b.workAuthorization ?? null, searchTerms: b.searchTerms ?? [], leftOut: b.leftOut ?? null,
  };
}

/** A brief needs something to search on: a job title or at least one requirement. */
export const isSearchable = (b: Brief) => b.jobTitles.length > 0 || b.criteria.length > 0;

/** An empty brief, for filling in by hand. */
export const emptyBrief = (): Brief => toBrief({ title: "" });

/**
 * True when people for this brief can be found through their code on GitHub. Other searches (an
 * analyst, a nurse, anyone who must come from a named employer) need professional profiles.
 */
export const findableOnGithub = (b: Brief) =>
  !b.companies.length && (b.searchTerms.length > 0 || b.criteria.some((c) => c.languages.length > 0));

/** The filters in a few words, for lists: "Alpharetta, GA · worked at HP · 5+ years · SQL". */
export function filterSummary(b: Brief, pay?: string | null): string {
  return [
    b.locations.length ? b.locations.join(" or ") + (b.remoteOk ? ", or remote in the US" : "") : "Anywhere in the US",
    b.companies.length ? `worked at ${b.companies.join(" or ")}` : null,
    b.minYears ? `${b.minYears}+ years` : null,
    ...b.criteria.filter((c) => c.importance === "must").slice(0, 3).map((c) => c.label),
    pay,
  ].filter(Boolean).join(" · ");
}

/** Answers to what job descriptions don't say: companies to look in or stay away from, an example person, the pay range. */
export type RoleContext = { target?: string; avoid?: string; like?: string; pay?: string };
/** Who must not be shown: locations learned from the recruiter's skips, and employers they named. */
export type RoleRules = { excludedLocations?: string[]; avoidCompanies?: string[] };

/** "Acme, Globex Inc." -> ["Acme", "Globex Inc."] */
export const splitList = (text: string | undefined | null) =>
  [...new Set((text ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 12);

// ---------- keyword fallback ----------

const LANGUAGES: [RegExp, string][] = [
  [/\brust\b/i, "Rust"], [/\bgolang\b|\bgo (?:developer|engineer)\b/i, "Go"], [/\bpython\b/i, "Python"],
  [/\btypescript\b/i, "TypeScript"], [/\bjavascript\b|\bnode\.?js\b/i, "JavaScript"], [/\bjava\b(?!script)/i, "Java"],
  [/c\+\+|\bcpp\b/i, "C++"], [/\bc#|\.net\b/i, "C#"], [/\bkotlin\b/i, "Kotlin"], [/\bswift\b/i, "Swift"],
  [/\bscala\b/i, "Scala"], [/\bruby\b/i, "Ruby"], [/\bphp\b/i, "PHP"], [/\belixir\b/i, "Elixir"],
  [/\bhaskell\b/i, "Haskell"], [/\bjulia\b/i, "Julia"], [/\bsolidity\b/i, "Solidity"], [/\bzig\b/i, "Zig"], [/\bocaml\b/i, "OCaml"],
];

const DOMAINS: { re: RegExp; label: string; signals: string[] }[] = [
  { re: /low.?latency|high.?frequency|\bhft\b/i, label: "Low-latency systems", signals: ["low-latency", "latency", "lock-free", "simd", "kernel bypass", "io_uring", "dpdk"] },
  { re: /trading|exchange|market.?mak|order.?book/i, label: "Trading or exchange systems", signals: ["trading", "order book", "orderbook", "exchange", "market data", "fix protocol", "backtest"] },
  { re: /machine learning|\bml\b|deep learning|pytorch|tensorflow|\bllm/i, label: "Machine learning", signals: ["machine learning", "deep learning", "pytorch", "tensorflow", "transformer", "llm", "neural"] },
  { re: /distributed systems?|consensus|\braft\b/i, label: "Distributed systems", signals: ["distributed", "consensus", "raft", "paxos", "replication"] },
  { re: /database|storage engine|query engine/i, label: "Databases and storage", signals: ["database", "storage engine", "query engine", "sql", "btree", "lsm"] },
  { re: /compiler|interpreter|\bllvm\b/i, label: "Compilers", signals: ["compiler", "llvm", "interpreter", "parser", "codegen"] },
  { re: /embedded|firmware|microcontroller|rtos/i, label: "Embedded systems", signals: ["embedded", "firmware", "rtos", "microcontroller", "no_std"] },
  { re: /kubernetes|devops|infrastructure as code|terraform/i, label: "Infrastructure and DevOps", signals: ["kubernetes", "terraform", "devops", "helm", "infrastructure"] },
  { re: /security|cryptograph/i, label: "Security", signals: ["security", "cryptography", "crypto", "fuzzing", "vulnerability"] },
  { re: /frontend|front-end|\breact\b/i, label: "Frontend", signals: ["react", "frontend", "ui", "nextjs", "vue"] },
  { re: /protein|biolog|genomic/i, label: "Computational biology", signals: ["protein", "genomics", "bioinformatics", "biology", "molecular"] },
  { re: /actuar|insurance/i, label: "Actuarial or insurance", signals: ["actuarial", "insurance", "reserving", "mortality", "ldti"] },
];

const CITIES = ["New York", "San Francisco", "Bay Area", "Seattle", "Boston", "Chicago", "Austin", "Los Angeles", "Denver",
  "Atlanta", "Washington", "Miami", "Dallas", "Houston", "Philadelphia", "Pittsburgh", "Hartford", "San Diego", "Portland", "Minneapolis"];

const SECTION: [RegExp, "must" | "nice" | "skip" | "role"][] = [
  [/^(nice to have|desirable|bonus points|it would be great|preferred)/i, "nice"],
  [/^(what you('|’)ll need|requirements|must.?haves?|essential|about you|you have|qualifications|skills)/i, "must"],
  [/^(about us|who we are|what we offer|benefits|perks|why join|our values|how to apply|compensation)/i, "skip"],
  [/^(the role|about the role|responsibilities|what you('|’)ll do|the team)/i, "role"],
];
const FLUFF = /equal opportunit|discriminat|holiday|\bpto\b|401\(k\)|medical|dental|gym|lunch|wellbeing|perks|inclusive/i;

const LEVEL_WORDS = /\b(senior|sr\.?|junior|jr\.?|staff|lead|principal|head of|chief)\b/gi;
const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
/** "GA" or "Georgia" -> "georgia". Null when it isn't a US state. */
export function stateName(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (STATE_ABBR[t]) return t;
  return Object.keys(STATE_ABBR).find((k) => STATE_ABBR[k].toLowerCase() === t) ?? null;
}
const titleCase = (text: string) => text.trim().replace(/\s+/g, " ").replace(/(^|[\s-])([a-z])/g, (_, a: string, c: string) => a + c.toUpperCase());
const SOFTWARE = /\b(software|web|back.?end|front.?end|full.?stack|mobile|ios|android|cloud|platform|systems?|application|game|firmware|devops|ml|ai|data)\b/i;
/** How a typed term reads as a label: "sql" -> "SQL", "low latency" -> "Low Latency", "PyTorch" stays. */
const titleCaseIfLower = (text: string) => (text !== text.toLowerCase() ? text.trim() : text.trim().length <= 3 ? text.trim().toUpperCase() : titleCase(text));
const isTech = (text: string) => LANGUAGES.some(([re]) => re.test(text)) || DOMAINS.some((d) => d.re.test(text));

/** "alpharetta georgia" -> "Alpharetta, GA"; "chicago" -> "Chicago". Null when it doesn't look like a place. */
function placeToLocation(place: string, strict: boolean): string | null {
  const p = place.trim().replace(/[.,]+$/, "").replace(/\s+/g, " ");
  const lower = p.toLowerCase();
  const state = Object.keys(STATE_ABBR).sort((a, b) => b.length - a.length).find((x) => lower.endsWith(` ${x}`) || lower.endsWith(`,${x}`));
  if (state) return `${titleCase(p.slice(0, p.length - state.length).replace(/[,\s]+$/, ""))}, ${STATE_ABBR[state]}`;
  const abbr = p.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (abbr && Object.values(STATE_ABBR).includes(abbr[2].toUpperCase())) return `${titleCase(abbr[1])}, ${abbr[2].toUpperCase()}`;
  if (CITIES.some((c) => c.toLowerCase() === lower) || STATE_ABBR[lower]) return titleCase(p);
  return strict || p.split(" ").length > 3 || isTech(p) ? null : titleCase(p);
}

/** A job title to search for, from a phrase: "senior rust engineer who has built trading systems" -> "Rust Engineer". */
function jobTitleFrom(phrase: string): string | null {
  const t = phrase.split(/[–—(|:]|\s-\s|,|\s+(?:who|with|that|having|experienced|skilled)\b/i)[0].replace(LEVEL_WORDS, " ").replace(/\s+/g, " ").trim();
  const words = t.split(" ").filter(Boolean);
  if (/^(someone|somebody|anyone|a person|person|people|candidates?)$/i.test(t)) return null;
  return words.length >= 1 && words.length <= 5 && /[a-z]/i.test(t) ? titleCase(t) : null;
}

/** "Rust Engineer" -> ["Rust Engineer", "Rust Developer"]: the two words mean the same job to most people. */
function titleVariants(title: string): string[] {
  const swap = /\bEngineer\b/.test(title) ? title.replace(/\bEngineer\b/, "Developer") : /\bDeveloper\b/.test(title) ? title.replace(/\bDeveloper\b/, "Engineer") : null;
  return swap && (isTech(title) || SOFTWARE.test(title)) ? [title, swap] : [title];
}

/** A one-line request such as "data analyst in alpharetta georgia from hp": the job, the place and the employer. */
function parseOneLine(text: string): { title?: string; location?: string; company?: string } {
  const t = text.trim().replace(/[.?!]+$/, "");
  if (/\n/.test(t) || t.length > 160) return {};
  const parts = t.replace(/\s+/g, " ").split(/\s+(in|near|based in|around|from|at|formerly at|ex)\s+/i);
  const out: { title?: string; location?: string; company?: string } = { title: parts[0] };
  const short = t.split(" ").length <= 12;
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const kw = parts[i].toLowerCase(), seg = parts[i + 1].trim();
    if (["in", "near", "based in", "around"].includes(kw)) out.location ??= placeToLocation(seg, !short) ?? undefined;
    else if (!out.company && seg.split(" ").length <= 4 && !isTech(seg)) out.company = seg.length <= 4 ? seg.toUpperCase() : titleCase(seg);
  }
  return out;
}

const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);

/** What changed between two briefs, in a few plain words for the recruiter. Empty when nothing did. */
export function describeChange(before: Brief, after: Brief): string {
  const key = (c: Criterion) => c.label.toLowerCase();
  const was = new Map(before.criteria.map((c) => [key(c), c]));
  const now = new Set(after.criteria.map(key));
  const kind = (c: Criterion) => (c.importance === "must" ? "must-have" : "nice to have");
  const parts: string[] = [];
  const added = after.criteria.filter((c) => !was.has(key(c)));
  const removed = before.criteria.filter((c) => !now.has(key(c)));
  if (added.length) parts.push(`added ${added.map((c) => `${c.label} (${kind(c)})`).join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.map((c) => c.label).join(", ")}`);
  for (const c of after.criteria) if (was.has(key(c)) && was.get(key(c))!.importance !== c.importance) parts.push(`${c.label} is now ${c.importance === "must" ? "a must-have" : "nice to have"}`);
  if (before.jobTitles.join("|") !== after.jobTitles.join("|") && after.jobTitles.length) parts.push(`job titles are ${after.jobTitles.join(", ")}`);
  if (before.companies.join("|") !== after.companies.join("|")) parts.push(after.companies.length ? `must have worked at ${after.companies.join(" or ")}` : "any employer");
  if (before.exclude.join("|") !== after.exclude.join("|")) parts.push(after.exclude.length ? `no ${after.exclude.join(" or ")} in their title` : "no title words ruled out");
  if (before.minYears !== after.minYears) parts.push(after.minYears ? `${after.minYears}+ years of experience` : "any amount of experience");
  if (before.locations.join("|") !== after.locations.join("|")) parts.push(after.locations.length ? `locations are ${after.locations.join(" or ")}` : "any location in the US");
  if (before.remoteOk !== after.remoteOk) parts.push(after.remoteOk ? "remote is fine" : "not remote");
  if (after.payRange && after.payRange !== before.payRange) parts.push(`pay is ${after.payRange}`);
  return parts.join("; ");
}

/** Applies a plain-words change such as "remote is fine" or "must know Go" without Claude. A rough fallback. */
export function refineBriefLocally(brief: Brief, text: string): Brief {
  const t = text.toLowerCase();
  const found = readBriefLocally(text);
  for (const m of text.matchAll(/"([^"]{2,40})"/g)) if (!found.criteria.some((c) => c.label.toLowerCase() === m[1].toLowerCase())) found.criteria.push(criterionFromLabel(m[1], "nice"));
  const removing = /\b(remove|drop|without|don'?t need|do not need|no longer need|not needed)\b/.test(t);
  const wanted: "must" | "nice" | null = /\b(nice to have|optional|bonus|preferred|a plus)\b/.test(t) ? "nice" : /\b(must|required|needs?|has to)\b/.test(t) ? "must" : null;
  const mentioned = (c: Criterion) => hasWord(t, c.label.toLowerCase());
  const criteria = brief.criteria
    .filter((c) => !(removing && mentioned(c)))
    .map((c) => (wanted && mentioned(c) ? { ...c, importance: wanted } : c));
  if (!removing) for (const c of found.criteria) if (!criteria.some((x) => x.label.toLowerCase() === c.label.toLowerCase())) criteria.push({ ...c, importance: wanted ?? "nice" });
  const remoteOk = /\b(no remote|not remote|on.?site only|in.?office only|in the office)\b/.test(t) ? false : /\bremote\b/.test(t) ? true : brief.remoteOk;
  // "only people in Atlanta" replaces what was there; "also Atlanta" adds to it.
  const only = /\b(only|just|instead)\b/.test(t);
  const merge = (had: string[], got: string[]) => (only && got.length ? got : [...new Set([...had, ...got])]);
  const locations = removing ? brief.locations.filter((l) => !t.includes(l.split(",")[0].toLowerCase())) : merge(brief.locations, found.locations);
  const companies = removing ? brief.companies.filter((c) => !hasWord(t, c.toLowerCase())) : merge(brief.companies, found.companies);
  return { ...brief, criteria, remoteOk, locations, companies, minYears: found.minYears ?? brief.minYears, payRange: found.payRange ?? brief.payRange };
}

/** "Chicago, IL, New York, NY" -> ["Chicago, IL", "New York, NY"]: a two-letter state joins the city before it. */
export function parseLocations(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const last = out[out.length - 1];
    if (/^[A-Za-z]{2}$/.test(part) && last && !/, [A-Z]{2}$/.test(last)) out[out.length - 1] = `${last}, ${part.toUpperCase()}`;
    else out.push(part);
  }
  return [...new Set(out)].slice(0, 6);
}

/** A requirement a recruiter typed, e.g. "Kubernetes" or "Go": what to look for in people's work. */
export function criterionFromLabel(label: string, importance: "must" | "nice"): Criterion {
  const clean = label.trim().slice(0, 60);
  const languages = LANGUAGES.filter(([re]) => re.test(clean)).map(([, name]) => name);
  const domain = DOMAINS.find((d) => d.re.test(clean));
  return { label: clean, importance, signals: [...new Set([clean.toLowerCase(), ...(domain?.signals ?? [])])], languages };
}

/** A rough brief from keywords, used when Claude isn't configured or can't be reached. */
export function readBriefLocally(text: string): Brief {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const criteria: Criterion[] = [];
  const add = (c: Criterion) => { if (!criteria.some((x) => x.label === c.label)) criteria.push(c); };
  let section: string | null = null, skipped = 0;

  for (const line of lines) {
    const head = line.replace(/^[-•*\s]+/, "").replace(/:$/, "");
    const hit = head.length < 60 && SECTION.find(([re]) => re.test(head));
    if (hit) { section = hit[1]; continue; }
    if (section === "skip" || FLUFF.test(line)) { skipped++; continue; }
    const importance = section === "nice" ? "nice" : "must";
    for (const [re, lang] of LANGUAGES) if (re.test(line)) add({ label: lang, importance, signals: [lang.toLowerCase()], languages: [lang] });
    for (const d of DOMAINS) if (d.re.test(line)) add({ label: d.label, importance: section === "must" ? "must" : section === "nice" ? "nice" : "must", signals: d.signals, languages: [] });
    if (/\b(senior|staff|principal|lead)\b/i.test(line)) add({ label: "Senior or above", importance: "must", signals: [], languages: [] });
  }

  const one = parseOneLine(text);
  const locations = [...new Set([...(one.location ? [one.location] : []), ...CITIES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(text) && !one.location?.startsWith(c))])];
  const jobTitle = jobTitleFrom(one.title ?? lines[0] ?? "");
  const years = text.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)/i);
  const pay = text.match(/\$\s?\d[\d,.]*k?\s?(?:–|-|to)\s?\$?\s?\d[\d,.]*k?/i)?.[0] ?? null;
  const auth = lines.find((l) => /sponsor|authori[sz]ed to work|work authori[sz]ation|green card/i.test(l))?.replace(/^[-•*\s]+/, "") ?? null;
  // A one-line request is named after the job; when it names none ("someone who knows Kubernetes"), after its first requirement.
  const title = (one.title ? (jobTitle || !criteria.length ? titleCase(one.title.split(/\s+(?:who|with|that|having)\b/i)[0]) : criteria[0].label) : lines[0] ?? "New search").slice(0, 80);

  return {
    title,
    summary: lines.length === 1 ? titleCase(lines[0]).slice(0, 160) : title,
    jobTitles: jobTitle ? titleVariants(jobTitle) : [],
    companies: one.company ? [one.company] : [],
    minYears: years ? Number(years[1]) : null,
    exclude: [],
    criteria,
    locations,
    remoteOk: /\bremote\b/i.test(text),
    payRange: pay,
    workAuthorization: auth,
    searchTerms: criteria.filter((c) => !c.languages.length && c.signals.length).slice(0, 3).map((c) => c.signals[0]),
    leftOut: skipped ? `${skipped} line${skipped > 1 ? "s" : ""} of benefits, perks and company description` : null,
  };
}

// ---------- Boolean strings ----------

const TITLE_WORDS = /\b(analyst|engineer|developer|programmer|manager|director|designer|scientist|accountant|recruiter|specialist|consultant|architect|administrator|coordinator|representative|technician|officer|associate|nurse|physician|therapist|pharmacist|attorney|lawyer|paralegal|teacher|professor|writer|editor|marketer|strategist|planner|buyer|auditor|controller|underwriter|actuary|electrician|mechanic|operator|supervisor|executive|president|founder|partner|assistant|advisor|adviser|agent|broker|trader|researcher|estimator|superintendent|bookkeeper|cto|ceo|cfo|coo|vp|sre|tester|lead|head)s?\b/i;

/**
 * A Boolean search string as a brief: ("data analyst" OR "BI analyst") AND (SQL OR Tableau) NOT manager.
 * The first group that names jobs becomes the job titles, groups of places become locations, every
 * other group is a must-have that any of its terms meets, and NOT terms rule out job titles.
 */
export function readBooleanLocally(text: string): Brief {
  type Group = { terms: string[]; negate: boolean };
  const groups: Group[] = [];
  let cur: Group = { terms: [], negate: false };
  let depth = 0, join = false, lastBare = false, ended = false;
  const close = () => { if (cur.terms.length) groups.push(cur); cur = { terms: [], negate: false }; join = false; lastBare = false; ended = false; };
  for (const m of text.matchAll(/"([^"]+)"|[()]|[^\s()"]+/g)) {
    let tok = m[0];
    if (tok === "OR") { join = true; ended = false; lastBare = false; continue; }
    if (tok === "AND") { close(); continue; }
    if (tok === "NOT") { close(); cur.negate = true; continue; }
    if (tok === "(") { if ((ended || (cur.terms.length && depth === 0)) && !join) close(); depth++; lastBare = false; continue; }
    if (tok === ")") { depth = Math.max(0, depth - 1); if (depth === 0) ended = true; lastBare = false; continue; }
    const bare = m[1] === undefined;
    if (bare && tok.length > 1 && tok.startsWith("-")) { close(); cur.negate = true; tok = tok.slice(1); }
    const term = (bare ? tok : m[1]).trim().replace(/^[,;]+|[,;]+$/g, "");
    if (!term) continue;
    if (ended && !join) close();
    if (bare && lastBare && !join && cur.terms.length) cur.terms[cur.terms.length - 1] += ` ${term}`; // adjacent words are one phrase
    else { if (cur.terms.length && !join && depth === 0) close(); cur.terms.push(term); }
    join = false; lastBare = bare; ended = cur.negate && depth === 0 && !bare;
  }
  close();

  const brief = emptyBrief();
  for (const g of groups) {
    const terms = [...new Set(g.terms.map((t) => t.slice(0, 60)))].slice(0, 8);
    const places = terms.map((t) => placeToLocation(t, true));
    if (g.negate) brief.exclude.push(...terms.map((t) => t.toLowerCase()));
    else if (!brief.jobTitles.length && terms.some((t) => TITLE_WORDS.test(t))) brief.jobTitles = terms.map((t) => titleCase(t.replace(LEVEL_WORDS, " "))).slice(0, 6);
    else if (places.every(Boolean)) brief.locations.push(...(places as string[]));
    else {
      const langs = terms.map((t) => LANGUAGES.find(([re]) => re.test(t))?.[1]);
      brief.criteria.push({
        label: terms.slice(0, 3).map(titleCaseIfLower).join(" or ").slice(0, 60), importance: "must",
        signals: terms.map((t) => t.toLowerCase()),
        languages: langs.every(Boolean) ? [...new Set(langs as string[])] : [], // a language requirement only when every alternative is one
      });
    }
  }
  brief.exclude = [...new Set(brief.exclude)].slice(0, 12);
  brief.locations = [...new Set(brief.locations)].slice(0, 6);
  brief.title = (brief.jobTitles[0] ?? brief.criteria[0]?.label ?? "Boolean search").slice(0, 80);
  brief.summary = text.replace(/\s+/g, " ").trim().slice(0, 200);
  brief.searchTerms = brief.criteria.filter((c) => !c.languages.length && isTech(c.label)).slice(0, 3).map((c) => c.signals[0]);
  return brief;
}

// ---------- people like this person ----------

/** A brief for finding people like someone, from what's on their profile. */
export function briefFromProfile(p: { name: string | null; headline: string | null; skills: string[]; languages: string[] }): Brief {
  const brief = emptyBrief();
  const who = p.name?.trim() || "this person";
  const job = p.headline ? jobTitleFrom(p.headline) : null;
  brief.jobTitles = job ? titleVariants(job) : [];
  const add = (label: string, importance: "must" | "nice") => {
    if (label.trim() && !brief.criteria.some((c) => c.label.toLowerCase() === label.trim().toLowerCase())) brief.criteria.push(criterionFromLabel(titleCaseIfLower(label), importance));
  };
  p.languages.slice(0, 2).forEach((l, i) => add(l, i === 0 ? "must" : "nice"));
  p.skills.slice(0, 5).forEach((sk, i) => add(sk, i < 2 && !p.languages.length ? "must" : "nice"));
  brief.title = (job ?? `People like ${who}`).slice(0, 80);
  brief.summary = `People with a background like ${who}${p.headline ? `, ${p.headline}` : ""}.`.slice(0, 200);
  brief.searchTerms = brief.criteria.filter((c) => !c.languages.length && isTech(c.label)).slice(0, 3).map((c) => c.signals[0]);
  return brief;
}
