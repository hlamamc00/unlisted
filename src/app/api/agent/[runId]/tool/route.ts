import { runTool } from "@/lib/agent";
import { checkAgentToken } from "@/agent/token";

/** Runs one of the agent's tools. Called by the agent driver with its run's token. */
export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!checkAgentToken(runId, req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const { name, input } = (await req.json().catch(() => ({}))) as { name?: string; input?: Record<string, unknown> };
  if (!name) return Response.json({ error: "A tool name is required." }, { status: 400 });
  return Response.json(await runTool(runId, name, input ?? {}));
}
