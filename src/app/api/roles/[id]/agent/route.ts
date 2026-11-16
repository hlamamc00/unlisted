import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Question } from "@/lib/agent";

/** The latest agent run and open questions for a role. The role page checks this every few seconds while the agent works. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const role = await db.role.findFirst({ where: { id, userId: user.id }, select: { questions: true } });
  if (!role) return new Response("Not found", { status: 404 });
  const run = await db.agentRun.findFirst({
    where: { roleId: id }, orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, added: true, looked: true, summary: true, error: true, createdAt: true },
  });
  return Response.json({ run, questions: ((role.questions ?? []) as Question[]).filter((q) => q.status === "open") });
}
