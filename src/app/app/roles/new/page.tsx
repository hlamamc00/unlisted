import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/claude";
import { NewRole } from "./new-role";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  await requireUser();
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>New role</h1>
          <p className="hint">
            Upload the job description or paste it. A few lines in your own words work too.
            {!hasClaude() && " Claude isn't connected yet, so a simpler keyword reader is used."}
          </p>
        </div>
      </div>
      <NewRole />
    </main>
  );
}
