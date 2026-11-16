"use client";

import { useActionState } from "react";
import { updateSettings, type SettingsState } from "../actions";

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
