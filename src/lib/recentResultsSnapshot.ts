import { prisma } from "@/lib/prisma";
import { getFixturesByDate, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot, utcDay } from "@/lib/football/usage";
import { GENERATION_TIERS, isSeniorWomensCompetition, leaguePriorityRank } from "@/lib/leagues";
import { tabOfStatus } from "@/lib/matchStatus";
import { trimLiveRow } from "@/lib/liveSnapshot";

/**
 * The homepage's Recent results, from one shared copy.
 *
 * WHY. The block used to fetch today's and yesterday's full slates
 * (/api/fixtures, 700-1,400 rows each) from the reader's browser on every
 * homepage view: two provider calls per visitor, and when a call failed or
 * the quota was tight the block quietly showed "nothing has finished". Now the
 * server keeps one stored copy of the finished matches that matter, refreshed
 * by at most one request per RECENT_POLICY.REFRESH_MINUTES site-wide (an
 * AppLock lease, as in liveSnapshot.ts), at most DAILY_CALL_CAP provider calls
 * a day, never when quota headroom is low, and never on a database error.
 *
 * WHICH MATCHES. Every men's CORE and SECONDARY competition: the top leagues,
 * the European club competitions, the Championship and the credible mid-tier
 * leagues the site generates for daily. European club competitions first, then
 * competition priority, most recent first within each (resultsRank).
 */

export const RECENT_POLICY = {
  /** At most one refresh (two provider calls) per this many minutes, site-wide. */
  REFRESH_MINUTES: 15,
  /** Provider calls per UTC day: 2 per refresh, so 96 refreshes would be 192. */
  DAILY_CALL_CAP: 200,
  /** Below this much quota left today, the copy stops refreshing. */
  MIN_QUOTA_REMAINING: 1_500,
  /** How far back a result stays on the homepage. */
  WINDOW_HOURS: 36,
  MEMO_MS: 30_000,
} as const;

export const RECENT_SNAPSHOT_KEY = "recent-results-snapshot";

export type RecentSnapshot = { version: 1; day: string; calls: number; fetchedAt: string | null; rows: FixtureRow[] };
const EMPTY: RecentSnapshot = { version: 1, day: "", calls: 0, fetchedAt: null, rows: [] };

export function parseRecentSnapshot(raw: string | null | undefined): RecentSnapshot {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw);
    return v?.version === 1 && Array.isArray(v.rows) ? (v as RecentSnapshot) : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Men's top and mid-tier competitions: the leagues the site covers every day. */
export const RESULTS_LEAGUE_IDS: ReadonlySet<number> = new Set(
  [...GENERATION_TIERS.CORE, ...GENERATION_TIERS.SECONDARY].filter((id) => !isSeniorWomensCompetition(id)),
);

/** What the homepage shows from a slate: finished, in scope, inside the window, best competitions first. Pure. */
export function selectRecentResults(rows: readonly FixtureRow[], now: Date): FixtureRow[] {
  const cutoff = now.getTime() - RECENT_POLICY.WINDOW_HOURS * 3_600_000;
  const byId = new Map<number, FixtureRow>();
  for (const r of rows) {
    if (!RESULTS_LEAGUE_IDS.has(r.league.id)) continue;
    // tabOfStatus excludes postponed/cancelled/abandoned: they are not results.
    if (tabOfStatus(r.fixture.status.short) !== "finished") continue;
    const t = new Date(r.fixture.date).getTime();
    if (Number.isNaN(t) || t < cutoff || t > now.getTime()) continue;
    byId.set(r.fixture.id, r);
  }
  return [...byId.values()].sort(
    (a, b) =>
      resultsRank(a.league.id) - resultsRank(b.league.id) ||
      new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime(),
  );
}

/**
 * Display order: the European club competitions lead (a Champions League
 * night is the headline), then the site's competition priority. That order
 * alone would put the Championship and the English cups above the UCL.
 */
const EUROPEAN_FIRST: readonly number[] = [2, 3, 848];
export function resultsRank(leagueApiId: number): number {
  const european = EUROPEAN_FIRST.indexOf(leagueApiId);
  return european >= 0 ? european - EUROPEAN_FIRST.length : leaguePriorityRank(leagueApiId);
}

export function recentCallsToday(s: RecentSnapshot, now: Date): number {
  return s.day === utcDay(now) ? s.calls : 0;
}

/** Having won the lease, may this refresh spend its two calls? Pure; null quota refuses (fails closed). */
export function mayRefreshRecent(previous: RecentSnapshot, now: Date, quotaRemaining: number | null): boolean {
  return (
    recentCallsToday(previous, now) + 2 <= RECENT_POLICY.DAILY_CALL_CAP &&
    quotaRemaining != null &&
    quotaRemaining >= RECENT_POLICY.MIN_QUOTA_REMAINING
  );
}

async function claimRefresh(now: Date): Promise<RecentSnapshot | null> {
  const expiresAt = new Date(now.getTime() + RECENT_POLICY.REFRESH_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${RECENT_SNAPSHOT_KEY}, ${JSON.stringify(EMPTY)}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows.length ? parseRecentSnapshot(rows[0].holder) : null;
}

let memo: { at: number; snapshot: RecentSnapshot } | null = null;

async function getRecentSnapshot(now: Date): Promise<RecentSnapshot> {
  if (memo && now.getTime() - memo.at < RECENT_POLICY.MEMO_MS) return memo.snapshot;
  let snapshot: RecentSnapshot;
  try {
    const previous = await claimRefresh(now);
    if (!previous) {
      const row = await prisma.appLock.findUnique({ where: { key: RECENT_SNAPSHOT_KEY }, select: { holder: true } });
      snapshot = parseRecentSnapshot(row?.holder);
    } else {
      const usage = await getUsageSnapshot().catch(() => null);
      if (!mayRefreshRecent(previous, now, usage ? usage.remaining : null)) {
        snapshot = previous;
      } else {
        const dates = [utcDay(new Date(now.getTime() - 86_400_000)), utcDay(now)];
        const slates = await Promise.all(dates.map((d) => getFixturesByDate(d)));
        const calls = recentCallsToday(previous, now) + dates.length;
        snapshot = slates.every((s) => s === null)
          ? { ...previous, day: utcDay(now), calls }
          : {
              version: 1,
              day: utcDay(now),
              calls,
              fetchedAt: now.toISOString(),
              // Stored already narrowed and trimmed: dozens of rows, not thousands.
              rows: selectRecentResults(slates.flatMap((s) => s ?? []), now).map(trimLiveRow),
            };
        await prisma.appLock.update({ where: { key: RECENT_SNAPSHOT_KEY }, data: { holder: JSON.stringify(snapshot) } });
      }
    }
  } catch (err) {
    console.error("[recent-results] failed; serving the last copy without calling the provider", err);
    snapshot = memo?.snapshot ?? EMPTY;
  }
  memo = { at: now.getTime(), snapshot };
  return snapshot;
}

/** The homepage's finished matches, from the shared copy, re-filtered to the window at read time. */
export async function getRecentResults(now: Date = new Date()): Promise<FixtureRow[]> {
  return selectRecentResults((await getRecentSnapshot(now)).rows, now);
}
