import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Brief } from "@/lib/brief";
import type { Question } from "@/lib/agent";
import { STAGES, followUpDue } from "@/lib/pipeline";

export const metadata = { title: "Today" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What needs the recruiter today, across all their roles. */
export default async function TodayPage() {
  const user = await requireUser();
  const roles = await db.role.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, brief: true, nightly: true, questions: true,
      matches: { where: { status: { in: ["review", "approved"] } }, select: { status: true, stage: true, messages: { select: { sentAt: true } } } },
      runs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
    },
  });

  const now = Date.now();
  const cards = roles.map((r) => {
    const brief = r.brief as unknown as Brief;
    const approved = r.matches.filter((m) => m.status === "approved");
    const stages = Object.fromEntries(STAGES.map(([k]) => [k, approved.filter((m) => m.stage === k).length])) as Record<string, number>;
    const due = approved.filter((m) => followUpDue(m.stage, m.messages.map((x) => x.sentAt), now)).length;
    const run = r.runs[0];
    return {
      id: r.id, title: r.title, nightly: r.nightly, stages, due,
      summary: [...brief.criteria.filter((c) => c.importance === "must").slice(0, 3).map((c) => c.label), brief.locations.length ? brief.locations.join(" or ") : "Anywhere in the US"].join(" · "),
      toReview: r.matches.filter((m) => m.status === "review").length,
      waiting: Math.max(0, stages.contacted - due),
      questions: ((r.questions ?? []) as Question[]).filter((q) => q.status === "open").length,
      inPipeline: approved.length - stages.closed,
      searching: Boolean(run && ["queued", "running"].includes(run.status) && now - run.createdAt.getTime() < 15 * 60_000),
    };
  });
  type Key = "toReview" | "due" | "waiting" | "questions";
  const total = (k: Key) => cards.reduce((sum, c) => sum + c[k], 0);
  const first = (k: Key) => cards.find((c) => c[k] > 0)?.id;
  const tiles: { label: string; key: Key; hint: string; tab?: string }[] = [
    { label: "To review", key: "toReview", hint: "People waiting for your yes or no" },
    { label: "Follow-ups due", key: "due", hint: "Contacted, no reply yet", tab: "pipeline" },
    { label: "Waiting for replies", key: "waiting", hint: "Recently contacted", tab: "pipeline" },
    { label: "Questions for you", key: "questions", hint: "From the agent" },
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="hint">{cards.length ? "What needs you, across your roles." : `Welcome, ${user.name.split(" ")[0]}.`}</p>
        </div>
        <Link href="/app/roles/new" className="btn primary">New role</Link>
      </div>

      {cards.length === 0 ? (
        <div className="panel empty-start">
          <h2>Start with a job description</h2>
          <p>Upload or paste it. Unlisted finds people on LinkedIn and people who aren&apos;t on it, shows why each one fits, and writes your first message.</p>
          <Link href="/app/roles/new" className="btn primary">Create your first role</Link>
        </div>
      ) : (
        <>
          <div className="tiles">
            {tiles.map((t) => {
              const n = total(t.key), id = first(t.key);
              const body = <><span className="tile-n">{n}</span><span className="tile-label">{t.label}</span><span className="hint">{t.hint}</span></>;
              return id
                ? <Link key={t.key} href={`/app/roles/${id}${t.tab ? `?tab=${t.tab}` : ""}`} className={`panel tile${n ? " hot" : ""}`}>{body}</Link>
                : <div key={t.key} className="panel tile">{body}</div>;
            })}
          </div>

          <h2 className="section-title">Your roles</h2>
          <div className="role-cards">
            {cards.map((c) => (
              <Link key={c.id} href={`/app/roles/${c.id}`} className="panel role-card">
                <div className="role-card-top">
                  <div style={{ minWidth: 0 }}>
                    <h3>{c.title}</h3>
                    <p className="hint clip">{c.summary}</p>
                  </div>
                  {c.toReview > 0 ? <span className="cta-pill">{c.toReview} to review</span> : <span className="hint nowrap">All reviewed</span>}
                </div>
                {c.inPipeline > 0 && (
                  <div>
                    <div className="stagebar" aria-hidden="true">
                      {STAGES.filter(([k]) => k !== "closed" && c.stages[k] > 0).map(([k]) => <span key={k} className={`seg ${k}`} style={{ flexGrow: c.stages[k] }} />)}
                    </div>
                    <p className="hint">{STAGES.filter(([k]) => k !== "closed" && c.stages[k] > 0).map(([k, label]) => `${c.stages[k]} ${label.toLowerCase()}`).join(" · ")}</p>
                  </div>
                )}
                {(c.due > 0 || c.questions > 0 || c.searching || (c.nightly && !user.agentPaused)) && (
                  <div className="chips">
                    {c.due > 0 && <span className="chip ctx">{plural(c.due, "follow-up")} due</span>}
                    {c.questions > 0 && <span className="chip ctx">{plural(c.questions, "question")} for you</span>}
                    {c.searching && <span className="chip must">Agent searching</span>}
                    {c.nightly && !user.agentPaused && <span className="chip">Searches every night</span>}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
