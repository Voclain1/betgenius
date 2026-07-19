"use client";
import {
  MARKET_TYPES,
  MATCH_WINNER_VALUES,
  DOUBLE_CHANCE_VALUES,
  OU_DIRECTIONS,
  BTTS_VALUES,
  type MarketType,
  type Selection,
} from "@/lib/markets";

const MARKET_TYPE_LABELS: Record<MarketType, string> = {
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  OVER_UNDER: "Total Goals (Over/Under)",
  BTTS: "Both Teams to Score",
  CORRECT_SCORE: "Correct Score",
  OTHER: "Other (free text — always settled manually)",
};

export type MarketFormState = {
  marketType: MarketType;
  selection: Selection;
  otherMarket: string;
  otherPick: string;
  ouLine: string;
  ouDirection: "OVER" | "UNDER";
};

export function emptyMarketFormState(): MarketFormState {
  return { marketType: "MATCH_WINNER", selection: null, otherMarket: "", otherPick: "", ouLine: "", ouDirection: "OVER" };
}

const inputCls = "mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2";

export function MarketSelectionFields({
  value,
  onChange,
  homeTeam,
  awayTeam,
}: {
  value: MarketFormState;
  onChange: (next: MarketFormState) => void;
  homeTeam?: string;
  awayTeam?: string;
}) {
  const h = homeTeam || "Home";
  const a = awayTeam || "Away";

  return (
    <>
      <label className="text-sm">Market type
        <select value={value.marketType}
          onChange={(e) => onChange({ ...value, marketType: e.target.value as MarketType, selection: null })}
          className={inputCls}>
          {MARKET_TYPES.map((m) => <option key={m} value={m}>{MARKET_TYPE_LABELS[m]}</option>)}
        </select>
      </label>

      {value.marketType === "MATCH_WINNER" && (
        <label className="text-sm">Selection
          <select value={(value.selection as any)?.value ?? ""}
            onChange={(e) => onChange({ ...value, selection: { value: e.target.value as any } })}
            className={inputCls}>
            <option value="" disabled>Choose…</option>
            {MATCH_WINNER_VALUES.map((v) => (
              <option key={v} value={v}>{v === "HOME" ? `${h} to win` : v === "AWAY" ? `${a} to win` : "Draw"}</option>
            ))}
          </select>
        </label>
      )}

      {value.marketType === "DOUBLE_CHANCE" && (
        <label className="text-sm">Selection
          <select value={(value.selection as any)?.value ?? ""}
            onChange={(e) => onChange({ ...value, selection: { value: e.target.value as any } })}
            className={inputCls}>
            <option value="" disabled>Choose…</option>
            {DOUBLE_CHANCE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v === "HOME_OR_DRAW" ? `${h} or Draw` : v === "AWAY_OR_DRAW" ? `${a} or Draw` : `${h} or ${a}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {value.marketType === "OVER_UNDER" && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>Line
            <input type="number" step="0.5" min="0" placeholder="e.g. 2.5"
              value={(value.selection as any)?.line ?? ""}
              onChange={(e) => onChange({ ...value, selection: { line: Number(e.target.value), direction: (value.selection as any)?.direction ?? "OVER" } })}
              className={inputCls} />
          </label>
          <label>Direction
            <select value={(value.selection as any)?.direction ?? "OVER"}
              onChange={(e) => onChange({ ...value, selection: { line: (value.selection as any)?.line ?? 0, direction: e.target.value as any } })}
              className={inputCls}>
              {OU_DIRECTIONS.map((d) => <option key={d} value={d}>{d === "OVER" ? "Over" : "Under"}</option>)}
            </select>
          </label>
        </div>
      )}

      {value.marketType === "BTTS" && (
        <label className="text-sm">Selection
          <select value={(value.selection as any)?.value ?? ""}
            onChange={(e) => onChange({ ...value, selection: { value: e.target.value as any } })}
            className={inputCls}>
            <option value="" disabled>Choose…</option>
            {BTTS_VALUES.map((v) => <option key={v} value={v}>{v === "YES" ? "Yes" : "No"}</option>)}
          </select>
        </label>
      )}

      {value.marketType === "CORRECT_SCORE" && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>{h} score
            <input type="number" min="0" step="1"
              value={(value.selection as any)?.home ?? ""}
              onChange={(e) => onChange({ ...value, selection: { home: Number(e.target.value), away: (value.selection as any)?.away ?? 0 } })}
              className={inputCls} />
          </label>
          <label>{a} score
            <input type="number" min="0" step="1"
              value={(value.selection as any)?.away ?? ""}
              onChange={(e) => onChange({ ...value, selection: { home: (value.selection as any)?.home ?? 0, away: Number(e.target.value) } })}
              className={inputCls} />
          </label>
        </div>
      )}

      {value.marketType === "OTHER" && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>Market
            <input value={value.otherMarket} onChange={(e) => onChange({ ...value, otherMarket: e.target.value })}
              placeholder="e.g. Corners, Cards, Anytime Scorer" className={inputCls} />
          </label>
          <label>Pick
            <input value={value.otherPick} onChange={(e) => onChange({ ...value, otherPick: e.target.value })}
              placeholder="e.g. Over 9.5 corners" className={inputCls} />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm md:col-span-2">
        <label>Over/Under line <span className="text-gray-500">(always shown as its own pick)</span>
          <input type="number" step="0.5" min="0" placeholder="e.g. 2.5" value={value.ouLine}
            onChange={(e) => onChange({ ...value, ouLine: e.target.value })}
            className={inputCls} />
        </label>
        <label>Direction
          <select value={value.ouDirection} onChange={(e) => onChange({ ...value, ouDirection: e.target.value as any })}
            className={inputCls}>
            {OU_DIRECTIONS.map((d) => <option key={d} value={d}>{d === "OVER" ? "Over" : "Under"}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}
