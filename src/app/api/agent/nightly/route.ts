import { db } from "@/lib/db";
import { startAgentRun } from "@/lib/agent";
import { checkAgentToken } from "@/agent/token";

/** Starts the overnight top-up for every role that has it switched on. Called by netlify/functions/agent-nightly.mts. */
export async function POST(req: Request) {
  if (!checkAgentToken("nightly", req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const since = new Date(Date.now() - 20 * 3_600_000);
  const roles = await db.role.findMany({
    where: { nightly: true, user: { agentPaused: false }, runs: { none: { trigger: "nightly", createdAt: { gt: since } } } },
    select: { id: true }, take: 50,
  });
  let started = 0;
  for (const r of roles) if ((await startAgentRun(r.id, "nightly")).runId) started++;
  return Response.json({ roles: roles.length, started });
}
