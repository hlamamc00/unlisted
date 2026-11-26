import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/claude";
import { canEmail } from "@/lib/email";
import { hasPdl } from "@/lib/pdl";
import { AgentSwitch, SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const services: { name: string; on: boolean; what: string; setting: string; how?: string }[] = [
    { name: "Claude", on: hasClaude(), what: "Reads job descriptions, writes your messages and runs the sourcing agent.", setting: "ANTHROPIC_API_KEY" },
    { name: "GitHub", on: Boolean(process.env.GITHUB_TOKEN), what: "Finds people through their public work. Without a token, GitHub allows only a few searches an hour.", setting: "GITHUB_TOKEN" },
    {
      name: "LinkedIn profiles", on: hasPdl(), setting: "PDL_API_KEY",
      what: "Finds people by job title, employer, place and years of experience, through People Data Labs. Every search that isn't about people who publish code needs it. Each profile found uses one of their credits.",
      how: "Create an account at peopledatalabs.com and copy the API key from its dashboard.",
    },
    { name: "Email", on: canEmail(), what: "Sends your messages from Unlisted and emails you when the agent finds someone, through Resend.", setting: "RESEND_API_KEY and EMAIL_FROM" },
  ];
  return (
    <main className="page narrow">
      <div className="page-head"><div><h1>Settings</h1><p className="hint">Signed in as {user.email}</p></div></div>
      <SettingsForm user={{ name: user.name, company: user.company ?? "", schedulingUrl: user.schedulingUrl ?? "", mailingAddress: user.mailingAddress ?? "" }} />

      <h2 className="section-title">Sourcing agent</h2>
      <AgentSwitch paused={user.agentPaused} connected={hasClaude()} />

      <h2 className="section-title">What&apos;s connected</h2>
      <div className="panel services">
        {services.map((s) => (
          <div key={s.name} className="service">
            <span className={`dot ${s.on ? "on" : "off"}`} aria-hidden="true" />
            <div>
              <b>{s.name}</b> <span className="hint">{s.on ? "Connected" : "Not connected"}</span>
              <p className="hint">{s.what}{!s.on && <> To connect it: {s.how && `${s.how} Then `}{s.how ? "add" : "Add"} <code>{s.setting}</code> to your site&apos;s environment variables in Netlify and deploy again.</>}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
