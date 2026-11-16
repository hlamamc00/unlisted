import { agentContext } from "@/lib/agent";
import { checkAgentToken } from "@/agent/token";

/** What the agent starts from. Called by the agent driver with its run's token. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!checkAgentToken(runId, req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const ctx = await agentContext(runId);
  return ctx ? Response.json(ctx) : new Response("Run not found", { status: 404 });
}
