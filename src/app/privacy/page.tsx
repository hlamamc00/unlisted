import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  const contact = process.env.PRIVACY_EMAIL;
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <article className="prose">
          <h1 style={{ fontSize: 30 }}>Privacy notice</h1>
          <p>Unlisted helps recruiters find people for jobs through the work those people have made public and their professional profiles. This notice explains what we collect about the people we find, why, and how to remove yourself.</p>
          <h2>What we collect</h2>
          <ul>
            <li>From your public GitHub profile: your name, username, photo, location, bio, company, website and public email, if you&apos;ve added them.</li>
            <li>Your public repositories: names, descriptions, topics, languages, stars and when you last pushed code.</li>
            <li>Whether your GitHub profile links to a LinkedIn profile, and its address.</li>
            <li>From People Data Labs, a licensed provider of professional profile data: your name, job title, employer, location, skills, recent roles and LinkedIn profile address. We don&apos;t collect anything from LinkedIn ourselves.</li>
          </ul>
          <p>We never use or guess your age, gender, race, religion, national origin, disability or visa status, and we don&apos;t collect your education or graduation dates.</p>
          <h2>Why</h2>
          <p>To show recruiters people whose work fits a role they&apos;re hiring for, with the evidence for each match, and to help them write a first message about that role.</p>
          <h2>Who sees it</h2>
          <p>Only recruiters with an Unlisted account, when they search for a role your work fits.</p>
          <h2>Your choices</h2>
          <ul>
            <li><Link href="/opt-out">Remove yourself</Link> at any time with your GitHub username or LinkedIn profile address: we delete what we hold and you won&apos;t be shown again.</li>
            <li>Ask what we hold about you, or ask us to correct it{contact ? <>, by emailing <span style={{ userSelect: "all" }}>{contact}</span></> : ""}.</li>
            <li>If you live in California, you have the right to know, delete and correct your personal information, and to opt out of its sale or sharing. We won&apos;t treat you differently for using these rights.</li>
          </ul>
          <h2>How long we keep it</h2>
          <p>GitHub profiles are refreshed at most once a week while recruiters are searching. When you remove yourself, we delete your data straight away.</p>
        </article>
      </main>
    </>
  );
}
