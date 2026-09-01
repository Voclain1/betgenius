import { getOdds } from "@/lib/football/api-football";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { HANDICAP_MARKET, MIN_BOOKMAKERS, impliedProbability } from "@/lib/odds";
import { EUROPEAN_HANDICAP_VALUES } from "@/lib/markets";

/**
 * Sourcing the European Handicap line from live prices.
 *
 * The line is NEVER proposed by the model. It is read off real quotes here and
 * handed to generation as a fixed constraint, because a handicap the market
 * does not quote is a fabricated number — the failure that made 39 of 41
 * Asian-line candidates look affordable on lines nobody prices.
 *
 * Read LIVE, never from FixtureOddsCache, for two measured reasons: the cache
 * is refreshed on a schedule and odds are withdrawn as kickoff nears (two
 * sampled fixtures carried a cached bookmakerCount but returned zero books
 * live), and a stale line is exactly the kind of plausible-looking wrong number
 * this whole design exists to prevent.
 */

/**
 * Tiers a handicap pick may be generated for.
 *
 * "world" is excluded on measured grounds, and NOT because handicap is poorly
 * covered there specifically: in the 55-fixture tier probe those fixtures were
 * thinly priced across the board, with a Match Winner control depth of 7.3
 * against 11.4-12.2 everywhere else, and a mean deepest handicap line of 3.4 —
 * below MIN_BOOKMAKERS before the gate is even applied. Spending a generation
 * on a market that cannot clear the bar is the waste this avoids.
 *
 * Cup ties need no rule of their own. Most are simply unpriced (18 of 26
 * probed returned no bookmakers at all), so they fall out through the ordinary
 * "no qualifying line, not a candidate" path; the priced ones behave like any
 * league fixture and are welcome.
 */
export const HANDICAP_ELIGIBLE_TIERS = ["top", "mid", "minor"] as const;

const TIER_BY_LEAGUE = new Map<number, string>(
  (LEAGUE_CATALOGUE as readonly { id: number; tier: string }[]).map((l) => [l.id, l.tier]),
);

/** Whether a fixture's competition is in scope at all. Cheap, no network. */
export function isHandicapEligibleLeague(leagueApiId: number | null | undefined): boolean {
  if (leagueApiId == null) return false;
  const tier = TIER_BY_LEAGUE.get(leagueApiId);
  return tier != null && (HANDICAP_ELIGIBLE_TIERS as readonly string[]).includes(tier);
}

export type HandicapQuote = {
  value: (typeof EUROPEAN_HANDICAP_VALUES)[number];
  /** Feed label this came from, e.g. "Home -1". */
  label: string;
  best: number;
  median: number;
  bookmakers: number;
  impliedPercent: number;
};

export type SourcedHandicapLine = {
  /** Signed goal handicap applied to the HOME team. Whole numbers only. */
  line: number;
  /** All three selections for that line, each already clearing MIN_BOOKMAKERS. */
  quotes: HandicapQuote[];
  /** Books quoting the THINNEST of the three selections — the line's real depth. */
  depth: number;
  /** Distinct bookmakers on the fixture overall, for context in the log. */
  bookmakerCount: number;
};

export type HandicapSourceResult =
  | { ok: true; line: SourcedHandicapLine }
  | { ok: false; reason: string };

const SIDE_BY_PREFIX: Record<string, (typeof EUROPEAN_HANDICAP_VALUES)[number]> = {
  Home: "HOME",
  Draw: "DRAW",
  Away: "AWAY",
};

const LABEL_BY_VALUE: Record<string, string> = { HOME: "Home", DRAW: "Draw", AWAY: "Away" };

/** Parse a feed label such as "Home -1" into a side and a signed whole line. */
export function parseHandicapLabel(
  label: string,
): { value: (typeof EUROPEAN_HANDICAP_VALUES)[number]; line: number } | null {
  const m = /^(Home|Draw|Away)\s*([+-]\d+(?:\.\d+)?)$/.exec(String(label).trim());
  if (!m) return null;
  const line = Number(m[2]);
  // Fractional lines belong to Asian Handicap, which settles half-win/half-loss
  // and has no representable outcome here. A zero line is a plain 1X2.
  if (!Number.isFinite(line) || !Number.isInteger(line) || line === 0) return null;
  return { value: SIDE_BY_PREFIX[m[1]], line };
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Read the deepest usable handicap line for a fixture.
 *
 * "Usable" requires ALL THREE selections on the line to clear MIN_BOOKMAKERS,
 * not just the one we happen to like. The model is free to choose Home, Draw or
 * Away once the line is fixed, so a line whose Draw is quoted by two books
 * would let it land on a selection that is not a market price at all. In the
 * probe the three selections on a qualifying line moved together (6/6/6), so
 * this costs almost nothing in practice and closes the hole completely.
 *
 * MIN_BOOKMAKERS is imported, never redefined. The measured median depth on
 * this market is exactly 5 against a Match Winner control of 11-12, so the
 * temptation to relax the bar "just for handicap" will be real and must be
 * refused: a 4-book line is not a market price, which is the entire reason the
 * constant exists.
 */
export async function sourceHandicapLine(fixtureApiId: number): Promise<HandicapSourceResult> {
  const response = (await getOdds(fixtureApiId)) as any;
  const bookmakers = response?.[0]?.bookmakers ?? [];
  if (!bookmakers.length) return { ok: false, reason: "no bookmakers priced this fixture" };

  // line -> side -> (bookmaker name -> price). Keyed by bookmaker so one book
  // listing a price twice cannot inflate the depth this all turns on.
  const byLine = new Map<number, Map<string, Map<string, number>>>();
  for (const book of bookmakers) {
    const bet = (book.bets ?? []).find((b: any) => b.name === HANDICAP_MARKET);
    if (!bet) continue;
    for (const v of bet.values ?? []) {
      const parsed = parseHandicapLabel(v.value);
      if (!parsed) continue;
      const odd = Number(v.odd);
      if (!Number.isFinite(odd) || odd <= 1.01) continue;
      const sides = byLine.get(parsed.line) ?? new Map<string, Map<string, number>>();
      byLine.set(parsed.line, sides);
      const books = sides.get(parsed.value) ?? new Map<string, number>();
      sides.set(parsed.value, books);
      if (!books.has(book.name)) books.set(book.name, odd);
    }
  }
  if (byLine.size === 0) return { ok: false, reason: HANDICAP_MARKET + " not quoted on this fixture" };

  let bestLine: SourcedHandicapLine | null = null;
  for (const [line, sides] of byLine) {
    if (EUROPEAN_HANDICAP_VALUES.some((v) => (sides.get(v)?.size ?? 0) < MIN_BOOKMAKERS)) continue;
    const quotes: HandicapQuote[] = EUROPEAN_HANDICAP_VALUES.map((value) => {
      const books = sides.get(value)!;
      const odds = [...books.values()];
      const med = medianOf(odds);
      return {
        value,
        label: LABEL_BY_VALUE[value] + " " + (line > 0 ? "+" : "") + line,
        best: Number(Math.max(...odds).toFixed(2)),
        median: Number(med.toFixed(2)),
        bookmakers: books.size,
        impliedPercent: Number(impliedProbability(med).toFixed(1)),
      };
    });
    const depth = Math.min(...quotes.map((q) => q.bookmakers));
    // Deepest wins; ties break toward the line closest to level, which is the
    // one with a real contest across all three outcomes rather than a formality.
    if (
      !bestLine ||
      depth > bestLine.depth ||
      (depth === bestLine.depth && Math.abs(line) < Math.abs(bestLine.line))
    ) {
      bestLine = { line, quotes, depth, bookmakerCount: bookmakers.length };
    }
  }

  if (!bestLine) {
    const deepest = Math.max(
      0,
      ...[...byLine.values()].map((sides) =>
        Math.min(...EUROPEAN_HANDICAP_VALUES.map((v) => sides.get(v)?.size ?? 0)),
      ),
    );
    return {
      ok: false,
      reason:
        "no line has all three selections quoted by " +
        MIN_BOOKMAKERS +
        "+ bookmakers (deepest was " +
        deepest +
        ")",
    };
  }
  return { ok: true, line: bestLine };
}
