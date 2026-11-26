"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { emptyBrief, findableOnGithub, isSearchable, type Brief } from "@/lib/brief";
import { createRole, readSearch, type ReadResult, type RoleExtras, type SearchMode } from "../../actions";
import { CriteriaForm, FiltersForm, SearchSentence } from "../search-parts";

type Mode = SearchMode | "manual";
const MODES: [Mode, string][] = [["describe", "Describe"], ["jd", "Job description"], ["similar", "Find similar"], ["boolean", "Boolean"], ["manual", "Set filters myself"]];
const EXAMPLES = ["data analyst in Alpharetta, Georgia who worked at HP", "registered nurse in Austin, TX with 5+ years", "senior Rust engineer in Chicago who has built trading systems"];
const BOOLEAN_EXAMPLE = '("data analyst" OR "BI analyst") AND (SQL OR Tableau) NOT manager';

/** One box to say who you want, then a check of what was understood before anything is searched. */
export function NewSearch({ linkedIn, claude }: { linkedIn: boolean; claude: boolean }) {
  const [read, readAction, reading] = useActionState<ReadResult, FormData>(readSearch, {});
  const [mode, setMode] = useState<Mode>("describe");
  const [text, setText] = useState("");
  const [manual, setManual] = useState(0); // a counter, so "Set filters myself" starts blank each time
  const [dismissed, setDismissed] = useState<number | undefined>(undefined); // the reading the recruiter started over from
  const pick = (m: Mode) => { setMode(m); setText(""); setDismissed(read.at); if (m === "manual") setManual((n) => n + 1); };
  // Enter runs a one-line request; Shift+Enter makes a new line.
  const submitOnEnter = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && mode !== "jd") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  };

  return (
    <>
      <form action={readAction} className="panel ask">
        <input type="hidden" name="mode" value={mode} />
        <div className="modes" role="tablist" aria-label="How to say who you want">
          {MODES.map(([m, label]) => <button key={m} type="button" role="tab" className="mode" aria-selected={mode === m} onClick={() => pick(m)}>{label}</button>)}
        </div>

        {mode === "describe" && (
          <>
            <div className="ask-box">
              <textarea name="text" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={submitOnEnter} autoFocus
                placeholder="Describe who you're looking for…" aria-label="Who you're looking for" />
              <button className="btn primary" disabled={reading || text.trim().length < 3}>{reading ? "Reading…" : "Continue"}</button>
            </div>
            <div className="examples">
              <span className="hint">Try:</span>
              {EXAMPLES.map((x) => <button key={x} type="button" className="example" onClick={() => setText(x)}>{x}</button>)}
            </div>
          </>
        )}

        {mode === "jd" && (
          <>
            <label className="field">
              <span className="sr-only">Job description</span>
              <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the job description here" />
            </label>
            <div className="row">
              <button className="btn primary" disabled={reading || text.trim().length < 3}>{reading ? "Reading…" : "Continue"}</button>
              <label className="btn">
                Upload a file
                <input type="file" name="file" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf" hidden onChange={(e) => e.currentTarget.form?.requestSubmit()} />
              </label>
              <span className="hint">PDF, Word (.docx) or text</span>
            </div>
          </>
        )}

        {mode === "similar" && (
          <>
            <div className="ask-box">
              <input name="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={submitOnEnter} autoFocus
                placeholder="Paste a GitHub or LinkedIn profile link" aria-label="Profile link" />
              <button className="btn primary" disabled={reading || text.trim().length < 3}>{reading ? "Reading…" : "Continue"}</button>
            </div>
            <p className="hint">Unlisted reads their job title and skills and looks for people with a similar background.{linkedIn ? " Reading a LinkedIn profile uses one People Data Labs credit." : " LinkedIn links need People Data Labs connected; GitHub links work now."}</p>
          </>
        )}

        {mode === "boolean" && (
          <>
            <div className="ask-box">
              <textarea name="text" rows={2} className="mono" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={submitOnEnter} autoFocus
                placeholder={BOOLEAN_EXAMPLE} aria-label="Boolean search" spellCheck={false} />
              <button className="btn primary" disabled={reading || text.trim().length < 3}>{reading ? "Reading…" : "Continue"}</button>
            </div>
            <p className="hint">Use AND, OR and NOT in capitals, with phrases in quotes. The group that names jobs becomes the job titles, and NOT rules out job titles. <button type="button" className="link" onClick={() => setText(BOOLEAN_EXAMPLE)}>Use the example</button></p>
          </>
        )}

        {mode === "manual" && <p className="hint">Fill in the filters below. Only a job title or one requirement is needed.</p>}
        {read.error && mode !== "manual" && <p className="error" role="alert">{read.error}</p>}
      </form>

      {mode === "manual"
        ? <Understood key={`manual-${manual}`} initial={emptyBrief()} jdText="" like="" open linkedIn={linkedIn} note="" onReset={() => pick("describe")} />
        : read.brief && !reading && read.at !== dismissed && (
          <Understood key={read.at} initial={read.brief} jdText={read.jdText ?? ""} like={read.like ?? ""} linkedIn={linkedIn}
            note={read.usedClaude ? "" : claude && mode !== "boolean" && mode !== "similar" ? "Claude couldn't be reached, so a simpler keyword reader was used. Check the filters." : ""}
            onReset={() => { setText(""); setDismissed(read.at); }} />
        )}
    </>
  );
}

type UnderstoodProps = { initial: Brief; jdText: string; like: string; linkedIn: boolean; note: string; open?: boolean; onReset(): void };

/** What was understood, as filters and ranking criteria the recruiter can change, with the button that runs the search. */
function Understood({ initial, jdText, like, linkedIn, note, open = false, onReset }: UnderstoodProps) {
  const [brief, setBrief] = useState<Brief>(initial);
  const [extras, setExtras] = useState<Required<RoleExtras>>({ pay: initial.payRange ?? "", like, target: "", avoid: "" });
  const [editing, setEditing] = useState(open);
  const [running, start] = useTransition();
  const ready = isSearchable(brief);
  const github = findableOnGithub(brief);
  const run = () => start(() => createRole({ jdText, brief: { ...brief, title: brief.title.trim() || brief.jobTitles[0] || brief.criteria[0]?.label || "New search" }, extras }));

  return (
    <section className="panel understood" aria-label="Filters">
      <div className="sec-head">
        <span className="label">{open ? "Your filters" : "Here's what I understood"}</span>
        {!open && <button className="btn small" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? "Done editing" : "Edit filters"}</button>}
      </div>
      <SearchSentence brief={brief} />
      {note && <p className="hint">{note}</p>}
      {editing && <FiltersForm brief={brief} extras={extras} onChange={setBrief} onExtras={setExtras} />}

      <div className="divider" />
      <div>
        <span className="label">Criteria to rank your matches</span>
        <p className="hint">{brief.criteria.length ? "People who meet more of these come first." : "Optional. Add skills or tools and the people who have them come first."}</p>
      </div>
      <CriteriaForm brief={brief} onChange={setBrief} />

      {brief.leftOut && <p className="hint">Left out: {brief.leftOut}.</p>}
      {brief.workAuthorization && <p className="notice">It mentions work authorization (&ldquo;{brief.workAuthorization}&rdquo;). Unlisted never guesses anyone&apos;s visa status, so ask about it on your first call.</p>}
      {!linkedIn && !github && ready && (
        <p className="notice">This search needs LinkedIn profiles, and they aren&apos;t connected yet, so it won&apos;t find anyone. Connect People Data Labs first: the steps are in <Link href="/app/settings">Settings</Link>.</p>
      )}
      {!linkedIn && github && <p className="hint">LinkedIn profiles aren&apos;t connected, so this searches GitHub only: people found through the code they&apos;ve published.</p>}

      <div className="run-row">
        <span className="hint">{linkedIn ? "Shows the first matches in a few seconds. Each LinkedIn profile found uses one People Data Labs credit, up to 10 per search." : ""}</span>
        <div className="row">
          {!open && <button className="btn" onClick={onReset} disabled={running}>Start over</button>}
          <button className="btn primary" onClick={run} disabled={running || !ready}>{running ? "Searching…" : "Run search"}</button>
        </div>
      </div>
      {!ready && <p className="hint">Add a job title or one requirement to run the search.</p>}
    </section>
  );
}
