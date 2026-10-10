import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { formatNgn, type PaidTier } from "@/lib/pricing";

/**
 * Every email BetGenius sends, as pure functions of their data.
 *
 * Pure so each one is checked in scripts/check-email.ts without a database or
 * a provider, and so the outbox stores exactly what was rendered at the moment
 * it was queued — a later price change cannot rewrite a receipt.
 *
 * EMAIL HTML IS NOT WEB HTML. Clients strip <style>, ignore most CSS and
 * render light by default, so this is one centred table with inline styles on
 * a white background and the brand's darker green (the light-theme value,
 * readable on white). Every email also has a plain-text twin.
 *
 * Every value from the database is escaped. An announcement body is the
 * admin's plain text, never HTML: paragraphs and line breaks are the only
 * formatting it gets, so nothing pasted into it can become markup.
 */

const BRAND = "#007c33";
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

const lagosDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
const lagosTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });

export function formatLagosDate(date: Date): string {
  return lagosDate.format(date);
}

const TIER_NAME: Record<PaidTier, string> = { VIP: "VIP", PREMIUM: "Premium" };

/** Plain text → safe paragraphs. Blank lines split paragraphs; single newlines become <br>. */
export function paragraphsHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:${INK}">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:${BRAND};border-radius:8px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`;
}

function layout(input: { preheader: string; heading: string; bodyHtml: string; footerHtml?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${RULE};border-radius:12px">
<tr><td style="padding:28px 32px 0"><a href="${SITE_URL}" style="font-size:20px;font-weight:700;color:${INK};text-decoration:none"><span style="color:${BRAND}">Bet</span>Genius</a></td></tr>
<tr><td style="padding:24px 32px 8px">
<h1 style="margin:0 0 20px;font-size:24px;line-height:32px;font-weight:700;color:${INK}">${escapeHtml(input.heading)}</h1>
${input.bodyHtml}
</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid ${RULE};font-size:12px;line-height:19px;color:${MUTED}">
${input.footerHtml ?? ""}<p style="margin:0">18+ only. Predictions are informational and no outcome is guaranteed. Never stake money you cannot afford to lose.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function unsubscribeFooter(url: string | null, what: string): { html: string; text: string } {
  if (!url) return { html: "", text: "" };
  return {
    html: `<p style="margin:0 0 10px">You get ${escapeHtml(what)} because of your BetGenius subscription. <a href="${escapeHtml(url)}" style="color:${MUTED}">Unsubscribe</a> or manage emails in your <a href="${SITE_URL}/notifications" style="color:${MUTED}">settings</a>.</p>`,
    text: `\n\nYou get ${what} because of your BetGenius subscription. Unsubscribe: ${url}`,
  };
}

const TEXT_FOOTER = "\n\n18+ only. Predictions are informational and no outcome is guaranteed.";

// ---------------------------------------------------------------------------

export function receiptEmail(input: { tier: PaidTier; amountNgn: number; reference: string; paidAt: Date; accessUntil: Date | null }): RenderedEmail {
  const name = TIER_NAME[input.tier];
  const until = input.accessUntil ? formatLagosDate(input.accessUntil) : null;
  const rows: [string, string][] = [
    ["Plan", `${name}, 30 days`],
    ["Amount", formatNgn(input.amountNgn)],
    ["Paid on", formatLagosDate(input.paidAt)],
    ...(until ? ([["Access until", until]] as [string, string][]) : []),
    ["Reference", input.reference],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:15px">${rows
    .map(([k, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${RULE};color:${MUTED}">${escapeHtml(k)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${RULE};color:${INK};font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>`;
  return {
    subject: `Your ${SITE_NAME} ${name} receipt`,
    html: layout({
      preheader: `Payment received — ${name} is active${until ? ` until ${until}` : ""}.`,
      heading: `Payment received. ${name} is active.`,
      bodyHtml:
        paragraphsHtml(`Thank you. Your payment went through and your ${name} picks are unlocked now.`) +
        table +
        button(`Open ${name} picks`, absoluteUrl(input.tier === "PREMIUM" ? "/predictions/premium" : "/predictions/vip")) +
        paragraphsHtml("This is a one-time payment for 30 days. Nothing renews automatically — we will email you before your access ends."),
    }),
    text:
      `Payment received. ${name} is active.\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\nOpen your picks: ${absoluteUrl(input.tier === "PREMIUM" ? "/predictions/premium" : "/predictions/vip")}\n\nThis is a one-time payment for 30 days. Nothing renews automatically — we will email you before your access ends.` +
      TEXT_FOOTER,
  };
}

/** Paystack categories this email speaks to, and what each one tells the payer. */
export type PaymentProblem = "ABANDONED" | "ISSUER_DECLINE" | "INSUFFICIENT_FUNDS" | "FRAUD_BLOCK" | "GATEWAY_FAILURE" | "UNKNOWN_FAILURE";

/**
 * How to reach a person. Replies only reach someone when a support inbox is
 * published (lib/email sets it as reply-to); otherwise the email points at the
 * Contact page rather than inviting replies to a no-reply address.
 */
function contactUs(): string {
  return process.env.NEXT_PUBLIC_CONTACT_EMAIL ? "reply to this email" : `contact us at ${SITE_URL}/contact`;
}

const problemCopy = (): Record<PaymentProblem, { heading: string; body: string }> => ({
  ABANDONED: {
    heading: "Your payment wasn't completed",
    body: "You started a checkout but the payment wasn't finished, so nothing was charged and your plan hasn't changed. If something on the payment page didn't work for you, a different payment method — bank transfer or USSD — usually gets through.",
  },
  ISSUER_DECLINE: {
    heading: "Your bank declined the payment",
    body: "Your bank or card issuer turned the payment down, so your plan hasn't changed. Trying a different payment method — bank transfer or USSD — usually gets through. Your bank can also tell you why they declined it.",
  },
  INSUFFICIENT_FUNDS: {
    heading: "Your payment didn't go through",
    body: "The payment was declined because the account didn't have enough available, so your plan hasn't changed. You can try again whenever you're ready, or use a different account.",
  },
  FRAUD_BLOCK: {
    heading: "Your payment was stopped by a security check",
    body: `Paystack's automatic security checks stopped this payment before it completed, so your plan hasn't changed. This is not a problem with your bank. Please try again with bank transfer or USSD, or ${contactUs()} and we'll sort it out with you.`,
  },
  GATEWAY_FAILURE: {
    heading: "Your payment didn't go through",
    body: "The payment provider had a temporary problem processing your payment, so your plan hasn't changed. These usually clear within minutes — please try again.",
  },
  UNKNOWN_FAILURE: {
    heading: "Your payment didn't go through",
    body: `Paystack reported that your payment didn't complete, so your plan hasn't changed. Please try again, or ${contactUs()} and we'll look into it with you.`,
  },
});

export function paymentProblemEmail(input: { tier: PaidTier; problem: PaymentProblem; reference: string }): RenderedEmail {
  const name = TIER_NAME[input.tier];
  const copy = problemCopy()[input.problem];
  const note = `If money did leave your account for this attempt, ${contactUs()} with the reference below and we will make sure you get your access or a refund.`;
  return {
    subject: `${copy.heading} — ${SITE_NAME} ${name}`,
    html: layout({
      preheader: `Your ${name} plan hasn't changed. Here's how to finish.`,
      heading: copy.heading,
      bodyHtml:
        paragraphsHtml(copy.body) +
        button(`Try ${name} again`, absoluteUrl("/pricing")) +
        paragraphsHtml(`${note}\n\nReference: ${input.reference}`),
    }),
    text: `${copy.heading}\n\n${copy.body}\n\nTry again: ${absoluteUrl("/pricing")}\n\n${note}\n\nReference: ${input.reference}${TEXT_FOOTER}`,
  };
}

export function renewalReminderEmail(input: { tier: PaidTier; endsAt: Date }): RenderedEmail {
  const name = TIER_NAME[input.tier];
  const ends = formatLagosDate(input.endsAt);
  const body = `Your ${name} access ends on ${ends}. Plans don't renew automatically, so to keep your picks coming, renew before then. Renewing early adds 30 days on top of the days you have left — you don't lose any.`;
  return {
    subject: `Your ${SITE_NAME} ${name} access ends on ${ends}`,
    html: layout({
      preheader: `Renew before ${ends} to keep your ${name} picks.`,
      heading: `Your ${name} access ends on ${ends}`,
      bodyHtml: paragraphsHtml(body) + button(`Renew ${name}`, absoluteUrl("/pricing")),
    }),
    text: `Your ${name} access ends on ${ends}\n\n${body}\n\nRenew: ${absoluteUrl("/pricing")}${TEXT_FOOTER}`,
  };
}

export function accessEndedEmail(input: { tier: PaidTier }): RenderedEmail {
  const name = TIER_NAME[input.tier];
  const body = `Your 30 days of ${name} have ended, so ${name} picks are locked again. Your account and settings are still here — renew any time to pick up where you left off.`;
  return {
    subject: `Your ${SITE_NAME} ${name} access has ended`,
    html: layout({
      preheader: `Renew any time to unlock ${name} picks again.`,
      heading: `Your ${name} access has ended`,
      bodyHtml: paragraphsHtml(body) + button(`Renew ${name}`, absoluteUrl("/pricing")),
    }),
    text: `Your ${name} access has ended\n\n${body}\n\nRenew: ${absoluteUrl("/pricing")}${TEXT_FOOTER}`,
  };
}

export type PickLine = {
  home: string;
  away: string;
  league: string | null;
  kickoff: Date;
  market: string;
  pick: string;
  odds: number | null;
  href: string;
};

export function dailyPicksEmail(input: { tier: PaidTier; dateLabel: string; picks: PickLine[]; unsubscribeUrl: string | null; feedHref: string }): RenderedEmail {
  const name = TIER_NAME[input.tier];
  const count = input.picks.length;
  const rows = input.picks
    .map((p) => {
      const meta = [lagosTime.format(p.kickoff), p.league].filter(Boolean).join(" · ");
      const odds = p.odds != null ? ` @ ${p.odds.toFixed(2)}` : "";
      return `<tr><td style="padding:14px 0;border-bottom:1px solid ${RULE}">
<div style="font-size:12px;color:${MUTED};margin-bottom:4px">${escapeHtml(meta)}</div>
<a href="${escapeHtml(p.href)}" style="font-size:16px;font-weight:600;color:${INK};text-decoration:none">${escapeHtml(p.home)} vs ${escapeHtml(p.away)}</a>
<div style="font-size:15px;color:${INK};margin-top:4px">${escapeHtml(p.market)}: <strong style="color:${BRAND}">${escapeHtml(p.pick)}</strong>${escapeHtml(odds)}</div>
</td></tr>`;
    })
    .join("");
  const footer = unsubscribeFooter(input.unsubscribeUrl, "daily picks emails");
  const textRows = input.picks
    .map((p) => `${lagosTime.format(p.kickoff)}  ${p.home} vs ${p.away}${p.league ? ` (${p.league})` : ""}\n  ${p.market}: ${p.pick}${p.odds != null ? ` @ ${p.odds.toFixed(2)}` : ""}\n  ${p.href}`)
    .join("\n\n");
  return {
    subject: `Today's ${name} picks — ${count} ${count === 1 ? "match" : "matches"}`,
    html: layout({
      preheader: `${count} ${name} ${count === 1 ? "pick" : "picks"} for ${input.dateLabel}.`,
      heading: `${name} picks for ${input.dateLabel}`,
      bodyHtml:
        paragraphsHtml("Kickoff times are Lagos time. Picks can be updated or added during the day — the site always has the latest.") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">${rows}</table>` +
        button(`See all ${name} picks`, input.feedHref),
      footerHtml: footer.html,
    }),
    text: `${name} picks for ${input.dateLabel}\n\nKickoff times are Lagos time. The site always has the latest.\n\n${textRows}\n\nAll picks: ${input.feedHref}${TEXT_FOOTER}${footer.text}`,
  };
}

export function announcementEmail(input: { subject: string; body: string; unsubscribeUrl: string | null }): RenderedEmail {
  const footer = unsubscribeFooter(input.unsubscribeUrl, "announcements");
  return {
    subject: input.subject,
    html: layout({ preheader: input.body.trim().split("\n")[0].slice(0, 120), heading: input.subject, bodyHtml: paragraphsHtml(input.body), footerHtml: footer.html }),
    text: `${input.subject}\n\n${input.body.trim()}${TEXT_FOOTER}${footer.text}`,
  };
}

export function adminPaymentAlertEmail(input: { reference: string; tier: string | null; amountNgn: number | null; problem: string }): RenderedEmail {
  const body = `Paystack reports a successful payment that has not unlocked access.\n\nReference: ${input.reference}\nPlan: ${input.tier ?? "unknown"}\nAmount: ${input.amountNgn != null ? formatNgn(input.amountNgn) : "unknown"}\nWhy: ${input.problem}\n\nOpen Payments in the admin area to verify and grant it, or to see why it was refused.`;
  return {
    subject: `Action needed: a paid ${input.tier ?? ""} checkout has no access`.replace("  ", " "),
    html: layout({ preheader: `Reference ${input.reference}`, heading: "A customer paid but has no access", bodyHtml: paragraphsHtml(body) + button("Open Payments", absoluteUrl("/admin/payments")) }),
    text: `${body}\n\n${absoluteUrl("/admin/payments")}`,
  };
}
