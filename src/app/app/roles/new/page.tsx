import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/claude";
import { SiteHeader } from "@/components/site-header";
import { NewRole } from "./new-role";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  await requireUser();
  return (
    <>
      <SiteHeader current="new" />
      <main className="wrap" style={{ display: "grid", gap: 16, maxWidth: 820 }}>
        <div>
          <h1 style={{ fontSize: 28 }}>New role</h1>
          <p className="hint" style={{ marginTop: 4 }}>
            Upload the job description or paste it. A few lines in your own words work too.
            {!hasClaude() && " Claude isn't connected yet, so a simpler keyword reader is used."}
          </p>
        </div>
        <NewRole />
      </main>
    </>
  );
}
