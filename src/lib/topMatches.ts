import { prisma } from "@/lib/prisma";
import { getFixturesByDate, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot, utcDay } from "@/lib/football/usage";
import { GENERATION_TIERS, isSeniorWomensCompetition } from "@/lib/leagues";
import { tabOfStatus, classifyStatus } from "@/lib/matchStatus";
import { trimLiveRow } from "@/lib/liveSnapshot";
import { resultsRank } from "@/lib/recentResultsSnapshot";
import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";
import { matchKey } from "@/lib/slug";

/**
 * The homepage's Top matches strip: the day's three or four biggest games,
 * live, upcoming or finished, as score cards under the top banner.
 *
 * WHICH DAY. Today's Lagos day while it has a top match at all, finished
 * ones included, so a Sunday evening still shows the afternoon's results.
 * A day with none (a quiet midweek, an international break with no
 * qualifiers) shows tomorrow's instead, labelled as such. With neither, the
 * homepage drops the section rather than show an empty box.
 *
 * WHICH MATCHES. Men's headline competitions only (TOP_MATCH_LEAGUE_IDS).
 * Within those, a game with one of the biggest clubs in it outranks one
 * without, then the European club competitions and competition priority
 * lead (resultsRank), then a game we have published analysis for, then
 * kickoff. At most two per competition while others are available, so a
 * Saturday does not fill all four with Premier League games. Status never
 * enters the ranking, so the same four stay from the morning to full time.
 *
 * WHERE FROM. One shared stored copy, like Recent results
 * (recentResultsSnapshot.ts): at most one refresh per REFRESH_MINUTES
 * site-wide, one provider call for today's slate and a second for tomorrow's
 * only when today has nothing to show, under a daily cap and a quota floor,
 * and never on a database error. Live minutes and scores between refreshes
 * come from the shared live snapshot, on the server here and polled by the
 * cards in the browser.
 */

export const TOP_MATCHES_POLICY = {
  REFRESH_MINUTES: 10,
  /** One or two calls per refresh; 144 refreshes a day is at most 288. */
  DAILY_CALL_CAP: 300,
  MIN_QUOTA_REMAINING: 1_500,
  LIMIT: 4,
  PER_COMPETITION: 2,
  MEMO_MS: 30_000,
} as const;

export const TOP_MATCHES_SNAPSHOT_KEY = "top-matches-snapshot";

/** Men's headline competitions: the top five leagues and their cups, Europe, and national-team tournaments and qualifiers. */
export const TOP_MATCH_LEAGUE_IDS: ReadonlySet<number> = new Set(
  [...GENERATION_TIERS.CORE, 5, 32, 34, 29, 36].filter((id) => !isSeniorWomensCompetition(id)),
);

/**
 * The clubs whose games are the day's headline wherever they play. API-Football
 * team ids: a game with one of them ranks above a game without, and a game
 * between two of them above both.
 */
export const BIG_CLUB_IDS: ReadonlySet<number> = new Set([
  33, 34, 40, 42, 47, 49, 50, // Man United, Newcastle, Liverpool, Arsenal, Tottenham, Chelsea, Man City
  529, 530, 541, // Barcelona, Atletico Madrid, Real Madrid
  157, 165, 168, // Bayern, Dortmund, Leverkusen
  489, 492, 496, 505, // AC Milan, Napoli, Juventus, Inter
  85, // PSG
]);

export type TopMatchesDay = "today" | "tomorrow";
export type TopMatches = { day: TopMatchesDay; rows: FixtureRow[] };

type Snapshot = { version: 1; day: string; calls: number; fetchedAt: string | null; rows: FixtureRow[] };
const EMPTY: Snapshot = { version: 1, day: "", calls: 0, fetchedAt: null, rows: [] };

export function parseTopSnapshot(raw: string | null | undefined): Snapshot {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw);
    return v?.version === 1 && Array.isArray(v.rows) ? (v as Snapshot) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function bigClubs(r: FixtureRow): number {
  return (BIG_CLUB_IDS.has(r.teams.home.id) ? 1 : 0) + (BIG_CLUB_IDS.has(r.teams.away.id) ? 1 : 0);
}

function published(r: FixtureRow, index?: Record<string, string>): boolean {
  if (!index) return false;
  const key = matchKey({ homeTeamApiId: r.teams.home.id, awayTeamApiId: r.teams.away.id, kickoff: r.fixture.date });
  return !!(key && index[key]);
}

/** In scope for the strip at all: a headline competition, not postponed or cancelled. Pure. */
export function isTopMatchCandidate(r: FixtureRow): boolean {
  return TOP_MATCH_LEAGUE_IDS.has(r.league.id) && tabOfStatus(r.fixture.status.short) !== null;
}

/**
 * The strip's matches for one Lagos day (offset 0 today, 1 tomorrow), in
 * ranking order. Pure. See the file note for the ranking.
 */
export function selectTopMatchesForDay(
  rows: readonly FixtureRow[],
  now: Date,
  offsetDays: 0 | 1,
  linkIndex?: Record<string, string>,
): FixtureRow[] {
  const { start, end } = lagosDayBounds(offsetDays, now);
  const byId = new Map<number, FixtureRow>();
  for (const r of rows) {
    if (!isTopMatchCandidate(r)) continue;
    const t = new Date(r.fixture.date).getTime();
    if (Number.isNaN(t) || t < start.getTime() || t >= end.getTime()) continue;
    byId.set(r.fixture.id, r);
  }
  const ranked = [...byId.values()].sort(
    (a, b) =>
      bigClubs(b) - bigClubs(a) ||
      resultsRank(a.league.id) - resultsRank(b.league.id) ||
      Number(published(b, linkIndex)) - Number(published(a, linkIndex)) ||
      new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime() ||
      a.fixture.id - b.fixture.id,
  );

  const picked: FixtureRow[] = [];
  const perLeague = new Map<number, number>();
  for (const r of ranked) {
    if (picked.length >= TOP_MATCHES_POLICY.LIMIT) break;
    const n = perLeague.get(r.league.id) ?? 0;
    if (n >= TOP_MATCHES_POLICY.PER_COMPETITION) continue;
    perLeague.set(r.league.id, n + 1);
    picked.push(r);
  }
  // A day with only one or two competitions still fills the strip.
  for (const r of ranked) {
    if (picked.length >= TOP_MATCHES_POLICY.LIMIT) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

/** Today's top matches, else tomorrow's, else none. Pure. */
export function selectTopMatches(rows: readonly FixtureRow[], now: Date, linkIndex?: Record<string, string>): TopMatches {
  const today = selectTopMatchesForDay(rows, now, 0, linkIndex);
  if (today.length > 0) return { day: "today", rows: today };
  return { day: "tomorrow", rows: selectTopMatchesForDay(rows, now, 1, linkIndex) };
}

/**
 * Card order: in play first, then the next kickoffs, then results. Pure.
 * Display only; which matches are on the strip is decided by selectTopMatches.
 */
export function orderTopMatchCards<T extends FixtureRow>(rows: readonly T[]): T[] {
  const weight = (r: FixtureRow) => ({ live: 0, upcoming: 1, finished: 2 })[classifyStatus(r.fixture.status.short)];
  return [...rows].sort(
    (a, b) => weight(a) - weight(b) || new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime(),
  );
}

/** Overlay the shared live feed onto stored rows by fixture id. Pure. */
export function overlayLive(rows: readonly FixtureRow[], live: readonly FixtureRow[]): FixtureRow[] {
  const byId = new Map(live.map((r) => [r.fixture.id, r]));
  return rows.map((r) => {
    const l = byId.get(r.fixture.id);
    return l ? { ...r, fixture: { ...r.fixture, status: l.fixture.status }, goals: l.goals } : r;
  });
}

function callsToday(s: Snapshot, now: Date): number {
  return s.day === utcDay(now) ? s.calls : 0;
}

/** Having won the lease, may this refresh spend `calls` provider calls? Pure; null quota refuses. */
export function mayRefreshTop(previous: Snapshot, now: Date, quotaRemaining: number | null, calls = 1): boolean {
  return (
    callsToday(previous, now) + calls <= TOP_MATCHES_POLICY.DAILY_CALL_CAP &&
    quotaRemaining != null &&
    quotaRemaining >= TOP_MATCHES_POLICY.MIN_QUOTA_REMAINING
  );
}

async function claimRefresh(now: Date): Promise<Snapshot | null> {
  const expiresAt = new Date(now.getTime() + TOP_MATCHES_POLICY.REFRESH_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${TOP_MATCHES_SNAPSHOT_KEY}, ${JSON.stringify(EMPTY)}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows.length ? parseTopSnapshot(rows[0].holder) : null;
}

let memo: { at: number; snapshot: Snapshot } | null = null;

async function getTopSnapshot(now: Date): Promise<Snapshot> {
  if (memo && now.getTime() - memo.at < TOP_MATCHES_POLICY.MEMO_MS) return memo.snapshot;
  let snapshot: Snapshot;
  try {
    const previous = await claimRefresh(now);
    if (!previous) {
      const row = await prisma.appLock.findUnique({ where: { key: TOP_MATCHES_SNAPSHOT_KEY }, select: { holder: true } });
      snapshot = parseTopSnapshot(row?.holder);
    } else {
      const usage = await getUsageSnapshot().catch(() => null);
      const quota = usage ? usage.remaining : null;
      if (!mayRefreshTop(previous, now, quota)) {
        snapshot = previous;
      } else {
        // Provider dates are UTC; the strip's days are Lagos days (UTC+1), so
        // filtering by Lagos bounds below drops the hour that falls outside.
        let calls = callsToday(previous, now) + 1;
        const today = await getFixturesByDate(lagosDateKey(now));
        let rows = (today ?? []).filter(isTopMatchCandidate);
        let ok = today !== null;
        if (selectTopMatchesForDay(rows, now, 0).length === 0 && mayRefreshTop({ ...previous, day: utcDay(now), calls }, now, quota)) {
          calls += 1;
          const tomorrow = await getFixturesByDate(lagosDateKey(lagosDayBounds(1, now).start));
          rows = rows.concat((tomorrow ?? []).filter(isTopMatchCandidate));
          ok = ok || tomorrow !== null;
        }
        snapshot = ok
          ? { version: 1, day: utcDay(now), calls, fetchedAt: now.toISOString(), rows: rows.map(trimLiveRow) }
          : { ...previous, day: utcDay(now), calls };
        await prisma.appLock.update({ where: { key: TOP_MATCHES_SNAPSHOT_KEY }, data: { holder: JSON.stringify(snapshot) } });
      }
    }
  } catch (err) {
    console.error("[top-matches] failed; serving the last copy without calling the provider", err);
    snapshot = memo?.snapshot ?? EMPTY;
  }
  memo = { at: now.getTime(), snapshot };
  return snapshot;
}

/** The homepage strip. Never throws: a failed read serves the last copy, or nothing (and the section hides). */
export async function getTopMatches(
  live: readonly FixtureRow[],
  linkIndex?: Record<string, string>,
  now: Date = new Date(),
): Promise<TopMatches> {
  const snapshot = await getTopSnapshot(now);
  const picked = selectTopMatches(snapshot.rows, now, linkIndex);
  return { day: picked.day, rows: orderTopMatchCards(overlayLive(picked.rows, live)) };
}
