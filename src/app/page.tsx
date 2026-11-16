import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const PILLARS = [
  ["Start from the job description", "Upload it or paste it. Unlisted pulls out the real requirements, ignores the benefits and company blurb, and lets you mark what's truly a must-have."],
  ["LinkedIn and beyond", "Candidates come from LinkedIn profiles and from what people have built on GitHub, so you also see the strong people who aren't on LinkedIn at all. Every match shows the evidence."],
  ["See who LinkedIn misses", "Many of the strongest engineers have no LinkedIn profile, or one they never update. Every candidate is marked On LinkedIn or Not on LinkedIn."],
  ["Review fast, teach it as you go", "Approve or skip with a keystroke. Skip someone for their location and the role stops showing people from there."],
  ["Messages that cite their work", "Draft a first message that mentions a specific project of theirs, with your pay range and an easy way to say no."],
  ["Respectful by design", "Matching never uses age, gender or other protected traits, and anyone can remove themselves at any time."],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="wrap" style={{ display: "grid", gap: 32 }}>
        <section className="hero">
          <div className="label">For recruiters</div>
          <h1>Find the candidates LinkedIn can&apos;t.</h1>
          <p>Tell Unlisted who you need. It finds people through the work they&apos;ve actually done, shows you why each one fits, and helps you write a first message they&apos;ll want to answer.</p>
          <div className="row">
            <Link href="/signup" className="btn primary">Create a free account</Link>
            <Link href="/login" className="btn">Log in</Link>
          </div>
        </section>
        <section className="pillars" aria-label="How it works">
          {PILLARS.map(([title, text]) => (
            <div key={title} className="panel"><h3>{title}</h3><p>{text}</p></div>
          ))}
        </section>
        <footer className="hint row" style={{ gap: 16 }}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/opt-out">Remove yourself</Link>
        </footer>
      </main>
    </>
  );
}
