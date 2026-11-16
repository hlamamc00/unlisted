import { db } from "@/lib/db";
import type { Brief, RoleContext } from "@/lib/brief";
import type { Feedback, Note } from "@/lib/agent";
import { evidenceFor, shortLocation, type Check } from "@/lib/score";
import { toScorable } from "@/lib/search";
import { Logo } from "@/components/logo";
import { Shortlist, type ShortlistPerson } from "./shortlist";

export const metadata = { title: "Shortlist", robots: { index: false, follow: false } };

/** The shortlist a recruiter shared with a hiring manager. Anyone with the link can rate it until the link expires. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const role = await db.role.findFirst({
    where: { shareToken: token, shareExpiresAt: { gt: new Date() } },
    include: {
      user: { select: { name: true, company: true } },
      matches: { where: { status: { in: ["review", "approved"] } }, include: { person: true }, orderBy: [{ status: "asc" }, { score: "desc" }], take: 12 },
    },
  });
  if (!role) {
    return (
      <main className="share">
        <div className="brand"><Logo /> Unlisted</div>
        <div className="panel"><h1 style={{ fontSize: 22 }}>This link no longer works</h1><p className="hint" style={{ marginTop: 6 }}>Ask the recruiter who sent it for a new one.</p></div>
      </main>
    );
  }
  const brief = role.brief as unknown as Brief;
  const pay = ((role.context ?? {}) as RoleContext).pay || brief.payRange;
  const people: ShortlistPerson[] = role.matches.map((m) => {
    const evidence = evidenceFor(toScorable(m.person));
    return {
      id: m.id,
      name: m.person.name || m.person.githubLogin || "Unnamed",
      headline: m.person.headline ? `${m.person.headline}${m.person.company ? ` at ${m.person.company}` : ""}` : null,
      location: shortLocation(m.person.location),
      login: m.person.githubLogin,
      linkedinUrl: m.person.linkedinUrl,
      hasLinkedIn: m.person.hasLinkedIn,
      met: (m.checks as Check[]).filter((c) => c.status === "yes").map((c) => c.label),
      why: (m.note as Note | null)?.why ?? null,
      work: evidence.filter((e) => ["GitHub", "Role", "Before"].includes(e.src)).slice(0, 2).map((e) => (e.src === "Before" ? `Before: ${e.text}` : e.text)),
      feedback: (m.feedback ?? []) as Feedback[],
    };
  });

  return (
    <main className="share">
      <div className="brand"><Logo /> Unlisted</div>
      <div className="share-head">
        <p className="label">Shortlist from {role.user.name}{role.user.company ? `, ${role.user.company}` : ""}</p>
        <h1>{role.title}</h1>
        <p className="hint" style={{ marginTop: 6 }}>
          {[...brief.criteria.filter((c) => c.importance === "must").slice(0, 4).map((c) => c.label), brief.locations.join(" or ") || "Anywhere in the US", pay].filter(Boolean).join(" · ")}
        </p>
      </div>
      {people.length
        ? <Shortlist token={token} people={people} />
        : <div className="panel"><p>There&apos;s no one on the shortlist yet. Check back soon.</p></div>}
    </main>
  );
}
