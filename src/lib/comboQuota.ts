/**
 * How many ordinary fixtures per Lagos KICKOFF day are generated as combos.
 *
 * THE PROBLEM THIS REPLACES. Scheduled generation used to run its first
 * DOUBLES_DAILY_QUOTA (20) jobs of every Lagos day in REGULAR_COMBO mode,
 * whatever the slate looked like. On a 130-fixture Saturday that is a small
 * share. On a quiet week it was nearly everything: for kickoffs on 22-27 Sep
 * 2026 there were 16-32 eligible fixtures a day, combo jobs took 106 of the
 * 122 ordinary jobs, and FEATURED got 0, 1, 4, 1, 5 and 0 single-market picks.
 *
 * THE RULE. A share of the day's eligible fixtures, with a floor so Combo Bets
 * keeps a usable feed, a cap so a big slate does not turn into a combo slate,
 * and a hard fraction ceiling that always wins:
 *
 *   target = min( clamp(round(eligible * 0.25), 6, 20), floor(eligible * 0.4) )
 *
 * Replayed on real kickoff days 22-27 Sep (eligible 32, 26, 16, 15, 23, 25):
 * combos 8, 7, 6, 6, 6, 6 and single-market jobs 26, 16, 7, 7, 16, 11, where
 * the old rule gave 29, 22, 9, 12, 17, 17 combos and 5, 1, 4, 1, 5, 0 singles.
 * The floor is 6 rather than the first-proposed 4: at 4, the 15- and 16-fixture
 * days would get 4 combos. At 6 they get 6 and still keep 7 singles, so Combo
 * Bets gets at least six on any day with 15+ fixtures without starving
 * FEATURED. Busy days (114-149 fixtures) are capped at 20, close to what they
 * got before (17-29).
 *
 * The existing per-CREATION-day DOUBLES_DAILY_QUOTA stays as a spend ceiling
 * on top: combos cost about twice a single fixture, so this rule can only ever
 * lower combo spend, never raise it.
 *
 * Pure: no database. The loader that feeds it lives in doublesTargeting.ts.
 */

import { leaguePriorityRank } from "@/lib/leagues";

export const COMBO_SHARE = 0.25;
export const COMBO_MIN_PER_DAY = 6;
export const COMBO_MAX_PER_DAY = 20;
/** Combos may never take more than this share of a day's eligible fixtures. */
export const COMBO_CEILING_SHARE = 0.4;

export const SAME_GAME_DOUBLE_TAG = "SAME_GAME_DOUBLE" as const;

/** The number of combo jobs a Lagos kickoff day with `eligible` fixtures should get. */
export function adaptiveComboTarget(eligible: number): number {
  const n = Math.max(0, Math.floor(eligible));
  const share = Math.min(COMBO_MAX_PER_DAY, Math.max(COMBO_MIN_PER_DAY, Math.round(n * COMBO_SHARE)));
  return Math.max(0, Math.min(share, Math.floor(n * COMBO_CEILING_SHARE)));
}

/**
 * Should the next fixture for this kickoff day be generated as a combo?
 *
 * `combosForDay` counts combo jobs already spent on that kickoff day, attempts
 * rather than published rows (a failed job still spent its slot), which is how
 * every generation quota here counts. `dailyRemaining` is what is left of the
 * per-creation-day spend ceiling.
 */
export function shouldGenerateCombo(args: { eligible: number; combosForDay: number; dailyRemaining: number }): boolean {
  return args.dailyRemaining > 0 && args.combosForDay < adaptiveComboTarget(args.eligible);
}

/**
 * WHICH fixtures get the day's combo slots.
 *
 * The count comes from adaptiveComboTarget. Handing the slots out first-come
 * would give them to the first fixtures claimed for the day, and the queue
 * claims the best-ranked pending fixture first (selectQueuedCandidates:
 * league priority, then kickoff, then matchKey). Replayed on production
 * kickoff days 22-27 Sep, first-come put 56% of each day's top-quartile
 * fixtures into combos against a 33% combo share overall. On 23 Sep, 5 of the
 * 6 best-ranked fixtures (KNVB Beker) became combos. That starves single-market
 * FEATURED of exactly the fixtures it most needs.
 *
 * So the slots are SPREAD across the day's ranked pool instead: slot k sits at
 * position floor((k + 0.5) * n / target). With the 40% ceiling the spacing is
 * at least 2.5, so the top-ranked fixture is always a single, and both products
 * draw from every part of the ranking, top included.
 *
 * The pool grows while discovery runs, so positions move. The rule is therefore
 * "owed by rank": a fixture becomes a combo when more slots fall at or above
 * its rank than combos already given at or above it. A slot missed because its
 * fixture was generated before the pool grew passes to the next fixture below.
 * Once the day's ungenerated fixtures are no more than the combos still owed,
 * every one of them becomes a combo, so the count is still met late in the day.
 * The target, the 40% ceiling and the spend ceiling are unchanged, and nothing
 * here is random.
 */
export type DayPoolEntry = {
  matchKey: string;
  leagueApiId: number | null;
  kickoff: Date;
  /** Already generated (by any pass), so no longer claimable. */
  generated: boolean;
  /** Generated as a combo. Only meaningful when `generated`. */
  combo: boolean;
};

/** The queue's own claim order within one kickoff day (selectQueuedCandidates, minus its today-first key). */
export function compareDayPool(a: Pick<DayPoolEntry, "matchKey" | "leagueApiId" | "kickoff">, b: Pick<DayPoolEntry, "matchKey" | "leagueApiId" | "kickoff">): number {
  return (
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    a.kickoff.getTime() - b.kickoff.getTime() ||
    a.matchKey.localeCompare(b.matchKey)
  );
}

/** The ranked positions (0 = best) the day's combo slots sit at. */
export function comboSlotPositions(poolSize: number, target: number): number[] {
  return Array.from({ length: target }, (_, k) => Math.floor(((k + 0.5) * poolSize) / target));
}

/**
 * Should this candidate be generated as a combo?
 *
 * `pool` is every eligible fixture for the candidate's kickoff day, generated
 * or not, in any order. The candidate is added if missing.
 */
export function planComboAllocation(args: { pool: readonly DayPoolEntry[]; candidate: Omit<DayPoolEntry, "generated" | "combo">; dailyRemaining: number }): boolean {
  const pool = args.pool.some((e) => e.matchKey === args.candidate.matchKey)
    ? [...args.pool]
    : [...args.pool, { ...args.candidate, generated: false, combo: false }];
  const combosForDay = pool.filter((e) => e.generated && e.combo).length;
  if (!shouldGenerateCombo({ eligible: pool.length, combosForDay, dailyRemaining: args.dailyRemaining })) return false;

  const target = adaptiveComboTarget(pool.length);
  const owedTotal = target - combosForDay;
  const pending = pool.filter((e) => !e.generated).length;
  if (pending <= owedTotal) return true;

  const ranked = pool.sort(compareDayPool);
  const index = ranked.findIndex((e) => e.matchKey === args.candidate.matchKey);
  const owedAtOrAbove = comboSlotPositions(pool.length, target).filter((p) => p <= index).length;
  const givenAtOrAbove = ranked.slice(0, index + 1).filter((e) => e.generated && e.combo).length;
  return givenAtOrAbove < owedAtOrAbove;
}

/**
 * The tags an assembled double is published under.
 *
 * Always SAME_GAME_DOUBLE, which is what /predictions/combo-bets reads. Beyond
 * that, only categories someone asked for explicitly: an ordinary scheduled
 * run passes none, so its doubles are no longer put in FEATURED by default.
 * An admin who requests ?categories=FEATURED (or GENIUS, ...) still gets it.
 */
export function comboDestinationCategories(explicit: readonly string[]): string[] {
  return [...new Set([...explicit.filter((c) => c !== SAME_GAME_DOUBLE_TAG), SAME_GAME_DOUBLE_TAG])];
}
