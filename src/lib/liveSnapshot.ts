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
 * THE RULE. The provider is asked by at most one request per
 * LIVE_POLICY.REFRESH_SECONDS, across all instances (a lease row in AppLock,
 * the same claim the European-club sweep uses), and at most
 * LIVE_POLICY.DAILY_CALL_CAP times per UTC day. Everyone else reads the stored
 * copy. So the most this feature can ever spend in a day is the cap, whether
 * one person is watching or a million, and it stands down entirely when the
 * day's quota headroom falls below LIVE_POLICY.MIN_QUOTA_REMAINING.
 *
 * FAILS CLOSED. Any database error means no provider call, never an unmetered
 * one: the reader gets the last copy or nothing.
 */

export const LIVE_POLICY = {
  /** At most one provider call per this many seconds, site-wide. */
  REFRESH_SECONDS: 30,
  /** At most this many provider calls per UTC day (16% of the 7,500 plan). Ten hours of continuous refresh. */
  DAILY_CALL_CAP: 1_200,
  /** Below this much quota left today, live scores stop refreshing so generation keeps its budget. */
  MIN_QUOTA_REMAINING: 1_500,
  /** Per-instance memo of the stored copy, so a burst of readers is one database read. */
  MEMO_MS: 5_000,
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
 * Having won the lease, may this request spend a provider call? Pure.
 * `quotaRemaining` is null when the usage read failed, which refuses: fail closed.
 */
export function mayRefresh(previous: LiveSnapshot, now: Date, quotaRemaining: number | null): { ok: true } | { ok: false; reason: string } {
  if (callsToday(previous, now) >= LIVE_POLICY.DAILY_CALL_CAP) return { ok: false, reason: "daily live-score call cap reached" };
  if (quotaRemaining == null) return { ok: false, reason: "quota unknown" };
  if (quotaRemaining < LIVE_POLICY.MIN_QUOTA_REMAINING) return { ok: false, reason: "quota headroom too low" };
  return { ok: true };
}

/**
 * Claim the refresh lease when it has expired. One statement: the INSERT wins
 * when no row exists and ON CONFLICT ... WHERE only takes an expired one, so a
 * request that gets no row back did not win. The stored copy (holder) is not
 * touched by the claim.
 */
async function claimRefresh(now: Date): Promise<LiveSnapshot | null> {
  const expiresAt = new Date(now.getTime() + LIVE_POLICY.REFRESH_SECONDS * 1_000);
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
    const previous = await claimRefresh(now);
    if (!previous) {
      snapshot = await readStored();
    } else {
      const usage = await getUsageSnapshot().catch(() => null);
      const verdict = mayRefresh(previous, now, usage ? usage.remaining : null);
      if (!verdict.ok) {
        snapshot = previous;
      } else {
        // Counted before the call, like recordCall: a timeout is still spent.
        const calls = callsToday(previous, now) + 1;
        const fetched = await getLiveFixtures();
        snapshot = fetched
          ? { version: 1, day: utcDay(now), calls, fetchedAt: now.toISOString(), rows: fetched.map(trimLiveRow) }
          : { ...previous, day: utcDay(now), calls };
        await prisma.appLock.update({ where: { key: LIVE_SNAPSHOT_KEY }, data: { holder: JSON.stringify(snapshot) } });
      }
    }
  } catch (err) {
    console.error("[live-snapshot] failed; serving the last copy without calling the provider", err);
    snapshot = memo?.snapshot ?? EMPTY;
  }
  memo = { at: now.getTime(), snapshot };
  return snapshot;
}
