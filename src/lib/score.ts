// How well a person fits a brief, line by line, from their public work only.
// Nothing here uses or guesses age, sex, race or other protected traits, and
// account age is deliberately not used as a stand-in for experience.
import type { Brief } from "./brief";
import type { Repo } from "./github";

export type Check = {
  label: string;
  importance: "must" | "nice" | "location";
  status: "yes" | "no" | "unknown";
  detail?: string;
};

export type ScorablePerson = {
  bio: string | null; company: string | null; location: string | null;
  languages: Record<string, number>; topRepos: Repo[]; totalStars: number; lastPushAt: Date | null;
};

const DAY = 86_400_000;
const city = (loc: string) => loc.split(",")[0].trim().toLowerCase();

export function scorePerson(p: ScorablePerson, brief: Brief): { score: number; checks: Check[] } {
  const repoText = (r: Repo) => [r.name.replace(/[-_.]/g, " "), r.description ?? "", ...r.topics].join(" ").toLowerCase();
  const corpus = [p.bio ?? "", p.company ?? "", ...p.topRepos.map(repoText)].join(" ").toLowerCase();
  const langs = Object.fromEntries(Object.entries(p.languages).map(([l, n]) => [l.toLowerCase(), n]));
  const checks: Check[] = [];
  let got = 0, max = 0, mustsWithSignals = 0, mustsMet = 0;

  for (const c of brief.criteria) {
    if (!c.signals.length && !c.languages.length) {
      checks.push({ label: c.label, importance: c.importance, status: "unknown", detail: "Ask in your first conversation" });
      continue;
    }
    const lang = c.languages.find((l) => langs[l.toLowerCase()]);
    const signal = c.signals.find((s) => s && corpus.includes(s.toLowerCase()));
    const repo = signal ? p.topRepos.find((r) => repoText(r).includes(signal.toLowerCase())) : undefined;
    const yes = Boolean(lang || signal);
    const detail = lang
      ? `${langs[lang.toLowerCase()]} ${lang} ${langs[lang.toLowerCase()] === 1 ? "repository" : "repositories"}`
      : repo ? `In ${repo.name}` : signal ? `Mentions "${signal}"` : undefined;
    checks.push({ label: c.label, importance: c.importance, status: yes ? "yes" : "no", detail });
    const w = c.importance === "must" ? 3 : 1;
    max += w;
    if (yes) got += w;
    if (c.importance === "must") { mustsWithSignals++; if (yes) mustsMet++; }
  }

  if (brief.locations.length) {
    const where = p.location?.toLowerCase() ?? "";
    const hit = brief.locations.find((l) => where && where.includes(city(l)));
    checks.unshift({
      label: hit ?? (p.location || "Location not given"),
      importance: "location",
      status: hit ? "yes" : brief.remoteOk || !p.location ? "unknown" : "no",
      detail: hit ? undefined : brief.remoteOk ? "Remote is fine for this role" : p.location ? "Outside your locations" : "Not on their profile",
    });
    // A miss only counts against people when the role can't be remote and their location is known.
    if (!brief.remoteOk && p.location) { max += 1.5; if (hit) got += 1.5; }
    else if (hit) { max += 1.5; got += 1.5; }
  }

  // Strength of the public work, a small bonus: stars on their own projects and recent activity.
  const strength = Math.min(6, Math.log10(p.totalStars + 1) * 2) + (p.lastPushAt && Date.now() - p.lastPushAt.getTime() < 90 * DAY ? 3 : 0);
  let score = (max ? 40 + 50 * (got / max) : 50) + strength;
  // Missing every must-have that public work can show means it isn't a match.
  if (mustsWithSignals && !mustsMet) score = Math.min(score, 30);
  return { score: Math.round(Math.min(99, score)), checks };
}

/** Plain-language lines about someone's public work, for the review screen and message drafts. */
export function evidenceFor(p: ScorablePerson & { followers: number; hireable: boolean | null }): { src: string; text: string }[] {
  const out: { src: string; text: string }[] = [];
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
