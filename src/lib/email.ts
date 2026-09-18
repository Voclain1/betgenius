import { Resend } from "resend";

/**
 * Outbound email.
 *
 * One seam, so the rest of the app asks for "send this person a reset link"
 * and never learns which provider is behind it.
 *
 * A missing RESEND_API_KEY is not a crash. Local development and preview
 * deployments have no key and no verified sending domain, and a password reset
 * that throws there would be worse than useless — it would 500 the request and
 * tell the visitor nothing. Instead the link is logged server-side, which is
 * also how support can recover an account by hand if sending is ever down.
 */

const FROM = process.env.RESEND_FROM || "BetGenius <no-reply@betgenius.ng>";

export type SendResult = { delivered: boolean; reason?: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("Email not sent: RESEND_API_KEY is not set", { to: input.to, subject: input.subject });
    return { delivered: false, reason: "NO_API_KEY" };
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      console.error("Email send failed", { to: input.to, error: error.message });
      return { delivered: false, reason: error.message };
    }
    return { delivered: true };
  } catch (error) {
    console.error("Email send threw", {
      to: input.to,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { delivered: false, reason: "SEND_THREW" };
  }
}

/** The reset link email. Plain text alongside HTML — some clients show only that. */
export function passwordResetEmail(link: string): { subject: string; html: string; text: string } {
  return {
    subject: "Reset your BetGenius password",
    text: [
      "Someone asked to reset the password on your BetGenius account.",
      "",
      `Open this link to choose a new one: ${link}`,
      "",
      "The link expires in one hour and can be used once.",
      "If this wasn't you, ignore this email — your password stays as it is.",
    ].join("\n"),
    html: `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
  <p style="margin:0 0 16px;line-height:1.5">Someone asked to reset the password on your BetGenius account.</p>
  <p style="margin:0 0 24px">
    <a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Choose a new password</a>
  </p>
  <p style="margin:0 0 16px;line-height:1.5;color:#555;font-size:14px">
    The link expires in one hour and can be used once. If this wasn't you, ignore this email — your password stays as it is.
  </p>
  <p style="margin:0;font-size:12px;color:#888;word-break:break-all">${link}</p>
</div>`.trim(),
  };
}
