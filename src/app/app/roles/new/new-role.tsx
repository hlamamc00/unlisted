"use client";

import { useActionState, useState, useTransition } from "react";
import type { Brief } from "@/lib/brief";
import { createRole, readJobDescription, type ReadResult } from "../../actions";

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
      <form action={readAction} className="panel" style={{ display: "grid", gap: 12 }}>
        <div className="row">
          <label className="btn">
            Upload job description
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
  const [ctx, setCtx] = useState({ avoid: "", like: "", pay: initial.payRange ?? "" });
  const [saving, startSaving] = useTransition();
  const toggle = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.map((c, j) => (j === i ? { ...c, importance: c.importance === "must" ? "nice" : "must" } : c)) }));
  const remove = (i: number) => setBrief((b) => ({ ...b, criteria: b.criteria.filter((_, j) => j !== i) }));

  return (
    <section className="panel" style={{ display: "grid", gap: 16 }} aria-label="Brief">
      <div>
        <div className="label">What we took from it {usedClaude ? "(read by Claude)" : "(keyword reader)"}</div>
        <input className="input" style={{ marginTop: 6, fontWeight: 600 }} value={brief.title} aria-label="Role title"
          onChange={(e) => setBrief({ ...brief, title: e.target.value })} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <p className="hint">Filled means must-have, dashed means nice to have. Click one to switch it: most job descriptions ask for more must-haves than the hiring manager really needs.</p>
        <div className="chips">
          {brief.criteria.map((c, i) => (
            <span key={c.label + i} className={`chip ${c.importance}`}>
              <button type="button" onClick={() => toggle(i)} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
                title="Switch between must-have and nice to have">{c.label}</button>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove ${c.label}`} style={{ background: "none", border: 0, color: "inherit", opacity: .6, cursor: "pointer" }}>×</button>
            </span>
          ))}
          {brief.locations.map((l) => <span key={l} className="chip">{l}</span>)}
          {brief.remoteOk && <span className="chip">Remote is fine</span>}
        </div>
        {brief.leftOut && <p className="hint">Left out: {brief.leftOut}.</p>}
        {brief.workAuthorization && <p className="notice">It mentions work authorization (&ldquo;{brief.workAuthorization}&rdquo;). Unlisted never guesses anyone&apos;s visa status, so ask about it on your first call.</p>}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="label">What job descriptions don&apos;t tell us</div>
        <p className="hint">Saved with the role and shown above its candidates. The pay range goes into your messages. Searching by company and finding people like someone you name come in a later update.</p>
        <label className="field">Companies to target or avoid<input value={ctx.avoid} onChange={(e) => setCtx({ ...ctx, avoid: e.target.value })} placeholder="e.g. target ex-exchange engineers, avoid the client's competitors" /></label>
        <label className="field">Someone like the person you want<input value={ctx.like} onChange={(e) => setCtx({ ...ctx, like: e.target.value })} placeholder="A GitHub, paper or personal site link" /></label>
        <label className="field">Pay range<input value={ctx.pay} onChange={(e) => setCtx({ ...ctx, pay: e.target.value })} placeholder="e.g. $200k–$250k" /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={saving || !brief.criteria.length}
          onClick={() => startSaving(() => createRole({ jdText, brief, context: ctx }))}>
          {saving ? "Creating the role and searching…" : "Create role and find candidates"}
        </button>
        {!brief.criteria.length && <span className="hint">Add at least one requirement to the job description first.</span>}
      </div>
    </section>
  );
}
