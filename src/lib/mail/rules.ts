import { isPaidTier } from "@/lib/entitlement";
import type { PaymentProblem } from "@/lib/mail/templates";

/**
 * The decisions behind the automatic emails, as pure functions with no
 * database or framework imports, so scripts/check-email.ts can assert every
 * rule directly. lib/mail/producers applies them to live data.
 */

const DAY = 24 * 60 * 60_000;
const OUR_REFERENCE = /^bg_(VIP|PREMIUM)_[0-9a-f]{32}$/;

export const REMINDER_LEAD_MS = 3 * DAY;

export const PROBLEM_CATEGORIES: PaymentProblem[] = ["ABANDONED", "ISSUER_DECLINE", "INSUFFICIENT_FUNDS", "FRAUD_BLOCK", "GATEWAY_FAILURE", "UNKNOWN_FAILURE"];
export const PROBLEM_DELAY_MS = 45 * 60_000;

export type ProblemAttempt = { reference: string; userId: string | null; tier: string | null; category: string; occurredAt: Date };

/**
 * Which attempts deserve a payment-problem email: pure, so the rules are
 * asserted in scripts/check-email.ts. One per user — their most recent
 * problem — and only if nothing they did afterwards succeeded.
 */
export function problemsToEmail(attempts: ProblemAttempt[], successes: { userId: string | null; occurredAt: Date }[], now: Date): ProblemAttempt[] {
  const latest = new Map<string, ProblemAttempt>();
  for (const a of attempts) {
    if (!a.userId || !OUR_REFERENCE.test(a.reference) || !isPaidTier(a.tier)) continue;
    if (!(PROBLEM_CATEGORIES as string[]).includes(a.category)) continue;
    if (now.getTime() - a.occurredAt.getTime() < PROBLEM_DELAY_MS) continue;
    const prev = latest.get(a.userId);
    if (!prev || prev.occurredAt < a.occurredAt) latest.set(a.userId, a);
  }
  return [...latest.values()].filter((a) => !successes.some((s) => s.userId === a.userId && s.occurredAt >= a.occurredAt));
}

export const DAILY_PICKS_FROM_HOUR = 9;
export const DAILY_PICKS_UNTIL_HOUR = 20;

export function lagosHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(now)) % 24;
}

export function inDailyPicksWindow(now: Date): boolean {
  const hour = lagosHour(now);
  return hour >= DAILY_PICKS_FROM_HOUR && hour < DAILY_PICKS_UNTIL_HOUR;
}
