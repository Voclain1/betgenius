import { bookmakerOverround } from "./predictionReliability";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "./odds";
import type { ReliabilityPriceInput } from "./reliabilitySnapshot";

/** Preserve provider clocks and exact labels without touching the existing price/selection gate. */
export function captureReliabilityPrice(
  cache: { oddsJson: unknown; fetchedAt: Date | null } | undefined,
  marketType: string,
  selection: unknown,
): ReliabilityPriceInput | undefined {
  try {
    const raw = cache?.oddsJson as FixtureOdds | null;
    const mapped = toBookmakerSelection(marketType, selection);
    const selected =
      raw && mapped ? findSelection(raw, mapped.market, mapped.value) : null;
    const expected =
      mapped?.market === "Match Winner"
        ? 3
        : mapped?.market === "Both Teams Score"
          ? 2
          : null;
    const selections =
      raw?.markets.find((m) => m.market === mapped?.market)?.selections ?? [];
    const overrounds = expected
      ? (selected?.quotes ?? []).flatMap((book) => {
          const prices = selections.map(
            (s) => s.quotes?.find((b) => b.bookmaker === book.bookmaker)?.odd,
          );
          const overround = prices.every((p): p is number => p != null)
            ? bookmakerOverround(prices, expected)
            : null;
          return overround == null
            ? []
            : [{ bookmaker: book.bookmaker, overround }];
        })
      : [];
    return {
      market: mapped?.market ?? null,
      selection: mapped?.value ?? null,
      derived: marketType === "DRAW_NO_BET",
      observedAt: cache?.fetchedAt?.toISOString() ?? null,
      providerUpdatedAt: raw?.update ?? null,
      overrounds,
      quotes: (selected?.quotes ?? []).map((book) => ({
        bookmaker: book.bookmaker,
        odds: book.odd,
        market: mapped!.market,
        selection: mapped!.value,
        observedAt: cache?.fetchedAt?.toISOString() ?? "",
        providerUpdatedAt: raw?.update ?? null,
        source: "api-football",
        suspended: null,
      })),
    };
  } catch {
    return undefined;
  } // Malformed diagnostics must never affect the baseline assessment.
}
