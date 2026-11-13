import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { lagosDateKey } from "@/lib/lagosDate";
import { PAID_DAY_ALERT_STATUSES } from "@/lib/paidOps";
import { loadPaidOpsSnapshot, type PaidOpsSnapshot } from "@/lib/paidOpsData";

/**
 * Operational alerts for the paid feeds, by email through the existing Resend
 * integration. No new dependency.
 *
 * OPT-IN: nothing is sent unless PAID_OPS_ALERT_EMAIL names a recipient. Each
 * alert is sent at most once per day and cause (an AppLock row records it),
 * so the three-hourly settle run that triggers it cannot repeat itself.
 * Alerts are for operational failures only; a genuine low-opportunity day is
 * reported on /admin/paid-ops and never alerts.
 */

export type PaidOpsAlert = { key: string; day: string; cause: string; detail: string };

/** Which alerts the snapshot calls for. Pure. Judged on yesterday and today. */
export function paidOpsAlertsDue(s: PaidOpsSnapshot, now: Date, mode: string): PaidOpsAlert[] {
  const today = lagosDateKey(now);
  const out: PaidOpsAlert[] = [];
  for (const d of s.days.slice(-2)) {
    if ((PAID_DAY_ALERT_STATUSES as readonly string[]).includes(d.status)) {
      out.push({ key: `${d.day}:${d.status}`, day: d.day, cause: d.status, detail: d.reasons.join("; ") });
    }
  }
  if (s.paidPassLast24h.runs === 0) out.push({ key: `${today}:PAID_PASS_SILENT`, day: today, cause: "PAID_PASS_SILENT", detail: "The VIP/Premium pass has not run in 24 hours. Check the cron-job.org schedule." });
  if (s.paidPassLast24h.failedRuns >= 3) out.push({ key: `${today}:PAID_PASS_FAILING`, day: today, cause: "PAID_PASS_FAILING", detail: `${s.paidPassLast24h.failedRuns} paid-pass runs failed in 24 hours.` });
  if (mode !== "current" && s.shadow.last24h === 0) out.push({ key: `${today}:SHADOW_LOG_SILENT`, day: today, cause: "SHADOW_LOG_SILENT", detail: "No paid-selection shadow record in 24 hours although shadow mode is on." });
  return out;
}

const LOCK_PREFIX = "paid-ops-alert:";

/** Send due alerts once each. Never throws; returns what it did. */
export async function sendPaidOpsAlerts(now: Date = new Date()): Promise<{ sent: string[]; skipped: string | null }> {
  const to = process.env.PAID_OPS_ALERT_EMAIL?.trim();
  if (!to) return { sent: [], skipped: "PAID_OPS_ALERT_EMAIL not set" };
  try {
    const snapshot = await loadPaidOpsSnapshot(3, now);
    const due = paidOpsAlertsDue(snapshot, now, (process.env.PAID_SELECTION_MODE ?? "shadow").toLowerCase());
    const sent: string[] = [];
    for (const a of due) {
      const key = `${LOCK_PREFIX}${a.key}`;
      // Claim first: a unique key that already exists means it was sent.
      const claimed = await prisma.appLock
        .create({ data: { key, holder: "paid-ops", acquiredAt: now, expiresAt: new Date(now.getTime() + 14 * 86_400_000) } })
        .then(() => true, () => false);
      if (!claimed) continue;
      const subject = `BetGenius paid feeds: ${a.cause.replace(/_/g, " ").toLowerCase()} (${a.day})`;
      const text = `${a.detail}\n\nSee /admin/paid-ops for the day-by-day picture.`;
      const r = await sendEmail({ to, subject, text, html: `<p>${escapeHtml(a.detail)}</p><p>See <code>/admin/paid-ops</code> for the day-by-day picture.</p>` });
      if (r.delivered) sent.push(a.key);
      else await prisma.appLock.delete({ where: { key } }).catch(() => {}); // let the next run retry
    }
    return { sent, skipped: null };
  } catch (error) {
    console.error("[paid-ops] alert check failed", error);
    return { sent: [], skipped: "ALERT_CHECK_FAILED" };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
