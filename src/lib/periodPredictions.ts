import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";
import { BANKER_CONFIDENCE_FLOOR, BANKER_MAX_PICKS, compareBankerRank, paidFixtureKey } from "@/lib/geniusCuration";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { GENERATE_UNTIL_HOURS } from "@/lib/generation/window";

/**
 * Weekend (Friday–Sunday) and midweek (Tuesday–Thursday) tips: the ordinary
 * published picks for a run of days, grouped by day, with a period Banker.
 *
 * Nothing is generated for these pages. Picks are produced 12–48h before
 * kickoff (src/lib/generation/window.ts), so a period's later days fill in as
 * it approaches, and the page says so rather than looking empty.
 *
 * PURE apart from the clock argument: the window and the Banker choice are
 * checked by scripts/check-period-predictions.ts.
 */

export type PeriodKind = "weekend" | "midweek";

const DAY_MS = 24 * 3_600_000;

export const PERIODS: Record<PeriodKind, {
  /** Lagos weekday the period opens on, 0 = Sunday. */
  startDow: number;
  days: number;
  path: string;
  name: string;
  title: string;
  blurb: string;
  bankerTitle: string;
}> = {
  weekend: {
    startDow: 5,
    days: 3,
    path: "/predictions/weekend",
    name: "Weekend Tips",
    title: "Weekend football predictions",
    blurb: "Every published pick from Friday to Sunday, day by day, with the weekend's strongest calls at the top.",
    bankerTitle: "Weekend Banker",
  },
  midweek: {
    startDow: 2,
    days: 3,
    path: "/predictions/midweek",
    name: "Midweek Tips",
    title: "Midweek football predictions",
    blurb: "Every published pick from Tuesday to Thursday, including the European nights, with the strongest calls at the top.",
    bankerTitle: "Midweek Banker",
  },
};

export type PeriodDay = { offset: number; key: string; start: Date; end: Date };

export type PeriodWindow = {
  kind: PeriodKind;
  /** live: the period is under way. upcoming: it starts soon and picks are arriving. finished: the last one, until the next opens. */
  state: "live" | "upcoming" | "finished";
  start: Date;
  end: Date;
  days: PeriodDay[];
};

/** Lagos weekday for an instant, 0 = Sunday. */
export function lagosWeekday(now: Date): number {
  return new Date(`${lagosDateKey(now)}T00:00:00Z`).getUTCDay();
}

/**
 * Which period the page shows at `now`.
 *
 * The current one while it runs. Before it, the next one as soon as its first
 * day is inside the generation window (picks for it can exist); until then,
 * the previous one, so the page carries its results rather than nothing.
 */
export function periodWindow(kind: PeriodKind, now: Date = new Date()): PeriodWindow {
  const { startDow, days } = PERIODS[kind];
  const dow = lagosWeekday(now);
  const intoPeriod = (dow - startDow + 7) % 7;
  let startOffset: number;
  let state: PeriodWindow["state"];
  if (intoPeriod < days) {
    startOffset = -intoPeriod;
    state = "live";
  } else {
    const untilNext = (startDow - dow + 7) % 7;
    if (untilNext * DAY_MS <= GENERATE_UNTIL_HOURS * 3_600_000) {
      startOffset = untilNext;
      state = "upcoming";
    } else {
      startOffset = untilNext - 7;
      state = "finished";
    }
  }
  const periodDays = Array.from({ length: days }, (_, i) => {
    const { start, end } = lagosDayBounds(startOffset + i, now);
    return { offset: startOffset + i, key: lagosDateKey(start), start, end };
  });
  return { kind, state, start: periodDays[0].start, end: periodDays[days - 1].end, days: periodDays };
}

/** When picks for a day start arriving: the far edge of the generation window. */
export function picksArriveFrom(day: PeriodDay): Date {
  return new Date(day.start.getTime() - GENERATE_UNTIL_HOURS * 3_600_000);
}

export type PeriodBankerRow = {
  id: string;
  leagueApiId: number | null;
  confidence: number;
  provenance: string | null;
  marketType: string;
  kickoff: Date | null;
  fixtureApiId: number | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
};

/**
 * The period's Banker: the same rule as the daily one, across the whole run
 * of days. Highest confidence first (competition priority breaks ties), at
 * least BANKER_CONFIDENCE_FLOOR, singles only, never a paid-only pick, one per
 * match, at most BANKER_MAX_PICKS. Started and settled picks stay in, so the
 * strip reads as a record once the period is under way.
 */
export function selectPeriodBankers<T extends PeriodBankerRow>(rows: readonly T[]): T[] {
  const eligible = rows
    .filter((r) => r.marketType !== "SAME_GAME_DOUBLE" && !isPaidOnlyProvenance(r.provenance) && r.confidence >= BANKER_CONFIDENCE_FLOOR)
    .sort((a, b) => compareBankerRank(a, b));
  const taken = new Set<string>();
  const out: T[] = [];
  for (const r of eligible) {
    if (out.length >= BANKER_MAX_PICKS) break;
    const key = paidFixtureKey(r);
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(r);
  }
  return out;
}
