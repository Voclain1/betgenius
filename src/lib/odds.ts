import type { OddsResponse } from "@/lib/football/api-football";
import type {
  MarketType,
  Selection,
  MatchWinnerSelection,
  DoubleChanceSelection,
  OverUnderSelection,
  BttsSelection,
} from "@/lib/markets";

/**
 * Bookmaker odds: what we keep from api-football's /odds response, and what
 * makes a price eligible for Bet of the Day.
 *
 * Every constant here is grounded in measurements taken from the live API
 * across all 37 tracked competitions — see scripts/research-odds-coverage.ts,
 * research-odds-leadtime.ts and research-odds-placeholders.ts, whose findings
 * are quoted inline where they justify a number.
 */

/**
 * The only markets we store or display.
 *
 * api-football returns 338 distinct markets; the research found a single
 * well-covered fixture carrying ~2,500 individual prices. Storing that whole
 * payload per fixture to render four numbers would be absurd, and — more to
 * the point — the exotic markets are actively dangerous to select on: `Goals
 * Over/Under` alone spans 1.00 to 80.0 within one fixture, so any "highest
 * odd" rule loosed on the full market list picks "Over 6.5 Goals @ 80.0" every
 * single day. Restricting the vocabulary is the first of three guards against
 * that (see qualifiesForBetOfDay for the other two).
 */
export const HEADLINE_MARKETS = ["Match Winner", "Double Chance", "Goals Over/Under", "Both Teams Score"] as const;
export type HeadlineMarket = (typeof HEADLINE_MARKETS)[number];

/**
 * European Handicap, as api-football names it.
 *
 * Kept OUT of HEADLINE_MARKETS deliberately. That list is the display and
 * selection vocabulary — four markets a reader recognises, each with plain
 * selections ("Home", "Over 2.5"). Handicap selections carry a line inside the
 * label ("Home -1"), and the market is not offered in the model's general
 * vocabulary at all, so folding it in there would widen a list whose narrowness
 * is the point. It is trimmed and stored so the line can be READ, nothing more.
 *
 * Three-way, unlike Asian Handicap: every line quotes Home, Draw and Away. See
 * EUROPEAN_HANDICAP_VALUES in src/lib/markets.ts for why that matters at
 * settlement.
 */
export const HANDICAP_MARKET = "Handicap Result" as const;
export type HandicapMarket = typeof HANDICAP_MARKET;

/** Everything trimOdds retains: the display four, plus handicap for its line. */
export const TRIMMED_MARKETS = [...HEADLINE_MARKETS, HANDICAP_MARKET] as const;
export type TrimmedMarket = (typeof TRIMMED_MARKETS)[number];

/**
 * Bet of the Day price band.
 *
 * Measured 1X2 distribution across 47 sampled fixtures (141 prices): p25 2.26,
 * median 3.18, p75 3.75, p90 5.20, favourite median 2.05.
 *
 * FLOOR ~ p25: excludes the short-priced favourites BANKER already covers.
 * Bet of the Day is meant to be the bolder call, not a second banker.
 *
 * CEILING ~ p85: this is the guard that matters. "High odd" has to mean
 * "priced against the field", not "statistically absurd" — without a ceiling
 * the rule degenerates into always picking the longest shot on the board,
 * which would be indistinguishable from picking at random and would lose most
 * days.
 */
export const MIN_ODDS = 2.2;
export const MAX_ODDS = 4.5;

/**
 * Minimum bookmakers quoting the selection.
 *
 * The research found real books running 10-14 deep inside 72h of kickoff, and
 * the only thin responses (1 and 2 bookmakers) were fixtures 7+ days out where
 * pricing had barely opened. A price quoted by one book is not a market price;
 * this is what keeps a barely-opened line out of the slot.
 */
export const MIN_BOOKMAKERS = 5;

/**
 * How far the model's confidence must exceed the market's implied probability.
 *
 * Without this, the odds band alone selects a pick priced 2.20-4.50 that we
 * merely happen to like — a coin flip with an attractive number attached. The
 * margin is what makes it a VALUE selection: at these odds the book implies
 * 22-45%, so requiring confidence to clear that by 10 points means we are
 * claiming a real disagreement with the market, not just restating its price.
 */
export const MIN_VALUE_EDGE_PP = 10;

/** A price so short it pays nothing. Real, not a placeholder — see below. */
const UNPAYABLE = 1.01;

export type OddsSelection = {
  /** Selection label as the bookmaker states it — "Home", "Over 2.5", "Yes". */
  value: string;
  /** Highest price any bookmaker quotes. What a reader would actually shop for. */
  best: number;
  /**
   * Median across bookmakers. Kept alongside `best` because the best price is
   * by construction an outlier: if one book is 20% off the rest, `best` shows
   * it and `median` is what says whether the market agrees.
   */
  median: number;
  /** How many bookmakers quote this selection at all. */
  bookmakers: number;
  /** Which book is offering `best`, so the figure is attributable. */
  bestBookmaker: string;
};

export type OddsMarket = { market: TrimmedMarket; selections: OddsSelection[] };

export type FixtureOdds = {
  /** Distinct bookmakers on the fixture, across all markets. */
  bookmakerCount: number;
  markets: OddsMarket[];
  /** api-football's own timestamp for the quote — the only staleness signal there is. */
  update: string | null;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Reduce a raw /odds response to the four headline markets, with a best and
 * median price per selection.
 *
 * Prices at or below 1.01 are dropped. The research flagged these on 44 of 47
 * fixtures, which looked like feed corruption until the third probe named
 * them: they are 302 of 75,360 prices (0.40%), and they are REAL — genuine
 * near-certainties on extreme lines like "Under 6.5 @ 1.00". Match Winner was
 * never quoted below 1.06. So they are not placeholders to be defended
 * against, just unpayable prices with no business on a tips page.
 */
export function trimOdds(response: OddsResponse | null | undefined): FixtureOdds | null {
  const bookmakers = response?.bookmakers ?? [];
  if (bookmakers.length === 0) return null;

  const markets: OddsMarket[] = [];

  for (const marketName of TRIMMED_MARKETS) {
    // selection label -> every price quoted for it, with its book
    const bySelection = new Map<string, Array<{ odd: number; bookmaker: string }>>();

    for (const book of bookmakers) {
      const bet = (book.bets ?? []).find((b) => b.name === marketName);
      if (!bet) continue;
      for (const v of bet.values ?? []) {
        const odd = Number(v.odd);
        if (!Number.isFinite(odd) || odd <= UNPAYABLE) continue;
        const list = bySelection.get(v.value) ?? [];
        list.push({ odd, bookmaker: book.name });
        bySelection.set(v.value, list);
      }
    }

    const selections: OddsSelection[] = [];
    for (const [value, quotes] of bySelection) {
      const top = quotes.reduce((a, b) => (b.odd > a.odd ? b : a));
      selections.push({
        value,
        best: Number(top.odd.toFixed(2)),
        median: Number(median(quotes.map((q) => q.odd)).toFixed(2)),
        bookmakers: quotes.length,
        bestBookmaker: top.bookmaker,
      });
    }

    if (selections.length > 0) {
      // Shortest price first: within a market that is the favourite, which is
      // the order a reader expects to scan.
      selections.sort((a, b) => a.best - b.best || a.value.localeCompare(b.value));
      markets.push({ market: marketName, selections });
    }
  }

  if (markets.length === 0) return null;

  return {
    bookmakerCount: bookmakers.length,
    markets,
    update: response?.update ?? null,
  };
}

/** What a decimal price says the market thinks the chance is, as a percentage. */
export function impliedProbability(odds: number): number {
  return (1 / odds) * 100;
}

/**
 * Translate one of our structured picks into the market and selection label
 * api-football quotes it under.
 *
 * This mapping is not optional, and it must key off `marketType`/`selection`
 * rather than the `market`/`pick` display strings. The two vocabularies
 * disagree on every single market:
 *
 *   ours (display)                      api-football
 *   ------------------------------------------------------------
 *   "Match Winner" / "Chelsea to win"   "Match Winner"     / "Home"
 *   "Double Chance" / "Watford or Draw" "Double Chance"    / "Home/Draw"
 *   "Total Goals" / "Over 2.5 Goals"    "Goals Over/Under" / "Over 2.5"
 *   "Both Teams to Score" / "Yes"       "Both Teams Score" / "Yes"
 *
 * Our labels interpolate team names, which no bookmaker feed does, so string
 * matching on them cannot ever succeed — it silently rejects every candidate
 * and reads as "no odds coverage" rather than as a bug. The structured fields
 * exist precisely so machine consumers don't have to parse display prose (see
 * the note on marketType in prisma/schema.prisma), and this is one.
 *
 * Returns null for CORRECT_SCORE and OTHER: correct score is not one of the
 * four headline markets, and OTHER is free text with no structure to map.
 */
export function toBookmakerSelection(
  marketType: MarketType | string,
  selection: Selection | unknown,
): { market: TrimmedMarket; value: string } | null {
  switch (marketType) {
    case "MATCH_WINNER": {
      const v = (selection as MatchWinnerSelection)?.value;
      if (v === "HOME") return { market: "Match Winner", value: "Home" };
      if (v === "DRAW") return { market: "Match Winner", value: "Draw" };
      if (v === "AWAY") return { market: "Match Winner", value: "Away" };
      return null;
    }
    case "EUROPEAN_HANDICAP": {
      // Rebuilds the feed's own label: side plus the signed HOME line, e.g.
      // {value:"AWAY", line:-1} -> "Away -1". The line is always stated from
      // the home team's side in the feed, so it is NOT flipped for an away
      // selection — "Away -1" means "away wins after home is docked a goal".
      const sel = selection as { value?: string; line?: number } | undefined;
      const side = sel?.value === "HOME" ? "Home" : sel?.value === "AWAY" ? "Away" : sel?.value === "DRAW" ? "Draw" : null;
      if (!side || typeof sel?.line !== "number" || !Number.isInteger(sel.line) || sel.line === 0) return null;
      return { market: HANDICAP_MARKET, value: `${side} ${sel.line > 0 ? "+" : ""}${sel.line}` };
    }
    case "DOUBLE_CHANCE": {
      const v = (selection as DoubleChanceSelection)?.value;
      // api-football orders these home-first and uses a slash, never "or".
      if (v === "HOME_OR_DRAW") return { market: "Double Chance", value: "Home/Draw" };
      if (v === "AWAY_OR_DRAW") return { market: "Double Chance", value: "Draw/Away" };
      if (v === "HOME_OR_AWAY") return { market: "Double Chance", value: "Home/Away" };
      return null;
    }
    case "OVER_UNDER": {
      const s = selection as OverUnderSelection;
      if (typeof s?.line !== "number" || !s?.direction) return null;
      // Formatting differences between "3" and "3.0" are reconciled numerically
      // by findSelection, so the label is written the plain way here.
      return { market: "Goals Over/Under", value: `${s.direction === "OVER" ? "Over" : "Under"} ${s.line}` };
    }
    case "BTTS": {
      const v = (selection as BttsSelection)?.value;
      if (v === "YES") return { market: "Both Teams Score", value: "Yes" };
      if (v === "NO") return { market: "Both Teams Score", value: "No" };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Find the stored price for a prediction's own selection.
 *
 * Returns null whenever a pick cannot be tied to a real quoted line — which is
 * the correct answer. Bet of the Day must never show a price belonging to a
 * different selection than the one being tipped.
 */
export function findSelection(odds: FixtureOdds | null, market: string, value: string): OddsSelection | null {
  if (!odds) return null;
  const found = odds.markets.find((m) => m.market === market);
  if (!found) return null;
  const normalised = value.trim().toLowerCase();
  const exact = found.selections.find((s) => s.value.trim().toLowerCase() === normalised);
  if (exact) return exact;

  // Goals Over/Under labels carry a number, and the two sides format it
  // differently: a line of 3 renders as "Over 3" from deriveMarketAndPick and
  // as "Over 3.0" in the feed. String equality misses that pairing entirely, so
  // the line is compared numerically. Direction still has to match exactly —
  // "Over 2.5" and "Under 2.5" are opposite bets, not formatting variants.
  const parse = (label: string) => {
    const m = label.trim().toLowerCase().match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
    return m ? { direction: m[1], line: Number(m[2]) } : null;
  };
  const want = parse(normalised);
  if (!want) return null;
  return (
    found.selections.find((s) => {
      const got = parse(s.value);
      return got && got.direction === want.direction && got.line === want.line;
    }) ?? null
  );
}

export type OddsGateResult = {
  qualifies: boolean;
  /** Every reason it failed — a gate that reports only the first is hard to tune. */
  reasons: string[];
  price: number | null;
  bookmakers: number | null;
  impliedProbability: number | null;
  edgePP: number | null;
};

/**
 * The Bet of the Day odds gate: is this pick a genuine value selection at a
 * high-but-sane price, quoted by a real market?
 *
 * Four conditions, all required. Each exists to exclude a specific failure the
 * research turned up, and the reasons are returned rather than collapsed to a
 * boolean so the admin panel and the verification script can both explain a
 * rejection.
 */
export function qualifiesForBetOfDay(input: {
  odds: FixtureOdds | null;
  /** The prediction's structured market type — NOT its display `market` string. */
  marketType: MarketType | string;
  /** The prediction's structured `selection` JSON — NOT its display `pick` string. */
  selection: Selection | unknown;
  confidence: number;
}): OddsGateResult {
  const reasons: string[] = [];

  const mapped = toBookmakerSelection(input.marketType, input.selection);
  if (!mapped) {
    return {
      qualifies: false,
      reasons: [`market type "${input.marketType}" is not one of the four headline markets`],
      price: null,
      bookmakers: null,
      impliedProbability: null,
      edgePP: null,
    };
  }

  const found = findSelection(input.odds, mapped.market, mapped.value);
  if (!found) {
    return {
      qualifies: false,
      reasons: ["no cached bookmaker price for this exact selection"],
      price: null,
      bookmakers: null,
      impliedProbability: null,
      edgePP: null,
    };
  }

  const implied = impliedProbability(found.best);
  const edge = input.confidence - implied;

  if (found.best < MIN_ODDS) reasons.push(`price ${found.best} is below the ${MIN_ODDS} floor (short-priced favourite)`);
  if (found.best > MAX_ODDS) reasons.push(`price ${found.best} is above the ${MAX_ODDS} ceiling (long-shot line)`);
  if (found.bookmakers < MIN_BOOKMAKERS) reasons.push(`only ${found.bookmakers} bookmaker(s) quote it, need ${MIN_BOOKMAKERS}`);
  if (edge < MIN_VALUE_EDGE_PP) {
    reasons.push(`confidence ${input.confidence}% is only ${edge.toFixed(1)}pp above the implied ${implied.toFixed(1)}%, need ${MIN_VALUE_EDGE_PP}pp`);
  }

  return {
    qualifies: reasons.length === 0,
    reasons,
    price: found.best,
    bookmakers: found.bookmakers,
    impliedProbability: Number(implied.toFixed(1)),
    edgePP: Number(edge.toFixed(1)),
  };
}

/** Human-readable age of a quote, for the staleness stamp beside a displayed price. */
export function quoteAge(fetchedAt: Date | string | null | undefined, now: Date = new Date()): string | null {
  if (!fetchedAt) return null;
  const then = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(then.getTime())) return null;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Does this fixture's market afford a Bet of the Day at all?
 *
 * Used BEFORE generation, when there is no pick yet — so it asks the only
 * question answerable at that point: does any selection in a headline market
 * sit inside the price band, quoted by enough books?
 *
 * This is what makes targeting price-first rather than generate-then-filter.
 * The alternative — generate bolder picks across the board and discard the ones
 * that miss the band — spends ~11 api-football calls and a model call per
 * rejection. Selecting fixtures whose price is already in band spends one
 * cached read.
 *
 * Deliberately NOT a value test. The confidence edge cannot be evaluated
 * before a pick exists; qualifiesForBetOfDay applies that later, to the actual
 * generated selection.
 */
/**
 * The selection labels our generator can actually produce.
 *
 * This filter is what stops the affordance check from being a false positive
 * machine. A fixture's Goals Over/Under market carries a dozen Asian lines
 * (Over 2.75, Over 3.0, Over 3.25), and at least one of them is almost always
 * priced inside 2.20-4.50 — so without this, 39 of 41 candidates "afforded" a
 * Bet of the Day, and three of the four selected targets were chosen on lines
 * no prediction we generate could ever be tipped at. Measured, not theorised.
 *
 * Over/Under is restricted to HALF lines because that is the only kind
 * deriveMarketAndPick emits (every OVER_UNDER prediction in the database uses
 * 2.5); the whole and quarter lines belong to a market we do not play in.
 */
function isProducibleSelection(market: TrimmedMarket, value: string): boolean {
  const v = value.trim();
  // Handicap is trimmed and stored so its LINE can be read at generation time,
  // not so it can be tipped as Bet of the Day. Excluded explicitly rather than
  // left to fall through the Over/Under regex below, which rejects "Home -1"
  // only by accident — an accident that would silently stop protecting this
  // the moment that regex is touched.
  if (market === HANDICAP_MARKET) return false;
  if (market === "Match Winner") return ["Home", "Draw", "Away"].includes(v);
  if (market === "Double Chance") return ["Home/Draw", "Draw/Away", "Home/Away"].includes(v);
  if (market === "Both Teams Score") return ["Yes", "No"].includes(v);
  return /^(Over|Under)\s+\d+\.5$/.test(v);
}

export function affordsBetOfDayPrice(odds: FixtureOdds | null): { affords: boolean; best: OddsSelection | null; market: TrimmedMarket | null } {
  if (!odds) return { affords: false, best: null, market: null };
  let best: OddsSelection | null = null;
  let market: TrimmedMarket | null = null;
  for (const m of odds.markets) {
    for (const sel of m.selections) {
      if (!isProducibleSelection(m.market, sel.value)) continue;
      if (sel.best < MIN_ODDS || sel.best > MAX_ODDS) continue;
      if (sel.bookmakers < MIN_BOOKMAKERS) continue;
      // Prefer the shortest qualifying price: within the band, the shorter side
      // is the more defensible bolder call, not the wilder one.
      if (!best || sel.best < best.best) {
        best = sel;
        market = m.market;
      }
    }
  }
  return { affords: best !== null, best, market };
}
