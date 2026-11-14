import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseDiscovery,
  discoveryDay,
  discoveryHref,
  discoveryPhase,
  matchesDiscoveryTime,
} from "../src/lib/predictionDiscovery";
import {
  identityDigest,
  selectionObservations,
  publicationObservation,
} from "../src/lib/predictionExplanation";
import { discoveryQuote } from "../src/lib/selectionQuote";
import { MatchEvidenceGuide } from "../src/components/MatchEvidenceGuide";

import type { TeamDigest } from "../src/lib/ai/digest";
const react = require("react");
react.cache ??= (fn: unknown) => fn;
const {
  PublishedMarketComparison,
} = require("../src/components/PublishedMarketComparison");
const { DiscoveryFilters } = require("../src/components/PredictionDiscovery");
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (v: unknown) => {
  assert.ok(v);
  checks++;
};
const now = new Date("2026-11-14T10:00:00Z"),
  kickoff = new Date("2026-11-14T19:00:00Z");
eq(parseDiscovery({}, undefined, now).zone, "Africa/Lagos");
eq(
  parseDiscovery({}, "America/New_York", new Date("2026-11-14T02:00:00Z")).date,
  "2026-11-13",
);
for (const zone of [
  "Africa/Lagos",
  "UTC",
  "Pacific/Kiritimati",
  "America/New_York",
  "Asia/Kathmandu",
]) {
  const d = discoveryDay("2026-11-14", zone);
  eq(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d.start),
    "2026-11-14",
  );
  ok(d.end > d.start);
}
eq(
  +discoveryDay("2026-03-08", "America/New_York").end -
    +discoveryDay("2026-03-08", "America/New_York").start,
  23 * 3600000,
);
eq(
  +discoveryDay("2026-11-01", "America/New_York").end -
    +discoveryDay("2026-11-01", "America/New_York").start,
  25 * 3600000,
);
for (const date of [
  "2026-02-30",
  "invalid",
  "2040-01-01",
  "2026-11-14<script>",
]) {
  const f = parseDiscovery({ d_date: date }, undefined, now);
  eq(f.date, "2026-11-14");
  eq(f.notices.length, 1);
}
eq(
  parseDiscovery(
    {
      d_page: "-1",
      d_market: "invented",
      d_competition: "1e30",
      d_state: "bad",
    },
    undefined,
    now,
  ).page,
  1,
);
eq(parseDiscovery({ d_page: "999" }, undefined, now).page, 25);
eq(
  parseDiscovery({ d_team: "x".repeat(1000) }, undefined, now).team.length,
  80,
);
eq(parseDiscovery({ d_date: "2026-11-13" }, undefined, now).state, "finished");
const href = discoveryHref(
  "/predictions",
  { d_market: "BTTS", d_team: "A & B", unexpected: "secret" },
  2,
);
ok(href.includes("d_page=2"));
ok(href.includes("d_market=BTTS"));
ok(!href.includes("secret"));
for (const state of ["FT", "AET", "PEN"])
  eq(discoveryPhase(kickoff, "PENDING", state), "finished");
for (const state of ["CANC", "PST", "ABD"])
  eq(discoveryPhase(kickoff, "PENDING", state), "unavailable");
for (const state of ["1H", "HT", "2H", "LIVE"])
  eq(discoveryPhase(kickoff, "PENDING", state, now), null);
eq(discoveryPhase(kickoff, "VOID", "NS"), "unavailable");
eq(
  matchesDiscoveryTime(
    kickoff,
    parseDiscovery({ d_window: "evening" }, undefined, now),
    now,
  ),
  true,
);
eq(
  matchesDiscoveryTime(
    kickoff,
    parseDiscovery({ d_window: "morning" }, undefined, now),
    now,
  ),
  false,
);
eq(
  matchesDiscoveryTime(
    kickoff,
    parseDiscovery({ d_window: "next6" }, undefined, now),
    now,
  ),
  false,
);
function digest(id: number): TeamDigest {
  return {
    name: `Synthetic ${id}`,
    apiId: id,
    rank: null,
    points: null,
    overall: null,
    home: null,
    away: null,
    goalsForAvg: null,
    goalsAgainstAvg: null,
    cleanSheets: null,
    failedToScore: null,
    form: null,
    streak: null,
    biggest: null,
    formations: [],
    cards: null,
    penalties: null,
    availability: [],
    availabilityAsOf: null,
    keyPlayers: [],
    last5: [
      {
        opponent: "A",
        venue: "home",
        result: "W",
        goalsFor: 2,
        goalsAgainst: 1,
        date: "2026-11-10",
      },
      {
        opponent: "B",
        venue: "away",
        result: "L",
        goalsFor: 0,
        goalsAgainst: 1,
        date: "2026-11-11",
      },
      {
        opponent: "C",
        venue: "home",
        result: "D",
        goalsFor: 0,
        goalsAgainst: 0,
        date: "2026-11-12",
      },
      {
        opponent: "D",
        venue: "home",
        result: "W",
        goalsFor: 9,
        goalsAgainst: 0,
        date: "2026-11-15",
      },
      {
        opponent: "E",
        venue: "home",
        result: "W",
        goalsFor: null,
        goalsAgainst: null,
        date: "2026-11-13",
      },
    ],
  };
}
const home = digest(1),
  away = digest(2),
  before = JSON.stringify(home);
eq(identityDigest(home, 2), null);
eq(identityDigest(home, null), null);
eq(identityDigest(home, 1), home);
const observations = selectionObservations({
  marketType: "OVER_UNDER",
  selection: { line: 2.5, direction: "OVER" },
  kickoff,
  home,
  away,
  now,
});
eq(observations.length, 2);
eq(observations[0].support, 1);
eq(observations[0].against, 2);
eq(observations[0].sample, 3);
eq(
  selectionObservations({
    marketType: "BTTS",
    selection: { value: "NO" },
    kickoff,
    home,
    away: null,
    now,
  })[0].support,
  2,
);
eq(
  selectionObservations({
    marketType: "DRAW_NO_BET",
    selection: { value: "HOME" },
    kickoff,
    home,
    away,
    now,
  })[0].neutral,
  1,
);
eq(
  selectionObservations({
    marketType: "OTHER",
    selection: null,
    kickoff,
    home,
    away,
    now,
  }),
  [],
);
eq(JSON.stringify(home), before);
const odds = {
  bookmakerCount: 1,
  update: now.toISOString(),
  markets: [
    {
      market: "Goals Over/Under" as const,
      selections: [
        {
          value: "Over 2.5",
          best: 1.95,
          median: 1.95,
          bookmakers: 1,
          bestBookmaker: "Synthetic Book",
          quotes: [{ bookmaker: "Synthetic Book", odd: 1.95 }],
        },
      ],
    },
  ],
};
const row = {
  fixtureApiId: 5,
  kickoff,
  marketType: "OVER_UNDER",
  selection: { line: 2.5, direction: "OVER" },
};
const cache = { fixtureApiId: 5, fetchedAt: now, oddsJson: odds };
eq(discoveryQuote(row, cache, now)?.decimal, 1.95);
eq(discoveryQuote(row, { ...cache, fixtureApiId: 6 }, now), null);
eq(discoveryQuote(row, undefined, now), null);
eq(
  discoveryQuote(
    row,
    {
      ...cache,
      oddsJson: { ...odds, update: new Date(+now - 121 * 60000).toISOString() },
    },
    now,
  ),
  null,
);
eq(
  discoveryQuote(row, { ...cache, oddsJson: { ...odds, update: null } }, now)
    ?.timeBasis,
  "fetch",
);
for (const oddsJson of [null, {}, { markets: {} }, { markets: [null] }])
  eq(discoveryQuote(row, { ...cache, oddsJson }, now), null);
eq(
  discoveryQuote(
    { ...row, marketType: "DRAW_NO_BET", selection: { value: "HOME" } },
    cache,
    now,
  ),
  null,
);
const snapshot = {
  evidenceKind: "PUBLICATION_INDICATIVE",
  entryPrice: 1.91,
  entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
  entryQuoteSelection: { market: "Goals Over/Under", value: "Over 2.5" },
  entryBookmakers: 1,
  entryQuoteSources: [{ bookmaker: "Synthetic Book", odd: 1.91 }],
  quoteFetchedAt: new Date(+now - 60000).toISOString(),
  confirmedAt: now.toISOString(),
};
const confirmation = { publicationQuoteEvidence: snapshot },
  frozen = JSON.stringify(confirmation);
eq(
  publicationObservation({ ...row, confirmation, publishedAt: now })?.median,
  1.91,
);
eq(
  publicationObservation({ ...row, confirmation: snapshot, publishedAt: now }),
  null,
);
eq(
  publicationObservation({
    ...row,
    confirmation,
    publishedAt: new Date(+now - 120000),
  }),
  null,
);
eq(
  publicationObservation({
    ...row,
    confirmation,
    publishedAt: now,
    selection: { line: 1.5, direction: "OVER" },
  }),
  null,
);
eq(JSON.stringify(confirmation), frozen);
const html = renderToStaticMarkup(
  <MatchEvidenceGuide
    {...row}
    market="Total goals"
    pick="Over 2.5"
    home={home}
    away={away}
    recordedAt={now}
    homeFetchedAt={now}
    awayFetchedAt={null}
    now={now}
  />,
);
ok(html.includes("Went against it"));
ok(html.includes("1 / 3"));
ok(html.includes("Unavailable"));
ok(!html.includes("probability of this fixture is"));
const missing = renderToStaticMarkup(
  <MatchEvidenceGuide
    {...row}
    market="Total goals"
    pick="Over 2.5"
    home={null}
    away={null}
    recordedAt={null}
    homeFetchedAt={null}
    awayFetchedAt={null}
    now={now}
  />,
);
ok(missing.includes("Insufficient verified recent scores"));
ok(missing.includes("do not reconstruct"));
const comparison = renderToStaticMarkup(
  <PublishedMarketComparison
    rows={[]}
    cache={null}
    confirmations={new Map()}
    now={now}
  />,
);
ok(comparison.includes("No published markets are readable"));
const perMarket = renderToStaticMarkup(
  <PublishedMarketComparison
    rows={[
      {
        ...row,
        id: "synthetic",
        category: "FEATURED",
        categories: [{ category: "FEATURED" }],
        provenance: "STANDARD_CURATED",
        homeTeam: home.name,
        awayTeam: away.name,
        homeTeamApiId: 1,
        awayTeamApiId: 2,
        leagueApiId: 39,
        leagueName: "Synthetic",
        outcome: "PENDING",
        market: "Total goals",
        pick: "Over 2.5",
        confidence: 80,
        publishedAt: now,
      },
    ]}
    cache={cache}
    confirmations={new Map([["synthetic", confirmation]])}
    contexts={new Map([["synthetic", { home, away, recordedAt: now }]])}
    now={now}
  />,
);
ok(
  perMarket.includes(
    "1 of 3 recent matches matched this market; 2 went against it",
  ),
);
ok(perMarket.includes("1.91"));
ok(perMarket.includes("1.95"));
const filters = renderToStaticMarkup(
  <DiscoveryFilters
    filter={parseDiscovery({}, undefined, now)}
    basePath="/predictions"
    signedIn={false}
  />,
);
for (const label of [
  "d_date",
  "d_team",
  "d_competition",
  "d_market",
  "d_window",
  "d_state",
  "d_category",
  "d_personal",
  "d_odds",
])
  ok(filters.includes(`name="${label}"`));
ok(filters.includes('method="get"'));
ok(filters.includes("Sign in"));
ok(!/\bAI(?:-assisted)?\b/i.test(html + missing + comparison + filters));
console.log(
  `Sprint 08 discovery, evidence and rendering: ${checks} assertions passed`,
);
