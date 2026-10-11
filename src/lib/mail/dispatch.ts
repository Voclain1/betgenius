import { sendDue, type SendSummary } from "@/lib/mail/outbox";
import {
  queueAdminPaymentAlerts,
  queueDailyPicks,
  queuePaymentProblems,
  queueReceipts,
  queueRenewalNotices,
  syncPaystackAttempts,
} from "@/lib/mail/producers";

/**
 * One email pass: find what is owed, then send what is due.
 *
 * Runs from the notifications dispatch cron (every two minutes), after the
 * push notifications, inside the same request — so email needed no new
 * scheduler entry. `budgetMs` keeps it well inside the route's 60s limit.
 *
 * Each producer is isolated: one throwing (a bad row, a slow query) is
 * recorded in the result and the others still run, and sending still happens.
 *
 * WITHOUT RESEND_API_KEY NOTHING RUNS AT ALL — not even the queueing. Queued
 * mail would otherwise pile up and then go out stale (yesterday's picks)
 * the moment a key was added.
 */
export type EmailDispatchResult =
  | { ran: false; reason: string }
  | { ran: true; paystack: Awaited<ReturnType<typeof syncPaystackAttempts>>; queued: Record<string, number>; errors: Record<string, string>; send: SendSummary };

const PRODUCERS = {
  receipts: queueReceipts,
  paymentProblems: queuePaymentProblems,
  renewal: queueRenewalNotices,
  dailyPicks: queueDailyPicks,
  adminAlerts: queueAdminPaymentAlerts,
} as const;

export async function runEmailDispatch(opts: { budgetMs: number; now?: Date }): Promise<EmailDispatchResult> {
  if (!process.env.RESEND_API_KEY) return { ran: false, reason: "RESEND_API_KEY not set" };
  const started = Date.now();
  const now = opts.now ?? new Date();

  // First, so a failure observed this hour can be emailed in this same pass.
  const paystack = await syncPaystackAttempts(now);

  const queued: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const [name, produce] of Object.entries(PRODUCERS)) {
    try {
      queued[name] = await produce(now);
    } catch (error) {
      errors[name] = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    }
  }

  const send = await sendDue({ deadline: started + opts.budgetMs });
  return { ran: true, paystack, queued, errors, send };
}

export function summariseEmailDispatch(r: EmailDispatchResult): string {
  if (!r.ran) return `skipped: ${r.reason}`;
  const queued = Object.entries(r.queued).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const errors = Object.keys(r.errors);
  return `queued ${queued}; sent ${r.send.sent}, retried ${r.send.retried}, failed ${r.send.failed}, skipped ${r.send.skipped}, expired ${r.send.expired}${errors.length ? `; errors in ${errors.join(", ")}` : ""}`;
}
