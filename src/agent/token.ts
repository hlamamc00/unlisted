// Tokens that let the background agent call the app's agent API for one run (or the nightly job).
// Derived from AUTH_SECRET, so no extra setting is needed. No database or Next.js imports here:
// the Netlify background function uses this file too.
import { createHmac, timingSafeEqual } from "node:crypto";

export function agentToken(scope: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set");
  return createHmac("sha256", secret).update(`agent:${scope}`).digest("base64url");
}

export function checkAgentToken(scope: string, authorization: string | null): boolean {
  const given = Buffer.from(authorization?.replace(/^Bearer\s+/i, "").trim() ?? "");
  const want = Buffer.from(agentToken(scope));
  return given.length === want.length && timingSafeEqual(given, want);
}
