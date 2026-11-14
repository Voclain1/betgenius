import { toBookmakerSelection, type FixtureOdds } from "./odds";
import { matchOddsState } from "./matchOdds";

export function discoveryQuote(
  row: {
    kickoff: Date | null;
    fixtureApiId: number | null;
    marketType: string;
    selection: unknown;
  },
  cache:
    | { fixtureApiId: number | null; fetchedAt: Date | null; oddsJson: unknown }
    | undefined,
  now: Date,
) {
  if (
    !row.kickoff ||
    row.fixtureApiId == null ||
    cache?.fixtureApiId !== row.fixtureApiId
  )
    return null;
  const raw = cache.oddsJson as FixtureOdds | null;
  if (
    !raw ||
    !Array.isArray(raw.markets) ||
    !cache.fetchedAt ||
    cache.fetchedAt > now
  )
    return null;
  // Ignore malformed/unnamed offers instead of inferring a bookmaker price.
  const odds: FixtureOdds = {
    ...raw,
    markets: raw.markets
      .filter((m) => m && Array.isArray(m.selections))
      .map((m) => ({
        ...m,
        selections: m.selections
          .filter(
            (s) =>
              s &&
              typeof s.value === "string" &&
              Number.isFinite(s.best) &&
              s.best > 1 &&
              Number.isFinite(s.bookmakers) &&
              s.bookmakers > 0,
          )
          .map((s) => ({
            ...s,
            quotes: Array.isArray(s.quotes)
              ? s.quotes.filter(
                  (q) =>
                    q &&
                    typeof q.bookmaker === "string" &&
                    q.bookmaker.trim() &&
                    Number.isFinite(q.odd) &&
                    q.odd > 1,
                )
              : [],
          })),
      })),
  };

  const state = matchOddsState({
    odds,
    fetchedAt: cache.fetchedAt,
    kickoff: row.kickoff,
    now,
  });
  if (state.state !== "current" && state.state !== "archived") return null;
  const mapped = toBookmakerSelection(row.marketType, row.selection);
  const selection =
    mapped &&
    odds?.markets
      .find((m) => m.market === mapped.market)
      ?.selections.find((s) => s.value === mapped.value);
  const quotes =
    selection?.quotes?.filter(
      (q) => q.bookmaker?.trim() && Number.isFinite(q.odd) && q.odd > 1,
    ) ?? [];
  const best = quotes.reduce<(typeof quotes)[number] | null>(
    (a, q) => (!a || q.odd > a.odd ? q : a),
    null,
  );
  return best
    ? {
        decimal: best.odd,
        bookmaker: best.bookmaker,
        at: state.asOf!,
        timeBasis: odds.update ? ("provider" as const) : ("fetch" as const),
        kind: state.state,
      }
    : null;
}
