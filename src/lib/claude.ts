import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BriefSchema, type Brief } from "./brief";

const MODEL = "claude-opus-5-5";
// If the model declines a request, the API re-runs it on Anthropic's recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const BRIEF_SYSTEM = `You turn what a recruiter gives you into a search brief for finding candidates in the US. The input is a job description, a few lines in their own words, or a one-line request such as "data analyst in alpharetta georgia from hp". Candidates are found two ways: through professional profiles (job title, employers, location, skills, work history) and, for people who publish code, through their GitHub repositories.

- title: the job's name as it would appear on a posting, e.g. "Data Analyst" or "Senior Rust Engineer, Trading Systems". No place and no employer.
- jobTitles: 1 to 4 titles people in this job actually hold, the most likely first: the one asked for plus close variants, e.g. "Data Analyst", "Business Intelligence Analyst", "Reporting Analyst". For software roles include the general title, e.g. "Software Engineer". No seniority words such as Senior or Lead.
- companies: employers the person must work at now or have worked at before, only when the recruiter asks for that ("from HP", "ex-Google", "who worked at Deloitte"). Use the name people put on their profile, and when a company is widely known by two names give both, e.g. "HP" and "Hewlett-Packard". The company that is hiring is never one of these.
- minYears: the minimum years of experience when a number is stated, otherwise null. Don't repeat it in criteria.
- locations: a city as "City, ST" with the two-letter state, e.g. "Alpharetta, GA"; a whole state by its name, e.g. "Texas". Empty when no place is given.
- remoteOk: true only when remote work is offered or the recruiter says anywhere is fine.
- criteria: the skills, tools, domains, licenses and certifications that matter for finding people. Mark "must" only for what is genuinely required: job descriptions list more requirements than hiring managers need, so prefer "nice" when unsure. A one-line request often has none, and you must not invent requirements the recruiter didn't mention. Leave out the job title itself, places, employers, years of experience, benefits, perks, the company description and legal text.
- label: 1 to 3 words a busy recruiter can scan, e.g. "SQL", "Tableau", "Low latency", "RN license".
- signals: lowercase words and short phrases that would appear in the skills, job titles, bios or repository names of someone who meets the requirement.
- languages: GitHub's names for programming languages, e.g. "Rust", "C++", "Python". Empty when the requirement isn't a programming language.
- Seniority can't be seen reliably: include it only when it's asked for, as a criterion with empty signals and languages.
- exclude: words that rule someone out when they appear in their job title, only when the recruiter says so: "not managers" gives "manager". Otherwise empty.
- searchTerms: for roles where people publish code, 2 to 4 short phrases to search GitHub repositories with, e.g. "order book". Empty for every other kind of role.
- Never include criteria about age, sex, race, religion, national origin, disability or other protected characteristics, or proxies for them such as graduation year.`;

/** Reads a one-line request or a job description into a brief. Returns null when Claude declines. */
export async function readBriefWithClaude(text: string): Promise<Brief | null> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: `<request>\n${text}\n</request>` }],
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}

const REFINE_SYSTEM = `${BRIEF_SYSTEM}

You are now updating an existing brief. The recruiter gives an instruction such as "remote is fine", "must know Tableau", "only people who worked at Dell" or "5+ years". Return the complete updated brief: apply the instruction, keep everything it doesn't mention exactly as it is, and don't re-word existing labels.`;

/** Applies a recruiter's plain-words change to a brief. Returns null when Claude declines. */
export async function refineBriefWithClaude(brief: Brief, instruction: string): Promise<Brief | null> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: `<brief>\n${JSON.stringify(brief)}\n</brief>\n<instruction>\n${instruction}\n</instruction>` }],
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}

const DRAFT_SYSTEM = `You write a recruiter's first message to someone they found through the person's public work or professional profile. Plain text, under 120 words, no subject line.

- Open with one specific piece of their work, described accurately using only the evidence given. Never invent details.
- Say in one sentence why that work matters for this role.
- If a pay range is given, include it.
- Ask for a 15-minute call, and make it easy to say no. If a scheduling link is given, offer it as the way to pick a time, written out in full.
- No flattery, no exclamation marks, no buzzwords. Use the person's name, never gendered pronouns.
- Sign off with the recruiter's name on its own line, followed by their company if given. Don't add an unsubscribe line; one is added after you.`;

const FOLLOW_UP_SYSTEM = `You write a recruiter's short follow-up to someone who hasn't answered an earlier message about a role. Plain text, under 60 words, no subject line.

- Don't repeat the first message. Add one new, specific reason the role fits their work, using only the evidence given, or one concrete detail about the role.
- Keep it light: one question that's easy to answer, such as whether the timing is wrong.
- If this is the final follow-up, say you won't write again.
- No guilt, no "just bumping this", no exclamation marks. Use the person's name, never gendered pronouns.
- Sign off with the recruiter's name on its own line. Don't add an unsubscribe line; one is added after you.`;

export type DraftInput = {
  firstName: string;
  roleTitle: string;
  roleSummary: string;
  pay?: string | null;
  evidence: string[];
  /** A suggested opening line from the sourcing agent, based on their work. */
  opener?: string;
  recruiterName: string;
  recruiterCompany?: string | null;
  schedulingUrl?: string | null;
  /** For follow-ups: what was sent before, oldest first. */
  previous?: string[];
};

/** Drafts a first message, or a follow-up when `previous` is given. Returns null when Claude declines. */
export async function draftMessageWithClaude(input: DraftInput): Promise<string | null> {
  const followUp = Boolean(input.previous?.length);
  const facts = [
    `Name: ${input.firstName}`,
    `Role: ${input.roleTitle}`,
    `About the role: ${input.roleSummary}`,
    `Pay: ${input.pay || "not given"}`,
    `Recruiter: ${input.recruiterName}${input.recruiterCompany ? `, ${input.recruiterCompany}` : ""}`,
    `Scheduling link: ${input.schedulingUrl || "none"}`,
    `Their work:\n${input.evidence.map((e) => `- ${e}`).join("\n")}`,
    input.opener && !followUp ? `Suggested opening line, based on their work: ${input.opener}` : "",
    followUp ? `Already sent, oldest first:\n${input.previous!.map((m, i) => `--- message ${i + 1}\n${m}`).join("\n")}` : "",
    followUp ? `This is follow-up ${input.previous!.length} of 2${input.previous!.length >= 2 ? ", the final one" : ""}.` : "",
  ].filter(Boolean).join("\n");
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system: followUp ? FOLLOW_UP_SYSTEM : DRAFT_SYSTEM,
    messages: [{ role: "user", content: facts }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return text || null;
}
