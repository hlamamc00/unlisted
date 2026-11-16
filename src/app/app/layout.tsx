import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppNav } from "@/components/app-nav";

/** The signed-in app: sidebar on the left, the page on the right. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const roles = await db.role.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, _count: { select: { matches: { where: { status: "review" } } } } },
  });
  return (
    <div className="shell">
      <AppNav userName={user.name} roles={roles.map((r) => ({ id: r.id, title: r.title, toReview: r._count.matches }))} />
      <div className="shell-main">{children}</div>
    </div>
  );
}
