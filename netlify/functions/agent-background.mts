// Runs the sourcing agent for one run, for up to 15 minutes (a Netlify background function:
// the "-background" name makes Netlify answer the caller straight away). Started by the app
// (src/lib/agent.ts: startAgentRun) with a token only the app can make.
import { runAgent } from "../../src/agent/driver";
import { checkAgentToken } from "../../src/agent/token";

export default async (request: Request) => {
  const { runId } = (await request.json().catch(() => ({}))) as { runId?: string };
  const auth = request.headers.get("authorization");
  if (!runId || !checkAgentToken(runId, auth)) {
    console.error("[agent] refused a start without a valid token");
    return;
  }
  const site = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
  await runAgent({ site, runId, token: auth!.replace(/^Bearer\s+/i, "").trim() });
};
