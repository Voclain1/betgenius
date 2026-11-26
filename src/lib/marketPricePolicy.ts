/**
 * One place that says what a pick's price means, shared by generation (the
 * "look for a better market" prompt) and the admin review queue (the verdict
 * shown beside every pick).
 *
 * The owner's rule: a selection quoted under MIN_USEFUL_ODDS (1.10) is almost
 * useless to a punter (a Coventry team Under 2.5 at ~1.03, a Double Chance at
 * 1.05), so it is never the pick when any better market exists. Between
 * MIN_USEFUL_ODDS and PREFERRED_ODDS it is acceptable only when nothing the
 * evidence supports pays more. The automatic publication floor
 * (AUTO_MIN_MEDIAN_ODDS, 1.12) is stricter than MIN_USEFUL_ODDS and is
 * unchanged: this module adds the "find a better market" behaviour and the
 * reviewer-facing verdict, it does not loosen any gate.
 *
 * Median prices, never the single best quote. Pure: no database.
 */
import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";
import { devigProbability } from "@/lib/marketConfirmed";

export const MIN_USEFUL_ODDS = 1.1;
export const PREFERRED_ODDS = 1.2;
/** Bookmakers that must quote a selection before its price is treated as real. */
export const MIN_QUOTING_BOOKS = 3;

export type PriceStatus = "GOOD" | "LOW" | "TOO_SHORT" | "NO_PRICE";
export type PriceVerdict = {
  status: PriceStatus;
  median: number | null;
  books: number | null;
  /** Short reviewer-facing text, e.g. "1.03 · too short to be worth tipping". */
  label: string;
  /** True when the pick should not be published without a better market. */
  blocksPublication: boolean;
};

const fmt = (n: number) => n.toFixed(2);

/** The price verdict for one persisted or drafted pick. */
export function priceVerdict(odds: FixtureOdds | null, marketType: string, selection: unknown): PriceVerdict {
  if (marketType === "TEAM_TOTAL") {
    return { status: "NO_PRICE", median: null, books: null, blocksPublication: true,
      label: "Team total: no bookmaker price on file, so the real odds are unknown (these are usually 1.05 or less)" };
  }
  if (marketType === "DRAW_NO_BET") {
    const side = (selection as { value?: string } | null)?.value;
    const h = odds ? devigProbability(odds, "Match Winner", "Home")?.probability : undefined;
    const a = odds ? devigProbability(odds, "Match Winner", "Away")?.probability : undefined;
    if (h != null && a != null && h + a > 0 && (side === "HOME" || side === "AWAY")) {
      const fair = (h + a) / (side === "HOME" ? h : a);
      return fair < MIN_USEFUL_ODDS
        ? { status: "TOO_SHORT", median: fair, books: null, blocksPublication: true, label: `about ${fmt(fair)} · too short to be worth tipping` }
        : { status: fair < PREFERRED_ODDS ? "LOW" : "GOOD", median: fair, books: null, blocksPublication: false, label: `about ${fmt(fair)} (derived from the match-winner prices)` };
    }
    return { status: "NO_PRICE", median: null, books: null, blocksPublication: false, label: "No price on file" };
  }
  const mapped = toBookmakerSelection(marketType, selection);
  const sel = mapped && odds ? findSelection(odds, mapped.market, mapped.value) : null;
  if (!sel || !Number.isFinite(sel.median)) {
    return { status: "NO_PRICE", median: null, books: null, blocksPublication: false, label: "No price on file" };
  }
  const books = `${sel.bookmakers} bookmaker${sel.bookmakers === 1 ? "" : "s"}`;
  if (sel.median < MIN_USEFUL_ODDS) {
    return { status: "TOO_SHORT", median: sel.median, books: sel.bookmakers, blocksPublication: true,
      label: `${fmt(sel.median)} · too short to be worth tipping (${books})` };
  }
  return { status: sel.median < PREFERRED_ODDS ? "LOW" : "GOOD", median: sel.median, books: sel.bookmakers, blocksPublication: false,
    label: `${fmt(sel.median)} (${books})` };
}

export type PricedOption = { market: string; value: string; label: string; median: number; books: number };

function optionLabel(market: string, value: string, home: string, away: string): string {
  if (market === "Match Winner") return value === "Home" ? `${home} to win` : value === "Away" ? `${away} to win` : "Draw";
  if (market === "Double Chance") return value === "Home/Draw" ? `${home} or Draw` : value === "Draw/Away" ? `${away} or Draw` : `${home} or ${away} (no draw)`;
  if (market === "Both Teams Score") return `Both teams to score: ${value}`;
  return `${value} goals`;
}

/**
 * Every cached headline selection that clears MIN_USEFUL_ODDS with enough
 * bookmakers, highest price first. These are real quotes, not suggestions.
 */
export function pricedOptions(odds: FixtureOdds | null, home: string, away: string): PricedOption[] {
  if (!odds || !Array.isArray(odds.markets)) return [];
  const out: PricedOption[] = [];
  for (const m of odds.markets) {
    if (m.market === "Handicap Result") continue;
    for (const s of m.selections) {
      if (!Number.isFinite(s.median) || s.median < MIN_USEFUL_ODDS || s.bookmakers < MIN_QUOTING_BOOKS) continue;
      out.push({ market: m.market, value: s.value, label: optionLabel(m.market, s.value, home, away), median: s.median, books: s.bookmakers });
    }
  }
  return out.sort((a, b) => b.median - a.median).slice(0, 24);
}

/**
 * Prompt section: the real priced menu and the rule for using it. Empty when
 * the fixture has no usable quote (generation then runs as it always did).
 */
export function betterMarketBlock(odds: FixtureOdds | null, home: string, away: string): string {
  const options = pricedOptions(odds, home, away);
  if (options.length === 0) return "";
  const lines = options.map((o) => `  - ${o.market}: ${o.label} — ${fmt(o.median)} (${o.books} bookmakers)`);
  return `
PRICE RULE — CHOOSE A MARKET THAT PAYS.

Real median bookmaker prices for this match (only selections at ${fmt(MIN_USEFUL_ODDS)} or above):
${lines.join("\n")}

A pick priced under ${fmt(MIN_USEFUL_ODDS)} is almost worthless to a punter and
must not be your pick unless nothing else is supported. Weigh EVERY market the
evidence supports — match winner, Double Chance, Draw No Bet, win either half,
match goals over/under, both teams to score — and prefer the supported selection with a real price (${fmt(PREFERRED_ODDS)} or
more). When the evidence backs a side at a short Double Chance price, check
whether it supports that side to WIN, or an Over line, before settling for the
Double Chance. Never choose a selection only because it pays more than the
evidence supports. Do not return a team total: its price cannot be verified
here, and it is usually a near-formality (a team Under 2.5 pays about 1.03).
`;
}
