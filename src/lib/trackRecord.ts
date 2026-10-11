import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { MARKET_TYPES, type MarketType } from "@/lib/markets";
import { lagosDateKey } from "@/lib/lagosDate";

// Minimum settled (non-PENDING) predictions required before /track-record
// shows real numbers instead of a "not enough data yet" placeholder — and,
// per-bucket, before any single stat (a specific category/market/window) is
// shown as a percentage rather than its own "not enough data" state. A rate
// like "100% win rate, 2 tips" is worse for trust than no page at all.
// Revisit as the site's settled-tip volume grows.
export const MIN_SETTLED_SAMPLE_SIZE = 20;

export const TRACK_RECORD_CATEGORIES = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY", "GOALS"] as const;
export const TRACK_RECORD_MARKET_TYPES = MARKET_TYPES.filter((m) => m !== "OTHER") as Exclude<MarketType, "OTHER">[];

export type WinRateStat = {
  won: number;
  lost: number;
  void: number;
  total: number; // won + lost + void — all settled, regardless of method
  decided: number; // won + lost — the rate's denominator (VOID excluded)
  rate: number | null; // 0-1, null when decided === 0
};

/** Exported for reuse by the league/team scoped pages (src/lib/predictionScope.ts) — same math, different row set. */
export function computeStat(outcomes: string[]): WinRateStat {
  const won = outcomes.filter((o) => o === "WON").length;
  const lost = outcomes.filter((o) => o === "LOST").length;
  const voided = outcomes.filter((o) => o === "VOID").length;
  const decided = won + lost;
  return { won, lost, void: voided, total: outcomes.length, decided, rate: decided > 0 ? won / decided : null };
}

export type RecentTip = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  market: string;
  pick: string;
  outcome: string;
  category: string;
  kickoff: string | null;
  settledAt: string | null;
};

export type SettledTotals = {
  won: number;
  lost: number;
  void: number;
  /** won + lost + void — the figure MIN_SETTLED_SAMPLE_SIZE gates /track-record's indexability on. */
  total: number;
  /** Most recent settledAt across every published, non-PENDING prediction. */
  lastSettledAt: Date | null;
};

/**
 * All-time settled counts — the smallest read that answers "does /track-record
 * clear its sample-size gate?". A grouped count in the database, never shown on
 * the page: the page reports one calendar month (getMonthTrackRecord). The
 * sitemap reads it too, so the page's indexability and its sitemap entry come
 * from one count definition, and neither flips at the start of every month.
 */
export const getSettledTotals = cache(async (): Promise<SettledTotals> => {
  const groups = await prisma.prediction.groupBy({
    by: ["outcome"],
    where: { status: "PUBLISHED", outcome: { not: "PENDING" } },
    _count: { _all: true },
    _max: { settledAt: true },
  });
  const count = (outcome: string) => groups.find((row) => row.outcome === outcome)?._count._all ?? 0;
  const won = count("WON");
  const lost = count("LOST");
  const voided = count("VOID");
  const lastSettledAt = groups.reduce<Date | null>(
    (latest, row) => (row._max.settledAt && (!latest || row._max.settledAt > latest) ? row._max.settledAt : latest),
    null,
  );
  return { won, lost, void: voided, total: won + lost + voided, lastSettledAt };
});

// ---------------------------------------------------------------------------
// The calendar-month record
// ---------------------------------------------------------------------------

const LAGOS_OFFSET = "+01:00";

/**
 * Half-open UTC bounds of a Lagos calendar month. `offsetMonths` 0 is the
 * month `now` falls in, -1 the one before. Lagos has no DST, so the month
 * starts at 00:00 +01:00 on the 1st, every month.
 */
export function lagosMonthBounds(now: Date = new Date(), offsetMonths = 0): { start: Date; end: Date; key: string } {
  const [year, month] = lagosDateKey(now).split("-").map(Number);
  const index = year * 12 + (month - 1) + offsetMonths;
  const y = Math.floor(index / 12);
  const m = index % 12;
  const iso = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, "0")}-01T00:00:00${LAGOS_OFFSET}`;
  const next = index + 1;
  return { start: new Date(iso(y, m)), end: new Date(iso(Math.floor(next / 12), next % 12)), key: `${y}-${String(m + 1).padStart(2, "0")}` };
}

/** "October 2026" for a month key ("2026-10"). Locale-independent of the server. */
export function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-15T12:00:00Z`));
}

/** A WinRateStat from grouped outcome counts. */
export function statFromCounts(counts: ReadonlyArray<{ outcome: string; count: number }>): WinRateStat {
  const n = (o: string) => counts.filter((c) => c.outcome === o).reduce((sum, c) => sum + c.count, 0);
  const won = n("WON");
  const lost = n("LOST");
  const voided = n("VOID");
  const decided = won + lost;
  return { won, lost, void: voided, total: won + lost + voided, decided, rate: decided > 0 ? won / decided : null };
}

export type MonthTrackRecord = {
  /** "2026-10" */
  monthKey: string;
  /** "October 2026" */
  monthLabel: string;
  headline: WinRateStat;
  byCategory: Record<string, WinRateStat>;
  byMarketType: Record<string, WinRateStat>;
  over25: WinRateStat;
  /** The latest settled picks of the month, newest first. */
  recentTips: RecentTip[];
  /** How last month finished, or null below the sample gate. */
  previousMonth: { label: string; rate: number } | null;
  lastSettledAt: string | null;
};

/** Picks of a month: published, settled, kicked off inside the month. */
function settledInMonth(bounds: { start: Date; end: Date }) {
  return { status: "PUBLISHED" as const, outcome: { not: "PENDING" as const }, kickoff: { gte: bounds.start, lt: bounds.end } };
}

/**
 * One Lagos calendar month of results, counted in the database.
 *
 * The page used to read every settled prediction of the last 90 days and
 * count them in JavaScript, plus all-time totals. That grows with the site's
 * whole history (4,000+ settled picks in October 2026); this grows with one
 * month and returns a few dozen small aggregate rows whatever the volume. The
 * month resets on the 1st: the record is "this month", not "ever".
 */
export const getMonthTrackRecord = cache(async (now: Date = new Date()): Promise<MonthTrackRecord> => getTrackRecordForMonth(lagosMonthBounds(now).key));

/**
 * The same record for any Lagos month by key ("2026-09"). Backs the live page
 * (the current month) and the monthly reports at /track-record/<month>
 * (SEO-304), so a closed month's report is computed exactly as the live page
 * computed it, from the published picks themselves: nothing is copied or
 * stored, and a settlement corrected later is reflected the next time the
 * report is built.
 */
export const getTrackRecordForMonth = cache(async (key: string): Promise<MonthTrackRecord> => {
  const mid = new Date(`${key}-15T12:00:00Z`);
  const month = lagosMonthBounds(mid);
  const previous = lagosMonthBounds(mid, -1);
  const where = settledInMonth(month);
  const grouped = (extra: Record<string, unknown> = {}) =>
    prisma.prediction
      .groupBy({ by: ["outcome"], where: { ...where, ...extra }, _count: { _all: true } })
      .then((rows) => statFromCounts(rows.map((r) => ({ outcome: r.outcome, count: r._count._all }))));

  const [headline, categoryStats, marketRows, over25, recent, previousStat] = await Promise.all([
    grouped(),
    Promise.all(TRACK_RECORD_CATEGORIES.map((category) => grouped({ categories: { some: { category } } }))),
    prisma.prediction.groupBy({ by: ["marketType", "outcome"], where, _count: { _all: true } }),
    grouped({ marketType: "OVER_UNDER", AND: [{ selection: { path: ["line"], equals: 2.5 } }, { selection: { path: ["direction"], equals: "OVER" } }] }),
    prisma.prediction.findMany({
      where,
      orderBy: { settledAt: "desc" },
      take: 12,
      select: { id: true, homeTeam: true, awayTeam: true, market: true, pick: true, outcome: true, category: true, kickoff: true, settledAt: true },
    }),
    prisma.prediction
      .groupBy({ by: ["outcome"], where: settledInMonth(previous), _count: { _all: true } })
      .then((rows) => statFromCounts(rows.map((r) => ({ outcome: r.outcome, count: r._count._all })))),
  ]);

  const byCategory: Record<string, WinRateStat> = {};
  TRACK_RECORD_CATEGORIES.forEach((category, i) => { byCategory[category] = categoryStats[i]; });
  const byMarketType: Record<string, WinRateStat> = {};
  for (const mt of TRACK_RECORD_MARKET_TYPES) {
    byMarketType[mt] = statFromCounts(marketRows.filter((r) => r.marketType === mt).map((r) => ({ outcome: r.outcome, count: r._count._all })));
  }

  return {
    monthKey: month.key,
    monthLabel: monthLabel(month.key),
    headline,
    byCategory,
    byMarketType,
    over25,
    recentTips: recent.map((r) => ({ ...r, kickoff: r.kickoff?.toISOString() ?? null, settledAt: r.settledAt?.toISOString() ?? null })),
    previousMonth: previousStat.decided >= MIN_SETTLED_SAMPLE_SIZE && previousStat.rate != null
      ? { label: monthLabel(previous.key), rate: previousStat.rate }
      : null,
    lastSettledAt: recent[0]?.settledAt?.toISOString() ?? null,
  };
});

// ---------------------------------------------------------------------------
// Monthly reports (SEO-304)
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * A month key that may have a report: well formed and already closed (before
 * the current Lagos month). The live month belongs to /track-record itself.
 */
export function closedMonthKey(key: string | null | undefined, now: Date = new Date()): string | null {
  if (!key || !MONTH_KEY.test(key)) return null;
  return key < lagosMonthBounds(now).key ? key : null;
}

/** Closed months from the one before `now` back to `startKey`, newest first. Pure. */
export function closedMonthsSince(startKey: string | null, now: Date = new Date()): string[] {
  if (!startKey || !MONTH_KEY.test(startKey)) return [];
  const keys: string[] = [];
  for (let offset = -1; offset >= -240; offset--) {
    const key = lagosMonthBounds(now, offset).key;
    if (key < startKey) break;
    keys.push(key);
  }
  return keys;
}

/** The Lagos month of the earliest settled published pick: where the archive starts. One aggregate. */
export const getRecordStartKey = cache(async (): Promise<string | null> => {
  const first = await prisma.prediction.aggregate({
    where: { status: "PUBLISHED", outcome: { not: "PENDING" }, kickoff: { not: null } },
    _min: { kickoff: true },
  });
  return first._min.kickoff ? lagosMonthBounds(first._min.kickoff).key : null;
});

/**
 * Plain-language findings for a month's report, from its rates alone: the
 * month against the one before, and the strongest and weakest categories and
 * markets that cleared the sample gate. Pure; never states a rate the page
 * would hide.
 */
export function monthHighlights(record: Pick<MonthTrackRecord, "monthLabel" | "headline" | "byCategory" | "byMarketType" | "previousMonth">, labels: { category: Record<string, string>; market: Record<string, string> }): string[] {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const rated = (stats: Record<string, WinRateStat>, names: Record<string, string>) =>
    Object.entries(stats)
      .filter(([, s]) => s.decided >= MIN_SETTLED_SAMPLE_SIZE && s.rate != null)
      .map(([k, s]) => ({ name: names[k] ?? k, rate: s.rate! }))
      .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  const out: string[] = [];
  const h = record.headline;
  if (h.decided >= MIN_SETTLED_SAMPLE_SIZE && h.rate != null) {
    const month = record.monthLabel.split(" ")[0];
    if (record.previousMonth) {
      const diff = Math.round((h.rate - record.previousMonth.rate) * 100);
      const prev = record.previousMonth.label.split(" ")[0];
      out.push(diff === 0
        ? `${month} finished at ${pct(h.rate)}, level with ${prev}.`
        : `${month} finished at ${pct(h.rate)}, ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} ${diff > 0 ? "above" : "below"} ${prev}'s ${pct(record.previousMonth.rate)}.`);
    } else {
      out.push(`${month} finished at ${pct(h.rate)}.`);
    }
  }
  const cats = rated(record.byCategory, labels.category);
  if (cats.length >= 2) out.push(`${cats[0].name} was the strongest category at ${pct(cats[0].rate)}; ${cats[cats.length - 1].name} the weakest at ${pct(cats[cats.length - 1].rate)}.`);
  const markets = rated(record.byMarketType, labels.market);
  if (markets.length >= 2) out.push(`By market, ${markets[0].name} led at ${pct(markets[0].rate)} and ${markets[markets.length - 1].name} trailed at ${pct(markets[markets.length - 1].rate)}.`);
  return out;
}

/**
 * Settled record for one league, or null when the sample is too small to publish.
 *
 * The gate is the same MIN_SETTLED_SAMPLE_SIZE the /track-record page uses, and
 * it is the whole point of this function: a win rate over four settled picks is
 * noise dressed as evidence, and publishing it beside a confidence figure would
 * be the least honest thing on the page. Below the bar this returns null and
 * callers render nothing — not a hedged number, not "too early to say".
 *
 * Reads the same PUBLISHED + settled rows as the track record, scoped by
 * leagueApiId. No schema of its own, no new indexes: same full-scan-then-filter
 * posture the rest of this module and predictionScope.ts already take at this
 * data volume.
 */
export const getLeagueTrackRecord = cache(async (leagueApiId: number | null): Promise<WinRateStat | null> => {
  if (leagueApiId == null) return null;
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", outcome: { not: "PENDING" }, leagueApiId },
    select: { outcome: true },
  });
  if (rows.length < MIN_SETTLED_SAMPLE_SIZE) return null;
  return computeStat(rows.map((r) => r.outcome));
});

/**
 * Settled record for one team, across both home and away fixtures. Same gate
 * and same reasoning as getLeagueTrackRecord.
 *
 * Matched on team API id rather than name so a spelling variant can't split one
 * team's record into two — the same reason homeTeamApiId/awayTeamApiId are
 * persisted at generation time.
 */
export const getTeamTrackRecord = cache(async (teamApiId: number | null): Promise<WinRateStat | null> => {
  if (teamApiId == null) return null;
  const rows = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: { not: "PENDING" },
      OR: [{ homeTeamApiId: teamApiId }, { awayTeamApiId: teamApiId }],
    },
    select: { outcome: true },
  });
  if (rows.length < MIN_SETTLED_SAMPLE_SIZE) return null;
  return computeStat(rows.map((r) => r.outcome));
});

/**
 * Settled record for one category feed, gated like getLeagueTrackRecord. TODAY
 * ignores tags (it is every published pick), so its record is every settled
 * pick; every other feed is its tag.
 */
export const getCategoryTrackRecord = cache(async (category: string): Promise<WinRateStat | null> => {
  // Counted in the database: a feed's whole history is thousands of rows.
  const groups = await prisma.prediction.groupBy({
    by: ["outcome"],
    where: {
      status: "PUBLISHED",
      outcome: { not: "PENDING" },
      ...(category === "TODAY" ? {} : { categories: { some: { category } } }),
    },
    _count: { _all: true },
  });
  const outcomes = groups.flatMap((g) => Array<string>(g._count._all).fill(g.outcome));
  if (outcomes.length < MIN_SETTLED_SAMPLE_SIZE) return null;
  return computeStat(outcomes);
});

