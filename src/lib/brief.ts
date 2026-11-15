// The brief: what a role needs, in a form the search and the scoring can use.
// Claude fills it from a job description (src/lib/claude.ts); readBriefLocally is
// the keyword fallback when no Anthropic key is set.
import { z } from "zod";

export const CriterionSchema = z.object({
  label: z.string().describe("Short requirement as a recruiter would say it, e.g. 'Rust' or 'Low-latency trading systems'."),
  importance: z.enum(["must", "nice"]),
  signals: z
    .array(z.string())
    .describe("Lowercase words or short phrases that would appear in repository names, descriptions, topics or bios of someone who meets this requirement."),
  languages: z.array(z.string()).describe("GitHub language names that show this requirement, e.g. 'Rust', 'C++'. Empty when it isn't about a programming language."),
});

export const BriefSchema = z.object({
  title: z.string().describe("The job title, e.g. 'Senior Rust Engineer, Trading Systems'."),
  summary: z.string().describe("One sentence describing who the role needs."),
  criteria: z.array(CriterionSchema),
  locations: z.array(z.string()).describe("Cities or regions the person should be in, e.g. 'Chicago, IL'. Empty when location doesn't matter."),
  remoteOk: z.boolean(),
  payRange: z.string().nullable().describe("The pay range as written, or null."),
  workAuthorization: z.string().nullable().describe("What it says about visas or authorization to work, or null."),
  searchTerms: z.array(z.string()).describe("2 to 4 short phrases to search GitHub repositories with, e.g. 'order book'."),
  leftOut: z.string().nullable().describe("A short phrase naming what was ignored, e.g. 'benefits, perks and the company description', or null."),
});

export type Brief = z.infer<typeof BriefSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;

/** Answers to what job descriptions don't say. */
export type RoleContext = { avoid?: string; like?: string; pay?: string };
/** What the role has learned from the recruiter's skips. */
export type RoleRules = { excludedLocations?: string[] };

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

  const locations = CITIES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  const pay = text.match(/\$\s?\d[\d,.]*k?\s?(?:–|-|to)\s?\$?\s?\d[\d,.]*k?/i)?.[0] ?? null;
  const auth = lines.find((l) => /sponsor|authori[sz]ed to work|work authori[sz]ation|green card/i.test(l))?.replace(/^[-•*\s]+/, "") ?? null;
  const title = (lines[0] ?? "New role").slice(0, 80);

  return {
    title,
    summary: title,
    criteria,
    locations,
    remoteOk: /\bremote\b/i.test(text),
    payRange: pay,
    workAuthorization: auth,
    searchTerms: criteria.filter((c) => !c.languages.length && c.signals.length).slice(0, 3).map((c) => c.signals[0]),
    leftOut: skipped ? `${skipped} line${skipped > 1 ? "s" : ""} of benefits, perks and company description` : null,
  };
}
