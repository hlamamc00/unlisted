"use client";

import { useState } from "react";
import { linkedInHref } from "@/lib/linkedin";
import { MAX_FOLLOW_UPS, STAGES, type Stage } from "@/lib/pipeline";
import { fitLabel, fitLevel, type Check } from "@/lib/score";
import type { MessageKind, SkipReason } from "../../actions";
import { Avatar, displayName } from "./avatar";
import type { Item } from "./types";

export const REASONS: [SkipReason, string][] = [["location", "Wrong location"], ["work", "Work isn't relevant"], ["known", "Already know them"], ["other", "Other"]];
const mark = (s: Check["status"]) => (s === "yes" ? "✓" : s === "no" ? "✗" : "?");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const FOUND: Record<string, string> = { agent: "Found by the agent", you: "Added by you", pool: "Found earlier" };

type Props = {
  item: Item;
  position: string;
  skipOpen: boolean;
  setSkipOpen(open: boolean): void;
  onBack(): void;
  onApprove(): void;
  onSkip(reason: SkipReason): void;
  onReview(): void;
  onStage(stage: Stage): void;
  onMessage(kind: MessageKind): void;
  onNotes(text: string): void;
};

/** One candidate in full: how they fit, their work, and what to do next. In the pipeline it also shows stage, notes and messages. */
export function CandidateDetail({ item, position, skipOpen, setSkipOpen, onBack, onApprove, onSkip, onReview, onStage, onMessage, onNotes }: Props) {
  const { person } = item;
  const [notes, setNotes] = useState(item.notes);
  const inPipeline = item.status === "approved";
  const work = item.evidence.filter((e) => e.src === "GitHub").slice(0, 2);
  const roles = item.evidence.filter((e) => e.src === "Role" || e.src === "Before").slice(0, 2);
  const sent = item.messages.length;
  const links = [
    person.login && <a href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer">GitHub</a>,
    person.linkedinUrl && <a href={linkedInHref(person.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn</a>,
    person.blog && <a href={person.blog.startsWith("http") ? person.blog : `https://${person.blog}`} target="_blank" rel="noreferrer">Website</a>,
  ].filter(Boolean);

  return (
    <>
      <button className="back-link" onClick={onBack}>‹ All candidates</button>

      <div className="d-head">
        <Avatar person={person} />
        <div className="who">
          <h2>{displayName(person)}</h2>
          {person.headline && <p>{person.headline}{person.company ? ` at ${person.company}` : ""}</p>}
          <p>{[person.location || "Location not given", ...links].map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>
          <div className="badges">
            {!person.hasLinkedIn && <span className="badge accent">Not on LinkedIn</span>}
            {person.hireable && <span className="badge good">Open to offers</span>}
            {FOUND[item.foundBy] && <span className="badge">{FOUND[item.foundBy]}</span>}
          </div>
        </div>
        <div className="fit-box">
          <span className={`fit-pill ${fitLevel(item.score)}`}>{fitLabel(item.score)}</span>
          <span className="hint">{position}</span>
        </div>
      </div>

      {inPipeline && (
        <div className="stages" role="group" aria-label="Stage">
          {STAGES.map(([k, label]) => (
            <button key={k} className={`stage${item.stage === k ? " on" : ""}`} aria-pressed={item.stage === k} onClick={() => onStage(k)}>{label}</button>
          ))}
        </div>
      )}
      {item.followUpDue && (
        <div className="notice due">
          <span>No reply yet, and it&apos;s been a few days. A short follow-up often gets the answer.</span>
          <button className="btn small primary" onClick={() => onMessage("followup")}>Write follow-up</button>
        </div>
      )}

      <div className="fitline" aria-label="How they fit">
        {item.checks.map((c) => (
          <span key={c.label} className={`fitchip ${c.status}`} title={[c.label, c.detail].filter(Boolean).join(": ")}>{mark(c.status)} {c.label}</span>
        ))}
      </div>

      {item.note && (
        <div className="agent-note">
          <div className="label">Why they fit</div>
          <p>{item.note.why}</p>
          {item.note.opener && <p className="hint">Opening line: &ldquo;{item.note.opener}&rdquo;</p>}
        </div>
      )}

      {item.feedback.length > 0 && (
        <div className="work">
          <div className="label">Hiring manager</div>
          <ul>
            {item.feedback.map((f) => (
              <li key={f.by + f.at}>
                <span className={f.verdict === "up" ? "verdict up" : "verdict down"}>{f.verdict === "up" ? "Wants to talk to them" : "Not a fit"}</span>
                {" "}<span className="hint">{f.by}</span>{f.comment && <>: {f.comment}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {work.length > 0 && (
        <div className="work">
          <div className="label">Best work</div>
          <ul>{work.map((e) => <li key={e.text}>{e.text}</li>)}</ul>
        </div>
      )}
      {!work.length && roles.length > 0 && (
        <div className="work">
          <div className="label">Experience</div>
          <ul>{roles.map((e) => <li key={e.text}>{e.src === "Before" ? `Before: ${e.text}` : e.text}</li>)}</ul>
        </div>
      )}

      {inPipeline && (
        <div className="two-col">
          <label className="field">
            <span className="label">Your notes</span>
            <textarea className="notes" value={notes} placeholder="Private notes: what they said, next steps…"
              onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== item.notes && onNotes(notes)} />
          </label>
          <div className="work">
            <div className="label">Messages</div>
            {sent === 0
              ? <p className="hint">Nothing sent yet.</p>
              : <ul>{item.messages.map((m, i) => <li key={i}>{day(m.sentAt)} · {m.kind === "first" ? "First message" : "Follow-up"} · {m.channel === "email" ? "emailed from Unlisted" : "sent by you"}</li>)}</ul>}
          </div>
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
        {person.email && <p className="hint">Email: <span style={{ userSelect: "all" }}>{person.email}</span></p>}
      </details>

      <div className="actionbar">
        <div className="skip-reasons">
          {item.status === "review" && (skipOpen
            ? <><span className="hint">Why skip?</span>{REASONS.map(([r, label]) => <button key={r} onClick={() => onSkip(r)}>{label}</button>)}<button onClick={() => setSkipOpen(false)}>Cancel</button></>
            : <button className="btn" onClick={() => setSkipOpen(true)}>Skip</button>)}
          {item.status !== "review" && <button className="btn" onClick={onReview}>Move back to review</button>}
        </div>
        <div className="row">
          {item.status !== "skipped" && (sent === 0
            ? <button className="btn" onClick={() => onMessage("first")}>Write message</button>
            : sent <= MAX_FOLLOW_UPS
              ? <button className="btn" onClick={() => onMessage("followup")}>Write follow-up</button>
              : <span className="hint">You&apos;ve followed up twice.</span>)}
          {item.status === "review" && <button className="btn primary" onClick={onApprove}>Approve</button>}
        </div>
      </div>
    </>
  );
}
