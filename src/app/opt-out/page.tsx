"use client";

import Link from "next/link";
import { useActionState } from "react";
import { optOut, type OptOutState } from "./actions";

export default function OptOutPage() {
  const [state, action, pending] = useActionState<OptOutState, FormData>(optOut, {});
  return (
    <main className="wrap public">
      <div className="panel auth">
        <Link href="/" className="brand" style={{ fontSize: 18 }}>Unlisted</Link>
        <h1 style={{ fontSize: 26 }}>Remove yourself</h1>
        {state.done ? (
          <p role="status">Done. We&apos;ve deleted what we held about you and you won&apos;t be shown to recruiters again. If a recruiter already wrote to you, replying &ldquo;no thanks&rdquo; stops their messages too.</p>
        ) : (
          <form action={action} style={{ display: "grid", gap: 12 }}>
            <p>Unlisted helps recruiters find people through their public GitHub work and professional profiles. Enter your GitHub username or your LinkedIn profile address, and we&apos;ll delete what we hold about you and never show you to recruiters again.</p>
            <label className="field">GitHub username, or your GitHub or LinkedIn profile link<input name="github" required autoComplete="off" placeholder="octocat or linkedin.com/in/your-name" /></label>
            {state.error && <p className="error" role="alert">{state.error}</p>}
            <button className="btn primary" disabled={pending}>{pending ? "Removing…" : "Remove me"}</button>
            <p className="hint">See our <Link href="/privacy">privacy notice</Link> for what we collect and why.</p>
          </form>
        )}
      </div>
    </main>
  );
}
