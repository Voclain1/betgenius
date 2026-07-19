// Structured betting-market vocabulary for predictions.
//
// `market`/`pick`/`overUnder` on Prediction remain plain display strings (used
// everywhere in the UI), but for every marketType except OTHER they are now
// DERIVED from these structured fields rather than freely typed — that's what
// makes auto-settlement (see resolveMarket) safe to run later. OTHER is the
// escape hatch for exotic markets: free-text market/pick, always manual.

export const MARKET_TYPES = ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS", "CORRECT_SCORE", "OTHER"] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

// The structured (non-OTHER) types a caller — e.g. Gemini — should be
// producing. OTHER is reserved for the manual admin escape hatch.
export const AUTO_MARKET_TYPES = MARKET_TYPES.filter((m) => m !== "OTHER") as Exclude<MarketType, "OTHER">[];

export const MATCH_WINNER_VALUES = ["HOME", "DRAW", "AWAY"] as const;
export const DOUBLE_CHANCE_VALUES = ["HOME_OR_DRAW", "AWAY_OR_DRAW", "HOME_OR_AWAY"] as const;
export const OU_DIRECTIONS = ["OVER", "UNDER"] as const;
export const BTTS_VALUES = ["YES", "NO"] as const;

export type MatchWinnerSelection = { value: (typeof MATCH_WINNER_VALUES)[number] };
export type DoubleChanceSelection = { value: (typeof DOUBLE_CHANCE_VALUES)[number] };
export type OverUnderSelection = { line: number; direction: (typeof OU_DIRECTIONS)[number] };
export type BttsSelection = { value: (typeof BTTS_VALUES)[number] };
export type CorrectScoreSelection = { home: number; away: number };

export type Selection =
  | MatchWinnerSelection
  | DoubleChanceSelection
  | OverUnderSelection
  | BttsSelection
  | CorrectScoreSelection
  | null; // OTHER

const MARKET_LABELS: Record<MarketType, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
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
    case "CORRECT_SCORE":
      return (
        isObj(selection) &&
        Number.isInteger(selection.home) &&
        Number.isInteger(selection.away) &&
        (selection.home as number) >= 0 &&
        (selection.away as number) >= 0
      );
    case "OTHER":
      return selection == null;
    default:
      return false;
  }
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
    case "CORRECT_SCORE": {
      const s = selection as CorrectScoreSelection;
      return { market: MARKET_LABELS.CORRECT_SCORE, pick: `${h} ${s.home}-${s.away} ${a}` };
    }
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

export function resolveMarket(marketType: MarketType, selection: Selection, homeScore: number, awayScore: number): SettlementOutcome {
  if (marketType === "OTHER" || !isValidSelection(marketType, selection)) return null;

  switch (marketType) {
    case "MATCH_WINNER": {
      const v = (selection as MatchWinnerSelection).value;
      const actual = homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "DRAW";
      return v === actual ? "WON" : "LOST";
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
    default:
      return null;
  }
}
