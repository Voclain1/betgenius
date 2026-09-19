/**
 * Render check for /match-insights and the trend-card data layer, against a
 * stubbed database.
 *
 * The calculation (check-insights.ts), the worker (verify-insight-integration.ts)
 * and the card wording (check-trend-cards.ts) are covered elsewhere. What was not
 * covered is everything between the cache rows and the markup: src/lib/topTrends.ts
 * — which pairs a row with its fixture, decides the trend team's side, attaches the
 * crest and the matching price, and paginates — and the page that renders it. That
 * layer had no test, and it is the only part of Match Insights that has never run
 * against cache rows anywhere, since the refresh job has never populated them.
 *
 * No database and no network: @/lib/prisma is replaced in the require cache before
 * the page is imported. The recorded query arguments are asserted too, because the
 * freshness contract — expired evidence and kicked-off matches are never shown —
 * lives in the `where` clause rather than in the markup.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-match-insights-render.tsx
 */
export {};

import { renderToStaticMarkup } from "react-dom/server";
import type { InsightEvidence } from "../src/lib/insights";
import type { FixtureOdds } from "../src/lib/odds";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 300))}`}`);
};

// ---------------------------------------------------------------------------
// The database stub, installed before the page is imported.
// ---------------------------------------------------------------------------

type Row = { id: string; predictionId: string; teamApiId: number; kickoff: Date; strength: number; evidence: InsightEvidence };

let rows: Row[] = [];
let predictions: any[] = [];
let crests: Array<{ teamApiId: number; crestUrl: string | null }> = [];
let oddsRows: Array<{ matchKey: string; oddsJson: FixtureOdds }> = [];
const queries: Array<{ model: string; args: any }> = [];

const inWhere = (row: Row, where: any) =>
  row.kickoff >= where.kickoff.gte && row.kickoff < where.kickoff.lt;

const prismaStub = {
  matchInsightCache: {
    findMany: (args: any) => {
      queries.push({ model: "matchInsightCache", args });
      return Promise.resolve(rows.filter((r) => inWhere(r, args.where)));
    },
  },
  prediction: {
    findMany: (args: any) => {
      queries.push({ model: "prediction", args });
      const ids: string[] = args.where?.id?.in ?? [];
      return Promise.resolve(predictions.filter((p) => ids.includes(p.id)));
    },
  },
  teamEnrichmentCache: {
    findMany: (args: any) => {
      queries.push({ model: "teamEnrichmentCache", args });
      const ids: number[] = args.where?.teamApiId?.in ?? [];
      return Promise.resolve(crests.filter((c) => ids.includes(c.teamApiId)));
    },
  },
  fixtureOddsCache: {
    findMany: (args: any) => {
      queries.push({ model: "fixtureOddsCache", args });
      const keys: string[] = args.where?.matchKey?.in ?? [];
      return Promise.resolve(oddsRows.filter((o) => keys.includes(o.matchKey)));
    },
  },
};

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

stub("../src/lib/prisma", { prisma: prismaStub });

/**
 * next/image resolves its allowlist from the build's injected image config,
 * which does not exist outside `next build` — the real allowlist is
 * next.config.mjs's remotePatterns, not anything this file could assert. A
 * plain <img> keeps the crest URL visible to the assertions below without
 * pulling Next's build configuration into a render test.
 */
const React = require("react");
stub("next/image", {
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => React.createElement("img", { src, alt, className }),
});

// ---------------------------------------------------------------------------
// Fixtures. Kickoffs are placed inside the Lagos day the page asks for, using
// the same bounds helper the page uses, so the test cannot drift from it.
// ---------------------------------------------------------------------------

const { lagosDayBounds } = require("../src/lib/lagosDate");
const { kickoffDay } = require("../src/lib/slug");

/** A kickoff comfortably inside a Lagos day that is still ahead of `now`. */
function kickoffWithin(offsetDays: number): Date {
  const { start, end } = lagosDayBounds(offsetDays);
  const now = Date.now();
  const earliest = Math.max(start.getTime(), now + 60 * 60_000);
  const candidate = new Date(Math.min(earliest + 2 * 60 * 60_000, end.getTime() - 60 * 60_000));
  return candidate;
}

const TOMORROW = kickoffWithin(1);

function evidence(over: Partial<InsightEvidence> = {}): InsightEvidence {
  return {
    type: "WIN_STREAK",
    scope: "ALL",
    teamApiId: 40,
    teamName: "Liverpool",
    leagueApiId: null,
    leagueName: null,
    count: 4,
    sampleSize: 4,
    exact: true,
    matches: [],
    explanation: "Won 4 matches in a row.",
    strength: 0.4,
    calculationVersion: "2",
    ...over,
  };
}

let sequence = 0;
function row(over: Partial<Row> = {}): Row {
  const e = over.evidence ?? evidence();
  return {
    id: `row-${++sequence}`,
    predictionId: "p1",
    teamApiId: e.teamApiId,
    kickoff: TOMORROW,
    strength: e.strength,
    ...over,
    evidence: e,
  };
}

const LIVERPOOL_EVERTON = {
  id: "p1",
  homeTeam: "Liverpool",
  awayTeam: "Everton",
  homeTeamApiId: 40,
  awayTeamApiId: 45,
  kickoff: TOMORROW,
};

const ARSENAL_CHELSEA = {
  id: "p2",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  homeTeamApiId: 42,
  awayTeamApiId: 49,
  kickoff: TOMORROW,
};

function odds(market: string, value: string, best: number, bookmakers: number): FixtureOdds {
  return {
    bookmakerCount: bookmakers,
    update: new Date().toISOString(),
    markets: [{ market: market as any, selections: [{ value, best, median: best, bookmakers, bestBookmaker: "Bet365" }] }],
  };
}

/**
 * renderToStaticMarkup separates interpolated text nodes with empty HTML
 * comments, so `{period}` inside a sentence arrives as "for <!-- -->today's".
 * Stripping them lets the assertions read the sentence a visitor would see.
 */
async function render(searchParams: Record<string, string> = {}) {
  queries.length = 0;
  const page = require("../src/app/(public)/match-insights/page");
  const html = renderToStaticMarkup(await page.default({ searchParams }));
  return html
    .replace(/<!--.*?-->/g, "")
    // React escapes apostrophes and quotes; "today's" arrives as "today&#x27;s".
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

async function main() {
  // -------------------------------------------------------------------------
  // Populated: a trend for each side of one fixture, plus a priced one.
  // -------------------------------------------------------------------------
  rows = [
    row(),
    row({
      teamApiId: 45,
      evidence: evidence({
        teamApiId: 45,
        teamName: "Everton",
        type: "WINLESS_STREAK",
        scope: "AWAY",
        count: 6,
        sampleSize: 6,
        exact: false,
        strength: 0.6,
      }),
    }),
  ];
  predictions = [LIVERPOOL_EVERTON];
  crests = [{ teamApiId: 40, crestUrl: "https://media.api-sports.io/football/teams/40.png" }];
  oddsRows = [{ matchKey: `40-45-${kickoffDay(TOMORROW)}`, oddsJson: odds("Match Winner", "Home", 1.85, 8) }];

  const html = await render({ period: "tomorrow" });
  check("a trend card renders for the home side", html.includes("Liverpool") && html.includes("won"), html.slice(0, 300));
  check("a trend card renders for the away side", html.includes("Everton") && html.includes("without a win"));
  check("the badge figure renders for an exact streak", html.includes(">Won<") || html.includes("Won"));
  check("an inexact streak is badged as a minimum", html.includes("6+"), html);
  check("the fixture renders on the card", html.includes("Liverpool - Everton"));
  check("the kickoff renders in Lagos format", /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(html));
  check("a crest on file renders", html.includes("media.api-sports.io") || html.includes("/_next/image"));
  check("the matching price renders when enough books quote it", html.includes("1.85") && html.includes("Liverpool"), html);
  check("the prediction link renders", html.includes("/predictions/match/"));
  check("the empty state is absent when cards exist", !html.includes("No verified trends"));
  check("the period tabs render", html.includes("Today") && html.includes("Tomorrow") && html.includes("Weekend"));
  check("the requested period is marked current", html.includes('aria-current="page"'));

  // -------------------------------------------------------------------------
  // The freshness contract, which lives in the query rather than the markup.
  // -------------------------------------------------------------------------
  const cacheQuery = queries.find((q) => q.model === "matchInsightCache")!;
  check("expired evidence is excluded by the query", cacheQuery.args.where?.expiresAt?.gt instanceof Date);
  check("the query never reaches back before now", cacheQuery.args.where?.kickoff?.gte instanceof Date && cacheQuery.args.where.kickoff.gte.getTime() >= Date.now() - 60_000);
  check("the query is bounded by the period's end", cacheQuery.args.where?.kickoff?.lt instanceof Date);
  const oddsQuery = queries.find((q) => q.model === "fixtureOddsCache")!;
  check("only fetched odds rows are considered", oddsQuery?.args.where?.fetchedAt?.not === null);

  // -------------------------------------------------------------------------
  // A price is only shown when the market is real.
  // -------------------------------------------------------------------------
  oddsRows = [{ matchKey: `40-45-${kickoffDay(TOMORROW)}`, oddsJson: odds("Match Winner", "Home", 1.85, 3) }];
  const thin = await render({ period: "tomorrow" });
  check("a thinly-quoted price is withheld", !thin.includes("1.85"), thin.slice(0, 300));

  oddsRows = [];
  const unpriced = await render({ period: "tomorrow" });
  check("a fixture with no cached odds still renders its trend", unpriced.includes("Liverpool") && !unpriced.includes("No verified trends"));

  // -------------------------------------------------------------------------
  // Period selection.
  // -------------------------------------------------------------------------
  const today = await render({ period: "today" });
  check("a period with no fixtures shows its own empty state", today.includes("No verified trends for today's fixtures yet"), today.slice(0, 400));

  const bogus = await render({ period: "'; drop table --" });
  check("an unknown period falls back to today rather than throwing", bogus.includes("today's fixtures"));

  // -------------------------------------------------------------------------
  // Pagination is over trends, and the page count follows the total.
  // -------------------------------------------------------------------------
  oddsRows = [];
  rows = Array.from({ length: 30 }, (_, i) =>
    row({
      predictionId: i % 2 ? "p2" : "p1",
      teamApiId: i % 2 ? 42 : 40,
      evidence: evidence({ teamApiId: i % 2 ? 42 : 40, teamName: i % 2 ? "Arsenal" : "Liverpool", count: 30 - i, sampleSize: 30 - i, strength: (30 - i) / 30 }),
    }),
  );
  predictions = [LIVERPOOL_EVERTON, ARSENAL_CHELSEA];
  const firstPage = await render({ period: "tomorrow" });
  check("a full page links to the next one", firstPage.includes("Next →") && firstPage.includes("page=2"));
  check("the page counter reflects the total", firstPage.includes("Page 1 of 2"), firstPage.slice(0, 200));
  const secondPage = await render({ period: "tomorrow", page: "2" });
  check("the second page renders the remainder", secondPage.includes("Page 2 of 2") && secondPage.includes("← Previous"));
  check("the strongest trend leads the first page", firstPage.indexOf("30") < firstPage.indexOf("29"));

  // -------------------------------------------------------------------------
  // Rows whose fixture no longer supports them must not reach a card.
  // -------------------------------------------------------------------------
  rows = [row()];
  predictions = [];
  const orphaned = await render({ period: "tomorrow" });
  check("a trend whose prediction row has gone is dropped, not rendered broken", orphaned.includes("No verified trends"), orphaned.slice(0, 300));

  rows = [row({ teamApiId: 999, evidence: evidence({ teamApiId: 999, teamName: "Not In This Match" }) })];
  predictions = [LIVERPOOL_EVERTON];
  const wrongTeam = await render({ period: "tomorrow" });
  check("a trend for a team not in the fixture is dropped", !wrongTeam.includes("Not In This Match"), wrongTeam.slice(0, 300));

  // -------------------------------------------------------------------------
  // Empty.
  // -------------------------------------------------------------------------
  rows = [];
  predictions = [];
  crests = [];
  const empty = await render({ period: "tomorrow" });
  check("the empty state renders when nothing is cached", empty.includes("No verified trends for tomorrow's fixtures yet"));
  check("the empty state explains the freshness rule", empty.includes("twelve hours"));
  check("the period tabs still render when empty", empty.includes("Weekend"));

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("match insights render checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
