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

const BRIEF_SYSTEM = `You turn a job description, or a few lines a recruiter wrote, into a search brief for finding candidates through their public work: GitHub repositories, papers and talks.

- label: 1 to 3 words a busy recruiter can scan, e.g. "Rust", "Low latency", "Trading systems", "6+ years".
- criteria: the requirements that matter for finding people. Mark "must" only for what is genuinely required. Job descriptions list more requirements than hiring managers need, so prefer "nice" when unsure. Leave out benefits, perks, the company description and legal text.
- Never include criteria about age, sex, race, religion, national origin, disability or other protected characteristics, or proxies for them such as graduation year.
- signals: lowercase words and short phrases that would appear in the repository names, descriptions, topics or bios of someone who meets the requirement.
- languages: GitHub's names for programming languages, e.g. "Rust", "C++", "Python".
- Seniority and years of experience can't be seen in public code: include them as criteria with empty signals and languages.
- searchTerms: 2 to 4 short phrases to search GitHub repositories with.`;

/** Reads a job description into a brief. Returns null when Claude declines. */
export async function readBriefWithClaude(text: string): Promise<Brief | null> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: `<job_description>\n${text}\n</job_description>` }],
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
