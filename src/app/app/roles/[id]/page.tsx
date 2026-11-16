import { notFound } from "next/navigation";
import { getUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Brief, RoleContext, RoleRules } from "@/lib/brief";
import { hasClaude } from "@/lib/claude";
import type { Feedback, Note, Question } from "@/lib/agent";
import { followUpDue, isStage } from "@/lib/pipeline";
import { evidenceFor, shortLocation, type Check } from "@/lib/score";
import { rescoreIfStale, toScorable, type SearchState } from "@/lib/search";
import { RoleScreen } from "./role-screen";
import type { Item } from "./types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  const role = user ? await db.role.findFirst({ where: { id: (await params).id, userId: user.id }, select: { title: true } }) : null;
  return { title: role?.title ?? "Role" };
}

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab } = await searchParams;
  await rescoreIfStale(id, user.id);
  const role = await db.role.findFirst({
    where: { id, userId: user.id },
    include: {
      matches: {
        where: { status: { in: ["review", "approved", "skipped"] } },
        include: { person: true, messages: { orderBy: { sentAt: "asc" }, select: { kind: true, channel: true, sentAt: true } } },
        orderBy: { score: "desc" },
      },
    },
  });
  if (!role) notFound();
  const run = await db.agentRun.findFirst({
    where: { roleId: id }, orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, added: true, looked: true, summary: true, error: true, createdAt: true },
  });

  const items: Item[] = role.matches.map((m) => ({
    id: m.id,
    status: m.status as Item["status"],
    score: m.score,
    checks: m.checks as Check[],
    evidence: evidenceFor(toScorable(m.person)),
    hasDraft: Boolean(m.draft),
    note: (m.note as Note | null) ?? null,
    foundBy: m.foundBy,
    stage: isStage(m.stage) ? m.stage : "new",
    notes: m.notes ?? "",
    followUpDue: m.status === "approved" && followUpDue(m.stage, m.messages.map((x) => x.sentAt)),
    messages: m.messages.map((x) => ({ kind: x.kind, channel: x.channel, sentAt: x.sentAt.toISOString() })),
    feedback: (m.feedback ?? []) as Feedback[],
    person: {
      login: m.person.githubLogin,
      linkedinUrl: m.person.linkedinUrl,
      headline: m.person.headline,
      name: m.person.name,
      avatarUrl: m.person.avatarUrl,
      location: shortLocation(m.person.location),
      company: m.person.company,
      email: m.person.email,
      blog: m.person.blog,
      hasLinkedIn: m.person.hasLinkedIn,
      hireable: Boolean(m.person.hireable),
    },
  }));
  const shared = role.shareToken && role.shareExpiresAt && role.shareExpiresAt > new Date();

  return (
    <main className="page">
      <RoleScreen
        key={role.id}
        initialTab={tab === "pipeline" ? "approved" : "review"}
        role={{
          id: role.id,
          title: role.title,
          brief: role.brief as unknown as Brief,
          context: (role.context ?? {}) as RoleContext,
          excluded: ((role.rules ?? {}) as RoleRules).excludedLocations ?? [],
          linkedInTotal: ((role.searchState ?? {}) as SearchState).pdlTotal ?? null,
          share: shared ? { path: `/r/${role.shareToken}`, expires: role.shareExpiresAt!.toISOString() } : null,
        }}
        items={items}
        agent={{
          enabled: hasClaude(),
          nightly: role.nightly,
          run: run ? { ...run, createdAt: run.createdAt.toISOString() } : null,
          questions: ((role.questions ?? []) as Question[]).filter((q) => q.status === "open"),
        }}
      />
    </main>
  );
}
