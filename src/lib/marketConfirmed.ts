import type { MarketType, Selection } from "@/lib/markets";
import { toBookmakerSelection, type FixtureOdds, type HeadlineMarket, type OddsSelection } from "@/lib/odds";

/**
 * Market-Confirmed picks: model conviction that the betting market independently agrees with.
 *
 * DELIBERATELY SEPARATE FROM BET OF THE DAY. That gate looks for a PRICE BAND
 * — 2.20 to 4.50 — and a model edge OVER the market of at least 10pp. This one
 * wants the opposite on both counts: no price band at all, and model and market
 * as close together as possible. Reusing qualifiesForBetOfDay, MIN_ODDS/MAX_ODDS
 * or MIN_VALUE_EDGE_PP here would import an inverted intent, so this file
 * carries its own constants even where a number happens to coincide.
 *
 * THE VIG. A bookmaker's prices do not sum to 1. Three prices of 2.00 imply
 * 150%, and the extra 50pp is the margin, not belief. Taking 1/price as a
 * probability therefore OVERSTATES every outcome, and would let picks through
 * a 75% bar that the market prices nearer 68%. Every probability here is
 * normalised within its own market so the book's own overround is divided out.
 */

/** Model must be at least this confident before the market is even consulted. */
export const MC_MIN_MODEL_CONFIDENCE = 75;

/** De-vigged market probability must independently reach the same bar. */
export const MC_MIN_MARKET_PROBABILITY = 75;

/**
 * Maximum absolute distance between model and market, in percentage points.
 *
 * Absolute, not signed: a model 20pp ABOVE the market is not "value" here, it
 * is disagreement, and disagreement is the one thing this pipeline exists to
 * exclude. That is the precise inversion of MIN_VALUE_EDGE_PP.
 */
export const MC_MAX_GAP_PP = 10;

/** Distinct bookmakers that must quote the exact selection. Its own constant, not Bet of the Day's. */
export const MC_MIN_BOOKMAKERS = 5;

/** A quote older than this is not evidence of the current market. */
export const MC_MAX_QUOTE_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Markets this pipeline can evaluate.
 *
 * CORRECT_SCORE and WIN_EITHER_HALF are excluded because odds.ts stores no
 * comparable bookmaker market for them — there is nothing to normalise against,
 * and a gate that cannot see the market cannot confirm anything. SAME_GAME_DOUBLE
 * is excluded because it is composed of other rows rather than priced directly.
 */
export const MC_ELIGIBLE_MARKET_TYPES = ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"] as const;
export type MarketConfirmedMarketType = (typeof MC_ELIGIBLE_MARKET_TYPES)[number];

export function isEligibleMarketType(marketType: string): marketType is MarketConfirmedMarketType {
  return (MC_ELIGIBLE_MARKET_TYPES as readonly string[]).includes(marketType);
}

export type MarketConfirmedRejection =
  | "INELIGIBLE_MARKET"
  | "NO_ODDS"
  | "STALE_QUOTE"
  | "UNMAPPED_SELECTION"
  | "MARKET_NOT_QUOTED"
  | "THIN_COVERAGE"
  | "MODEL_BELOW_FLOOR"
  | "MARKET_BELOW_FLOOR"
  | "GAP_TOO_WIDE";

export type MarketConfirmedVerdict = {
  confirmed: boolean;
  reason?: MarketConfirmedRejection;
  detail?: string;
  /** The model's own confidence, echoed so callers can display both sides. */
  modelProbability: number;
  /** De-vigged market probability for the exact selection, 0-100, or null if it could not be computed. */
  marketProbability: number | null;
  /** Absolute distance in percentage points, or null when the market side is missing. */
  gapPP: number | null;
  bookmakers: number | null;
  market: HeadlineMarket | null;
  value: string | null;
  quoteAgeMs: number | null;
};

/** Reciprocal of decimal odds — the raw, still-vigged implied probability. */
function reciprocal(price: number): number {
  return price > 1 ? 1 / price : 0;
}

/**
 * Normalises a set of mutually exclusive, collectively exhaustive selections
 * so their probabilities sum to 1, removing the book's overround.
 *
 * Returns null unless EVERY leg of the market is present: normalising Home and
 * Away without Draw would divide by a total that is missing a real outcome and
 * inflate both survivors.
 */
function devig(selections: OddsSelection[], required: string[]): Map<string, number> | null {
  const byValue = new Map(selections.map((s) => [s.value.trim().toLowerCase(), s]));
  const legs: Array<{ key: string; raw: number }> = [];
  for (const want of required) {
    const found = byValue.get(want.trim().toLowerCase());
    // Median, not best: `best` is by construction the most generous outlier on
    // the book, so a de-vig built from it would systematically overstate.
    if (!found || !(found.median > 1)) return null;
    legs.push({ key: want, raw: reciprocal(found.median) });
  }
  const total = legs.reduce((sum, l) => sum + l.raw, 0);
  if (!(total > 0)) return null;
  return new Map(legs.map((l) => [l.key, l.raw / total]));
}

function marketOf(odds: FixtureOdds, market: HeadlineMarket): OddsSelection[] | null {
  return odds.markets.find((m) => m.market === market)?.selections ?? null;
}

/** Over/Under labels pair by line — "Over 2.5" needs "Under 2.5", not any Under. */
function parseOverUnder(label: string): { direction: string; line: number } | null {
  const m = label.trim().toLowerCase().match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
  return m ? { direction: m[1], line: Number(m[2]) } : null;
}

/**
 * De-vigged market probability for one bookmaker selection.
 *
 * Each market normalises within its own complete outcome set:
 *   Match Winner      Home / Draw / Away
 *   Both Teams Score  Yes / No
 *   Goals Over/Under  Over N / Under N, matched on the SAME line
 *   Double Chance     derived from de-vigged Match Winner, because a book's own
 *                     Double Chance prices carry a second, separate margin —
 *                     de-vigging them independently would give a different and
 *                     less reliable answer than the 1X2 market they are built
 *                     from. Coverage is still checked on the real Double Chance
 *                     line, so a derived probability never stands in for a
 *                     selection the books do not actually quote.
 */
export function devigProbability(
  odds: FixtureOdds,
  market: HeadlineMarket,
  value: string,
): { probability: number; bookmakers: number } | null {
  const wanted = value.trim().toLowerCase();

  if (market === "Match Winner") {
    const sels = marketOf(odds, "Match Winner");
    if (!sels) return null;
    const probs = devig(sels, ["Home", "Draw", "Away"]);
    const p = probs?.get(["Home", "Draw", "Away"].find((k) => k.toLowerCase() === wanted) ?? "");
    if (p == null) return null;
    const sel = sels.find((s) => s.value.trim().toLowerCase() === wanted);
    return sel ? { probability: p * 100, bookmakers: sel.bookmakers } : null;
  }

  if (market === "Both Teams Score") {
    const sels = marketOf(odds, "Both Teams Score");
    if (!sels) return null;
    const probs = devig(sels, ["Yes", "No"]);
    const p = probs?.get(["Yes", "No"].find((k) => k.toLowerCase() === wanted) ?? "");
    if (p == null) return null;
    const sel = sels.find((s) => s.value.trim().toLowerCase() === wanted);
    return sel ? { probability: p * 100, bookmakers: sel.bookmakers } : null;
  }

  if (market === "Goals Over/Under") {
    const sels = marketOf(odds, "Goals Over/Under");
    if (!sels) return null;
    const want = parseOverUnder(wanted);
    if (!want) return null;
    const opposite = want.direction === "over" ? "under" : "over";
    const mine = sels.find((s) => {
      const g = parseOverUnder(s.value);
      return g && g.direction === want.direction && g.line === want.line;
    });
    const theirs = sels.find((s) => {
      const g = parseOverUnder(s.value);
      return g && g.direction === opposite && g.line === want.line;
    });
    if (!mine || !theirs) return null;
    const probs = devig([mine, theirs], [mine.value, theirs.value]);
    const p = probs?.get(mine.value);
    return p == null ? null : { probability: p * 100, bookmakers: mine.bookmakers };
  }

  if (market === "Double Chance") {
    const mw = marketOf(odds, "Match Winner");
    if (!mw) return null;
    const probs = devig(mw, ["Home", "Draw", "Away"]);
    if (!probs) return null;
    const pairs: Record<string, [string, string]> = {
      "home/draw": ["Home", "Draw"],
      "away/draw": ["Away", "Draw"],
      "home/away": ["Home", "Away"],
    };
    const pair = pairs[wanted];
    if (!pair) return null;
    const probability = ((probs.get(pair[0]) ?? 0) + (probs.get(pair[1]) ?? 0)) * 100;

    // Coverage comes from the REAL Double Chance line, not from the 1X2 market
    // the probability was derived from — the point of the cross-check is that
    // the books genuinely quote this selection.
    const dc = marketOf(odds, "Double Chance");
    const sel = dc?.find((s) => s.value.trim().toLowerCase() === wanted);
    if (!sel) return null;
    return { probability, bookmakers: sel.bookmakers };
  }

  return null;
}

/**
 * The whole gate, as one pure function.
 *
 * Order matters: the cheapest and most disqualifying checks run first, and
 * every rejection names itself so a run can report WHY nothing qualified rather
 * than only that nothing did.
 */
export function evaluateMarketConfirmed(input: {
  marketType: MarketType | string;
  selection: Selection;
  /** The model's confidence, 0-100. */
  confidence: number;
  odds: FixtureOdds | null;
  /** When the odds were fetched — our own timestamp, not the book's. */
  fetchedAt: Date | string | null;
  now?: Date;
}): MarketConfirmedVerdict {
  const now = input.now ?? new Date();
  const base: MarketConfirmedVerdict = {
    confirmed: false,
    modelProbability: input.confidence,
    marketProbability: null,
    gapPP: null,
    bookmakers: null,
    market: null,
    value: null,
    quoteAgeMs: null,
  };

  if (!isEligibleMarketType(String(input.marketType))) {
    return { ...base, reason: "INELIGIBLE_MARKET", detail: `${input.marketType} has no comparable bookmaker market` };
  }

  if (input.confidence < MC_MIN_MODEL_CONFIDENCE) {
    return { ...base, reason: "MODEL_BELOW_FLOOR", detail: `${input.confidence}% < ${MC_MIN_MODEL_CONFIDENCE}%` };
  }

  if (!input.odds) return { ...base, reason: "NO_ODDS", detail: "no cached odds for this fixture" };

  const fetchedAt = input.fetchedAt ? new Date(input.fetchedAt) : null;
  if (!fetchedAt || Number.isNaN(fetchedAt.getTime())) {
    return { ...base, reason: "STALE_QUOTE", detail: "no fetch timestamp on the cached odds" };
  }
  const quoteAgeMs = now.getTime() - fetchedAt.getTime();
  if (quoteAgeMs > MC_MAX_QUOTE_AGE_MS) {
    return { ...base, reason: "STALE_QUOTE", quoteAgeMs, detail: `quote is ${Math.round(quoteAgeMs / 60000)}m old` };
  }

  const mapped = toBookmakerSelection(input.marketType as MarketType, input.selection);
  if (!mapped) {
    return { ...base, quoteAgeMs, reason: "UNMAPPED_SELECTION", detail: "selection has no headline-market equivalent" };
  }

  const devigged = devigProbability(input.odds, mapped.market, mapped.value);
  if (!devigged) {
    return {
      ...base, quoteAgeMs, market: mapped.market, value: mapped.value,
      reason: "MARKET_NOT_QUOTED", detail: `${mapped.market} / ${mapped.value} not fully quoted`,
    };
  }

  const marketProbability = devigged.probability;
  const gapPP = Math.abs(input.confidence - marketProbability);
  const detailed: MarketConfirmedVerdict = {
    ...base,
    quoteAgeMs,
    market: mapped.market,
    value: mapped.value,
    marketProbability,
    gapPP,
    bookmakers: devigged.bookmakers,
  };

  if (devigged.bookmakers < MC_MIN_BOOKMAKERS) {
    return { ...detailed, reason: "THIN_COVERAGE", detail: `${devigged.bookmakers} bookmakers < ${MC_MIN_BOOKMAKERS}` };
  }
  if (marketProbability < MC_MIN_MARKET_PROBABILITY) {
    return { ...detailed, reason: "MARKET_BELOW_FLOOR", detail: `${marketProbability.toFixed(1)}% < ${MC_MIN_MARKET_PROBABILITY}%` };
  }
  if (gapPP > MC_MAX_GAP_PP) {
    return { ...detailed, reason: "GAP_TOO_WIDE", detail: `${gapPP.toFixed(1)}pp > ${MC_MAX_GAP_PP}pp` };
  }

  return { ...detailed, confirmed: true };
}

/**
 * Picks the single selection to keep when a fixture produces several passing ones.
 *
 * Highest min(model, market) first — the pick whose WEAKER side is strongest,
 * which is the conservative reading and the same instinct as the doubles
 * ceiling. Then the tightest agreement. Then id, so the choice is stable across
 * runs rather than depending on query order.
 */
export function compareMarketConfirmed<T extends { id: string; verdict: MarketConfirmedVerdict }>(a: T, b: T): number {
  const floorOf = (x: T) => Math.min(x.verdict.modelProbability, x.verdict.marketProbability ?? 0);
  return (
    floorOf(b) - floorOf(a) ||
    (a.verdict.gapPP ?? Infinity) - (b.verdict.gapPP ?? Infinity) ||
    a.id.localeCompare(b.id)
  );
}
