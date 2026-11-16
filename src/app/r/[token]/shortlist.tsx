"use client";

import { useEffect, useState } from "react";
import type { Feedback } from "@/lib/agent";
import { linkedInHref } from "@/lib/linkedin";
import { submitFeedback } from "./actions";

export type ShortlistPerson = {
  id: string; name: string; headline: string | null; location: string | null; login: string | null; linkedinUrl: string | null;
  hasLinkedIn: boolean; met: string[]; why: string | null; work: string[]; feedback: Feedback[];
};

const NAME_KEY = "unlisted-reviewer-name";

export function Shortlist({ token, people }: { token: string; people: ShortlistPerson[] }) {
  const [by, setBy] = useState("");
  useEffect(() => { try { setBy(localStorage.getItem(NAME_KEY) ?? ""); } catch { /* private window */ } }, []);
  const remember = (v: string) => { setBy(v); try { localStorage.setItem(NAME_KEY, v); } catch { /* private window */ } };

  return (
    <>
      <div className="panel">
        <label className="field">Your name
          <input value={by} onChange={(e) => remember(e.target.value)} placeholder="So the recruiter knows whose feedback this is" autoComplete="name" />
        </label>
        <p className="hint" style={{ marginTop: 8 }}>Say yes or no to each person. A short reason helps the recruiter find more of the people you want.</p>
      </div>
      {people.map((p) => <Card key={p.id} token={token} person={p} by={by} />)}
    </>
  );
}

function Card({ token, person, by }: { token: string; person: ShortlistPerson; by: string }) {
  const mine = person.feedback.find((f) => by.trim() && f.by.toLowerCase() === by.trim().toLowerCase());
  const [verdict, setVerdict] = useState<"up" | "down" | null>(mine?.verdict ?? null);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async (v: "up" | "down", text = comment) => {
    setVerdict(v); setState("saving");
    const res = await submitFeedback(token, person.id, { by, verdict: v, comment: text }).catch(() => ({ ok: false }));
    setState(res.ok ? "saved" : "error");
  };
  const links = [
    person.login && <a href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer">GitHub</a>,
    person.linkedinUrl && <a href={linkedInHref(person.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn</a>,
  ].filter(Boolean);

  return (
    <article className="panel share-card">
      <div className="who">
        <h2 style={{ fontSize: 20 }}>{person.name}</h2>
        {person.headline && <p>{person.headline}</p>}
        <p>{[person.location || "Location not given", ...links].map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>
        {!person.hasLinkedIn && <div className="badges"><span className="badge accent">Not on LinkedIn</span></div>}
      </div>
      {person.met.length > 0 && <div className="fitline">{person.met.map((m) => <span key={m} className="fitchip yes">✓ {m}</span>)}</div>}
      {person.why && <div className="agent-note"><div className="label">Why they fit</div><p>{person.why}</p></div>}
      {person.work.length > 0 && <div className="work"><ul>{person.work.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <div className="vote">
        <button className={`btn small up${verdict === "up" ? " on" : ""}`} aria-pressed={verdict === "up"} onClick={() => save("up")}>Yes, talk to them</button>
        <button className={`btn small down${verdict === "down" ? " on" : ""}`} aria-pressed={verdict === "down"} onClick={() => save("down")}>Not a fit</button>
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why? (optional)" aria-label={`Comment on ${person.name}`}
          onBlur={() => verdict && comment !== (mine?.comment ?? "") && save(verdict)} />
        <span className="hint" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save. Try again." : ""}</span>
      </div>
    </article>
  );
}
