import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/claude";
import { hasPdl } from "@/lib/pdl";
import { NewSearch } from "./new-role";

export const metadata = { title: "New search" };

export default async function NewSearchPage() {
  await requireUser();
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Who are you looking for?</h1>
          <p className="hint">Say it in one line, paste a job description, or point at someone to find more like them. You check the filters before anything is searched.</p>
        </div>
      </div>
      <NewSearch linkedIn={hasPdl()} claude={hasClaude()} />
    </main>
  );
}
