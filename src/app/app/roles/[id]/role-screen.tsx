"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Question } from "@/lib/agent";
import { STAGES, stageIndex, stageLabel, type Stage } from "@/lib/pipeline";
import { fitLabel, fitLevel } from "@/lib/score";
import { answerAgentQuestion, decide, findCandidates, saveNotes, setStage, type MessageKind, type SkipReason } from "../../actions";
import { Avatar, displayName } from "./avatar";
import { CandidateDetail, REASONS } from "./candidate-detail";
import { MessageDrawer } from "./message-drawer";
import { RoleDrawer } from "./role-drawer";
import type { AgentView, Item, RoleView, RunView, Tab } from "./types";

const TABS: [Tab, string][] = [["review", "To review"], ["approved", "Pipeline"], ["skipped", "Skipped"]];

/** A role: review new candidates, work the pipeline, and watch the agent search. */
export function RoleScreen({ role, items, agent, initialTab }: { role: RoleView; items: Item[]; agent: AgentView; initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [overrides, setOverrides] = useState<Record<string, Partial<Pick<Item, "status" | "stage">>>>({});
  const [sel, setSel] = useState<string | null>(null);
  // On phones only one pane shows at a time: the list, or one candidate.
  const [pane, setPane] = useState<"list" | "detail">(initialTab === "review" ? "detail" : "list");
  const [skipOpen, setSkipOpen] = useState(false);
  const [message, setMessage] = useState<{ id: string; kind: MessageKind } | null>(null);
  const [roleDrawer, setRoleDrawer] = useState<"details" | "add" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [run, setRun] = useState<RunView | null>(agent.run);
  const [questions, setQuestions] = useState<Question[]>(agent.questions);
  const [hideRunNote, setHideRunNote] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastAdded = useRef(agent.run?.added ?? 0);
  const active = run?.status === "queued" || run?.status === "running";

  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const lists = useMemo(() => {
    const out: Record<Tab, Item[]> = { review: [], approved: [], skipped: [] };
    for (const raw of items) {
      const it = { ...raw, ...overrides[raw.id] };
      out[it.status].push({ ...it, followUpDue: it.followUpDue && it.stage === "contacted" && it.status === "approved" });
    }
    out.approved.sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || Number(b.followUpDue) - Number(a.followUpDue) || b.score - a.score);
    return out;
  }, [items, overrides]);
  const cur = lists[tab];
  const idx = Math.max(0, cur.findIndex((x) => x.id === sel));
  const item = cur.length ? cur[idx] : null;
  const messageItem = message ? [...lists.review, ...lists.approved, ...lists.skipped].find((x) => x.id === message.id) : undefined;

  const select = (id: string | null) => { setSel(id); setSkipOpen(false); };
  const openTab = (t: Tab) => { setTab(t); select(null); setPane(t === "review" ? "detail" : "list"); };

  const move = async (it: Item, to: Tab, reason?: SkipReason) => {
    if (tab !== to) { const i = cur.findIndex((x) => x.id === it.id); setSel((cur[i + 1] ?? cur[i - 1])?.id ?? null); }
    setOverrides((o) => ({ ...o, [it.id]: { ...o[it.id], status: to } }));
    setSkipOpen(false);
    const { learned } = await decide(it.id, to, reason);
    say(learned ?? (to === "approved" ? `${displayName(it.person)} is in your pipeline.` : to === "skipped" ? "Skipped" : "Moved back to review"));
    router.refresh();
  };

  const changeStage = async (it: Item, stage: Stage) => {
    setOverrides((o) => ({ ...o, [it.id]: { ...o[it.id], stage } }));
    await setStage(it.id, stage);
    say(`${displayName(it.person)}: ${stageLabel(stage)}`);
    router.refresh();
  };

  const find = () => startSearch(async () => {
    const r = await findCandidates(role.id);
    const quick = r.added ? `Found ${r.added} right away.` : r.message ?? "";
    say([quick, r.agent.started ? "The agent is searching for more in the background." : r.agent.message].filter(Boolean).join(" ") || "No strong matches yet.");
    if (r.agent.started) {
      lastAdded.current = 0;
      setHideRunNote(false);
      setRun({ id: "", status: "queued", progress: "Starting", added: 0, looked: 0, summary: null, error: null, createdAt: new Date().toISOString() });
    }
    router.refresh();
  });

  // While the agent works, check on it every few seconds; new candidates appear as it adds them.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/roles/${role.id}/agent`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { run: RunView | null; questions: Question[] };
      setQuestions(data.questions);
      if (!data.run) return;
      setRun(data.run);
      const finished = data.run.status === "done" || data.run.status === "failed";
      if (data.run.added !== lastAdded.current || finished) { lastAdded.current = data.run.added; router.refresh(); }
      if (data.run.status === "done") say(`The agent finished and added ${data.run.added} ${data.run.added === 1 ? "person" : "people"}.`);
    }, 3000);
    return () => clearInterval(timer);
  }, [active, role.id, router, say]);

  const answer = async (q: Question, yes: boolean) => {
    setQuestions((qs) => qs.filter((x) => x.id !== q.id));
    await answerAgentQuestion(role.id, q.id, yes);
    say(yes ? "Updated the role. Click Find candidates to search with the change." : "Noted. The agent won't ask that again.");
    router.refresh();
  };

  // Shortcuts for fast reviewing: J/K move, A approves, S then 1-4 skips, M writes a message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (message || roleDrawer || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "j" && cur[idx + 1]) select(cur[idx + 1].id);
      else if (k === "k" && cur[idx - 1]) select(cur[idx - 1].id);
      else if (!item) return;
      else if (k === "a" && item.status === "review") void move(item, "approved");
      else if (k === "s" && item.status === "review") setSkipOpen(true);
      else if (k === "m" && item.status !== "skipped") setMessage({ id: item.id, kind: item.messages.length ? "followup" : "first" });
      else if (skipOpen && ["1", "2", "3", "4"].includes(k)) void move(item, "skipped", REASONS[Number(k) - 1][0]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { brief, context } = role;
  const summary = [
    ...brief.criteria.filter((c) => c.importance === "must").slice(0, 3).map((c) => c.label),
    brief.locations.length ? brief.locations.join(" or ") + (brief.remoteOk ? ", or remote in the US" : "") : "Anywhere in the US",
    context.pay || brief.payRange,
  ].filter(Boolean).join(" · ");
  const dueCount = lists.approved.filter((x) => x.followUpDue).length;

  const row = (it: Item) => (
    <button key={it.id} className="qrow" aria-current={it.id === item?.id} onClick={() => { select(it.id); setPane("detail"); }}>
      <Avatar person={it.person} />
      <span className="qrow-text">
        <b>{displayName(it.person)}</b>
        <small>{it.followUpDue ? <span className="due-text">Follow-up due</span> : tab === "approved" && it.person.headline ? it.person.headline : [it.person.location || "Location not given", it.person.hasLinkedIn ? "On LinkedIn" : "Not on LinkedIn"].join(" · ")}</small>
      </span>
      {it.feedback.length > 0 && <span className={`hm ${it.feedback.some((f) => f.verdict === "up") ? "up" : "down"}`} title="The hiring manager rated them">{it.feedback.some((f) => f.verdict === "up") ? "✓" : "✗"}</span>}
      {tab === "review" && <span className={`fit ${fitLevel(it.score)}`}>{fitLabel(it.score).split(" ")[0]}</span>}
    </button>
  );

  return (
    <>
      <header className="role-head">
        <div className="role-head-text">
          <h1>{role.title}</h1>
          <p className="brief-line" title={summary}>{summary}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setRoleDrawer("add")}>Add someone</button>
          <button className="btn" onClick={() => setRoleDrawer("details")}>Role details</button>
          <button className="btn primary" onClick={find} disabled={searching || active}>{searching ? "Searching…" : active ? "Agent searching…" : "Find candidates"}</button>
        </div>
      </header>

      {run && (active || (!hideRunNote && Date.now() - Date.parse(run.createdAt) < 12 * 3_600_000)) && (
        <div className={`agent-bar${active ? " running" : ""}`} role="status">
          {active
            ? <><span className="pulse" aria-hidden="true" /><span><b>Agent searching:</b> {run.progress}{run.added ? ` · ${run.added} added so far` : ""}</span></>
            : run.status === "failed"
              ? <span><b>The agent stopped:</b> {run.error ?? "Something went wrong."} Try Find candidates again.</span>
              : <span><b>Agent:</b> {run.summary}</span>}
          {!active && <button className="chip-x" aria-label="Hide" onClick={() => setHideRunNote(true)}>×</button>}
        </div>
      )}
      {questions.map((q) => (
        <div key={q.id} className="panel question">
          <span><b>The agent asks:</b> {q.text}</span>
          <div className="row">
            <button className="btn small primary" onClick={() => answer(q, true)}>Yes</button>
            <button className="btn small" onClick={() => answer(q, false)}>No</button>
          </div>
        </div>
      ))}

      <div className="review" data-pane={pane}>
        <aside className="panel queue" aria-label="Candidates">
          <div className="qtabs" role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => openTab(t)}>
                {label} <span className="count">{lists[t].length}</span>{t === "approved" && dueCount > 0 && <i className="due-dot" title={`${dueCount} follow-up${dueCount === 1 ? "" : "s"} due`} />}
              </button>
            ))}
          </div>
          <div className="qlist">
            {tab === "approved"
              ? STAGES.filter(([k]) => cur.some((x) => x.stage === k)).map(([k, label]) => (
                  <div key={k}>
                    <div className="qgroup">{label} <span>{cur.filter((x) => x.stage === k).length}</span></div>
                    {cur.filter((x) => x.stage === k).map(row)}
                  </div>
                ))
              : cur.map(row)}
            {!cur.length && (
              <p className="hint qempty">
                {tab === "review" ? (active ? "The agent is searching. New people appear here as it finds them." : "No one to review. Click Find candidates.")
                  : tab === "approved" ? "Approve someone and they appear here, ready to contact." : "People you skip appear here."}
              </p>
            )}
          </div>
        </aside>

        <section className="panel detail" aria-live="polite">
          {item ? (
            <CandidateDetail
              key={item.id}
              item={item}
              position={`${idx + 1} of ${cur.length}`}
              skipOpen={skipOpen}
              setSkipOpen={setSkipOpen}
              onBack={() => setPane("list")}
              onApprove={() => move(item, "approved")}
              onSkip={(r) => move(item, "skipped", r)}
              onReview={() => move(item, "review")}
              onStage={(s) => changeStage(item, s)}
              onMessage={(kind) => setMessage({ id: item.id, kind })}
              onNotes={async (text) => { await saveNotes(item.id, text); say("Notes saved"); router.refresh(); }}
            />
          ) : (
            <div className="empty">
              {searching ? "Searching for people whose work fits this role…"
                : tab === "review" ? (active ? "The agent is searching. New people appear here as it finds them." : "You've seen everyone found so far. Click Find candidates to look for more.")
                : tab === "approved" ? "Your pipeline is empty. Approve people in To review and they land here." : "Nothing here yet."}
            </div>
          )}
        </section>
      </div>

      {message && messageItem && (
        <MessageDrawer key={message.id + message.kind} item={messageItem} kind={message.kind} onClose={() => setMessage(null)}
          onDone={(text) => {
            setOverrides((o) => ({ ...o, [message.id]: { ...o[message.id], status: "approved", stage: messageItem.stage === "new" ? "contacted" : messageItem.stage } }));
            setMessage(null); say(text); router.refresh();
          }} />
      )}
      {roleDrawer && <RoleDrawer role={role} agentEnabled={agent.enabled} nightly={agent.nightly} focus={roleDrawer} onClose={() => setRoleDrawer(null)} say={say} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
