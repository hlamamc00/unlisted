import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { linkedInHref } from "@/lib/linkedin";
import { stageLabel } from "@/lib/pipeline";
import { fitLabel, shortLocation } from "@/lib/score";

// Cells starting with = + - @ would run as formulas in a spreadsheet, so they're prefixed with an apostrophe.
const cell = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\r?\n/g, " ").trim();
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The role's pipeline as a CSV file, for spreadsheets and for importing into an applicant tracking system. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const role = await db.role.findFirst({
    where: { id, userId: user.id },
    include: { matches: { where: { status: "approved" }, include: { person: true }, orderBy: { updatedAt: "desc" } } },
  });
  if (!role) return new Response("Not found", { status: 404 });

  const header = ["Name", "Stage", "Fit", "Current role", "Company", "Location", "Email", "LinkedIn", "GitHub", "Last contacted", "Notes"];
  const rows = role.matches.map((m) => [
    m.person.name || m.person.githubLogin, stageLabel(m.stage), fitLabel(m.score), m.person.headline, m.person.company, shortLocation(m.person.location),
    m.person.email, m.person.linkedinUrl ? linkedInHref(m.person.linkedinUrl) : "", m.person.githubLogin ? `https://github.com/${m.person.githubLogin}` : "",
    m.contactedAt ? m.contactedAt.toISOString().slice(0, 10) : "", m.notes,
  ]);
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const name = role.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "role";
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-pipeline.csv"`, "Cache-Control": "no-store" },
  });
}
