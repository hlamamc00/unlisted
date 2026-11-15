import Link from "next/link";
import { getUser } from "@/lib/auth";
import { logout } from "@/app/(auth)/actions";

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="none" stroke="var(--ink)" strokeWidth="2" opacity=".35" />
      <circle cx="13" cy="13" r="6" fill="none" stroke="var(--ink)" strokeWidth="2" opacity=".7" />
      <circle cx="19" cy="8" r="3" fill="var(--accent)" />
    </svg>
  );
}

/** Top bar for every page. `current` marks the active nav link. */
export async function SiteHeader({ current }: { current?: "roles" | "new" }) {
  const user = await getUser();
  return (
    <header className="top">
      <div className="wrap">
        <Link href={user ? "/app" : "/"} className="brand">
          <Logo /> Unlisted
        </Link>
        <nav className="nav" aria-label="Main">
          {user && (
            <>
              <Link href="/app" aria-current={current === "roles" ? "page" : undefined}>Roles</Link>
              <Link href="/app/roles/new" aria-current={current === "new" ? "page" : undefined}>New role</Link>
            </>
          )}
        </nav>
        {user ? (
          <form action={logout} className="row">
            <span className="hint">{user.name}</span>
            <button className="btn small">Log out</button>
          </form>
        ) : (
          <div className="row">
            <Link href="/login" className="btn small">Log in</Link>
            <Link href="/signup" className="btn small primary">Sign up</Link>
          </div>
        )}
      </div>
    </header>
  );
}
