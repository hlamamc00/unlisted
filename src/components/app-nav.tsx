"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "./logo";

export type NavRole = { id: string; title: string; toReview: number };

/** The app's sidebar: Today, the recruiter's roles with how many people wait for review, and settings. A slide-in menu on phones. */
export function AppNav({ userName, roles }: { userName: string; roles: NavRole[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);

  return (
    <>
      <div className="mobile-bar">
        <Link href="/app" className="brand"><Logo /> Unlisted</Link>
        <button className="btn small" onClick={() => setOpen(true)} aria-expanded={open}>Menu</button>
      </div>
      {open && <div className="scrim side-scrim" onClick={() => setOpen(false)} />}
      <nav className={`side${open ? " open" : ""}`} aria-label="Main">
        <Link href="/app" className="brand"><Logo /> Unlisted</Link>
        <Link href="/app" className="side-link" aria-current={current("/app")}>Today</Link>
        <Link href="/app/roles/new" className="btn primary side-new">New role</Link>

        <div className="side-label">Roles</div>
        {roles.map((r) => (
          <Link key={r.id} href={`/app/roles/${r.id}`} className="side-link" aria-current={current(`/app/roles/${r.id}`)} title={r.title}>
            <span className="side-title">{r.title}</span>
            {r.toReview > 0 && <span className="side-count" title={`${r.toReview} to review`}>{r.toReview}</span>}
          </Link>
        ))}
        {!roles.length && <p className="hint" style={{ padding: "2px 10px" }}>Your roles appear here.</p>}

        <div className="side-foot">
          <Link href="/app/settings" className="side-link" aria-current={current("/app/settings")}>Settings</Link>
          <form action={logout}>
            <button className="side-link as-button"><span>Log out</span><span className="hint side-title">{userName}</span></button>
          </form>
        </div>
      </nav>
    </>
  );
}
