"use client";

// The pieces a search is shown and edited with, on the new-search page and on each role:
// the sentence that says who is being looked for, the filters form and the ranking criteria.
import { useState } from "react";
import { criterionFromLabel, parseLocations, splitList, type Brief } from "@/lib/brief";
import type { RoleExtras } from "../actions";

/** Filters that are set, for the "Filters (4)" button. */
export const filterCount = (b: Brief) =>
  Number(b.jobTitles.length > 0) + Number(b.locations.length > 0 || b.remoteOk) + Number(b.companies.length > 0) + Number(Boolean(b.minYears)) + Number(b.exclude.length > 0);

const orList = (items: string[], cls = "tok") =>
  items.map((x, i) => <span key={x + i}>{i > 0 && " or "}<span className={cls}>{x}</span></span>);

/** Who the search is for, as one sentence: "Data Analyst +2 in Alpharetta, GA who works or used to work at HP". */
export function SearchSentence({ brief }: { brief: Brief }) {
  const [first, ...others] = brief.jobTitles;
  const musts = brief.criteria.filter((c) => c.importance === "must").slice(0, 3).map((c) => c.label);
  return (
    <p className="sentence">
      {/* A search without job titles is described by what people must have: "People with Rust and Trading systems". */}
      {first ? <span className="tok">{first}</span> : musts.length ? <>People with {musts.map((m, i) => <span key={m}>{i > 0 && (i === musts.length - 1 ? " and " : ", ")}<span className="tok">{m}</span></span>)}</> : "Anyone"}
      {others.length > 0 && <> <span className="tok more" title={`Also: ${others.join(", ")}`}>+{others.length}</span></>}
      {brief.locations.length > 0
        ? <> in {orList(brief.locations)}{brief.remoteOk && <> or <span className="tok">remote in the US</span></>}</>
        : <> <span className="tok more">anywhere in the US</span></>}
      {brief.companies.length > 0 && <> who works or used to work at {orList(brief.companies)}</>}
      {brief.minYears ? <> with <span className="tok">{brief.minYears}+ years</span> of experience</> : null}
      {brief.exclude.length > 0 && <> without {orList(brief.exclude, "tok neg")} in their title</>}
    </p>
  );
}

/** The requirements matches are ranked by. Click one to switch between must-have and nice to have. */
export function CriteriaForm({ brief, onChange }: { brief: Brief; onChange(brief: Brief): void }) {
  const [label, setLabel] = useState("");
  const toggle = (i: number) => onChange({ ...brief, criteria: brief.criteria.map((c, j) => (j === i ? { ...c, importance: c.importance === "must" ? "nice" : "must" } : c)) });
  const remove = (i: number) => onChange({ ...brief, criteria: brief.criteria.filter((_, j) => j !== i) });
  const add = () => {
    const text = label.trim();
    if (!text || brief.criteria.some((c) => c.label.toLowerCase() === text.toLowerCase())) return;
    onChange({ ...brief, criteria: [...brief.criteria, criterionFromLabel(text, "must")] });
    setLabel("");
  };
  return (
    <div className="criteria-form">
      {brief.criteria.length > 0 && (
        <div className="chips">
          {brief.criteria.map((c, i) => (
            <span key={c.label + i} className={`chip ${c.importance}`}>
              <button type="button" className="chip-text" onClick={() => toggle(i)} title={c.importance === "must" ? "Must-have. Click to make it nice to have." : "Nice to have. Click to make it a must-have."}>{c.label}</button>
              <button type="button" className="chip-x" onClick={() => remove(i)} aria-label={`Remove ${c.label}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <input className="input add-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add a skill or requirement, e.g. Tableau"
          aria-label="New requirement" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn small" onClick={add} disabled={!label.trim()}>Add</button>
      </div>
      {brief.criteria.length > 0 && <p className="hint">Filled means must-have, dashed means nice to have. Click one to switch it.</p>}
    </div>
  );
}

type FiltersProps = { brief: Brief; extras: Required<RoleExtras>; onChange(brief: Brief): void; onExtras(extras: Required<RoleExtras>): void };

/** The filters: job titles, places, employers, years, and what a request doesn't usually say (pay, companies to avoid). */
export function FiltersForm({ brief, extras, onChange, onExtras }: FiltersProps) {
  // List fields are typed as text; the brief gets the parsed list on every keystroke.
  const [titles, setTitles] = useState(brief.jobTitles.join(", "));
  const [places, setPlaces] = useState(brief.locations.join(", "));
  const [companies, setCompanies] = useState(brief.companies.join(", "));
  const [exclude, setExclude] = useState(brief.exclude.join(", "));
  const set = (k: keyof RoleExtras) => (e: React.ChangeEvent<HTMLInputElement>) => onExtras({ ...extras, [k]: e.target.value });

  return (
    <div className="form-grid">
      <label className="field">Name of this search
        <input value={brief.title} onChange={(e) => onChange({ ...brief, title: e.target.value })} placeholder="e.g. Data Analyst" />
      </label>
      <div className="two-col">
        <label className="field">Job titles
          <input value={titles} onChange={(e) => { setTitles(e.target.value); onChange({ ...brief, jobTitles: splitList(e.target.value).slice(0, 6) }); }} placeholder="e.g. Data Analyst, BI Analyst" />
          <span className="hint">Any of these, separated by commas. Leave out words like Senior.</span>
        </label>
        <label className="field">Works or used to work at
          <input value={companies} onChange={(e) => { setCompanies(e.target.value); onChange({ ...brief, companies: splitList(e.target.value).slice(0, 8) }); }} placeholder="e.g. HP, Dell" />
          <span className="hint">Leave empty for any employer.</span>
        </label>
        <label className="field">Places
          <input value={places} onChange={(e) => { setPlaces(e.target.value); onChange({ ...brief, locations: parseLocations(e.target.value) }); }} placeholder="e.g. Alpharetta, GA, Atlanta, GA" />
          <span className="hint">Cities with their state, or a whole state. Leave empty for anywhere in the US.</span>
        </label>
        <label className="field">Minimum years of experience
          <input type="number" min={0} max={40} value={brief.minYears ?? ""} placeholder="Any"
            onChange={(e) => { const n = Math.round(Number(e.target.value)); onChange({ ...brief, minYears: e.target.value && n > 0 ? Math.min(40, n) : null }); }} />
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={brief.remoteOk} onChange={(e) => onChange({ ...brief, remoteOk: e.target.checked })} /> Remote is fine (anyone in the US)</label>
      <div className="two-col">
        <label className="field">Not in their job title
          <input value={exclude} onChange={(e) => { setExclude(e.target.value); onChange({ ...brief, exclude: splitList(e.target.value).map((x) => x.toLowerCase()) }); }} placeholder="e.g. manager, intern" />
          <span className="hint">People with these words in their title are left out.</span>
        </label>
        <label className="field">Companies to avoid
          <input value={extras.avoid} onChange={set("avoid")} placeholder="Company names, separated by commas" />
          <span className="hint">People working there now are never shown.</span>
        </label>
        <label className="field">Pay range
          <input value={extras.pay} onChange={set("pay")} placeholder="e.g. $85k–$105k" />
          <span className="hint">Goes into your messages.</span>
        </label>
        <label className="field">Companies to look in first
          <input value={extras.target} onChange={set("target")} placeholder="Company names, separated by commas" />
          <span className="hint">The agent starts with these.</span>
        </label>
      </div>
    </div>
  );
}
