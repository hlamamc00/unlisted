import Link from "next/link";
import { getUser } from "@/lib/auth";
import { Logo } from "./logo";

/** Top bar for the public pages (landing, login, privacy). The app itself uses the sidebar in app-nav.tsx. */
export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="top">
      <div className="wrap">
        <Link href={user ? "/app" : "/"} className="brand">
          <Logo /> Unlisted
        </Link>
        <span style={{ flex: 1 }} />
        {user ? (
          <Link href="/app" className="btn small primary">Open the app</Link>
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
