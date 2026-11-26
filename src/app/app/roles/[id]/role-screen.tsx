"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { findableOnGithub } from "@/lib/brief";
import type { Question } from "@/lib/agent";
import { STAGES, stageIndex, stageLabel, type Stage } from "@/lib/pipeline";
import { fitLabel, fitLevel } from "@/lib/score";
import { answerAgentQuestion, decide, findCandidates, finishCalibrating, refineSearch, saveNotes, setStage, type MessageKind, type SkipReason } from "../../actions";
import { SearchSentence, filterCount } from "../search-parts";
import { Avatar, displayName } from "./avatar";
import { CandidateCard, HiddenRow, REASONS } from "./candidate-card";
import { CandidateDetail } from "./candidate-detail";
import { MessageDrawer } from "./message-drawer";
import { RoleDrawer, type DrawerFocus } from "./role-drawer";
import type { AgentView, Item, RoleView, RunView, Tab } from "./types";

const TABS: [Tab, string][] = [["review", "Matches"], ["approved", "Shortlist"], ["skipped", "Hidden"]];
const CALIBRATE_WITH = 5; // decisions that give a fair picture of who the recruiter wants

/** A search and its results: matches as cards to hide or shortlist, the shortlist as a pipeline, and the agent's progress. */
export function RoleScreen({ role, items, agent, initialTab }: { role: RoleView; items: Item[]; agent: AgentView; initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  // Matches show as a list of cards, or one at a time for fast reviewing with the keyboard.
  const [view, setView] = useState<"list" | "review">("list");
  const [overrides, setOverrides] = useState<Record<string, Partial<Pick<Item, "status" | "stage">>>>({});
  const [sel, setSel] = useState<string | null>(null);
  // On phones the one-at-a-time view shows one pane: the list, or one candidate.
  const [pane, setPane] = useState<"list" | "detail">("list");
  const [skipOpen, setSkipOpen] = useState(false);
  const [hiddenNow, setHiddenNow] = useState<string[]>([]); // hidden a moment ago: shown as a slim row where the card was
  const [message, setMessage] = useState<{ id: string; kind: MessageKind } | null>(null);
  const [drawer, setDrawer] = useState<DrawerFocus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refine, setRefine] = useState("");
  const [searching, startSearch] = useTransition();
  const [finishing, startFinish] = useTransition();
  const [calibratedNow, setCalibratedNow] = useState(false);
  const [run, setRun] = useState<RunView | null>(agent.run);
  const [questions, setQuestions] = useState<Question[]>(agent.questions);
  const [hideRunNote, setHideRunNote] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastAdded = useRef(agent.run?.added ?? 0);
  const active = run?.status === "queued" || run?.status === "running";
  const calibrated = role.calibrated || calibratedNow;

  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5200);
  }, []);

  const all = useMemo(() => items.map((raw) => ({ ...raw, ...overrides[raw.id] })), [items, overrides]);
  const lists = useMemo(() => {
    const out: Record<Tab, Item[]> = { review: [], approved: [], skipped: [] };
    for (const it of all) out[it.status].push({ ...it, followUpDue: it.followUpDue && it.stage === "contacted" && it.status === "approved" });
    out.approved.sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || Number(b.followUpDue) - Number(a.followUpDue) || b.score - a.score);
    return out;
  }, [all]);
  // Cards stay in order; someone hidden a moment ago keeps their place as a slim row.
  const cards = all.filter((it) => it.status === "review" || (it.status === "skipped" && hiddenNow.includes(it.id)));
  const split = tab === "approved" || (tab === "review" && view === "review");
  const cur = lists[tab];
  const idx = Math.max(0, cur.findIndex((x) => x.id === sel));
  const item = split && cur.length ? cur[idx] : null;
  const messageItem = message ? all.find((x) => x.id === message.id) : undefined;
  const reviewed = lists.approved.length + lists.skipped.length;
  const contacted = lists.approved.filter((x) => x.stage !== "new" && x.stage !== "closed").length;
  const replied = lists.approved.filter((x) => ["replied", "interviewing", "offer", "hired"].includes(x.stage)).length;
  const dueCount = lists.approved.filter((x) => x.followUpDue).length;

  const select = (id: string | null) => { setSel(id); setSkipOpen(false); };
  const openTab = (t: Tab) => { setTab(t); select(null); setPane("list"); setHiddenNow([]); };
  const openOne = (it: Item) => { setTab(it.status === "approved" ? "approved" : "review"); setView("review"); select(it.id); setPane("detail"); };

  const move = async (it: Item, to: Tab, reason?: SkipReason, quiet = false) => {
    if (split && tab !== to) { const i = cur.findIndex((x) => x.id === it.id); setSel((cur[i + 1] ?? cur[i - 1])?.id ?? null); }
    setOverrides((o) => ({ ...o, [it.id]: { ...o[it.id], status: to } }));
    setSkipOpen(false);
    const { learned } = await decide(it.id, to, reason);
    if (learned || !quiet) say(learned ?? (to === "approved" ? `${displayName(it.person)} is on your shortlist.` : to === "skipped" ? "Hidden" : "Moved back to your matches"));
    router.refresh();
  };
  // Hide on a card is one click. The reason is asked afterwards, in the card's place, and is optional.
  const hideCard = (it: Item) => { setHiddenNow((h) => [...h, it.id]); void move(it, "skipped", undefined, true); };
  const forget = (id: string) => setHiddenNow((h) => h.filter((x) => x !== id));
  const whyHidden = async (it: Item, reason: SkipReason) => {
    forget(it.id);
    const { learned } = await decide(it.id, "skipped", reason);
    say(learned ?? "Noted.");
    router.refresh();
  };

  const changeStage = async (it: Item, stage: Stage) => {
    setOverrides((o) => ({ ...o, [it.id]: { ...o[it.id], stage } }));
    await setStage(it.id, stage);
    say(`${displayName(it.person)}: ${stageLabel(stage)}`);
    router.refresh();
  };

  const watchRun = () => {
    lastAdded.current = 0;
    setHideRunNote(false);
    setRun({ id: "", status: "queued", progress: "Starting", added: 0, looked: 0, summary: null, error: null, createdAt: new Date().toISOString() });
  };

  // The search button: with words typed it changes the search and runs it; empty, it looks for more with the same filters.
  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    startSearch(async () => {
      const text = refine.trim();
      if (text) {
        const r = await refineSearch(role.id, text);
        say(r.message);
        if (r.ok) { setRefine(""); setHiddenNow([]); }
      } else {
        const r = await findCandidates(role.id);
        const quick = r.added ? `Found ${r.added} more.` : r.message ?? "No one new this time.";
        say([quick, r.agent.started ? "The agent is searching for more in the background." : r.agent.message].filter(Boolean).join(" "));
        if (r.agent.started) watchRun();
      }
      router.refresh();
    });
  };

  const finish = () => startFinish(async () => {
    const r = await finishCalibrating(role.id);
    setCalibratedNow(true);
    if (r.started) { watchRun(); say("Calibrated. The agent is now searching for more people like your shortlist."); }
    else say(r.paused ? "Calibrated. The agent is paused, so it won't search on its own until you turn it on in Settings." : `Calibrated. ${r.message ?? ""}`.trim());
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
    say(yes ? "Search updated. Click Find more to search with the change." : "Noted. The agent won't ask that again.");
    router.refresh();
  };

  // Shortcuts for the one-at-a-time view: J/K move, A shortlists, H then 1-4 hides, M writes a message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!split || message || drawer || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "j" && cur[idx + 1]) select(cur[idx + 1].id);
      else if (k === "k" && cur[idx - 1]) select(cur[idx - 1].id);
      else if (!item) return;
      else if (k === "a" && item.status === "review") void move(item, "approved");
      else if ((k === "h" || k === "s") && item.status === "review") setSkipOpen(true);
      else if (k === "m" && item.status !== "skipped") setMessage({ id: item.id, kind: item.messages.length ? "followup" : "first" });
      else if (skipOpen && ["1", "2", "3", "4"].includes(k)) void move(item, "skipped", REASONS[Number(k) - 1][0]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { brief } = role;
  const needsLinkedIn = !role.linkedIn && !findableOnGithub(brief);
  const agentOn = agent.enabled && !agent.paused;

  const row = (it: Item) => (
    <button key={it.id} className="qrow" aria-current={it.id === item?.id} onClick={() => { select(it.id); setPane("detail"); }}>
      <Avatar person={it.person} />
      <span className="qrow-text">
        <b>{displayName(it.person)}</b>
        <small>{it.followUpDue ? <span className="due-text">Follow-up due</span> : it.person.headline ? `${it.person.headline}${it.person.company ? ` at ${it.person.company}` : ""}` : [it.person.location || "Location not given", it.person.hasLinkedIn ? "On LinkedIn" : "Not on LinkedIn"].join(" · ")}</small>
      </span>
      {it.feedback.length > 0 && <span className={`hm ${it.feedback.some((f) => f.verdict === "up") ? "up" : "down"}`} title="The hiring manager rated them">{it.feedback.some((f) => f.verdict === "up") ? "✓" : "✗"}</span>}
      {tab === "review" && <span className={`fit ${fitLevel(it.score)}`}>{fitLabel(it.score).split(" ")[0]}</span>}
    </button>
  );

  const searchButton = (
    <button className="btn" onClick={() => search()} disabled={searching || active}>{searching ? "Searching…" : active ? "Agent searching…" : "Find more"}</button>
  );
  const nothingYet = needsLinkedIn
    ? <>This search needs LinkedIn profiles, and they aren&apos;t connected yet. Connect People Data Labs (the steps are in <Link href="/app/settings">Settings</Link>), then click Find more.</>
    : searching ? "Searching…"
    : active ? "The agent is searching. New people appear here as it finds them."
    : role.searchNote ?? (reviewed ? "You've been through everyone found so far. Click Find more to look for others." : "No one found yet. Click Find more, or widen the filters.");

  return (
    <>
      <header className="role-head">
        <div className="role-head-text"><h1>{role.title}</h1></div>
        <dl className="stats" aria-label="This search so far">
          <div><dt>Matches</dt><dd>{lists.review.length}</dd></div>
          <div><dt>Shortlisted</dt><dd>{lists.approved.length}</dd></div>
          <div><dt>Contacted</dt><dd>{contacted}</dd></div>
          <div><dt>Replied</dt><dd>{replied}</dd></div>
        </dl>
        <div className="row">
          <button className="btn" onClick={() => setDrawer("add")}>Add someone</button>
          <button className="btn" onClick={() => setDrawer("details")}>Details</button>
        </div>
      </header>

      <section className="panel searchbar" aria-label="The search">
        <div className="searchbar-top">
          <SearchSentence brief={brief} />
          <div className="row">
            <button className="btn small" onClick={() => setDrawer("filters")}>Filters ({filterCount(brief)})</button>
            <button className="btn small" onClick={() => setDrawer("criteria")}>Criteria ({brief.criteria.length})</button>
          </div>
        </div>
        <form className="refine" onSubmit={search}>
          <input className="input" value={refine} onChange={(e) => setRefine(e.target.value)} disabled={searching}
            placeholder="Change the search in plain words, e.g. only people who worked at Dell" aria-label="Change the search" />
          <button className="btn primary" disabled={searching || active}>{searching ? "Searching…" : refine.trim() ? "Update search" : "Find more"}</button>
        </form>
      </section>

      {!calibrated && items.length > 0 && !active && (
        <div className="agent-bar calib" role="status">
          <span>
            <b>Calibrating</b> · {reviewed} of {CALIBRATE_WITH} reviewed. Shortlist the people you&apos;d contact and hide the rest.{" "}
            {agentOn ? "When you finish, the agent searches for more people like your shortlist." : "The agent is paused, so it won't search on its own until you turn it on in Settings."}
          </span>
          <button className="btn small primary" onClick={finish} disabled={finishing || reviewed === 0} title={reviewed === 0 ? "Shortlist or hide at least one person first" : undefined}>{finishing ? "Saving…" : "Finish calibrating"}</button>
        </div>
      )}
      {run && (active || (!hideRunNote && Date.now() - Date.parse(run.createdAt) < 12 * 3_600_000)) && (
        <div className={`agent-bar${active ? " running" : ""}`} role="status">
          {active
            ? <><span className="pulse" aria-hidden="true" /><span><b>Agent searching:</b> {run.progress}{run.added ? ` · ${run.added} added so far` : ""}</span></>
            : run.status === "failed"
              ? <span><b>The agent stopped:</b> {run.error ?? "Something went wrong."} Try Find more again.</span>
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

      <div className="results-head">
        <div className="rtabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => openTab(t)}>
              {label} <span className="count">{lists[t].length}</span>{t === "approved" && dueCount > 0 && <i className="due-dot" title={`${dueCount} follow-up${dueCount === 1 ? "" : "s"} due`} />}
            </button>
          ))}
        </div>
        {tab === "review" && lists.review.length > 0 && (
          <div className="seg-toggle" role="group" aria-label="How to show matches">
            <button aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
            <button aria-pressed={view === "review"} onClick={() => { setView("review"); setPane("detail"); }} title="One at a time. Keys: J and K move, A shortlists, H hides.">Review</button>
          </div>
        )}
      </div>

      {split ? (
        <div className="review" data-pane={pane}>
          <aside className="panel queue" aria-label="Candidates">
            <div className="qlist">
              {tab === "approved"
                ? STAGES.filter(([k]) => cur.some((x) => x.stage === k)).map(([k, label]) => (
                    <div key={k}>
                      <div className="qgroup">{label} <span>{cur.filter((x) => x.stage === k).length}</span></div>
                      {cur.filter((x) => x.stage === k).map(row)}
                    </div>
                  ))
                : cur.map(row)}
              {!cur.length && <p className="hint qempty">{tab === "approved" ? "Shortlist someone and they appear here, ready to contact." : "No one left to review."}</p>}
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
                {tab === "approved" ? "Your shortlist is empty. Shortlist people from Matches and they land here, ready to contact." : <>{nothingYet} <div className="empty-action">{searchButton}</div></>}
              </div>
            )}
          </section>
        </div>
      ) : tab === "review" ? (
        <div className="cards">
          {cards.map((it) => it.status === "skipped"
            ? <HiddenRow key={it.id} item={it} onReason={(r) => whyHidden(it, r)} onUndo={() => { forget(it.id); void move(it, "review", undefined, true); }} />
            : <CandidateCard key={it.id} item={it} onOpen={() => openOne(it)} onHide={() => hideCard(it)} onShortlist={() => move(it, "approved")} />)}
          {lists.review.length === 0
            ? <div className="empty">{nothingYet}{!needsLinkedIn && <div className="empty-action">{searchButton}</div>}</div>
            : (
              <div className="more-row">
                {searchButton}
                <span className="hint">
                  {role.linkedInTotal ? (role.linkedInTotal === 1 ? "One person on LinkedIn fits these filters. " : `About ${role.linkedInTotal.toLocaleString("en-US")} people on LinkedIn fit these filters. `) : ""}
                  {role.linkedIn ? "Each LinkedIn profile found uses one People Data Labs credit, up to 10 per search." : ""}
                </span>
              </div>
            )}
        </div>
      ) : (
        <div className="cards">
          {cur.map((it) => <CandidateCard key={it.id} item={it} onRestore={() => move(it, "review")} />)}
          {!cur.length && <div className="empty">People you hide appear here, and you can bring them back.</div>}
        </div>
      )}

      {message && messageItem && (
        <MessageDrawer key={message.id + message.kind} item={messageItem} kind={message.kind} onClose={() => setMessage(null)}
          onDone={(text) => {
            setOverrides((o) => ({ ...o, [message.id]: { ...o[message.id], status: "approved", stage: messageItem.stage === "new" ? "contacted" : messageItem.stage } }));
            setMessage(null); say(text); router.refresh();
          }} />
      )}
      {drawer && (
        <RoleDrawer role={role} agentEnabled={agent.enabled} agentPaused={agent.paused} nightly={agent.nightly} focus={drawer} onClose={() => setDrawer(null)} say={say}
          onSearched={(started) => { setHiddenNow([]); if (started) watchRun(); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
