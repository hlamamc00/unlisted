"use client";

import { useActionState, useState, useTransition } from "react";
import type { Brief } from "@/lib/brief";
import { createRole, readJobDescription, type ReadResult, type RoleExtras } from "../../actions";

const SAMPLE = `Senior Rust Engineer – Trading Systems
Northfold Markets · Chicago, IL · 3 days a week in the office

About us
Northfold is a fast-growing market maker trading on 40 venues worldwide.

What you'll need
- 6+ years of professional software engineering, at least 3 in Rust
- Experience building low-latency or high-throughput systems, ideally in trading or exchanges
- Authorized to work in the US. We can't sponsor visas for this role.

Nice to have
- Contributions to open-source async runtimes or networking crates

What we offer
- Base salary $200,000–$250,000 plus annual bonus
- Medical, dental and vision coverage, and a 401(k) with a 6% match`;

export function NewRole() {
  const [read, readAction, reading] = useActionState<ReadResult, FormData>(readJobDescription, {});
  const [text, setText] = useState("");
  return (
    <>
      <form action={readAction} className="panel form-grid">
        <div className="step-title"><span className="step-n">1</span> The job description</div>
        <div className="row">
          <label className="btn">
            Upload a file
            <input type="file" name="file" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf" hidden
              onChange={(e) => e.currentTarget.form?.requestSubmit()} />
          </label>
          <button type="button" className="btn" onClick={() => setText(SAMPLE)}>Try a sample</button>
          <span className="hint">PDF, Word (.docx) or text</span>
        </div>
        <label className="field">
          <span className="label">Or paste it here</span>
          <textarea name="text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Paste the job description, or describe who you need the way you'd tell a colleague" />
        </label>
        {read.error && <p className="error" role="alert">{read.error}</p>}
        <div><button className="btn primary" disabled={reading}>{reading ? "Reading…" : "Read it"}</button></div>
      </form>
      {read.brief && read.jdText && <BriefEditor key={read.jdText} initial={read.brief} jdText={read.jdText} usedClaude={!!read.usedClaude} />}
    </>
  );
}

function BriefEditor({ initial, jdText, usedClaude }: { initial: Brief; jdText: string; usedClaude: boolean }) {
  const [brief, setBrief] = useState<Brief>(initial);
  const [extras, setExtras] = useState<Required<RoleExtras>>({ pay: initial.payRange ?? "", like: "", target: "", avoid: "" });
  const [saving, startSaving] = useTransition();
  const toggle = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.map((c, j) => (j === i ? { ...c, importance: c.importance === "must" ? "nice" : "must" } : c)) }));
  const remove = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.filter((_, j) => j !== i) }));
  const set = (k: keyof RoleExtras) => (e: React.ChangeEvent<HTMLInputElement>) => setExtras({ ...extras, [k]: e.target.value });

  return (
    <section className="panel form-grid" aria-label="Brief">
      <div className="step-title"><span className="step-n">2</span> Check what we understood <span className="hint">{usedClaude ? "(read by Claude)" : "(keyword reader)"}</span></div>
      <input className="input" style={{ fontWeight: 600 }} value={brief.title} aria-label="Role title"
        onChange={(e) => setBrief({ ...brief, title: e.target.value })} />
      <div style={{ display: "grid", gap: 8 }}>
        <p className="hint">Filled means must-have, dashed means nice to have. Click one to switch it: most job descriptions ask for more must-haves than the hiring manager really needs.</p>
        <div className="chips">
          {brief.criteria.map((c, i) => (
            <span key={c.label + i} className={`chip ${c.importance}`}>
              <button type="button" className="chip-text" onClick={() => toggle(i)} title="Switch between must-have and nice to have">{c.label}</button>
              <button type="button" className="chip-x" onClick={() => remove(i)} aria-label={`Remove ${c.label}`}>×</button>
            </span>
          ))}
          {brief.locations.map((l) => <span key={l} className="chip">{l}</span>)}
          {brief.remoteOk && <span className="chip">Remote is fine</span>}
        </div>
        {brief.leftOut && <p className="hint">Left out: {brief.leftOut}.</p>}
        {brief.workAuthorization && <p className="notice">It mentions work authorization (&ldquo;{brief.workAuthorization}&rdquo;). Unlisted never guesses anyone&apos;s visa status, so ask about it on your first call.</p>}
      </div>

      <div className="step-title"><span className="step-n">3</span> What job descriptions don&apos;t say <span className="hint">(optional)</span></div>
      <div className="two-col">
        <label className="field">Pay range<input value={extras.pay} onChange={set("pay")} placeholder="e.g. $200k–$250k" /><span className="hint">Goes into your messages.</span></label>
        <label className="field">Someone like the person you want<input value={extras.like} onChange={set("like")} placeholder="A GitHub profile link" /><span className="hint">The agent looks for people with similar work.</span></label>
        <label className="field">Companies to look in<input value={extras.target} onChange={set("target")} placeholder="Company names, separated by commas" /><span className="hint">The agent searches these first.</span></label>
        <label className="field">Companies to avoid<input value={extras.avoid} onChange={set("avoid")} placeholder="Company names, separated by commas" /><span className="hint">People working there are never shown.</span></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={saving || !brief.criteria.length}
          onClick={() => startSaving(() => createRole({ jdText, brief, extras }))}>
          {saving ? "Creating the role and searching…" : "Create role and find candidates"}
        </button>
        {!brief.criteria.length && <span className="hint">Add at least one requirement to the job description first.</span>}
      </div>
    </section>
  );
}
