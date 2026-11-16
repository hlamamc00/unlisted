import "server-only";

// Email goes out through Resend (resend.com). EMAIL_FROM must use a domain verified there.
const API = process.env.RESEND_API_URL || "https://api.resend.com/emails";

export const canEmail = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export type Email = {
  to: string;
  subject: string;
  text: string;
  /** Shown as the sender's name; the address stays EMAIL_FROM's. */
  fromName?: string;
  /** Replies go here (the recruiter's own inbox). */
  replyTo?: string;
  /** Lets mail apps show their own unsubscribe button. */
  unsubscribeUrl?: string;
};

export async function sendEmail(msg: Email): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "Email sending isn't set up yet." };
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  const fromName = msg.fromName?.replace(/[<>"\r\n]/g, "").trim();
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${address}>` : from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        reply_to: msg.replyTo,
        headers: msg.unsubscribeUrl ? { "List-Unsubscribe": `<${msg.unsubscribeUrl}>` } : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    console.error("Email failed", res.status, await res.text().catch(() => ""));
    return { ok: false, error: res.status === 429 ? "Too many emails at once. Try again in a minute." : "The email couldn't be sent." };
  } catch (e) {
    console.error("Email failed", e);
    return { ok: false, error: "The email couldn't be sent." };
  }
}
