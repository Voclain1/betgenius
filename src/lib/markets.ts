// Structured betting-market vocabulary for predictions.
//
// `market`/`pick`/`overUnder` on Prediction remain plain display strings (used
// everywhere in the UI), but for every marketType except OTHER they are now
// DERIVED from these structured fields rather than freely typed — that's what
// makes auto-settlement (see resolveMarket) safe to run later. OTHER is the
// escape hatch for exotic markets: free-text market/pick, always manual.

export const MARKET_TYPES = ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS", "CORRECT_SCORE", "WIN_EITHER_HALF", "DRAW_NO_BET", "HT_FT", "TEAM_TOTAL", "EUROPEAN_HANDICAP", "SAME_GAME_DOUBLE", "OTHER"] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

// The structured types a caller — e.g. Gemini — should be producing.
//
// OTHER is reserved for the manual admin escape hatch. SAME_GAME_DOUBLE is
// excluded for a different reason: it is COMPOSED from two already-generated
// predictions, never generated. This list is interpolated straight into the
// model's instructions (see analysis.ts), so leaving it in would invite the
// model to emit a double whose legIds point at nothing.
export const AUTO_MARKET_TYPES = MARKET_TYPES.filter(
  (m) => m !== "OTHER" && m !== "SAME_GAME_DOUBLE" && m !== "EUROPEAN_HANDICAP",
) as Exclude<MarketType, "OTHER" | "SAME_GAME_DOUBLE" | "EUROPEAN_HANDICAP">[];

// EUROPEAN_HANDICAP is excluded from the list above for the same reason
// SAME_GAME_DOUBLE is, though the failure it prevents is different. A handicap
// is meaningless without a LINE, and a line is only real if a bookmaker is
// quoting it. Offering the market in the model's general vocabulary would
// invite it to pick a number that reads plausibly and was never priced —
// exactly the fabricated-line mistake that made 39 of 41 Asian-line candidates
// look affordable on lines nobody quotes. The line is sourced from live odds
// and handed to the model as a fixed constraint; see src/lib/handicapLine.ts.

// What the generic admin prediction editor may set. A double's selection is a
// pair of references to other rows, not something meaningful to type into a
// form, and one assembled by hand could pair legs from different fixtures or
// legs that contradict each other — neither of which the editor can check.
// Doubles are created by the assembler and nowhere else. Same reasoning that
// keeps BET_OF_THE_DAY out of the generic category editor.
// Spelled out rather than filtered because z.enum() needs a non-empty TUPLE,
// which Array.filter cannot produce. The two type assertions below make the
// list self-checking: it cannot drift from MARKET_TYPES without a compile
// error, and it cannot silently regain SAME_GAME_DOUBLE.
export const ADMIN_MARKET_TYPES = [
  "MATCH_WINNER",
  "DOUBLE_CHANCE",
  "OVER_UNDER",
  "BTTS",
  "CORRECT_SCORE",
  "WIN_EITHER_HALF",
  "DRAW_NO_BET",
  "HT_FT",
  "TEAM_TOTAL",
  "OTHER",
] as const satisfies readonly Exclude<MarketType, "SAME_GAME_DOUBLE" | "EUROPEAN_HANDICAP">[];

// Every admin-editable type is a real market type, and every market type
// except SAME_GAME_DOUBLE is admin-editable. Adding a market type without
// deciding which side it belongs on is a compile error, not an oversight.
// EUROPEAN_HANDICAP joins SAME_GAME_DOUBLE on the excluded side: its line has
// to come from a real quoted price, and an admin typing one into a form is the
// same fabricated number as a model inventing one, just with a person's name
// on it. Sourced rows only.
type _AdminCoversAllButDouble = Exclude<MarketType, "SAME_GAME_DOUBLE" | "EUROPEAN_HANDICAP"> extends
  (typeof ADMIN_MARKET_TYPES)[number]
  ? true
  : never;
const _adminMarketTypesAreComplete: _AdminCoversAllButDouble = true;
void _adminMarketTypesAreComplete;

export const MATCH_WINNER_VALUES = ["HOME", "DRAW", "AWAY"] as const;

/**
 * European Handicap is a THREE-way market, and that is the whole difference
 * between it and Asian Handicap.
 *
 * Every line the feed quotes carries Home, Draw AND Away — verified against a
 * live /odds response ("Home -1" 4.00, "Draw -1" 3.80, "Away -1" 1.65). So an
 * adjusted scoreline that ends level is not a push to be refunded: it is the
 * Draw selection winning and the other two losing. There is no VOID on this
 * market, which is why it needs no new SettlementOutcome state.
 */
export const EUROPEAN_HANDICAP_VALUES = ["HOME", "DRAW", "AWAY"] as const;
export const DOUBLE_CHANCE_VALUES = ["HOME_OR_DRAW", "AWAY_OR_DRAW", "HOME_OR_AWAY"] as const;
export const OU_DIRECTIONS = ["OVER", "UNDER"] as const;
export const BTTS_VALUES = ["YES", "NO"] as const;
/** Which side is backed to win at least one half outright. No DRAW option — a draw is not a side. */
export const WIN_EITHER_HALF_VALUES = ["HOME", "AWAY"] as const;
/** Draw No Bet backs a side with the draw refunded — so there is no DRAW option. */
export const DRAW_NO_BET_VALUES = ["HOME", "AWAY"] as const;
/** Which side's goals a team total counts. */
export const TEAM_TOTAL_SIDES = ["HOME", "AWAY"] as const;

/**
 * Lines generation may use, and only these.
 *
 * Half-lines cannot push, which is why every OVER_UNDER we generate uses 2.5.
 * Books DO quote whole-number team totals — "Over 2" was seen on every probed
 * fixture — and a team scoring exactly 2 on that line is a refund, not a win.
 * Settlement below handles the push correctly for a hand-entered admin row,
 * but the model is never offered one.
 *
 * 3.5 is absent deliberately: 7.1% of real team-innings clear it, so the pick
 * is effectively decided before kickoff. 2.5 is UNDER-only for the same reason
 * from the other direction — only 16.0% go over it.
 */
export const TEAM_TOTAL_GENERATABLE_LINES = [0.5, 1.5, 2.5] as const;

/** Each half of an HT/FT pick is an ordinary 1X2 result. */
export const HT_FT_VALUES = ["HOME", "DRAW", "AWAY"] as const;

export type MatchWinnerSelection = { value: (typeof MATCH_WINNER_VALUES)[number] };
export type DoubleChanceSelection = { value: (typeof DOUBLE_CHANCE_VALUES)[number] };
export type OverUnderSelection = { line: number; direction: (typeof OU_DIRECTIONS)[number] };
export type BttsSelection = { value: (typeof BTTS_VALUES)[number] };
export type WinEitherHalfSelection = { value: (typeof WIN_EITHER_HALF_VALUES)[number] };
export type DrawNoBetSelection = { value: (typeof DRAW_NO_BET_VALUES)[number] };
/** Half-time result and full-time result, both required — this is one pick, not two. */
export type HtFtSelection = { ht: (typeof HT_FT_VALUES)[number]; ft: (typeof HT_FT_VALUES)[number] };
/** One side's goal count against a line — the team-scoped counterpart of OVER_UNDER. */
export type TeamTotalSelection = {
  side: (typeof TEAM_TOTAL_SIDES)[number];
  line: number;
  direction: (typeof OU_DIRECTIONS)[number];
};
export type CorrectScoreSelection = { home: number; away: number };
/**
 * A same-game double: the ids of the two Prediction rows it is composed of.
 *
 * The only selection shape that REFERENCES other rows rather than describing
 * an outcome on its own. That is deliberate — the legs are real published
 * picks with their own reasoning, confidence and settlement, and duplicating
 * their content here would create a second copy that could drift from the
 * rows readers actually see.
 */
export type SameGameDoubleSelection = { legIds: [string, string] };

/**
 * `line` is the goal handicap applied to the HOME team, matching how the feed
 * labels it: "Home -1" / "Draw -1" / "Away -1" all describe the same line, a
 * one-goal deduction from the home side. Whole numbers only — European
 * Handicap never quotes the quarter and half lines Asian Handicap does.
 */
export type EuropeanHandicapSelection = { value: (typeof EUROPEAN_HANDICAP_VALUES)[number]; line: number };

export type Selection =
  | MatchWinnerSelection
  | EuropeanHandicapSelection
  | DoubleChanceSelection
  | OverUnderSelection
  | BttsSelection
  | CorrectScoreSelection
  | WinEitherHalfSelection
  | DrawNoBetSelection
  | HtFtSelection
  | TeamTotalSelection
  | SameGameDoubleSelection
  | null; // OTHER

const MARKET_LABELS: Record<MarketType, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
  WIN_EITHER_HALF: "Win Either Half",
  DRAW_NO_BET: "Draw No Bet",
  HT_FT: "Half-Time / Full-Time",
  TEAM_TOTAL: "Team Total Goals",
  EUROPEAN_HANDICAP: "Handicap",
  // Display label only. The enum value stays SAME_GAME_DOUBLE everywhere:
  // it is written into Prediction.marketType and PredictionCategoryTag rows
  // that already exist in production.
  SAME_GAME_DOUBLE: "Combo Bet",
  OTHER: "Other",
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Strictly checks that `selection`'s shape matches what `marketType` requires. */
export function isValidSelection(marketType: MarketType, selection: unknown): selection is Selection {
  switch (marketType) {
    case "MATCH_WINNER":
      return isObj(selection) && (MATCH_WINNER_VALUES as readonly unknown[]).includes(selection.value);
    case "EUROPEAN_HANDICAP":
      return (
        isObj(selection) &&
        (EUROPEAN_HANDICAP_VALUES as readonly unknown[]).includes(selection.value) &&
        typeof selection.line === "number" &&
        // Whole numbers only. A fractional line here means the value came from
        // an Asian Handicap quote, which settles half-win/half-loss and cannot
        // be expressed by SettlementOutcome — rejecting it is what stops that
        // market leaking in through this one.
        Number.isInteger(selection.line) &&
        // A zero line is a plain Match Winner wearing a handicap label; the
        // feed does quote "Home +0" on ASIAN handicap, never on this market.
        selection.line !== 0
      );
    case "DOUBLE_CHANCE":
      return isObj(selection) && (DOUBLE_CHANCE_VALUES as readonly unknown[]).includes(selection.value);
    case "OVER_UNDER":
      return (
        isObj(selection) &&
        typeof selection.line === "number" &&
        selection.line > 0 &&
        (OU_DIRECTIONS as readonly unknown[]).includes(selection.direction)
      );
    case "BTTS":
      return isObj(selection) && (BTTS_VALUES as readonly unknown[]).includes(selection.value);
    case "WIN_EITHER_HALF":
      return isObj(selection) && (WIN_EITHER_HALF_VALUES as readonly unknown[]).includes(selection.value);
    case "DRAW_NO_BET":
      return isObj(selection) && (DRAW_NO_BET_VALUES as readonly unknown[]).includes(selection.value);
    case "TEAM_TOTAL":
      // Accepts WHOLE lines too. An admin may legitimately enter one, and
      // settlement resolves it as a push; only generation is restricted, via
      // isGeneratableTeamTotal below.
      return (
        isObj(selection) &&
        (TEAM_TOTAL_SIDES as readonly unknown[]).includes(selection.side) &&
        typeof selection.line === "number" &&
        selection.line > 0 &&
        (OU_DIRECTIONS as readonly unknown[]).includes(selection.direction)
      );
    case "HT_FT":
      // BOTH halves required. A selection carrying only one is not a partially
      // specified HT/FT pick, it is a different market wearing this one's name.
      return (
        isObj(selection) &&
        (HT_FT_VALUES as readonly unknown[]).includes(selection.ht) &&
        (HT_FT_VALUES as readonly unknown[]).includes(selection.ft)
      );
    case "CORRECT_SCORE":
      return (
        isObj(selection) &&
        Number.isInteger(selection.home) &&
        Number.isInteger(selection.away) &&
        (selection.home as number) >= 0 &&
        (selection.away as number) >= 0
      );
    case "SAME_GAME_DOUBLE": {
      if (!isObj(selection) || !Array.isArray(selection.legIds)) return false;
      const ids = selection.legIds;
      // Exactly two, both real ids, and not the same row twice — a "double"
      // of one prediction with itself would settle as that prediction while
      // presenting as a compound pick.
      return (
        ids.length === 2 &&
        ids.every((id) => typeof id === "string" && id.length > 0) &&
        ids[0] !== ids[1]
      );
    }
    case "OTHER":
      return selection == null;
    default:
      return false;
  }
}

/**
 * Whether a team total is one GENERATION may produce.
 *
 * Same enforcement shape as isProducibleSelection in src/lib/odds.ts: the
 * prompt states the rule and this is what makes it true, because a prompt
 * alone has already proven insufficient once this session.
 *
 * Two restrictions, both from measured data (scripts/research-team-totals.ts,
 * 156 real team-innings):
 *   - half-lines only, so a pick can never push;
 *   - 2.5 is UNDER-only, since just 16.0% of team-innings go over it and 3.5
 *     is excluded outright at 7.1% — a line the data barely crosses is decided
 *     before kickoff.
 */
export function isGeneratableTeamTotal(selection: unknown): boolean {
  if (!isValidSelection("TEAM_TOTAL", selection)) return false;
  const s = selection as TeamTotalSelection;
  if (!(TEAM_TOTAL_GENERATABLE_LINES as readonly number[]).includes(s.line)) return false;
  if (s.line === 2.5 && s.direction === "OVER") return false;
  return true;
}

/** Derives the display market/pick strings from structured fields. OTHER passes the free-text pair through untouched. */
export function deriveMarketAndPick(
  marketType: MarketType,
  selection: Selection,
  home?: string | null,
  away?: string | null,
  fallback?: { market: string; pick: string },
): { market: string; pick: string } {
  const h = home || "Home";
  const a = away || "Away";
  switch (marketType) {
    case "MATCH_WINNER": {
      const v = (selection as MatchWinnerSelection).value;
      return { market: MARKET_LABELS.MATCH_WINNER, pick: v === "HOME" ? `${h} to win` : v === "AWAY" ? `${a} to win` : "Draw" };
    }
    case "DOUBLE_CHANCE": {
      const v = (selection as DoubleChanceSelection).value;
      const pick = v === "HOME_OR_DRAW" ? `${h} or Draw` : v === "AWAY_OR_DRAW" ? `${a} or Draw` : `${h} or ${a}`;
      return { market: MARKET_LABELS.DOUBLE_CHANCE, pick };
    }
    case "OVER_UNDER": {
      const s = selection as OverUnderSelection;
      return { market: MARKET_LABELS.OVER_UNDER, pick: `${s.direction === "OVER" ? "Over" : "Under"} ${s.line} Goals` };
    }
    case "BTTS": {
      const v = (selection as BttsSelection).value;
      return { market: MARKET_LABELS.BTTS, pick: v === "YES" ? "Yes" : "No" };
    }
    case "WIN_EITHER_HALF": {
      const v = (selection as WinEitherHalfSelection).value;
      return { market: MARKET_LABELS.WIN_EITHER_HALF, pick: `${v === "HOME" ? h : a} to win either half` };
    }
    case "EUROPEAN_HANDICAP": {
      const s = selection as EuropeanHandicapSelection;
      // Signed, always — "+1" and "-1" are different bets and a bare "1" is
      // ambiguous. The line is stated against the team it applies to so the
      // pick reads the way a bettor would say it out loud.
      const signed = `${s.line > 0 ? "+" : ""}${s.line}`;
      const side = s.value === "HOME" ? h : s.value === "AWAY" ? a : "Draw";
      const pick = s.value === "DRAW"
        ? `Draw (${h} ${signed})`
        : `${side} (${h} ${signed})`;
      return { market: MARKET_LABELS.EUROPEAN_HANDICAP, pick };
    }
    case "CORRECT_SCORE": {
      const s = selection as CorrectScoreSelection;
      return { market: MARKET_LABELS.CORRECT_SCORE, pick: `${h} ${s.home}-${s.away} ${a}` };
    }
    case "DRAW_NO_BET": {
      const v = (selection as DrawNoBetSelection).value;
      return { market: MARKET_LABELS.DRAW_NO_BET, pick: `${v === "HOME" ? h : a} (draw no bet)` };
    }
    case "TEAM_TOTAL": {
      const s = selection as TeamTotalSelection;
      const team = s.side === "HOME" ? h : a;
      return {
        market: MARKET_LABELS.TEAM_TOTAL,
        pick: `${team} ${s.direction === "OVER" ? "Over" : "Under"} ${s.line} Goals`,
      };
    }
    case "HT_FT": {
      const sel = selection as HtFtSelection;
      const side = (r: string) => (r === "HOME" ? h : r === "AWAY" ? a : "Draw");
      return { market: MARKET_LABELS.HT_FT, pick: `${side(sel.ht)} at HT / ${side(sel.ft)} at FT` };
    }
    // A double's pick text names both legs, which live in other rows this pure
    // function cannot read. The assembler derives each leg's text with this
    // same function and writes the combined string, passing it as `fallback`.
    case "SAME_GAME_DOUBLE":
      return fallback ?? { market: MARKET_LABELS.SAME_GAME_DOUBLE, pick: "" };
    case "OTHER":
    default:
      return fallback ?? { market: MARKET_LABELS.OTHER, pick: "" };
  }
}

export function deriveOverUnderText(line?: number | null, direction?: string | null): string | null {
  if (line == null || !direction) return null;
  return `${direction === "OVER" ? "Over" : "Under"} ${line} Goals`;
}

// --- A1 prerequisite: settlement resolver (not yet wired to a route/cron —
// depends on a finished-score source, which this app doesn't populate yet;
// see the Fixture-ingestion gap noted alongside this change). Pure function,
// safe to import once that's sorted out. ---

export type SettlementOutcome = "WON" | "LOST" | "VOID" | null; // null = cannot auto-resolve (OTHER, or bad input)

/**
 * The half-time score, for markets that need to see the halves separately.
 *
 * Optional because every other market resolves from the full-time regulation
 * score alone, and because a caller that cannot supply it must get a clean
 * "cannot auto-resolve" (null) rather than a guess — see WIN_EITHER_HALF below.
 */
export type HalfTimeScore = { home: number; away: number };

/** Scores passed here must be regulation-time scores; extra time and shootouts never count for these markets. */
export function resolveMarket(
  marketType: MarketType,
  selection: Selection,
  regulationHomeScore: number,
  regulationAwayScore: number,
  halftime?: HalfTimeScore | null,
): SettlementOutcome {
  if (marketType === "OTHER" || !isValidSelection(marketType, selection)) return null;
  // A same-game double resolves from its two LEGS' outcomes, which live in
  // other rows. Reading them would make this function impure and force every
  // caller and every test to have a database. It stays a pure scoreline
  // resolver; composeComboOutcome in src/lib/sameGameDouble.ts does the
  // composition, and the settle route calls it after the legs are settled.
  if (marketType === "SAME_GAME_DOUBLE") return null;

  const homeScore = regulationHomeScore;
  const awayScore = regulationAwayScore;

  switch (marketType) {
    case "MATCH_WINNER": {
      const v = (selection as MatchWinnerSelection).value;
      const actual = homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "DRAW";
      return v === actual ? "WON" : "LOST";
    }
    case "EUROPEAN_HANDICAP": {
      // Composes from the two regulation-time integers and nothing else — no
      // new lookup, no new column, which is what made this market cheap to add.
      //
      // NO VOID. On a two-way (Asian) handicap an adjusted tie refunds the
      // stake, and treating this market the same way would settle every
      // adjusted-draw pick wrongly: here DRAW is one of the three things you
      // can back, so a level adjusted score means the Draw selection WON and
      // the other two LOST. Verified against a live quote carrying
      // "Home -1", "Draw -1" and "Away -1" side by side.
      const s = selection as EuropeanHandicapSelection;
      const adjustedHome = homeScore + s.line;
      const actual = adjustedHome > awayScore ? "HOME" : adjustedHome < awayScore ? "AWAY" : "DRAW";
      return s.value === actual ? "WON" : "LOST";
    }
    case "DOUBLE_CHANCE": {
      const v = (selection as DoubleChanceSelection).value;
      const actual = homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "DRAW";
      const covers: Record<string, string[]> = {
        HOME_OR_DRAW: ["HOME", "DRAW"],
        AWAY_OR_DRAW: ["AWAY", "DRAW"],
        HOME_OR_AWAY: ["HOME", "AWAY"],
      };
      return covers[v].includes(actual) ? "WON" : "LOST";
    }
    case "OVER_UNDER": {
      const s = selection as OverUnderSelection;
      const total = homeScore + awayScore;
      if (total === s.line) return "VOID"; // push — only reachable on whole-number lines
      const over = total > s.line;
      return (s.direction === "OVER") === over ? "WON" : "LOST";
    }
    case "BTTS": {
      const v = (selection as BttsSelection).value;
      const bothScored = homeScore > 0 && awayScore > 0;
      return (v === "YES") === bothScored ? "WON" : "LOST";
    }
    case "CORRECT_SCORE": {
      const s = selection as CorrectScoreSelection;
      return s.home === homeScore && s.away === awayScore ? "WON" : "LOST";
    }
    /**
     * DRAW NO BET — the backed side must win; a draw refunds the stake.
     *
     * VOID here is the market's defining feature, not an edge case. Roughly a
     * quarter of matches end level, so this marketType will produce far more
     * VOIDs than every existing one combined — see scripts/check-void-handling.ts,
     * which exists to prove nothing downstream treats VOID as negligible.
     */
    /**
     * TEAM TOTAL — one side's goals against a line.
     *
     * Needs strictly LESS than OVER_UNDER, which sums both sides. Reads the
     * backed team's goals directly, so there is nothing to derive and nothing
     * to invent.
     *
     * A whole-number line pushes when the count lands exactly on it. Generation
     * never produces one (see isGeneratableTeamTotal), but an admin-entered row
     * must still resolve correctly rather than being scored as a loss.
     */
    case "TEAM_TOTAL": {
      const s = selection as TeamTotalSelection;
      const goals = s.side === "HOME" ? homeScore : awayScore;
      if (goals === s.line) return "VOID";
      return (s.direction === "OVER") === (goals > s.line) ? "WON" : "LOST";
    }
    case "DRAW_NO_BET": {
      const v = (selection as DrawNoBetSelection).value;
      if (homeScore === awayScore) return "VOID";
      const winner = homeScore > awayScore ? "HOME" : "AWAY";
      return v === winner ? "WON" : "LOST";
    }
    /**
     * HALF-TIME / FULL-TIME — both results must match, as one pick.
     *
     * Fails closed exactly as WIN_EITHER_HALF does: without a half-time score
     * there is no way to resolve the first leg, and guessing it from the
     * full-time score would invent a result. Returning null hands the row to a
     * human instead.
     *
     * The full-time leg reads REGULATION time, so a tie settled in extra time
     * or on penalties is a draw here — the same basis every other market in
     * this file uses.
     */
    case "HT_FT": {
      const sel = selection as HtFtSelection;
      if (!halftime || !Number.isFinite(halftime.home) || !Number.isFinite(halftime.away)) return null;
      // A half-time score above the full-time score would mean goals were
      // un-scored; the data is wrong, so refuse rather than resolve from it.
      if (halftime.home > homeScore || halftime.away > awayScore) return null;
      const resultOf = (hs: number, as: number) => (hs > as ? "HOME" : as > hs ? "AWAY" : "DRAW");
      const htActual = resultOf(halftime.home, halftime.away);
      const ftActual = resultOf(homeScore, awayScore);
      return sel.ht === htActual && sel.ft === ftActual ? "WON" : "LOST";
    }
    /**
     * WIN EITHER HALF — the backed side wins at least ONE half outright.
     *
     * The second half is DERIVED, not fetched: full-time regulation minus
     * half-time. api-football returns both on the same /fixtures response the
     * settlement lookup already makes, so this costs no extra call and invents
     * no line value — the reason this market was picked ahead of Handicap and
     * HT/FT, which need a line or a nine-way grid.
     *
     * Two invariants are checked rather than assumed, because a wrong
     * settlement here is silent:
     *
     *   - halftime must be SUPPLIED. Without it there is no honest answer, so
     *     this returns null ("cannot auto-resolve") and the settle route flags
     *     the row for a human. It must never fall back to the full-time result:
     *     a side can win the match while losing both halves individually is
     *     impossible, but a side can win the match having won NEITHER half
     *     (e.g. 1-0 HT, 0-1 2H is a 1-1 draw — and 2-1 FT from 1-0 HT / 1-1 2H
     *     means the winner won only the first half). Full time does not answer
     *     the question.
     *   - the derived second half must be non-negative. Goals cannot be
     *     un-scored, so a negative half means the two scores disagree and the
     *     row is not safely resolvable.
     */
    case "WIN_EITHER_HALF": {
      const v = (selection as WinEitherHalfSelection).value;
      if (!halftime || !Number.isFinite(halftime.home) || !Number.isFinite(halftime.away)) return null;

      const secondHalfHome = homeScore - halftime.home;
      const secondHalfAway = awayScore - halftime.away;
      if (secondHalfHome < 0 || secondHalfAway < 0) return null;

      const wonFirst = v === "HOME" ? halftime.home > halftime.away : halftime.away > halftime.home;
      const wonSecond = v === "HOME" ? secondHalfHome > secondHalfAway : secondHalfAway > secondHalfHome;
      return wonFirst || wonSecond ? "WON" : "LOST";
    }
    default:
      return null;
  }
}
