/**
 * Daily quota accounting for api-football.
 *
 * The Pro plan caps usage at 7,500 requests/day (resetting at UTC midnight) on
 * top of the 300/min rate limit that api-football.ts's MIN_GAP_MS throttle
 * paces. Those two limits need different mechanisms: the per-minute cap is a
 * pacing problem one instance can solve locally, but the daily cap is a shared
 * budget across every serverless instance, so it lives in the database (see the
 * ApiUsage model) and is incremented atomically per request.
 *
 * Why this matters now: a single prediction generation costs ~11 API calls
 * (2x searchTeam, 2x getTeamContext at 3 calls each, standings, h2h,
 * resolveSeason), so a 20-fixture bulk run is ~220 calls. At the 240 req/min
 * the throttle now permits, the daily budget is exhaustible in ~31 minutes of
 * sustained bulk generation — previously impossible under the old 6.5s gap.
 */
import { prisma } from "@/lib/prisma";

/** api-football's quota day rolls over at UTC midnight. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Plan ceiling. Overridable so a plan change doesn't need a code deploy, and so
 * the limit can be dialled down to leave headroom for other consumers of the
 * same key.
 */
export const DAILY_LIMIT = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;

/**
 * Requests held back from the ceiling. Local counting can drift below the
 * account's real usage (calls made outside this app, or an instance dying
 * between dispatching a request and recording it), so stopping short of the
 * true limit keeps that drift from turning into hard 429s mid-run.
 */
export const RESERVE = Number(process.env.API_FOOTBALL_DAILY_RESERVE) || 100;

export type UsageSnapshot = {
  day: string;
  used: number;
  limit: number;
  reserve: number;
  remaining: number;
  byPath: Array<{ path: string; count: number }>;
};

/** Total requests recorded for a day. Cheap enough to run per-call at this volume. */
export async function usedToday(day: string = utcDay()): Promise<number> {
  const agg = await prisma.apiUsage.aggregate({ where: { day }, _sum: { count: true } });
  return agg._sum.count ?? 0;
}

/** Full breakdown for the admin usage endpoint. */
export async function getUsageSnapshot(day: string = utcDay()): Promise<UsageSnapshot> {
  const rows = await prisma.apiUsage.findMany({
    where: { day },
    select: { path: true, count: true },
    orderBy: { count: "desc" },
  });
  const used = rows.reduce((sum, r) => sum + r.count, 0);
  return {
    day,
    used,
    limit: DAILY_LIMIT,
    reserve: RESERVE,
    remaining: Math.max(0, DAILY_LIMIT - RESERVE - used),
    byPath: rows,
  };
}

/**
 * Atomic per-endpoint increment. Uses upsert's `increment` rather than a
 * read-modify-write so concurrent instances can't clobber each other's counts.
 *
 * Never throws: a usage-tracking failure must not take down the actual API call
 * that succeeded. A dropped increment under-counts (fails open), which the
 * /status reconciliation in reconcileWithAccount() is there to correct.
 */
export async function recordCall(path: string, day: string = utcDay()): Promise<void> {
  try {
    await prisma.apiUsage.upsert({
      where: { day_path: { day, path } },
      create: { day, path, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    console.error("[api-football/usage] failed to record call", path, err);
  }
}

/**
 * True when there's budget left to spend. Callers should treat `false` as a
 * hard stop for the rest of the UTC day, not a retryable condition.
 *
 * Fails OPEN. This gate sits in front of every api-football request, so a
 * database blip (or a deploy that lands before `prisma db push` creates the
 * ApiUsage table) would otherwise black out the entire football integration —
 * a far worse outcome than briefly spending unmetered against a 7,500/day
 * ceiling. getUsageSnapshot() deliberately does NOT do this: it only backs
 * admin-facing reads, where a visible error beats a confidently wrong
 * "remaining" figure.
 */
export async function hasBudget(day: string = utcDay()): Promise<boolean> {
  try {
    return (await usedToday(day)) < DAILY_LIMIT - RESERVE;
  } catch (err) {
    console.error("[api-football/usage] budget check failed — allowing request", err);
    return true;
  }
}

/**
 * Align local counts with the account's authoritative `requests.current` from
 * /status. Local tracking only ever under-counts (untracked callers, lost
 * increments), so this corrects upward only — writing a lower number would
 * hand back budget the account has genuinely already spent.
 *
 * The adjustment lands on a synthetic "(reconciled)" path so it stays visible
 * as drift in the breakdown instead of silently inflating a real endpoint.
 */
export async function reconcileWithAccount(accountCurrent: number, day: string = utcDay()): Promise<{ adjusted: number }> {
  const local = await usedToday(day);
  const drift = accountCurrent - local;
  if (drift <= 0) return { adjusted: 0 };
  await prisma.apiUsage.upsert({
    where: { day_path: { day, path: "(reconciled)" } },
    create: { day, path: "(reconciled)", count: drift },
    update: { count: { increment: drift } },
  });
  return { adjusted: drift };
}
