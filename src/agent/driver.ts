// The sourcing agent's loop. Claude plans and decides; every tool call goes to the app's own
// agent API (src/app/api/agent), which does the searching, checking and saving. This file has no
// database or Next.js imports, so the Netlify background function can run it for up to 15 minutes.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are a sourcing agent working for a recruiter in the US. Your job is to find people who fit one role and add the best of them to the recruiter's review list, each with a short, accurate note.

How to work:
- Start from the brief and from the people the recruiter approved and skipped. Look for more people like the ones they approved, and avoid what made them skip others.
- Find people two ways: search_github finds people through what they've built (repositories) or by language and city (users); search_linkedin finds people with LinkedIn profiles, when it's available. Use both, so the list also includes strong people who aren't on LinkedIn.
- Before adding someone from GitHub, look at them with look_at_people (up to 6 at a time). Profiles from search_linkedin already include what you need.
- Add only people who genuinely fit, with add_candidates. For each, write why they fit in one or two sentences, and an opening line the recruiter could start a message with. Cite evidence exactly as the tools showed it: repository names, job titles, companies or skills. Never invent or embellish details; anything you can't cite, leave out.
- If an add is rejected, read the reason and adjust; don't retry the same thing.
- If the recruiter named companies to target, look there first (search_linkedin takes a companies list). People at companies to avoid can't be added. If an ideal example is given, look for people whose work resembles it.
- Hiring manager feedback tells you what the person making the decision wants: find more people like the ones they want to talk to.
- When a search finds little, change approach: other search terms, related skills, nearby areas. If the brief itself seems too narrow (for example the city has very few people), ask the recruiter with ask_recruiter rather than assuming. Ask at most two questions, only when the answer would change who you look for, and never re-ask something already answered.
- Never use or guess anyone's age, gender, race, religion, national origin, disability or visa status, and never use graduation years or account age as a stand-in for experience.
- Stop when you've added about 8 strong people, when searches stop finding new people, or when a tool says time is up. Quality matters more than quantity.
- Finish by replying with two or three plain sentences for the recruiter: what you searched, how many people you added, and anything they should decide.`;

type Context = Record<string, unknown> & { role: { title: string }; linkedinAvailable: boolean; limits: Record<string, number> };

function briefing(ctx: Context): string {
  return [
    `Find candidates for this role. Here is everything you know, as JSON:`,
    JSON.stringify(ctx, null, 1),
    ctx.linkedinAvailable ? "" : "LinkedIn search is not available for this account; use GitHub only.",
    `Limits for this run: ${JSON.stringify(ctx.limits)}.`,
  ].filter(Boolean).join("\n\n");
}

export async function runAgent({ site, runId, token }: { site: string; runId: string; token: string }) {
  const api = async (path: string, body?: unknown) => {
    const res = await fetch(`${site}/api/agent/${runId}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`The app's agent API answered ${res.status} for ${path}`);
    return res.json();
  };
  const call = async (name: string, input: unknown) => {
    try { return JSON.stringify(await api("tool", { name, input })); }
    catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : "The tool failed." }); }
  };

  const tools = [
    betaZodTool({
      name: "search_github",
      description: "Search GitHub. kind 'repos' finds the owners of repositories matching the query (people found through what they've built); kind 'users' finds people by language and location. Returns people not yet shown to the recruiter.",
      inputSchema: z.object({
        kind: z.enum(["repos", "users"]),
        query: z.string().describe("GitHub search syntax. Repos: words plus qualifiers, e.g. 'order book language:Rust stars:>5 pushed:>2025-06-01'. Users: qualifiers, e.g. 'language:Rust location:Chicago followers:>10'."),
        page: z.number().int().min(1).max(10).optional(),
      }),
      run: (input) => call("search_github", input),
    }),
    betaZodTool({
      name: "search_linkedin",
      description: "Search people in the US with LinkedIn profiles, through a licensed data provider. Each person returned uses a credit, so search precisely. Returns full profiles with how they fit the brief.",
      inputSchema: z.object({
        title: z.string().describe("Job title words, e.g. 'software engineer' or 'actuary'"),
        skills: z.array(z.string()).max(4).describe("Skills they must list, e.g. ['rust']"),
        cities: z.array(z.string()).max(4).describe("Cities to search in, e.g. ['Chicago']; ignored when remote is true"),
        remote: z.boolean().describe("true to search the whole US"),
        boost: z.array(z.string()).max(8).optional().describe("Skills that make someone a better match, e.g. ['low latency', 'trading']"),
        companies: z.array(z.string()).max(8).optional().describe("Only people currently at these companies, e.g. the recruiter's target companies"),
      }),
      run: (input) => call("search_linkedin", input),
    }),
    betaZodTool({
      name: "look_at_people",
      description: "Look closely at GitHub users: location, main languages, best repositories, LinkedIn status, and how they fit the brief. Use before adding anyone found on GitHub.",
      inputSchema: z.object({ github_logins: z.array(z.string()).min(1).max(6) }),
      run: (input) => call("look_at_people", input),
    }),
    betaZodTool({
      name: "add_candidates",
      description: "Add people to the recruiter's review list. Each is checked: their location must fit, and every piece of evidence must appear in their profile.",
      inputSchema: z.object({
        candidates: z.array(z.object({
          person_id: z.string().describe("Exactly as a tool returned it"),
          why: z.string().describe("One or two sentences on why they fit, using only facts from their profile"),
          opener: z.string().describe("One sentence the recruiter could open a message with, mentioning their actual work"),
          evidence: z.array(z.string()).min(1).max(6).describe("Exact repository names, job titles, companies or skills from their profile"),
        })).min(1).max(5),
      }),
      run: (input) => call("add_candidates", input),
    }),
    betaZodTool({
      name: "ask_recruiter",
      description: "Ask the recruiter a yes/no question whose answer changes the role. Their answer arrives later; carry on meanwhile.",
      inputSchema: z.object({
        question: z.string().describe("Short and plain, e.g. 'Chicago has few matches. Should I include people anywhere in the US?'"),
        change: z.discriminatedUnion("type", [
          z.object({ type: z.literal("allow_remote") }),
          z.object({ type: z.literal("add_location"), location: z.string() }),
          z.object({ type: z.literal("make_optional"), requirement: z.string().describe("A must-have's label, exactly") }),
          z.object({ type: z.literal("add_requirement"), label: z.string(), signals: z.array(z.string()), languages: z.array(z.string()) }),
        ]).describe("What changes in the role if they say yes"),
      }),
      run: (input) => call("ask_recruiter", input),
    }),
  ];

  try {
    const ctx = (await api("context")) as Context;
    const final = await new Anthropic().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      max_iterations: 16,
      // If the model declines, the API re-runs the request on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      // Each turn re-sends the conversation; caching it makes the repeats cheap.
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools,
      messages: [{ role: "user", content: briefing(ctx) }],
    });
    const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    console.log(`[agent ${runId}] finished: stop_reason=${final.stop_reason} usage=${JSON.stringify(final.usage)}`);
    await api("finish", final.stop_reason === "refusal" ? { error: "The agent stopped early." } : { summary: text });
  } catch (e) {
    console.error(`[agent ${runId}] failed`, e);
    await api("finish", { error: "The agent ran into a problem and stopped." }).catch(() => undefined);
  }
}
