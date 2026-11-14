import {
  isValidSelection,
  resolveMarket,
  type MarketType,
  type Selection,
} from "./markets";
import { publicationObservation } from "./predictionExplanation";
export const PERFORMANCE_CAP = 5000;
export type PerformanceRow = {
  id: string;
  fixtureApiId: number | null;
  fixtureId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueName: string | null;
  leagueApiId: number | null;
  kickoff: Date | null;
  publishedAt: Date | null;
  settledAt: Date | null;
  outcome: string;
  marketType: string;
  selection: unknown;
  market: string;
  pick: string;
  category: string;
  categories: Array<{ category: string }>;
  provenance: string | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  marketConfirmation: unknown;
  rewriteCount: number;
  matchSlugKey: string | null;
};
export type PerformanceFilter = {
  months: number;
  team: string;
  category: string;
  market: string;
  league: string;
  outcome: string;
  page: number;
};
export function performanceFilter(
  p: Record<string, string | string[] | undefined>,
): PerformanceFilter {
  const val = (k: string) =>
    typeof p[k] === "string" ? (p[k] as string).trim() : "";
  return {
    months: [1, 3, 6, 12].includes(Number(val("months")))
      ? Number(val("months"))
      : 3,
    team: val("team").slice(0, 80),
    category: /^[A-Z_]{1,25}$/.test(val("category")) ? val("category") : "",
    market: /^[A-Z_]{1,30}$/.test(val("market")) ? val("market") : "",
    league: val("league").slice(0, 80),
    outcome: ["WON", "LOST", "VOID", "PENDING", "OTHER"].includes(
      val("outcome"),
    )
      ? val("outcome")
      : "",
    page: Math.max(1, Math.min(250, Math.floor(Number(val("page"))) || 1)),
  };
}
export function performanceBounds(months: number, now = new Date()) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(key.find((x) => x.type === "year")!.value),
    m = Number(key.find((x) => x.type === "month")!.value);
  const d = new Date(Date.UTC(y, m - months, 1));
  return {
    start: new Date(`${d.toISOString().slice(0, 7)}-01T00:00:00+01:00`),
    end: now,
  };
}
const valid = (d: Date | null): d is Date => !!d && Number.isFinite(+d);
export function settlementVerified(r: PerformanceRow, now = new Date()) {
  if (
    !r.fixtureId &&
    !(Number.isInteger(r.fixtureApiId) && r.fixtureApiId! > 0)
  )
    return false;
  if (
    !valid(r.kickoff) ||
    !valid(r.publishedAt) ||
    !valid(r.settledAt) ||
    +r.publishedAt >= +r.kickoff ||
    +r.settledAt < +r.kickoff ||
    +r.settledAt > +now
  )
    return false;
  if (!["WON", "LOST", "VOID"].includes(r.outcome)) return false;
  // Manual voids may represent cancellation: score-free voids remain recorded, not independently verified.
  if (
    !Number.isInteger(r.finalHomeScore) ||
    !Number.isInteger(r.finalAwayScore) ||
    r.finalHomeScore! < 0 ||
    r.finalAwayScore! < 0
  )
    return false;
  if (!isValidSelection(r.marketType as MarketType, r.selection)) return false;
  return (
    resolveMarket(
      r.marketType as MarketType,
      r.selection as Selection,
      r.finalHomeScore!,
      r.finalAwayScore!,
    ) === r.outcome
  );
}
export function indicativeReturn(
  outcome: string,
  decimal: number,
): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return outcome === "WON"
    ? decimal - 1
    : outcome === "LOST"
      ? -1
      : outcome === "VOID"
        ? 0
        : null;
}
export function historyPrice(r: PerformanceRow) {
  if (
    !r.kickoff ||
    r.rewriteCount !== 0 ||
    (!r.fixtureId && !(Number.isInteger(r.fixtureApiId) && r.fixtureApiId! > 0))
  )
    return null;
  const q = publicationObservation({
    confirmation: r.marketConfirmation,
    kickoff: r.kickoff,
    publishedAt: r.publishedAt,
    marketType: r.marketType,
    selection: r.selection,
  });
  if (!q || !r.publishedAt) return null;
  const snapshot = (r.marketConfirmation as any).publicationQuoteEvidence;
  if (+r.publishedAt - Date.parse(snapshot.confirmedAt) > 60000) return null;
  const prices = q.sources.map((p) => p.odd).sort((a, b) => a - b),
    n = prices.length;
  if (
    !n ||
    new Set(q.sources.map((p) => p.bookmaker.trim().toLowerCase())).size !==
      n ||
    snapshot.entryBookmakers !== n
  )
    return null;
  const median =
    n % 2 ? prices[Math.floor(n / 2)] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
  return Math.abs(median - q.median) < 1e-8 ? q : null;
}
export function duplicateIds(rows: readonly PerformanceRow[]) {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    const path: string[] = [];
    let current = key;
    while (parent.has(current) && parent.get(current) !== current) {
      path.push(current);
      current = parent.get(current)!;
    }
    parent.set(current, current);
    for (const node of path) parent.set(node, current);
    return current;
  };
  const tokens = (r: PerformanceRow) => [
    ...(Number.isInteger(r.fixtureApiId) && r.fixtureApiId! > 0
      ? [`api:${r.fixtureApiId}:${r.marketType}`]
      : []),
    ...(r.fixtureId ? [`native:${r.fixtureId}:${r.marketType}`] : []),
  ];
  for (const r of unique) {
    const keys = tokens(r);
    if (keys.length === 2) parent.set(root(keys[1]), root(keys[0]));
  }
  const groups = new Map<string, string[]>();
  for (const r of unique) {
    const key = tokens(r)[0];
    if (!key) continue;
    const group = root(key);
    groups.set(group, [...(groups.get(group) ?? []), r.id]);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}
export function performanceSummary(
  input: readonly PerformanceRow[],
  now = new Date(),
) {
  const rows = [...new Map(input.map((r) => [r.id, r])).values()],
    duplicates = duplicateIds(rows);
  const verified = rows.filter(
    (r) => !duplicates.has(r.id) && settlementVerified(r, now),
  );
  const won = verified.filter((r) => r.outcome === "WON").length,
    lost = verified.filter((r) => r.outcome === "LOST").length;
  const eligible = verified.flatMap((r) => {
    const q = historyPrice(r);
    const net = q ? indicativeReturn(r.outcome, q.median) : null;
    return net == null ? [] : [{ id: r.id, net }];
  });
  const net = eligible.reduce((s, r) => s + r.net, 0);
  const counts = Object.fromEntries(
    ["WON", "LOST", "VOID", "PENDING"].map((o) => [
      o,
      rows.filter((r) => r.outcome === o).length,
    ]),
  );
  let winStreak = 0,
    lossStreak = 0,
    w = 0,
    l = 0;
  // Streaks refer to verified distinct records ordered by kickoff/id, not a daily subscriber strategy.
  for (const r of [...rows].sort(
    (a, b) => +(a.kickoff ?? 0) - +(b.kickoff ?? 0) || a.id.localeCompare(b.id),
  )) {
    if (
      duplicates.has(r.id) ||
      !settlementVerified(r, now) ||
      r.outcome === "VOID"
    ) {
      w = 0;
      l = 0;
      continue;
    }
    w = r.outcome === "WON" ? w + 1 : 0;
    l = r.outcome === "LOST" ? l + 1 : 0;
    winStreak = Math.max(winStreak, w);
    lossStreak = Math.max(lossStreak, l);
  }
  return {
    published: rows.length,
    counts,
    other: rows.length - Object.values(counts).reduce((a, b) => a + b, 0),
    recordedSettled: rows.filter((r) =>
      ["WON", "LOST", "VOID"].includes(r.outcome),
    ).length,
    verified: verified.length,
    decided: won + lost,
    won,
    lost,
    rate: won + lost >= 20 ? won / (won + lost) : null,
    duplicates: duplicates.size,
    unverified: rows.filter(
      (r) =>
        ["WON", "LOST", "VOID"].includes(r.outcome) &&
        (!settlementVerified(r, now) || duplicates.has(r.id)),
    ).length,
    eligible: eligible.length,
    excluded: rows.length - eligible.length,
    net,
    roi: eligible.length >= 20 ? net / eligible.length : null,
    winStreak,
    lossStreak,
  };
}
export function performanceBreakdown(
  rows: readonly PerformanceRow[],
  dimension: "category" | "marketType" | "leagueName" | "month",
  now = new Date(),
) {
  const groups = new Map<string, PerformanceRow[]>();
  for (const r of rows) {
    const k =
      dimension === "month"
        ? r.kickoff?.toLocaleDateString("en-CA", {
            timeZone: "Africa/Lagos",
            year: "numeric",
            month: "2-digit",
          })
        : r[dimension];
    const key = k ?? "Unavailable";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // Duplicate exclusion must be global, even when the conflicting records occupy different categories/months.
  const duplicates = duplicateIds(rows);
  return [...groups]
    .map(([label, items]) => ({
      label,
      ...performanceSummary(
        items.map((r) =>
          duplicates.has(r.id) ? { ...r, settledAt: null } : r,
        ),
        now,
      ),
    }))
    .sort(
      (a, b) => b.published - a.published || a.label.localeCompare(b.label),
    );
}
