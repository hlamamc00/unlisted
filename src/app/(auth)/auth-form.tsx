"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup, type AuthState } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "login" ? login : signup, {});
  const isSignup = mode === "signup";
  return (
    <form action={action} className="panel auth">
      <h1 style={{ fontSize: 26 }}>{isSignup ? "Create your recruiter account" : "Log in"}</h1>
      {isSignup && (
        <>
          <label className="field">Your name<input name="name" autoComplete="name" required defaultValue={state.name} /></label>
          <label className="field">Company (optional)<input name="company" autoComplete="organization" defaultValue={state.company} /></label>
        </>
      )}
      <label className="field">Work email<input name="email" type="email" autoComplete="email" required defaultValue={state.email} /></label>
      <label className="field">
        Password
        <input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 10 : undefined} />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn primary" disabled={pending}>{pending ? "One moment…" : isSignup ? "Create account" : "Log in"}</button>
      <p className="hint">
        {isSignup ? <>Already have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Create an account</Link></>}
      </p>
    </form>
  );
}
