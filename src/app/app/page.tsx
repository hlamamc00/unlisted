import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  const user = await requireUser();
  const roles = await db.role.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, lastSearchAt: true, matches: { select: { status: true } } },
  });

  return (
    <>
      <SiteHeader current="roles" />
      <main className="wrap" style={{ display: "grid", gap: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 28 }}>Your roles</h1>
          <Link href="/app/roles/new" className="btn primary">New role</Link>
        </div>
        {roles.length === 0 ? (
          <div className="empty">
            <p>Start with a job description. Upload it or paste it, and Unlisted finds people through the work they&apos;ve done.</p>
            <p style={{ marginTop: 12 }}><Link href="/app/roles/new" className="btn primary">Create your first role</Link></p>
          </div>
        ) : (
          <div className="roles">
            {roles.map((r) => {
              const count = (s: string) => r.matches.filter((m) => m.status === s).length;
              return (
                <Link key={r.id} href={`/app/roles/${r.id}`} className="panel role-row">
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: 18 }}>{r.title}</h2>
                    <p className="hint">{r.lastSearchAt ? `Last searched ${r.lastSearchAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not searched yet"}</p>
                  </div>
                  <div className="counts">
                    <span><b>{count("review")}</b> to review</span>
                    <span><b>{count("approved")}</b> approved</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
