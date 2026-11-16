"use client";

import { useActionState, useState, useTransition } from "react";
import { setAgentPaused, updateSettings, type SettingsState } from "../actions";

type Values = { name: string; company: string; schedulingUrl: string; mailingAddress: string };

export function SettingsForm({ user }: { user: Values }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettings, {});
  return (
    <form action={action} className="panel form-grid">
      <label className="field">Your name<input name="name" defaultValue={user.name} required autoComplete="name" /></label>
      <label className="field">Company<input name="company" defaultValue={user.company} autoComplete="organization" /></label>
      <label className="field">
        Scheduling link
        <input name="schedulingUrl" defaultValue={user.schedulingUrl} placeholder="https://calendly.com/you/15min" inputMode="url" />
        <span className="hint">Offered in your messages so people can book a call with you. Calendly, Cal.com or a Google Calendar booking page all work.</span>
      </label>
      <label className="field">
        Business address
        <input name="mailingAddress" defaultValue={user.mailingAddress} placeholder="Acme Talent, 100 Main St, Chicago, IL 60601" autoComplete="street-address" />
        <span className="hint">Added to the bottom of emails Unlisted sends for you. US law (CAN-SPAM) expects a postal address in commercial email.</span>
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        {state.saved && !pending && <span className="hint" role="status">Saved. Your messages are signed with your name from now on.</span>}
      </div>
    </form>
  );
}

/** Turns the sourcing agent on or off for this recruiter. Paused by default, because each run costs money. */
export function AgentSwitch({ paused, connected }: { paused: boolean; connected: boolean }) {
  const [isPaused, setPaused] = useState(paused);
  const [busy, start] = useTransition();
  const toggle = () => start(async () => { await setAgentPaused(!isPaused); setPaused(!isPaused); });
  return (
    <div className="panel agent-switch">
      <div>
        <b>{isPaused ? "The agent is paused" : "The agent is on"}</b>
        <p className="hint">
          {isPaused
            ? "Nothing runs in the background or overnight. Find candidates still runs the quick search, and Claude still reads job descriptions and writes your messages."
            : "It searches in the background when you create a role or click Find candidates, and every night for roles where you've chosen that. Each run uses Claude, and LinkedIn profiles when they're connected."}
          {isPaused && !connected && " Turning it on also needs Claude connected (see below)."}
        </p>
      </div>
      <button className={isPaused ? "btn primary" : "btn"} onClick={toggle} disabled={busy}>{busy ? "Saving…" : isPaused ? "Turn on the agent" : "Pause the agent"}</button>
    </div>
  );
}
