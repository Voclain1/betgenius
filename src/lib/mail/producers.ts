import { prisma } from "@/lib/prisma";
import { hasActivePaidAccess, isPaidTier } from "@/lib/entitlement";
import { lagosDateKey, lagosDayLabel } from "@/lib/lagosDate";
import { getCategoryPredictions } from "@/lib/categoryPredictions";
import { matchSlug } from "@/lib/slug";
import { listTransactions } from "@/lib/paystack/paystack";
import { recordPaymentAttempt } from "@/lib/paystack/recordPaymentAttempt";
import { JOB_PAYSTACK_SYNC, recordJobRun } from "@/lib/jobRuns";
import { existingKeys, queueEmails, unsubscribeUrl, type QueueInput } from "@/lib/mail/outbox";
import {
  absoluteUrl,
  accessEndedEmail,
  adminPaymentAlertEmail,
  dailyPicksEmail,
  paymentProblemEmail,
  receiptEmail,
  renewalReminderEmail,
  type PickLine,
} from "@/lib/mail/templates";
import type { PaidTier } from "@/lib/pricing";
import { PROBLEM_CATEGORIES, REMINDER_LEAD_MS, inDailyPicksWindow, lagosHour, problemFor, problemsToEmail, type ProblemAttempt } from "@/lib/mail/rules";

/**
 * The automatic emails. Each producer asks one question of the live data —
 * "who should have had this email by now?" — and queues the answer under a
 * key that makes it impossible to send twice. They run every couple of minutes
 * from the notifications dispatch cron (see lib/mail/dispatch), so each one
 * only looks back over a short window: a deploy never mails out a backlog of
 * old events.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const OUR_REFERENCE = /^bg_(VIP|PREMIUM)_[0-9a-f]{32}$/;

// ---------------------------------------------------------------------------
// Paystack sync. Paystack only sends a webhook for SUCCESSFUL payments, so a
// declined or abandoned checkout is invisible until something asks. This asks,
// read-only, once an hour — the same listing the admin "Reconcile from
// Paystack" button uses. It records what it sees and changes nothing else:
// no grants, no retries.
// ---------------------------------------------------------------------------

export async function syncPaystackAttempts(now: Date): Promise<{ ran: boolean; recorded: number; reason?: string }> {
  if (!process.env.PAYSTACK_SECRET_KEY) return { ran: false, recorded: 0, reason: "PAYSTACK_SECRET_KEY not set" };
  // Any attempt counts, failed ones included: a revoked key should cost one
  // request an hour, not one every two minutes.
  const last = await prisma.jobRun.findFirst({ where: { job: JOB_PAYSTACK_SYNC }, orderBy: { ranAt: "desc" }, select: { ranAt: true } });
  if (last && now.getTime() - last.ranAt.getTime() < 55 * 60_000) return { ran: false, recorded: 0, reason: "tried within the hour" };
  const started = Date.now();
  try {
    const listed = await listTransactions(50);
    for (const transaction of listed.data ?? []) await recordPaymentAttempt(transaction, "RECONCILE");
    const recorded = listed.data?.length ?? 0;
    await recordJobRun({ job: JOB_PAYSTACK_SYNC, ok: true, summary: `recorded ${recorded}`, ms: Date.now() - started });
    return { ran: true, recorded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun({ job: JOB_PAYSTACK_SYNC, ok: false, summary: `threw: ${message.slice(0, 200)}`, ms: Date.now() - started });
    return { ran: false, recorded: 0, reason: message };
  }
}

// ---------------------------------------------------------------------------
// Receipts: one per payment that actually granted access. Read from the
// exactly-once ledger (PaymentAttempt.entitlementGrantedAt), so it fires for
// the webhook, the payer's return and an admin reconcile alike, and never for
// a payment that was refused.
// ---------------------------------------------------------------------------

export async function queueReceipts(now: Date): Promise<number> {
  const granted = await prisma.paymentAttempt.findMany({
    where: { entitlementGrantedAt: { gte: new Date(now.getTime() - 2 * DAY) }, userId: { not: null } },
    select: { reference: true, userId: true, tier: true, amountKobo: true, paidAt: true, entitlementGrantedAt: true },
    take: 200,
  });
  const done = await existingKeys(granted.map((g) => `receipt:${g.reference}`));
  const todo = granted.filter((g) => !done.has(`receipt:${g.reference}`) && isPaidTier(g.tier));
  if (todo.length === 0) return 0;
  const users = await usersById(todo.map((g) => g.userId!));
  const queue: QueueInput[] = [];
  for (const g of todo) {
    const user = users.get(g.userId!);
    if (!user) continue;
    const accessUntil = user.subscription?.currentPeriodEnd ?? null;
    queue.push({
      key: `receipt:${g.reference}`,
      kind: "RECEIPT",
      userId: user.id,
      to: user.email,
      email: receiptEmail({
        tier: g.tier as PaidTier,
        amountNgn: Math.round((g.amountKobo ?? 0) / 100),
        reference: g.reference,
        paidAt: g.paidAt ?? g.entitlementGrantedAt!,
        accessUntil,
      }),
    });
  }
  return queueEmails(queue);
}

// ---------------------------------------------------------------------------
// Payment problems: a checkout of ours that was declined, blocked or left
// unfinished. Waits PROBLEM_DELAY before writing, because people retry, and a
// "your payment failed" email that lands after they have already paid is
// worse than none. At most one per person per Lagos day, none if they have
// paid since, and none to someone who already has access.
// ---------------------------------------------------------------------------

export async function queuePaymentProblems(now: Date): Promise<number> {
  const since = new Date(now.getTime() - DAY);
  const [attempts, successes] = await Promise.all([
    prisma.paymentAttempt.findMany({
      where: { occurredAt: { gte: since }, category: { in: PROBLEM_CATEGORIES } },
      select: { reference: true, userId: true, tier: true, category: true, gatewayResponse: true, occurredAt: true },
      take: 500,
    }),
    prisma.paymentAttempt.findMany({ where: { occurredAt: { gte: since }, status: "success" }, select: { userId: true, occurredAt: true } }),
  ]);
  const candidates = problemsToEmail(attempts, successes, now);
  if (candidates.length === 0) return 0;
  const keyFor = (a: ProblemAttempt) => `payment-problem:${a.userId}:${lagosDateKey(a.occurredAt)}`;
  const done = await existingKeys(candidates.map(keyFor));
  const todo = candidates.filter((a) => !done.has(keyFor(a)));
  if (todo.length === 0) return 0;
  const users = await usersById(todo.map((a) => a.userId!));
  // No more than one of these every three days, whatever the dates say.
  const recent = await prisma.emailMessage.findMany({
    where: { kind: "PAYMENT_PROBLEM", userId: { in: todo.map((a) => a.userId!) }, createdAt: { gte: new Date(now.getTime() - 3 * DAY) } },
    select: { userId: true },
  });
  const recentlyMailed = new Set(recent.map((r) => r.userId));
  const queue: QueueInput[] = [];
  for (const a of todo) {
    const user = users.get(a.userId!);
    if (!user || recentlyMailed.has(user.id) || hasActivePaidAccess(user.subscription, now)) continue;
    queue.push({
      key: keyFor(a),
      kind: "PAYMENT_PROBLEM",
      userId: user.id,
      to: user.email,
      email: paymentProblemEmail({ tier: a.tier as PaidTier, problem: problemFor(a), reference: a.reference }),
      expiresAt: new Date(now.getTime() + DAY),
    });
  }
  return queueEmails(queue);
}

// ---------------------------------------------------------------------------
// Renewal: nothing renews automatically, so a subscriber hears three days
// before their access ends, and once more when it has. Both are keyed on the
// period end, so renewing (which moves it) naturally starts a fresh cycle.
// ---------------------------------------------------------------------------

export async function queueRenewalNotices(now: Date): Promise<number> {
  const rows = await prisma.subscription.findMany({
    where: {
      tier: { in: ["VIP", "PREMIUM"] },
      status: "ACTIVE",
      currentPeriodEnd: { gt: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
    },
    select: { userId: true, tier: true, currentPeriodEnd: true, user: { select: { email: true } } },
  });
  const queue: QueueInput[] = [];
  for (const r of rows) {
    const end = r.currentPeriodEnd!;
    const ended = end.getTime() <= now.getTime();
    queue.push(
      ended
        ? { key: `access-ended:${r.userId}:${end.getTime()}`, kind: "ACCESS_ENDED", userId: r.userId, to: r.user.email, email: accessEndedEmail({ tier: r.tier as PaidTier }), expiresAt: new Date(end.getTime() + 2 * DAY) }
        : { key: `renewal:${r.userId}:${end.getTime()}`, kind: "RENEWAL_REMINDER", userId: r.userId, to: r.user.email, email: renewalReminderEmail({ tier: r.tier as PaidTier, endsAt: end }), expiresAt: end },
    );
  }
  const done = await existingKeys(queue.map((q) => q.key));
  return queueEmails(queue.filter((q) => !done.has(q.key)));
}

// ---------------------------------------------------------------------------
// Daily picks: once a Lagos day, from DAILY_PICKS_FROM_HOUR, to everyone with
// live paid access who has not switched it off. The picks are the same rows
// the VIP/Premium feeds show, limited to matches that have not kicked off.
// A day with no picks sends nothing; if picks are published later in the day,
// the next run sends them, until DAILY_PICKS_UNTIL_HOUR.
// ---------------------------------------------------------------------------

type PickRow = Awaited<ReturnType<typeof getCategoryPredictions>>[number];

function toPickLine(p: PickRow, fallbackHref: string): PickLine | null {
  const home = p.homeTeam ?? p.fixture?.homeTeam?.name;
  const away = p.awayTeam ?? p.fixture?.awayTeam?.name;
  if (!home || !away || !p.kickoff) return null;
  const slug = matchSlug({ homeTeam: home, awayTeam: away, kickoff: p.kickoff });
  return {
    home,
    away,
    league: p.leagueName ?? p.fixture?.league?.name ?? null,
    kickoff: p.kickoff,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    href: absoluteUrl(slug ? `/predictions/match/${slug}` : fallbackHref),
  };
}

export async function queueDailyPicks(now: Date): Promise<number> {
  if (!inDailyPicksWindow(now)) return 0;
  const date = lagosDateKey(now);
  const subscribers = await prisma.subscription.findMany({
    where: { tier: { in: ["VIP", "PREMIUM"] }, status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] },
    select: { userId: true, tier: true, user: { select: { email: true, emailPreference: { select: { dailyPicks: true } } } } },
  });
  const wanting = subscribers.filter((s) => s.user.emailPreference?.dailyPicks !== false);
  const done = await existingKeys(wanting.map((s) => `daily-picks:${s.userId}:${date}`));
  const todo = wanting.filter((s) => !done.has(`daily-picks:${s.userId}:${date}`));
  if (todo.length === 0) return 0;

  const upcoming = (rows: PickRow[], href: string) =>
    rows.filter((r) => r.kickoff && r.kickoff > now).map((r) => toPickLine(r, href)).filter((l): l is PickLine => l != null);
  const vip = upcoming(await getCategoryPredictions("VIP", "today"), "/predictions/vip");
  const premiumOnly = todo.some((s) => s.tier === "PREMIUM") ? upcoming(await getCategoryPredictions("PREMIUM", "today"), "/predictions/premium") : [];
  // Premium can read VIP too (lib/access), so it gets both, without repeats.
  const seen = new Set(premiumOnly.map((l) => l.href + l.market + l.pick));
  const premium = [...premiumOnly, ...vip.filter((l) => !seen.has(l.href + l.market + l.pick))].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());

  const dateLabel = lagosDayLabel(0, now);
  const endOfDay = new Date(now.getTime() + (24 - lagosHour(now)) * HOUR);
  const queue: QueueInput[] = [];
  for (const s of todo) {
    const tier = s.tier as PaidTier;
    const picks = tier === "PREMIUM" ? premium : vip;
    if (picks.length === 0) continue;
    queue.push({
      key: `daily-picks:${s.userId}:${date}`,
      kind: "DAILY_PICKS",
      userId: s.userId,
      to: s.user.email,
      unsubscribeKind: "dailyPicks",
      expiresAt: endOfDay,
      email: dailyPicksEmail({
        tier,
        dateLabel,
        picks,
        unsubscribeUrl: unsubscribeUrl(s.userId, "dailyPicks"),
        feedHref: absoluteUrl(tier === "PREMIUM" ? "/predictions/premium" : "/predictions/vip"),
      }),
    });
  }
  return queueEmails(queue);
}

// ---------------------------------------------------------------------------
// Admin alert: Paystack says a BetGenius checkout was paid, and no access was
// granted for it half an hour later. This is the "charged and locked out"
// case, and it is the one an admin must hear about without having to look.
// ---------------------------------------------------------------------------

export async function queueAdminPaymentAlerts(now: Date): Promise<number> {
  const stuck = await prisma.paymentAttempt.findMany({
    where: {
      status: "success",
      entitlementGrantedAt: null,
      reference: { startsWith: "bg_" },
      occurredAt: { gte: new Date(now.getTime() - 7 * DAY), lte: new Date(now.getTime() - 30 * 60_000) },
    },
    select: { reference: true, tier: true, amountKobo: true, entitlementError: true, verifyError: true },
    take: 50,
  });
  if (stuck.length === 0) return 0;
  const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true, email: true } });
  const queue: QueueInput[] = [];
  for (const s of stuck) {
    if (!OUR_REFERENCE.test(s.reference)) continue;
    for (const admin of admins) {
      queue.push({
        key: `admin-payment-alert:${s.reference}:${admin.id}`,
        kind: "ADMIN_ALERT",
        userId: admin.id,
        to: admin.email,
        email: adminPaymentAlertEmail({
          reference: s.reference,
          tier: s.tier,
          amountNgn: s.amountKobo != null ? Math.round(s.amountKobo / 100) : null,
          problem: s.entitlementError ? `refused (${s.entitlementError})` : s.verifyError ? `verification failed (${s.verifyError})` : "no grant recorded yet",
        }),
      });
    }
  }
  const done = await existingKeys(queue.map((q) => q.key));
  return queueEmails(queue.filter((q) => !done.has(q.key)));
}

// ---------------------------------------------------------------------------

async function usersById(ids: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, email: true, subscription: { select: { tier: true, status: true, currentPeriodEnd: true } } },
  });
  return new Map(users.map((u) => [u.id, u]));
}
