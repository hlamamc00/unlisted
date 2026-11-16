import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const STEPS = [
  ["Upload the job description", "Unlisted pulls out the real requirements, then asks what job descriptions never say: the pay, companies to look in or avoid, and an example of who you want."],
  ["Review people who fit", "An agent searches LinkedIn profiles and public work on GitHub, and adds people with the evidence for each one. You approve or skip, and it learns from every choice."],
  ["Reach out and follow up", "Each message is written from that person's work and signed by you. Send it by email or paste it into LinkedIn. Reminders and a pipeline keep everyone moving."],
];

const PILLARS = [
  ["People who aren't on LinkedIn", "Many strong engineers have no LinkedIn profile, or one they never update. Unlisted finds them through what they've built, next to the people who are on LinkedIn."],
  ["Evidence you can check", "Every candidate is checked off against your requirements, line by line. Anything the agent says about someone is verified against their real profile before you see it."],
  ["An agent that asks before guessing", "Switch it on and it starts the moment you create a role, and can keep searching every night. When a choice would change the role, such as allowing remote, it asks you first."],
  ["Your hiring manager, one link away", "Share the shortlist with a link. They say yes or no without an account, and the search learns what they want."],
  ["A pipeline that reminds you", "Stages from first message to hire, private notes, follow-ups when someone hasn't replied, and a CSV export for your tracking system."],
  ["Respectful by design", "Matching never uses age, gender or other protected traits. You approve every message, and anyone can remove themselves at any time."],
];

const COMPARE = [
  ["Who you can find", "People with a LinkedIn profile", "Typically large profile databases", "LinkedIn profiles, plus people found through their public work who aren't on LinkedIn"],
  ["Why someone fits", "Search filters and an AI assistant, over LinkedIn profiles", "Typically an AI summary", "Each requirement checked off, with evidence verified against their profile"],
  ["Who's in control", "You search and send InMail", "Often automated outreach", "The agent does the searching. You approve every person and every message"],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="wrap public">
        <section className="hero-grid">
          <div className="hero">
            <div className="label">For recruiters in the US</div>
            <h1>Find the candidates LinkedIn can&apos;t.</h1>
            <p>Tell Unlisted who you need. An agent finds people on LinkedIn and people who aren&apos;t on it, shows you why each one fits, and writes a first message they&apos;ll want to answer.</p>
            <div className="row">
              <Link href="/signup" className="btn primary">Create your account</Link>
              <Link href="/login" className="btn">Log in</Link>
            </div>
          </div>

          <div className="panel preview" role="img" aria-label="An example of how a candidate appears: a strong match who is not on LinkedIn, with the reasons they fit.">
            <div className="d-head" aria-hidden="true">
              <span className="avatar">AR</span>
              <div className="who">
                <h2>Ana Rivera</h2>
                <p>Systems engineer · Chicago, IL · GitHub</p>
                <div className="badges"><span className="badge accent">Not on LinkedIn</span><span className="badge">Found by the agent</span></div>
              </div>
              <span className="fit-pill strong">Strong match</span>
            </div>
            <div className="fitline" aria-hidden="true">
              <span className="fitchip yes">✓ Chicago, IL</span><span className="fitchip yes">✓ Rust</span><span className="fitchip yes">✓ Trading systems</span><span className="fitchip unknown">? 6+ years</span>
            </div>
            <div className="agent-note" aria-hidden="true">
              <div className="label">Why they fit</div>
              <p>Maintains a lock-free order book in Rust built for low-latency trading, and is based in Chicago.</p>
              <p className="hint">Opening line: &ldquo;Your lockfree-orderbook project is close to what this team is building.&rdquo;</p>
            </div>
            <div className="preview-foot" aria-hidden="true">
              <span className="btn small">Skip</span><span className="btn small">Write message</span><span className="btn small primary">Approve</span>
            </div>
            <p className="hint">An example. Real candidates come with their own work and links.</p>
          </div>
        </section>

        <section className="band">
          <h2>How it works</h2>
          <div className="steps">
            {STEPS.map(([title, text], i) => (
              <div key={title} className="panel">
                <div className="step-title"><span className="step-n">{i + 1}</span> {title}</div>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="band">
          <h2>Built for how recruiters actually work</h2>
          <div className="pillars">
            {PILLARS.map(([title, text]) => <div key={title} className="panel"><h3>{title}</h3><p>{text}</p></div>)}
          </div>
        </section>

        <section className="band">
          <h2>How it compares</h2>
          <div className="panel compare">
            <table>
              <thead><tr><th scope="col"><span className="sr-only">What</span></th><th scope="col">LinkedIn Recruiter</th><th scope="col">Typical AI sourcing tools</th><th scope="col">Unlisted</th></tr></thead>
              <tbody>{COMPARE.map((r) => <tr key={r[0]}><th scope="row" style={{ textTransform: "none", letterSpacing: 0, font: "inherit", color: "inherit", fontWeight: 600 }}>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <footer className="site-foot hint">
          <span>Unlisted</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/opt-out">Remove yourself</Link>
          <Link href="/login">Log in</Link>
        </footer>
      </main>
    </>
  );
}
