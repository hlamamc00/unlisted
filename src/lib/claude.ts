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

const DRAFT_SYSTEM = `You write a recruiter's first message to someone they found through the person's public work. Plain text, under 120 words, no subject line.

- Open with one specific piece of their work, described accurately using only the evidence given. Never invent details.
- Say in one sentence why that work matters for this role.
- If a pay range is given, include it.
- Ask for a 15-minute call, and make it easy to say no.
- No flattery, no exclamation marks, no buzzwords. Use the person's name, never gendered pronouns.
- End with "[Your name]" on its own line. Don't add an unsubscribe line; one is added after you.`;

export type DraftInput = {
  firstName: string;
  roleTitle: string;
  roleSummary: string;
  pay?: string | null;
  evidence: string[];
};

/** Drafts a first message citing the person's work. Returns null when Claude declines. */
export async function draftMessageWithClaude(input: DraftInput): Promise<string | null> {
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system: DRAFT_SYSTEM,
    messages: [{
      role: "user",
      content: `Name: ${input.firstName}\nRole: ${input.roleTitle}\nAbout the role: ${input.roleSummary}\nPay: ${input.pay || "not given"}\nTheir public work:\n${input.evidence.map((e) => `- ${e}`).join("\n")}`,
    }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return text || null;
}
