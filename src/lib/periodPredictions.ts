import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";
import { compareBankerRank, paidFixtureKey } from "@/lib/geniusCuration";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { GENERATE_UNTIL_HOURS } from "@/lib/generation/window";

/**
 * Weekend (Friday–Sunday) and midweek (Tuesday–Thursday) tips: a short list
 * of the period's strongest published picks, grouped by day, with a period
 * Banker at the top. See selectPeriodList for the bar.
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
    blurb: "The weekend's strongest picks from Friday to Sunday, at 75% confidence or more, with the Weekend Banker at the top.",
    bankerTitle: "Weekend Banker",
  },
  midweek: {
    startDow: 2,
    days: 3,
    path: "/predictions/midweek",
    name: "Midweek Tips",
    title: "Midweek football predictions",
    blurb: "The strongest picks from Tuesday to Thursday, including the European nights, at 75% confidence or more, with the Midweek Banker at the top.",
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
 * The bar for the weekend and midweek pages. These are short lists of the
 * period's best picks, not every pick: a pick below the floor is left out,
 * never used to reach a target count.
 */
export const PERIOD_PICK_FLOOR = 75;
/** At most this many matches on a page, Banker included. */
export const PERIOD_MAX_GAMES = 30;
/** A period Banker needs this much, above the list's own floor. */
export const PERIOD_BANKER_FLOOR = 80;
export const PERIOD_MAX_BANKERS = 15;

/** May this row appear on a period page at all? Singles at or above the floor, never a paid-only pick. */
export function qualifiesForPeriod(r: Pick<PeriodBankerRow, "confidence" | "marketType" | "provenance">): boolean {
  return r.marketType !== "SAME_GAME_DOUBLE" && !isPaidOnlyProvenance(r.provenance) && r.confidence >= PERIOD_PICK_FLOOR;
}

/**
 * The period's list. Highest confidence first (competition priority breaks
 * ties), one pick per match (that match's strongest), at most
 * PERIOD_MAX_GAMES matches. The Banker is the top of that list at
 * PERIOD_BANKER_FLOOR or more, up to PERIOD_MAX_BANKERS; `picks` is the rest.
 * Started and settled picks stay in, so the page reads as a record once the
 * period is under way.
 */
export function selectPeriodList<T extends PeriodBankerRow>(rows: readonly T[]): { bankers: T[]; picks: T[] } {
  const ranked = rows.filter(qualifiesForPeriod).sort((a, b) => compareBankerRank(a, b));
  const taken = new Set<string>();
  const list: T[] = [];
  for (const r of ranked) {
    if (list.length >= PERIOD_MAX_GAMES) break;
    const key = paidFixtureKey(r);
    if (taken.has(key)) continue;
    taken.add(key);
    list.push(r);
  }
  const bankers = list.filter((r) => r.confidence >= PERIOD_BANKER_FLOOR).slice(0, PERIOD_MAX_BANKERS);
  const bankerIds = new Set(bankers.map((r) => r.id));
  return { bankers, picks: list.filter((r) => !bankerIds.has(r.id)) };
}
