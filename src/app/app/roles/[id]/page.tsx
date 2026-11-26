import { notFound } from "next/navigation";
import { getUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toBrief, type RoleContext, type RoleRules } from "@/lib/brief";
import { hasClaude } from "@/lib/claude";
import { hasPdl, type Role } from "@/lib/pdl";
import type { Feedback, Note, Question } from "@/lib/agent";
import { followUpDue, isStage } from "@/lib/pipeline";
import { employerMatches, evidenceFor, searchTitles, shortLocation, titleMatches, type Check } from "@/lib/score";
import { rescoreIfStale, toScorable, type SearchState } from "@/lib/search";
import { RoleScreen } from "./role-screen";
import type { Item, JobView } from "./types";

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
      _count: { select: { runs: true } },
    },
  });
  if (!role) notFound();
  const brief = toBrief(role.brief);
  const state = (role.searchState ?? {}) as SearchState;

  // Work history for the cards, newest first, with the jobs the search asked for marked.
  const titles = searchTitles(brief);
  const year = (d?: string | null) => d?.slice(0, 4) || null;
  const when = (r: Role) => {
    const from = year(r.start), to = r.current ? "Present" : year(r.end);
    return from && to ? (from === to ? from : `${from} – ${to}`) : from ?? to ?? "";
  };
  const job = (r: Role): JobView => ({
    title: r.title, company: r.company, when: when(r),
    match: titles.some((t) => titleMatches(r.title, t)) || brief.companies.some((c) => Boolean(r.company) && employerMatches(r.company!, c)),
  });
  const jobs = (p: { headline: string | null; company: string | null; experience: unknown }): JobView[] => {
    const history = ((p.experience ?? []) as Role[]).slice(0, 5).map(job);
    return history.length || !p.headline ? history : [job({ title: p.headline, company: p.company, current: true })];
  };
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
      experience: jobs(m.person),
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
          brief,
          context: (role.context ?? {}) as RoleContext,
          excluded: ((role.rules ?? {}) as RoleRules).excludedLocations ?? [],
          linkedInTotal: state.pdlTotal ?? null,
          searchNote: state.note ?? null,
          linkedIn: hasPdl(),
          // Roles the agent already searched before calibration existed count as calibrated.
          calibrated: Boolean(role.calibratedAt) || role._count.runs > 0,
          share: shared ? { path: `/r/${role.shareToken}`, expires: role.shareExpiresAt!.toISOString() } : null,
        }}
        items={items}
        agent={{
          enabled: hasClaude(),
          paused: user.agentPaused,
          nightly: role.nightly,
          run: run ? { ...run, createdAt: run.createdAt.toISOString() } : null,
          questions: ((role.questions ?? []) as Question[]).filter((q) => q.status === "open"),
        }}
      />
    </main>
  );
}
