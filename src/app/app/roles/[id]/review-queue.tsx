"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brief, RoleContext } from "@/lib/brief";
import type { Check } from "@/lib/score";
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

export function ReviewQueue({ role, items }: { role: RoleView; items: Item[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("review");
  const [overrides, setOverrides] = useState<Record<string, Tab>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [drawer, setDrawer] = useState<{ id: string; text: string; loading: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const nextId = (id: string) => { const i = cur.findIndex((x) => x.id === id); return (cur[i + 1] ?? cur[i - 1])?.id ?? null; };

  const move = useCallback(async (it: Item, to: Tab, reason?: SkipReason) => {
    if (tab !== to) setSel(nextId(it.id));
    setOverrides((o) => ({ ...o, [it.id]: to }));
    setSkipOpen(false);
    const { learned } = await decide(it.id, to, reason);
    if (learned) { say(learned); router.refresh(); }
    else say(to === "approved" ? "Approved" : to === "skipped" ? "Skipped" : "Moved back to review");
  }, [tab, cur, router, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const find = () => startSearch(async () => {
    const r = await findCandidates(role.id);
    say(r.message ?? (r.added ? `Found ${r.added} new candidate${r.added === 1 ? "" : "s"}` : `Looked at ${r.looked} people; none were strong enough. Try again for more.`));
    router.refresh();
  });

  const openMessage = async (it: Item) => {
    setDrawer({ id: it.id, text: "", loading: true });
    try {
      const { draft } = await draftMessage(it.id);
      setDrawer({ id: it.id, text: draft, loading: false });
    } catch {
      setDrawer(null);
      say("The message couldn't be drafted. Try again.");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (drawer || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "j" && cur[idx + 1]) select(cur[idx + 1].id);
      else if (k === "k" && cur[idx - 1]) select(cur[idx - 1].id);
      else if (!item) return;
      else if (k === "a" && status === "review") void move(item, "approved");
      else if (k === "s" && status === "review") setSkipOpen(true);
      else if (k === "m") void openMessage(item);
      else if (skipOpen && "1234".includes(k) && k) void move(item, "skipped", REASONS[Number(k) - 1][0]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { brief, context } = role;
  return (
    <>
      <div className="panel briefbar">
        <h1>{role.title}</h1>
        <div className="chips">
          {brief.criteria.map((c) => <span key={c.label} className={`chip ${c.importance}`} title={c.importance === "must" ? "Must have" : "Nice to have"}>{c.label}</span>)}
          {brief.locations.map((l) => <span key={l} className="chip" title="Location">{l}</span>)}
          {brief.remoteOk && <span className="chip">Remote is fine</span>}
          {role.excluded.map((c) => (
            <span key={c} className="chip neg" title="Learned from your skips">Not {c}
              <button aria-label={`Stop excluding ${c}`} onClick={async () => { await removeLocationRule(role.id, c); router.refresh(); }}
                style={{ background: "none", border: 0, color: "inherit", cursor: "pointer" }}>×</button>
            </span>
          ))}
          {context.pay && <span className="chip ctx">Pay: {context.pay}</span>}
          {context.avoid && <span className="chip ctx">Target or avoid: {context.avoid}</span>}
          {context.like && <span className="chip ctx">Like: {context.like}</span>}
        </div>
        <div className="row">
          <button className="btn primary" onClick={find} disabled={searching}>{searching ? "Searching GitHub…" : "Find candidates"}</button>
          {confirmDelete
            ? <><button className="btn small" onClick={() => deleteRole(role.id)}>Delete this role</button><button className="btn small" onClick={() => setConfirmDelete(false)}>Keep it</button></>
            : <button className="btn small" onClick={() => setConfirmDelete(true)}>Delete…</button>}
        </div>
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
                <span className="avatar" aria-hidden="true">{it.person.avatarUrl ? <img src={it.person.avatarUrl} alt="" /> : initials(it.person)}</span>
                <span style={{ minWidth: 0 }}><b>{it.person.name || it.person.login}</b><small>{[it.person.location, `@${it.person.login}`].filter(Boolean).join(" · ")}</small></span>
                <span className="s">{it.score}</span>
              </button>
            ))}
            {!cur.length && <p className="hint" style={{ padding: 14 }}>{tab === "review" ? "No one to review. Click Find candidates." : "None yet."}</p>}
          </div>
        </aside>

        <section className="panel detail" aria-live="polite">
          {!item ? (
            <div className="empty">
              {searching ? "Searching GitHub for people whose work fits this brief…" : tab === "review" ? "You've reviewed everyone found so far. Click Find candidates to search further." : "Nothing here yet."}
            </div>
          ) : (
            <>
              <div className="d-head">
                <div className="avatar" aria-hidden="true">{item.person.avatarUrl ? <img src={item.person.avatarUrl} alt="" /> : initials(item.person)}</div>
                <div className="who" style={{ minWidth: 0 }}>
                  <h2>{item.person.name || item.person.login}</h2>
                  <p>{[item.person.company, item.person.location].filter(Boolean).join(" · ") || "No company or location on their profile"}</p>
                  <p><a href={`https://github.com/${item.person.login}`} target="_blank" rel="noreferrer">github.com/{item.person.login}</a>
                    {item.person.blog && <> · <a href={item.person.blog.startsWith("http") ? item.person.blog : `https://${item.person.blog}`} target="_blank" rel="noreferrer">Website</a></>}</p>
                </div>
                <div className="score"><b>{item.score}</b><span>{idx + 1} of {cur.length}</span></div>
              </div>
              <div className="hidden-why">
                <span className="label">{item.person.hasLinkedIn ? "On LinkedIn" : "Hard to find"}</span>
                <span>{item.person.hasLinkedIn ? "They link a LinkedIn profile from GitHub." : "No LinkedIn linked from their GitHub profile. Found through their work."}</span>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Against your brief</div>
                <ul className="checks">
                  {item.checks.map((c) => (
                    <li key={c.label} className={c.status === "yes" ? "" : "miss"}>
                      <span className={c.status === "yes" ? "y" : ""}>{c.status === "yes" ? "✓" : c.status === "no" ? "–" : "?"}</span>
                      <span>{c.label}{c.importance !== "must" && <small> {c.importance === "nice" ? "nice to have" : "location"}</small>}{c.detail && <small className="hint"> · {c.detail}</small>}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>Their work</div>
                <ul className="evidence">{item.evidence.map((e, i) => <li key={i}><span className="src">{e.src}</span><span>{e.text}</span></li>)}</ul>
              </div>
              {item.person.email && <p className="hint">Public email on GitHub: <span style={{ userSelect: "all" }}>{item.person.email}</span></p>}
              <div className="actionbar">
                <div className="skip-reasons">
                  {status === "approved" ? <span className="status-pill">Approved</span>
                    : status === "skipped" ? <button className="btn" onClick={() => move(item, "review")}>Move back to review</button>
                    : skipOpen ? <><span className="hint">Why skip?</span>{REASONS.map(([r, label], i) => <button key={r} onClick={() => move(item, "skipped", r)}>{label}<kbd>{i + 1}</kbd></button>)}</>
                    : <button className="btn" onClick={() => setSkipOpen(true)}>Skip<kbd>S</kbd></button>}
                </div>
                <div className="row">
                  <button className="btn" onClick={() => openMessage(item)}>{item.hasDraft ? "Message" : "Draft message"}<kbd>M</kbd></button>
                  {status === "review" && <button className="btn primary" onClick={() => move(item, "approved")}>Approve<kbd>A</kbd></button>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      <p className="keys" aria-hidden="true">
        <span><kbd>J</kbd> <kbd>K</kbd> next, previous</span><span><kbd>A</kbd> approve</span>
        <span><kbd>S</kbd> skip, then <kbd>1</kbd>–<kbd>4</kbd> for why</span><span><kbd>M</kbd> message</span>
      </p>

      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <aside className="drawer" aria-label="Message">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 22 }}>First message</h2>
              <button className="btn small" onClick={() => setDrawer(null)}>Close</button>
            </div>
            <p className="hint">Drafted from their public work. Edit it, then send it from your own email.</p>
            <textarea className="input" value={drawer.loading ? "Drafting…" : drawer.text} disabled={drawer.loading} aria-label="Message"
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
