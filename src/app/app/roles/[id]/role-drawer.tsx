"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { criterionFromLabel, parseLocations, type Brief } from "@/lib/brief";
import { addPerson, createShareLink, deleteRole, removeLocationRule, revokeShareLink, setNightly, updateRole, type RoleExtras } from "../../actions";
import type { RoleView } from "./types";

type Props = { role: RoleView; agentEnabled: boolean; agentPaused: boolean; nightly: boolean; focus: "details" | "add"; onClose(): void; say(message: string): void };

/** Everything about a role that isn't a candidate: its requirements, adding someone, sharing with the hiring manager, searching, export. */
export function RoleDrawer({ role, agentEnabled, agentPaused, nightly, focus, onClose, say }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [added, setAdded] = useState<{ ok: boolean; message: string } | null>(null);
  const [share, setShare] = useState(role.share);
  const [nightlyOn, setNightlyOn] = useState(nightly);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [origin, setOrigin] = useState("");
  const [busy, start] = useTransition();
  const addInput = useRef<HTMLInputElement>(null);
  const { brief, context } = role;

  useEffect(() => { setOrigin(window.location.origin); if (focus === "add") addInput.current?.focus(); }, [focus]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await addPerson(role.id, link);
      setAdded(res);
      if (res.ok) { setLink(""); router.refresh(); }
    });
  };
  const shareUrl = share ? origin + share.path : "";
  const copyShare = async () => {
    try { await navigator.clipboard.writeText(shareUrl); say("Link copied. Send it to the hiring manager."); }
    catch { say("Select the link and copy it with Ctrl+C."); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Role details">
        <div className="drawer-head"><h2>Role details</h2><button className="btn small" onClick={onClose}>Close</button></div>

        <section className="drawer-sec">
          <div className="sec-head">
            <h3>Who you&apos;re looking for</h3>
            {!editing && <button className="btn small" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          {editing ? (
            <BriefForm role={role} onCancel={() => setEditing(false)}
              onSaved={() => { setEditing(false); say("Role updated. Click Find candidates to search with the changes."); router.refresh(); }} />
          ) : (
            <>
              <div className="chips">
                {brief.criteria.map((c) => <span key={c.label} className={`chip ${c.importance}`} title={c.importance === "must" ? "Must have" : "Nice to have"}>{c.label}</span>)}
                {brief.locations.map((l) => <span key={l} className="chip">{l}</span>)}
                {brief.remoteOk && <span className="chip">Remote is fine</span>}
                {role.excluded.map((c) => (
                  <span key={c} className="chip neg" title="Learned from your skips">Not {c}
                    <button aria-label={`Stop excluding ${c}`} className="chip-x" onClick={async () => { await removeLocationRule(role.id, c); router.refresh(); }}>×</button>
                  </span>
                ))}
              </div>
              <p className="hint">Filled means must-have, dashed means nice to have.</p>
              <dl className="facts">
                {(context.pay || brief.payRange) && <><dt>Pay</dt><dd>{context.pay || brief.payRange}</dd></>}
                {context.target && <><dt>Look in</dt><dd>{context.target}</dd></>}
                {context.avoid && <><dt>Avoid</dt><dd>{context.avoid}</dd></>}
                {context.like && <><dt>Someone like</dt><dd className="clip">{context.like}</dd></>}
              </dl>
            </>
          )}
        </section>

        <section className="drawer-sec">
          <h3>Add someone you have in mind</h3>
          <form className="row" onSubmit={add}>
            <input ref={addInput} className="input" style={{ flex: 1, minWidth: 0 }} value={link} onChange={(e) => setLink(e.target.value)}
              placeholder="Their GitHub or LinkedIn profile link" aria-label="Profile link" />
            <button className="btn" disabled={busy || !link.trim()}>{busy ? "Adding…" : "Add"}</button>
          </form>
          {added && <p className={added.ok ? "hint" : "error"} role="status">{added.message}</p>}
        </section>

        <section className="drawer-sec">
          <h3>Ask the hiring manager</h3>
          <p className="hint">Send them a link to rate your shortlist. They don&apos;t need an account. Their answers appear on each candidate and teach the agent what they want.</p>
          {share ? (
            <>
              <input className="input" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Review link" />
              <div className="row">
                <button className="btn small primary" onClick={copyShare}>Copy link</button>
                <button className="btn small" onClick={() => start(async () => { await revokeShareLink(role.id); setShare(null); say("The link no longer works."); })}>Stop sharing</button>
                <span className="hint">Works until {new Date(share.expires).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
            </>
          ) : (
            <div><button className="btn small" disabled={busy} onClick={() => start(async () => setShare(await createShareLink(role.id)))}>Create review link</button></div>
          )}
        </section>

        <section className="drawer-sec">
          <h3>Searching</h3>
          {role.linkedInTotal !== null && <p>About <b>{role.linkedInTotal.toLocaleString("en-US")}</b> people on LinkedIn match this role in the US.</p>}
          {agentPaused ? (
            <p className="hint">The agent is paused, so nothing runs in the background or overnight. Turn it on in <Link href="/app/settings">Settings</Link> when you want it.</p>
          ) : agentEnabled ? (
            <label className="check">
              <input type="checkbox" checked={nightlyOn} onChange={async (e) => {
                const on = e.target.checked; setNightlyOn(on); await setNightly(role.id, on);
                say(on ? "The agent will keep searching every night." : "Nightly search is off.");
              }} />
              Keep searching every night, and email me when there&apos;s someone new
            </label>
          ) : <p className="hint">Connect Claude in Settings to let the agent search for you.</p>}
        </section>

        <section className="drawer-sec">
          <h3>Export</h3>
          <div><a className="btn small" href={`/api/roles/${role.id}/export`}>Download pipeline as CSV</a></div>
          <p className="hint">Opens in Excel or Google Sheets, and most applicant tracking systems can import it.</p>
        </section>

        <section className="drawer-sec">
          <div className="row">
            {confirmDelete
              ? <><button className="btn small danger" onClick={() => deleteRole(role.id)}>Delete this role and its candidates</button><button className="btn small" onClick={() => setConfirmDelete(false)}>Keep it</button></>
              : <button className="btn small" onClick={() => setConfirmDelete(true)}>Delete role…</button>}
          </div>
        </section>
      </aside>
    </>
  );
}

function BriefForm({ role, onCancel, onSaved }: { role: RoleView; onCancel(): void; onSaved(): void }) {
  const [brief, setBrief] = useState<Brief>(role.brief);
  const [locations, setLocations] = useState(role.brief.locations.join(", "));
  const [extras, setExtras] = useState<Required<RoleExtras>>({
    pay: role.context.pay ?? role.brief.payRange ?? "", like: role.context.like ?? "", target: role.context.target ?? "", avoid: role.context.avoid ?? "",
  });
  const [label, setLabel] = useState("");
  const [saving, start] = useTransition();
  const toggle = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.map((c, j) => (j === i ? { ...c, importance: c.importance === "must" ? "nice" : "must" } : c)) }));
  const remove = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.filter((_, j) => j !== i) }));
  const addRequirement = () => {
    const text = label.trim();
    if (!text || brief.criteria.some((c) => c.label.toLowerCase() === text.toLowerCase())) return;
    setBrief((b) => ({ ...b, criteria: [...b.criteria, criterionFromLabel(text, "must")] }));
    setLabel("");
  };
  const set = (k: keyof RoleExtras) => (e: React.ChangeEvent<HTMLInputElement>) => setExtras({ ...extras, [k]: e.target.value });
  const save = () => start(async () => {
    const cleaned = { ...brief, locations: parseLocations(locations) };
    await updateRole(role.id, { brief: cleaned, extras });
    onSaved();
  });

  return (
    <div className="form-grid">
      <label className="field">Title<input value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} /></label>
      <div className="field">
        <span>Requirements <span className="hint">(click one to switch between must-have and nice to have)</span></span>
        <div className="chips">
          {brief.criteria.map((c, i) => (
            <span key={c.label + i} className={`chip ${c.importance}`}>
              <button type="button" className="chip-text" onClick={() => toggle(i)}>{c.label}</button>
              <button type="button" className="chip-x" onClick={() => remove(i)} aria-label={`Remove ${c.label}`}>×</button>
            </span>
          ))}
        </div>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 0 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add a requirement, e.g. Kubernetes"
            aria-label="New requirement" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRequirement(); } }} />
          <button type="button" className="btn small" onClick={addRequirement} disabled={!label.trim()}>Add</button>
        </div>
      </div>
      <label className="field">Locations<input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="e.g. Chicago, IL, New York, NY" /><span className="hint">Cities, separated by commas, with or without the state. Leave empty for anywhere in the US.</span></label>
      <label className="check"><input type="checkbox" checked={brief.remoteOk} onChange={(e) => setBrief({ ...brief, remoteOk: e.target.checked })} /> Remote is fine (anywhere in the US)</label>
      <label className="field">Pay range<input value={extras.pay} onChange={set("pay")} placeholder="e.g. $200k–$250k" /></label>
      <label className="field">Companies to look in<input value={extras.target} onChange={set("target")} placeholder="Company names, separated by commas" /></label>
      <label className="field">Companies to avoid<input value={extras.avoid} onChange={set("avoid")} placeholder="Company names, separated by commas" /></label>
      <label className="field">Someone like the person you want<input value={extras.like} onChange={set("like")} placeholder="A GitHub profile link" /></label>
      <div className="row">
        <button className="btn primary" onClick={save} disabled={saving || !brief.criteria.length || !brief.title.trim()}>{saving ? "Saving…" : "Save changes"}</button>
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
