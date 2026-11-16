// The stages an approved candidate moves through, and when a follow-up is due.
// No server-only imports: the screens use this too.

export const STAGES = [
  ["new", "To contact"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["interviewing", "Interviewing"],
  ["offer", "Offer"],
  ["hired", "Hired"],
  ["closed", "Not moving forward"],
] as const;

export type Stage = (typeof STAGES)[number][0];

export const isStage = (s: string): s is Stage => STAGES.some(([k]) => k === s);
export const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? "To contact";
export const stageIndex = (s: string) => Math.max(0, STAGES.findIndex(([k]) => k === s));

const DAY = 86_400_000;
/** Follow-ups after the first message: at most this many. */
export const MAX_FOLLOW_UPS = 2;

/**
 * A follow-up is due when someone was contacted, hasn't replied, and it's been 4 days since the
 * first message or 5 since the last follow-up. After two follow-ups, none is due.
 */
export function followUpDue(stage: string, sentAts: (Date | string)[], now = Date.now()): boolean {
  if (stage !== "contacted" || !sentAts.length || sentAts.length > MAX_FOLLOW_UPS) return false;
  const last = Math.max(...sentAts.map((d) => new Date(d).getTime()));
  return now - last >= (sentAts.length === 1 ? 4 : 5) * DAY;
}
