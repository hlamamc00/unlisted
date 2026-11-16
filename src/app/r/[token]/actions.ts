"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Feedback } from "@/lib/agent";

/**
 * A hiring manager's verdict on one candidate from the shared shortlist. No login: the link's token
 * is the permission, it only works until the link expires, and only for that role's shortlist.
 */
export async function submitFeedback(token: string, matchId: string, input: { by: string; verdict: "up" | "down"; comment: string }): Promise<{ ok: boolean }> {
  const role = await db.role.findFirst({ where: { shareToken: token, shareExpiresAt: { gt: new Date() } }, select: { id: true } });
  if (!role) return { ok: false };
  const match = await db.match.findFirst({ where: { id: matchId, roleId: role.id, status: { in: ["review", "approved"] } }, select: { feedback: true } });
  if (!match) return { ok: false };

  const by = String(input.by ?? "").trim().slice(0, 60) || "Hiring manager";
  const entry: Feedback = { by, verdict: input.verdict === "down" ? "down" : "up", comment: String(input.comment ?? "").trim().slice(0, 400), at: new Date().toISOString() };
  // One verdict per person; a new one replaces their earlier one.
  const others = ((match.feedback ?? []) as Feedback[]).filter((f) => f.by.toLowerCase() !== by.toLowerCase()).slice(-9);
  await db.match.update({ where: { id: matchId }, data: { feedback: [...others, entry] as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/app/roles/${role.id}`);
  return { ok: true };
}
