"use client";

import { useEffect, useState, useTransition } from "react";
import { linkedInHref } from "@/lib/linkedin";
import { draftMessage, markContacted, sendMessage, type Draft, type MessageKind } from "../../actions";
import { displayName } from "./avatar";
import type { Item } from "./types";

/** Writes a first message or a follow-up, then sends it by email or lets the recruiter send it themselves. */
export function MessageDrawer({ item, kind, onClose, onDone }: { item: Item; kind: MessageKind; onClose(): void; onDone(toast: string): void }) {
  const { person } = item;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();
  const first = displayName(person).split(" ")[0];

  useEffect(() => {
    let live = true;
    draftMessage(item.id, kind)
      .then((d) => { if (live) { setDraft(d); setSubject(d.subject); setText(d.draft); } })
      .catch(() => live && setError("The message couldn't be written. Close this and try again."));
    return () => { live = false; };
  }, [item.id, kind]);

  const send = () => start(async () => {
    setError(null);
    const res = await sendMessage(item.id, { subject, body: text, kind });
    if (res.ok) onDone(`Sent to ${first}. If there's no reply, you'll see a follow-up reminder in 4 days.`);
    else setError(res.error ?? "The email couldn't be sent.");
  });
  const sentMyself = () => start(async () => {
    await markContacted(item.id, { body: text, kind });
    onDone(`Marked ${first} as contacted. If there's no reply, you'll see a follow-up reminder in 4 days.`);
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setError("Select the text and copy it with Ctrl+C."); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Message">
        <div className="drawer-head">
          <h2>{kind === "followup" ? "Follow-up" : "First message"} to {first}</h2>
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        {!draft && !error && <p className="hint">Writing from their work and profile…</p>}
        {draft && (
          <>
            <p className="hint">
              {draft.to ? <>To <span style={{ userSelect: "all" }}>{draft.to}</span></> : "There's no email address on their profile, so send this on LinkedIn or GitHub."}
              {draft.to && !draft.canSend && " Email sending isn't set up, so copy it into your own email."}
            </p>
            {draft.to && <label className="field">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
            <label className="field">Message<textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
            <div className="row">
              {draft.canSend && <button className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send email"}</button>}
              <button className={draft.canSend ? "btn" : "btn primary"} onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
              {person.linkedinUrl && <a className="btn" href={linkedInHref(person.linkedinUrl)} target="_blank" rel="noreferrer">Open their LinkedIn</a>}
              {!person.linkedinUrl && person.login && <a className="btn" href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer">Open their GitHub</a>}
            </div>
            <div className="sent-myself">
              <span className="hint">Sent it yourself? Log it, and Unlisted will remind you to follow up.</span>
              <button className="btn small" disabled={busy} onClick={sentMyself}>I&apos;ve sent it</button>
            </div>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </>
  );
}
