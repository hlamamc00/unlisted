"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSearchable, type Brief } from "@/lib/brief";
import { addPerson, createShareLink, deleteRole, findCandidates, removeLocationRule, revokeShareLink, setNightly, updateRole, type RoleExtras } from "../../actions";
import { CriteriaForm, FiltersForm } from "../search-parts";
import type { RoleView } from "./types";

/** What the drawer opens on: the search's filters or criteria, adding one person, or everything else about the role. */
export type DrawerFocus = "filters" | "criteria" | "add" | "details";
type Props = {
  role: RoleView; agentEnabled: boolean; agentPaused: boolean; nightly: boolean; focus: DrawerFocus;
  onClose(): void; say(message: string): void;
  /** Called after the search was changed and run again. `agentStarted`: the agent is now working in the background. */
  onSearched(agentStarted: boolean): void;
};

export function RoleDrawer(props: Props) {
  const { focus, onClose } = props;
  const editing = focus === "filters" || focus === "criteria";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={editing ? "Edit the search" : "Details"}>
        <div className="drawer-head">
          <h2>{editing ? "Edit the search" : focus === "add" ? "Add someone" : "Details"}</h2>
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        {editing ? <SearchEditor {...props} /> : <Details {...props} />}
      </aside>
    </>
  );
}

/** Filters and ranking criteria. Saving re-scores the people already found and searches again. */
function SearchEditor({ role, focus, onClose, say, onSearched }: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief>(role.brief);
  const [extras, setExtras] = useState<Required<RoleExtras>>({
    pay: role.context.pay ?? role.brief.payRange ?? "", like: role.context.like ?? "", target: role.context.target ?? "", avoid: role.context.avoid ?? "",
  });
  const [saving, start] = useTransition();
  const ready = isSearchable(brief) && Boolean(brief.title.trim());
  const save = () => start(async () => {
    await updateRole(role.id, { brief, extras });
    const r = await findCandidates(role.id);
    say(`Search updated. ${r.added ? `Found ${r.added} more.` : r.message ?? ""}`.trim());
    onSearched(r.agent.started);
    router.refresh();
    onClose();
  });

  const filters = (
    <section className="drawer-sec" key="filters">
      <h3>Filters</h3>
      <FiltersForm brief={brief} extras={extras} onChange={setBrief} onExtras={setExtras} />
      {role.excluded.length > 0 && (
        <div className="chips">
          {role.excluded.map((c) => (
            <span key={c} className="chip neg" title="Learned when you hid someone for their location">Not {c}
              <button aria-label={`Stop excluding ${c}`} className="chip-x" onClick={async () => { await removeLocationRule(role.id, c); router.refresh(); }}>×</button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
  const criteria = (
    <section className="drawer-sec" key="criteria">
      <h3>Criteria to rank your matches</h3>
      <CriteriaForm brief={brief} onChange={setBrief} />
    </section>
  );

  return (
    <>
      {focus === "criteria" ? [criteria, filters] : [filters, criteria]}
      <div className="drawer-foot">
        {!ready && <span className="hint">A search needs a name, and a job title or one requirement.</span>}
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || !ready}>{saving ? "Searching…" : "Save and search"}</button>
      </div>
    </>
  );
}

/** Everything about a role that isn't the search itself: adding someone, the hiring manager's link, the agent, export. */
function Details({ role, agentEnabled, agentPaused, nightly, focus, say }: Props) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [added, setAdded] = useState<{ ok: boolean; message: string } | null>(null);
  const [share, setShare] = useState(role.share);
  const [nightlyOn, setNightlyOn] = useState(nightly);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [origin, setOrigin] = useState("");
  const [busy, start] = useTransition();
  const addInput = useRef<HTMLInputElement>(null);

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
      <section className="drawer-sec">
        <h3>Add someone you have in mind</h3>
        <form className="row" onSubmit={add}>
          <input ref={addInput} className="input" style={{ flex: 1, minWidth: 0 }} value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="Their GitHub or LinkedIn profile link" aria-label="Profile link" />
          <button className="btn" disabled={busy || !link.trim()}>{busy ? "Adding…" : "Add"}</button>
        </form>
        {added && <p className={added.ok ? "hint" : "error"} role="status">{added.message}</p>}
      </section>

      {focus === "details" && (
        <>
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
            <h3>The agent</h3>
            {agentPaused ? (
              <p className="hint">The agent is paused, so nothing runs in the background or overnight. Turn it on in <Link href="/app/settings">Settings</Link> when you want it.</p>
            ) : agentEnabled ? (
              <>
                <p className="hint">{role.calibrated ? "The agent searches when you click Find more, using who you shortlisted and hid." : "The agent starts once you finish calibrating: shortlist and hide a few matches first."}</p>
                <label className="check">
                  <input type="checkbox" checked={nightlyOn} onChange={async (e) => {
                    const on = e.target.checked; setNightlyOn(on); await setNightly(role.id, on);
                    say(on ? "The agent will keep searching every night." : "Nightly search is off.");
                  }} />
                  Keep searching every night, and email me when there&apos;s someone new
                </label>
              </>
            ) : <p className="hint">Connect Claude (see Settings) to let the agent search for you.</p>}
          </section>

          <section className="drawer-sec">
            <h3>Export</h3>
            <div><a className="btn small" href={`/api/roles/${role.id}/export`}>Download shortlist as CSV</a></div>
            <p className="hint">Opens in Excel or Google Sheets, and most applicant tracking systems can import it.</p>
          </section>

          <section className="drawer-sec">
            <div className="row">
              {confirmDelete
                ? <><button className="btn small danger" onClick={() => deleteRole(role.id)}>Delete this search and its candidates</button><button className="btn small" onClick={() => setConfirmDelete(false)}>Keep it</button></>
                : <button className="btn small" onClick={() => setConfirmDelete(true)}>Delete this search…</button>}
            </div>
          </section>
        </>
      )}
    </>
  );
}
