import { prisma } from "@/lib/prisma";
import { getLiveFixtures, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot, utcDay } from "@/lib/football/usage";

/**
 * One shared copy of the in-play scores, for every reader on every page.
 *
 * THE PROBLEM. /api/livescores called api-football once per request, and every
 * open Livescores page and match page polled it, so the provider bill grew with
 * the audience: a thousand readers on a busy evening could spend the whole
 * 7,500-call day.
 *
 * THE RULE. The provider is asked by at most one request per refresh
 * interval, across all instances (a lease row in AppLock, the same claim the
 * European-club sweep uses). Everyone else reads the stored copy, so readers
 * never add calls.
 *
 * THE INTERVAL is as short as LIVE_POLICY.MIN_REFRESH_SECONDS while the day's
 * quota allows, and stretches only as the quota runs down: the calls left
 * above LIVE_POLICY.GENERATION_RESERVE are spread evenly over the rest of the
 * UTC day (refreshIntervalSeconds). So scores stay as fresh as the plan can
 * pay for all day, instead of the copy freezing once a fixed cap is hit, and
 * live scores can never spend the reserve generation needs.
 *
 * WHY NOT A FIXED CAP (the first version, #88): a 1,200-call cap at 30 s ran
 * out after ten hours of traffic, and a 1,500-call headroom floor stopped
 * refreshes outright on a heavy generation day. Either froze every live score
 * on the site at its last value until the next UTC day.
 *
 * FAILS CLOSED. Any database error means no provider call, never an unmetered
 * one: the reader gets the last copy or nothing.
 */

export const LIVE_POLICY = {
  /** The fastest refresh: one provider call per this many seconds, site-wide. */
  MIN_REFRESH_SECONDS: 15,
  /** Calls live scores never touch, kept for prediction generation and settlement. */
  GENERATION_RESERVE: 1_000,
  /** Per-instance memo of the stored copy, so a burst of readers is one database read. */
  MEMO_MS: 3_000,
} as const;

export const LIVE_SNAPSHOT_KEY = "live-snapshot";

export type LiveSnapshot = {
  version: 1;
  /** UTC day the call count belongs to. */
  day: string;
  /** Provider calls made for live scores on `day`. */
  calls: number;
  /** When the rows were last fetched; null before the first fetch. */
  fetchedAt: string | null;
  rows: FixtureRow[];
};

const EMPTY: LiveSnapshot = { version: 1, day: "", calls: 0, fetchedAt: null, rows: [] };

export function parseLiveSnapshot(raw: string | null | undefined): LiveSnapshot {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw);
    return v?.version === 1 && Array.isArray(v.rows) ? (v as LiveSnapshot) : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Only what the score views read: no venue, referee or score breakdown. Keeps the stored row small. */
export function trimLiveRow(r: FixtureRow): FixtureRow {
  return {
    fixture: { id: r.fixture.id, date: r.fixture.date, status: { short: r.fixture.status.short, elapsed: r.fixture.status.elapsed ?? null } },
    league: { id: r.league.id, name: r.league.name, country: r.league.country, logo: r.league.logo, season: r.league.season, round: r.league.round ?? null },
    teams: {
      home: { id: r.teams.home.id, name: r.teams.home.name, logo: r.teams.home.logo },
      away: { id: r.teams.away.id, name: r.teams.away.name, logo: r.teams.away.logo },
    },
    goals: { home: r.goals.home, away: r.goals.away },
  };
}

/** Calls already spent today, from the stored copy. A copy from an earlier UTC day counts as zero. */
export function callsToday(snapshot: LiveSnapshot, now: Date): number {
  return snapshot.day === utcDay(now) ? snapshot.calls : 0;
}

/**
 * Seconds between refreshes, from the quota left today. Pure.
 *
 * The calls above GENERATION_RESERVE are spread evenly over the seconds left
 * in the UTC day, never faster than MIN_REFRESH_SECONDS. Null (no refresh)
 * only when nothing is left above the reserve, or when the quota cannot be
 * read: fails closed.
 */
export function refreshIntervalSeconds(quotaRemaining: number | null, now: Date): number | null {
  if (quotaRemaining == null) return null;
  const budget = quotaRemaining - LIVE_POLICY.GENERATION_RESERVE;
  if (budget <= 0) return null;
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const secondsLeft = Math.max(1, (midnight - now.getTime()) / 1_000);
  return Math.max(LIVE_POLICY.MIN_REFRESH_SECONDS, Math.ceil(secondsLeft / budget));
}

/**
 * Claim the refresh lease when it has expired. One statement: the INSERT wins
 * when no row exists and ON CONFLICT ... WHERE only takes an expired one, so a
 * request that gets no row back did not win. The stored copy (holder) is not
 * touched by the claim.
 */
async function claimRefresh(now: Date, intervalSeconds: number): Promise<LiveSnapshot | null> {
  const expiresAt = new Date(now.getTime() + intervalSeconds * 1_000);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${LIVE_SNAPSHOT_KEY}, ${JSON.stringify(EMPTY)}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows.length ? parseLiveSnapshot(rows[0].holder) : null;
}

async function readStored(): Promise<LiveSnapshot> {
  const row = await prisma.appLock.findUnique({ where: { key: LIVE_SNAPSHOT_KEY }, select: { holder: true } });
  return parseLiveSnapshot(row?.holder);
}

let memo: { at: number; snapshot: LiveSnapshot } | null = null;

/** The in-play scores, from the shared copy, refreshed from the provider only within LIVE_POLICY. */
export async function getLiveSnapshot(now: Date = new Date()): Promise<LiveSnapshot> {
  if (memo && now.getTime() - memo.at < LIVE_POLICY.MEMO_MS) return memo.snapshot;
  let snapshot: LiveSnapshot;
  try {
    const usage = await getUsageSnapshot().catch(() => null);
    const interval = refreshIntervalSeconds(usage ? usage.remaining : null, now);
    const previous = interval == null ? null : await claimRefresh(now, interval);
    if (!previous) {
      snapshot = await readStored();
    } else {
      // Counted before the call, like recordCall: a timeout is still spent.
      // The count is for visibility only; the interval is what bounds spend.
      const calls = callsToday(previous, now) + 1;
      const fetched = await getLiveFixtures();
      snapshot = fetched
        ? { version: 1, day: utcDay(now), calls, fetchedAt: now.toISOString(), rows: fetched.map(trimLiveRow) }
        : { ...previous, day: utcDay(now), calls };
      await prisma.appLock.update({ where: { key: LIVE_SNAPSHOT_KEY }, data: { holder: JSON.stringify(snapshot) } });
    }
  } catch (err) {
    console.error("[live-snapshot] failed; serving the last copy without calling the provider", err);
    snapshot = memo?.snapshot ?? EMPTY;
  }
  memo = { at: now.getTime(), snapshot };
  return snapshot;
}
