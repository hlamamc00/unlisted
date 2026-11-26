"use client";

import { linkedInHref } from "@/lib/linkedin";
import { fitLabel, fitLevel, type Check } from "@/lib/score";
import type { SkipReason } from "../../actions";
import { Avatar, displayName } from "./avatar";
import type { Item, JobView, PersonView } from "./types";

export const REASONS: [SkipReason, string][] = [["location", "Wrong location"], ["work", "Experience isn't relevant"], ["known", "Already know them"], ["other", "Other"]];
export const mark = (s: Check["status"]) => (s === "yes" ? "✓" : s === "no" ? "✗" : "?");

/** How someone fits the search, one chip per filter and requirement. */
export function FitChips({ checks }: { checks: Check[] }) {
  return (
    <div className="fitline" aria-label="How they fit">
      {checks.map((c) => (
        <span key={c.label} className={`fitchip ${c.status}`} title={[c.label, c.detail].filter(Boolean).join(": ")}>{mark(c.status)} {c.label}</span>
      ))}
    </div>
  );
}

/** Work history, newest first. Jobs the search asked for (the title or the employer) are marked. */
export function Timeline({ jobs }: { jobs: JobView[] }) {
  return (
    <ol className="timeline">
      {jobs.map((j, i) => (
        <li key={i} className={j.match ? "hit" : undefined}>
          <span className="t-what"><b>{j.title}</b>{j.company && <> · {j.company}</>}</span>
          {j.when && <span className="t-when">{j.when}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Where they are, then links to their profiles. */
export function WhereAndLinks({ person }: { person: PersonView }) {
  const links = [
    person.linkedinUrl && <a href={linkedInHref(person.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn</a>,
    person.login && <a href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer">GitHub</a>,
    person.blog && <a href={person.blog.startsWith("http") ? person.blog : `https://${person.blog}`} target="_blank" rel="noreferrer">Website</a>,
  ].filter(Boolean);
  return <p>{[person.location || "Location not given", ...links].map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>;
}

/** `onOpen`, `onHide` and `onShortlist` are for matches; someone already hidden only has `onRestore`. */
type CardProps = { item: Item; onOpen?(): void; onHide?(): void; onShortlist?(): void; onRestore?(): void };

/** One match as a card: who they are, how they fit, their work history, and Hide or Shortlist. */
export function CandidateCard({ item, onOpen, onHide, onShortlist, onRestore }: CardProps) {
  const { person } = item;
  const work = item.evidence.filter((e) => e.src === "GitHub").slice(0, person.experience.length ? 1 : 2);
  return (
    <article className="panel card" aria-label={displayName(person)}>
      <div className="card-top">
        <Avatar person={person} />
        <div className="who">
          <h3>{onOpen ? <button className="name-link" onClick={onOpen} title="Open their full profile">{displayName(person)}</button> : displayName(person)}</h3>
          {person.headline && <p>{person.headline}{person.company ? ` at ${person.company}` : ""}</p>}
          <WhereAndLinks person={person} />
        </div>
        <div className="fit-box">
          <span className={`fit-pill ${fitLevel(item.score)}`}>{fitLabel(item.score)}</span>
          {!person.hasLinkedIn && <span className="badge accent">Not on LinkedIn</span>}
          {item.foundBy === "agent" && <span className="badge">Found by the agent</span>}
        </div>
      </div>

      <FitChips checks={item.checks} />
      {person.experience.length > 0 && <Timeline jobs={person.experience.slice(0, 3)} />}
      {work.length > 0 && <ul className="repo-list">{work.map((e) => <li key={e.text}>{e.text}</li>)}</ul>}
      {item.note?.why && <p className="why-line"><b>Why they fit:</b> {item.note.why}</p>}

      <div className="card-actions">
        {onRestore && <button className="btn" onClick={onRestore}>Move back to matches</button>}
        {onHide && <button className="btn" onClick={onHide}>Hide</button>}
        {onShortlist && <button className="btn primary" onClick={onShortlist}>Shortlist</button>}
      </div>
    </article>
  );
}

/** Where a card was a moment ago, after Hide: the reason is optional, and it can be undone. */
export function HiddenRow({ item, onReason, onUndo }: { item: Item; onReason(reason: SkipReason): void; onUndo(): void }) {
  return (
    <div className="panel card gone" role="status">
      <span>Hidden <b>{displayName(item.person)}</b>. <span className="hint">Why? It helps the next search.</span></span>
      <div className="skip-reasons">
        {REASONS.slice(0, 3).map(([r, label]) => <button key={r} onClick={() => onReason(r)}>{label}</button>)}
        <button className="link" onClick={onUndo}>Undo</button>
      </div>
    </div>
  );
}
