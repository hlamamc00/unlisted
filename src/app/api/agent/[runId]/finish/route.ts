import { finishRun } from "@/lib/agent";
import { checkAgentToken } from "@/agent/token";

/** Ends a run with the agent's summary (or what went wrong), and emails the recruiter when there's news. */
export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!checkAgentToken(runId, req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { summary?: string; error?: string };
  await finishRun(runId, body);
  return Response.json({ ok: true });
}
