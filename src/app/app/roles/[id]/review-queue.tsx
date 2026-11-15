"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brief, RoleContext } from "@/lib/brief";
import { fitLabel, fitLevel, type Check } from "@/lib/score";
import { decide, deleteRole, draftMessage, findCandidates, removeLocationRule, type SkipReason } from "../../actions";

export type Item = {
  id: string;
  status: "review" | "approved" | "skipped";
  score: number;
  checks: Check[];
  evidence: { src: string; text: string }[];
  hasDraft: boolean;
  person: { login: string; name: string | null; avatarUrl: string | null; location: string | null; company: string | null; email: string | null; blog: string | null; hasLinkedIn: boolean };
};
type Tab = Item["status"];
type RoleView = { id: string; title: string; brief: Brief; context: RoleContext; excluded: string[] };

const REASONS: [SkipReason, string][] = [["location", "Wrong location"], ["work", "Work isn't relevant"], ["known", "Already know them"], ["other", "Other"]];
const TABS: [Tab, string][] = [["review", "To review"], ["approved", "Approved"], ["skipped", "Skipped"]];
const initials = (p: Item["person"]) => (p.name || p.login).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const mark = (s: Check["status"]) => (s === "yes" ? "✓" : s === "no" ? "✗" : "?");

function Avatar({ person }: { person: Item["person"] }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="avatar" aria-hidden="true">{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person)}</span>;
}

export function ReviewQueue({ role, items }: { role: RoleView; items: Item[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("review");
  const [overrides, setOverrides] = useState<Record<string, Tab>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [drawer, setDrawer] = useState<{ id: string; text: string; loading: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const lists = useMemo(() => {
    const out: Record<Tab, Item[]> = { review: [], approved: [], skipped: [] };
    for (const it of items) out[overrides[it.id] ?? it.status].push(it);
    return out;
  }, [items, overrides]);
  const cur = lists[tab];
  const idx = Math.max(0, cur.findIndex((x) => x.id === sel));
  const item = cur.length ? cur[idx] : null;
  const status = item ? overrides[item.id] ?? item.status : null;
  const select = (id: string | null) => { setSel(id); setSkipOpen(false); };

  const move = async (it: Item, to: Tab, reason?: SkipReason) => {
    if (tab !== to) { const i = cur.findIndex((x) => x.id === it.id); setSel((cur[i + 1] ?? cur[i - 1])?.id ?? null); }
    setOverrides((o) => ({ ...o, [it.id]: to }));
    setSkipOpen(false);
    const { learned } = await decide(it.id, to, reason);
    if (learned) { say(learned); router.refresh(); }
    else say(to === "approved" ? "Approved" : to === "skipped" ? "Skipped" : "Moved back to review");
  };

  const find = () => startSearch(async () => {
    const r = await findCandidates(role.id);
    say(r.message ?? (r.added ? `Found ${r.added} new candidate${r.added === 1 ? "" : "s"}` : `Looked at ${r.looked} people; none were strong enough. Try again for more.`));
    router.refresh();
  });

  const openMessage = async (it: Item) => {
    setDrawer({ id: it.id, text: "", loading: true });
    try { setDrawer({ id: it.id, text: (await draftMessage(it.id)).draft, loading: false }); }
    catch { setDrawer(null); say("The message couldn't be drafted. Try again."); }
  };

  // Shortcuts for fast reviewing: J/K move, A approves, S then 1-4 skips, M drafts a message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "j" && cur[idx + 1]) select(cur[idx + 1].id);
      else if (k === "k" && cur[idx - 1]) select(cur[idx - 1].id);
      else if (!item) return;
      else if (k === "a" && status === "review") void move(item, "approved");
      else if (k === "s" && status === "review") setSkipOpen(true);
      else if (k === "m") void openMessage(item);
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
  const work = item?.evidence.filter((e) => e.src === "GitHub").slice(0, 2) ?? [];

  return (
    <>
      <div className="panel briefbar">
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <h1>{role.title}</h1>
          <p className="brief-line" title={summary}>{summary}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowBrief((v) => !v)} aria-expanded={showBrief}>{showBrief ? "Hide details" : "Details"}</button>
          <button className="btn primary" onClick={find} disabled={searching}>{searching ? "Searching…" : "Find candidates"}</button>
        </div>
        {showBrief && (
          <div className="brief-more">
            <p className="hint">Filled means must-have, dashed means nice to have.</p>
            <div className="chips">
              {brief.criteria.map((c) => <span key={c.label} className={`chip ${c.importance}`}>{c.label}</span>)}
              {brief.locations.map((l) => <span key={l} className="chip">{l}</span>)}
              {brief.remoteOk && <span className="chip">Remote is fine</span>}
              {role.excluded.map((c) => (
                <span key={c} className="chip neg" title="Learned from your skips">Not {c}
                  <button aria-label={`Stop excluding ${c}`} className="chip-x" onClick={async () => { await removeLocationRule(role.id, c); router.refresh(); }}>×</button>
                </span>
              ))}
              {context.avoid && <span className="chip ctx">Target or avoid: {context.avoid}</span>}
              {context.like && <span className="chip ctx">Like: {context.like}</span>}
            </div>
            <div className="row">
              {confirmDelete
                ? <><button className="btn small" onClick={() => deleteRole(role.id)}>Delete this role</button><button className="btn small" onClick={() => setConfirmDelete(false)}>Keep it</button></>
                : <button className="btn small" onClick={() => setConfirmDelete(true)}>Delete role…</button>}
            </div>
          </div>
        )}
      </div>

      <div className="review">
        <aside className="panel queue" aria-label="Candidates">
          <div className="qtabs" role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); select(null); }}>{label} {lists[t].length}</button>
            ))}
          </div>
          <div className="qlist">
            {cur.map((it) => (
              <button key={it.id} className="qrow" aria-current={it.id === item?.id} onClick={() => select(it.id)}>
                <Avatar person={it.person} />
                <span style={{ minWidth: 0 }}><b>{it.person.name || it.person.login}</b><small>{it.person.location || "Location not given"}</small></span>
                <span className={`fit ${fitLevel(it.score)}`}>{fitLabel(it.score).split(" ")[0]}</span>
              </button>
            ))}
            {!cur.length && <p className="hint" style={{ padding: 14 }}>{tab === "review" ? "No one to review yet. Click Find candidates." : "None yet."}</p>}
          </div>
        </aside>

        <section className="panel detail" aria-live="polite">
          {!item ? (
            <div className="empty">
              {searching ? "Searching GitHub for people whose work fits this role…" : tab === "review" ? "You've seen everyone found so far. Click Find candidates to look for more." : "Nothing here yet."}
            </div>
          ) : (
            <>
              <div className="d-head">
                <Avatar person={item.person} />
                <div className="who" style={{ minWidth: 0 }}>
                  <h2>{item.person.name || item.person.login}</h2>
                  <p>
                    {item.person.location || "Location not given"} · <a href={`https://github.com/${item.person.login}`} target="_blank" rel="noreferrer">GitHub</a>
                    {item.person.blog && <> · <a href={item.person.blog.startsWith("http") ? item.person.blog : `https://${item.person.blog}`} target="_blank" rel="noreferrer">Website</a></>}
                  </p>
                  {!item.person.hasLinkedIn && <span className="badge">Not on LinkedIn</span>}
                </div>
                <span className={`fit-pill ${fitLevel(item.score)}`}>{fitLabel(item.score)}</span>
              </div>

              <div className="fitline" aria-label="How they fit">
                {item.checks.map((c) => (
                  <span key={c.label} className={`fitchip ${c.status}`} title={[c.label, c.detail].filter(Boolean).join(": ")}>{mark(c.status)} {c.label}</span>
                ))}
              </div>

              {work.length > 0 && (
                <div className="work">
                  <div className="label">Best work</div>
                  <ul>{work.map((e) => <li key={e.text}>{e.text}</li>)}</ul>
                </div>
              )}

              <details className="why">
                <summary>Why this person?</summary>
                <ul className="checks">
                  {item.checks.map((c) => (
                    <li key={c.label} className={c.status === "yes" ? "" : "miss"}>
                      <span className={c.status === "yes" ? "y" : ""}>{mark(c.status)}</span>
                      <span>{c.label}{c.detail && <small className="hint"> · {c.detail}</small>}</span>
                    </li>
                  ))}
                </ul>
                <ul className="evidence">{item.evidence.map((e, i) => <li key={i}><span className="src">{e.src}</span><span>{e.text}</span></li>)}</ul>
                {item.person.email && <p className="hint">Public email on GitHub: <span style={{ userSelect: "all" }}>{item.person.email}</span></p>}
              </details>

              <div className="actionbar">
                <div className="skip-reasons">
                  {status === "approved" ? <span className="status-pill">Approved</span>
                    : status === "skipped" ? <button className="btn" onClick={() => move(item, "review")}>Move back to review</button>
                    : skipOpen ? <><span className="hint">Why skip?</span>{REASONS.map(([r, label]) => <button key={r} onClick={() => move(item, "skipped", r)}>{label}</button>)}</>
                    : <button className="btn" onClick={() => setSkipOpen(true)}>Skip</button>}
                </div>
                <div className="row">
                  <button className="btn" onClick={() => openMessage(item)}>{item.hasDraft ? "Message" : "Write message"}</button>
                  {status === "review" && <button className="btn primary" onClick={() => move(item, "approved")}>Approve</button>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <aside className="drawer" aria-label="Message">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 22 }}>First message</h2>
              <button className="btn small" onClick={() => setDrawer(null)}>Close</button>
            </div>
            <p className="hint">Written from their public work. Edit it if you like, then send it from your own email.</p>
            <textarea className="input" value={drawer.loading ? "Writing…" : drawer.text} disabled={drawer.loading} aria-label="Message"
              onChange={(e) => setDrawer({ ...drawer, text: e.target.value })} />
            <div className="row">
              <button className="btn primary" disabled={drawer.loading} onClick={async () => {
                try { await navigator.clipboard.writeText(drawer.text); say("Copied"); } catch { say("Select the text and copy it with Ctrl+C"); }
              }}>Copy message</button>
            </div>
          </aside>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
