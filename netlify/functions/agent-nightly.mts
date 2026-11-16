// The overnight top-up: every day at 10:00 UTC (5 or 6 am US Eastern), the app starts the agent
// for each role with "Keep searching every night" switched on (src/app/api/agent/nightly).
import { agentToken } from "../../src/agent/token";

export default async () => {
  const site = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
  const res = await fetch(`${site}/api/agent/nightly`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken("nightly")}` },
    signal: AbortSignal.timeout(25_000),
  });
  console.log(`[agent-nightly] ${res.status} ${await res.text()}`);
};

export const config = { schedule: "0 10 * * *" };
