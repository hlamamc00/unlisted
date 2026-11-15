import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Brief, RoleContext, RoleRules } from "@/lib/brief";
import { evidenceFor, type Check } from "@/lib/score";
import { rescoreIfStale, toScorable } from "@/lib/search";
import { SiteHeader } from "@/components/site-header";
import { ReviewQueue, type Item } from "./review-queue";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const role = await db.role.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: role?.title ?? "Role" };
}

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  await rescoreIfStale(id, user.id);
  const role = await db.role.findFirst({
    where: { id, userId: user.id },
    include: { matches: { where: { status: { in: ["review", "approved", "skipped"] } }, include: { person: true }, orderBy: { score: "desc" } } },
  });
  if (!role) notFound();

  const items: Item[] = role.matches.map((m) => ({
    id: m.id,
    status: m.status as Item["status"],
    score: m.score,
    checks: m.checks as Check[],
    evidence: evidenceFor(toScorable(m.person)),
    hasDraft: Boolean(m.draft),
    person: {
      login: m.person.githubLogin,
      name: m.person.name,
      avatarUrl: m.person.avatarUrl,
      location: m.person.location,
      company: m.person.company,
      email: m.person.email,
      blog: m.person.blog,
      hasLinkedIn: m.person.hasLinkedIn,
    },
  }));

  return (
    <>
      <SiteHeader current="roles" />
      <main className="wrap">
        <ReviewQueue
          role={{
            id: role.id,
            title: role.title,
            brief: role.brief as unknown as Brief,
            context: (role.context ?? {}) as RoleContext,
            excluded: ((role.rules ?? {}) as RoleRules).excludedLocations ?? [],
          }}
          items={items}
        />
      </main>
    </>
  );
}
