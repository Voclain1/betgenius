import { toBookmakerSelection } from "../src/lib/odds";
const react = require("react");
react.cache ??= (fn: unknown) => fn;
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  performanceSummary,
  indicativeReturn,
  historyPrice,
  settlementVerified,
  performanceFilter,
  performanceBounds,
  duplicateIds,
  performanceBreakdown,
  type PerformanceRow,
} from "../src/lib/performanceTransparency";
import { PerformanceDashboard } from "../src/components/PerformanceDashboard";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (a: unknown) => {
  assert.ok(a);
  checks++;
};
const now = new Date("2026-11-14T12:00:00Z"),
  kickoff = new Date("2026-11-10T12:00:00Z"),
  published = new Date("2026-11-10T10:00:00Z");
const base: PerformanceRow = {
  id: "synthetic-1",
  fixtureApiId: 1,
  fixtureId: null,
  homeTeam: "Synthetic Home",
  awayTeam: "Synthetic Away",
  leagueName: "Synthetic League",
  leagueApiId: 1,
  kickoff,
  publishedAt: published,
  settledAt: new Date("2026-11-10T15:00:00Z"),
  outcome: "WON",
  marketType: "BTTS",
  selection: { value: "YES" },
  market: "Both teams to score",
  pick: "Yes",
  category: "FEATURED",
  categories: [{ category: "FEATURED" }],
  provenance: "STANDARD_CURATED",
  finalHomeScore: 2,
  finalAwayScore: 1,
  marketConfirmation: {
    publicationQuoteEvidence: {
      evidenceKind: "PUBLICATION_INDICATIVE",
      entryPrice: 2,
      entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
      entryQuoteSelection: { market: "Both Teams Score", value: "Yes" },
      entryBookmakers: 1,
      entryQuoteSources: [{ bookmaker: "Synthetic Bookmaker", odd: 2 }],
      quoteFetchedAt: new Date(+published - 60000).toISOString(),
      confirmedAt: published.toISOString(),
    },
  },
  rewriteCount: 0,
  matchSlugKey: "synthetic",
};
eq(indicativeReturn("WON", 2.5), 1.5);
eq(indicativeReturn("LOST", 2.5), -1);
eq(indicativeReturn("VOID", 2.5), 0);
for (const o of ["PENDING", "HALF_WON", "HALF_LOST", "UNKNOWN"])
  eq(indicativeReturn(o, 2), null);
for (const price of [NaN, Infinity, 0, 1, -1])
  eq(indicativeReturn("WON", price), null);
eq(historyPrice(base)?.median, 2);
ok(settlementVerified(base, now));
for (const extra of [
  { finalHomeScore: -1 },
  { finalHomeScore: null },
  { finalHomeScore: 1.1 },
  { finalAwayScore: 0 },
  { settledAt: null },
  { settledAt: new Date("2026-11-10T11:00:00Z") },
  { settledAt: new Date("2027-01-01") },
  { publishedAt: kickoff },
  { publishedAt: null },
  { outcome: "HALF_WON" },
  { marketType: "OTHER" },
  { selection: { value: "INVALID" } },
  { fixtureApiId: null },
])
  eq(settlementVerified({ ...base, ...extra }, now), false);
for (const extra of [
  { marketConfirmation: null },
  { rewriteCount: 1 },
  { selection: { value: "NO" } },
  { fixtureApiId: null },
])
  eq(historyPrice({ ...base, ...extra }), null);
const snap = (base.marketConfirmation as any).publicationQuoteEvidence;
for (const extra of [
  { entryPrice: 3 },
  { entryPriceBasis: "DERIVED" },
  { entryBookmakers: 2 },
  { entryQuoteSources: [] },
  { entryQuoteSelection: { market: "Both Teams Score", value: "No" } },
  { quoteFetchedAt: kickoff.toISOString() },
  { confirmedAt: new Date(+published - 120000).toISOString() },
])
  eq(
    historyPrice({
      ...base,
      marketConfirmation: { publicationQuoteEvidence: { ...snap, ...extra } },
    }),
    null,
  );
const rows = Array.from({ length: 20 }, (_, i) => ({
  ...base,
  id: `r${i}`,
  fixtureApiId: 100 + i,
  kickoff: new Date(+kickoff + i * 1000),
  outcome: i < 12 ? "WON" : "LOST",
  finalAwayScore: i < 12 ? 1 : 0,
}));
let s = performanceSummary(rows, now);
eq(s.decided, 20);
eq(s.rate, 0.6);
eq(s.eligible, 20);
eq(s.net, 4);
eq(s.roi, 0.2);
eq(s.counts.WON, 12);
eq(s.counts.LOST, 8);
eq(s.winStreak, 12);
eq(s.lossStreak, 8);
eq(performanceSummary(rows.slice(0, 19), now).rate, null);
eq(performanceSummary(rows.slice(0, 19), now).roi, null);
s = performanceSummary([...rows, rows[0]], now);
eq(s.published, 20);
eq(s.net, 4);
s = performanceSummary(
  [base, { ...base, id: "duplicate", selection: { value: "NO" } }],
  now,
);
eq(s.duplicates, 2);
eq(s.verified, 0);
eq(s.eligible, 0);
eq(duplicateIds([base, { ...base, id: "d" }]).size, 2);
eq(
  performanceSummary([{ ...base, outcome: "PENDING" }], now).recordedSettled,
  0,
);
eq(
  performanceSummary(
    [
      {
        ...base,
        outcome: "VOID",
        marketConfirmation: {
          publicationQuoteEvidence: {
            ...snap,
            entryQuoteSelection: toBookmakerSelection("OVER_UNDER", {
              line: 2,
              direction: "OVER",
            }),
          },
        },
        marketType: "OVER_UNDER",
        selection: { line: 2, direction: "OVER" },
        finalHomeScore: 1,
        finalAwayScore: 1,
      },
    ],
    now,
  ).verified,
  1,
);
eq(
  performanceSummary([{ ...base, outcome: "VOID", finalHomeScore: null }], now)
    .verified,
  0,
);
eq(performanceSummary([{ ...base, outcome: "HALF_WON" }], now).other, 1);
eq(
  performanceFilter({ months: "1000", team: ["private"], page: "Infinity" })
    .months,
  3,
);
eq(performanceFilter({ months: "12", page: "-10" }).page, 1);
eq(performanceBounds(1, now).start.toISOString(), "2026-10-31T23:00:00.000Z");
eq(performanceBounds(3, now).start.toISOString(), "2026-08-31T23:00:00.000Z");
eq(performanceBreakdown(rows, "category", now)[0].published, 20);
eq(performanceBreakdown(rows, "marketType", now)[0].rate, 0.6);
eq(duplicateIds([base, base]).size, 0);
eq(
  duplicateIds([
    { ...base, fixtureId: "native" },
    { ...base, id: "alias", fixtureApiId: null, fixtureId: "native" },
  ]).size,
  2,
);
eq(
  duplicateIds([
    { ...base, fixtureId: "native" },
    { ...base, id: "conflict", fixtureApiId: 99, fixtureId: "native" },
  ]).size,
  2,
);
eq(
  duplicateIds(
    Array.from({ length: 5000 }, (_, i) => ({
      ...base,
      id: `stress-${i}`,
      fixtureApiId: 10000 + i,
      fixtureId: "same-native",
    })),
  ).size,
  5000,
);
eq(settlementVerified({ ...base, fixtureApiId: 0 }, now), false);
eq(historyPrice({ ...base, fixtureApiId: -1 }), null);
eq(settlementVerified({ ...base, marketConfirmation: null }, now), false);
eq(
  performanceSummary([{ ...base, marketConfirmation: null }], now)
    .recordedSettled,
  1,
);
eq(performanceSummary([{ ...base, marketConfirmation: null }], now).decided, 0);
eq(settlementVerified({ ...base, rewriteCount: 1 }, now), false);
for (const line of [2.25, 2.75, Infinity]) {
  const quarter = {
    ...base,
    marketType: "OVER_UNDER",
    selection: { line, direction: "OVER" },
    outcome: "LOST",
    finalHomeScore: 1,
    finalAwayScore: 1,
    marketConfirmation: {
      publicationQuoteEvidence: {
        ...snap,
        entryQuoteSelection: toBookmakerSelection("OVER_UNDER", {
          line,
          direction: "OVER",
        }),
      },
    },
  };
  eq(settlementVerified(quarter, now), false);
  eq(performanceSummary([quarter], now).eligible, 0);
}
const html = renderToStaticMarkup(
  <PerformanceDashboard
    rows={rows}
    filter={performanceFilter({})}
    start={performanceBounds(3, now).start}
    end={now}
    truncated={false}
    signedIn={false}
  />,
);
for (const text of [
  "Prediction Results",
  "Past Predictions",
  "How Results Are Calculated",
  "12 won",
  "8 lost",
  "20 predictions with confirmed past odds",
  "not real bets",
  "Results by Market",
  "Results by Category",
  "Monthly Performance",
])
  ok(html.includes(text));
ok(!/\bAI(?:-assisted)?\b/.test(html));
ok(!html.includes("data:image"));
ok(html.includes('method="get"'));
ok(html.includes("/track-record/prediction/"));
const empty = renderToStaticMarkup(
  <PerformanceDashboard
    rows={[]}
    filter={performanceFilter({})}
    start={now}
    end={now}
    truncated={true}
    signedIn={false}
  />,
);
ok(empty.includes("No past predictions"));
ok(empty.includes("Not enough confirmed"));
ok(empty.includes("5,000"));
console.log(
  `Sprint 09: ${checks} calculation, evidence, integrity and render assertions passed`,
);
