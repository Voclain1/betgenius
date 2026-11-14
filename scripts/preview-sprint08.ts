const react = require("react");
react.cache ??= (fn: unknown) => fn;
/** Synthetic local preview only. Never run against a production database. */
import { writeFileSync, mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { matchKey, matchSlug, leagueSlug, teamSlug } from "../src/lib/slug";
import type { TeamDigest } from "../src/lib/ai/digest";
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Preview requires disposable local PostgreSQL");
  const email = "sprint08-preview@example.invalid";
  if (await prisma.user.findUnique({ where: { email } }))
    throw new Error(
      "Preview already seeded; use its manifest or recreate the disposable database",
    );
  const user = await prisma.user.create({
    data: {
      email,
      name: "Synthetic preview member",
      role: "USER",
      subscription: {
        create: {
          tier: "PREMIUM",
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 86400000),
        },
      },
    },
  });
  const now = new Date(),
    published = new Date(+now - 1800000),
    kickoff = new Date(+now + 86400000);
  const league = await prisma.league.create({
    data: {
      apiId: 1918000000,
      name: "Synthetic Preview League",
      country: "Preview",
      season: 2026,
    },
  });
  function digest(name: string, apiId: number): TeamDigest {
    return {
      name,
      apiId,
      rank: null,
      points: null,
      overall: null,
      home: {
        played: 8,
        win: 4,
        draw: 2,
        loss: 2,
        goalsFor: 13,
        goalsAgainst: 9,
      },
      away: {
        played: 8,
        win: 3,
        draw: 2,
        loss: 3,
        goalsFor: 11,
        goalsAgainst: 10,
      },
      goalsForAvg: null,
      goalsAgainstAvg: null,
      cleanSheets: null,
      failedToScore: null,
      form: "WLDWW",
      streak: null,
      biggest: null,
      formations: [],
      cards: null,
      penalties: null,
      availability: [],
      availabilityAsOf: null,
      keyPlayers: [],
      statisticsScope: {
        leagueApiId: league.apiId,
        leagueName: league.name,
        season: 2026,
      },
      last5: [
        [2, 1],
        [0, 1],
        [1, 1],
        [3, 0],
        [2, 0],
      ].map(([gf, ga], i) => ({
        opponent: `Preview Opponent ${i + 1}`,
        venue: i % 2 ? "away" : "home",
        result: gf > ga ? "W" : gf < ga ? "L" : "D",
        goalsFor: gf,
        goalsAgainst: ga,
        date: new Date(+now - (6 - i) * 86400000).toISOString(),
      })),
    };
  }
  let matchHref = "",
    firstId = "",
    missingHref = "";
  for (let i = 0; i < 6; i++) {
    const h = `Preview Athletic${i ? ` ${i + 1}` : ""}`,
      a = `Preview United${i ? ` ${i + 1}` : ""}`,
      homeId = 1918000100 + i * 2,
      awayId = homeId + 1,
      fixtureApiId = 1918000200 + i;
    const home = await prisma.team.create({ data: { apiId: homeId, name: h } }),
      away = await prisma.team.create({ data: { apiId: awayId, name: a } });
    const fixture = await prisma.fixture.create({
      data: {
        apiId: fixtureApiId,
        leagueId: league.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoff,
        status: "NS",
      },
    });
    const job =
      i === 0
        ? await prisma.aIJob.create({
            data: {
              userId: user.id,
              prompt: "Synthetic preview only",
              rawOutput: "Synthetic preview only",
              model: "preview-fixture",
              createdAt: new Date(+published - 60000),
              context: {
                v: 2,
                digest: {
                  v: 2,
                  fixture: {
                    home: h,
                    away: a,
                    league: league.name,
                    kickoff: kickoff.toISOString(),
                  },
                  teams: { home: digest(h, homeId), away: digest(a, awayId) },
                  h2h: null,
                  standings: null,
                  coverage: {
                    stats: true,
                    form: true,
                    availability: false,
                    h2h: false,
                    standings: false,
                  },
                },
              },
            },
          })
        : null;
    for (const marketType of ["OVER_UNDER", "BTTS"] as const) {
      const selection =
        marketType === "OVER_UNDER"
          ? { line: 2.5, direction: "OVER" }
          : { value: "YES" };
      const qMarket =
          marketType === "OVER_UNDER" ? "Goals Over/Under" : "Both Teams Score",
        qValue = marketType === "OVER_UNDER" ? "Over 2.5" : "Yes";
      const row = await prisma.prediction.create({
        data: {
          authorId: user.id,
          aiJobId: job?.id,
          fixtureId: fixture.id,
          fixtureApiId,
          leagueApiId: league.apiId,
          leagueName: league.name,
          homeTeam: h,
          awayTeam: a,
          homeTeamApiId: homeId,
          awayTeamApiId: awayId,
          kickoff,
          status: "PUBLISHED",
          publishedAt: published,
          confidence: 80 - i,
          category: "FEATURED",
          categories: { create: [{ category: "FEATURED" }] },
          marketType,
          selection,
          market:
            marketType === "OVER_UNDER" ? "Total goals" : "Both teams to score",
          pick: marketType === "OVER_UNDER" ? "Over 2.5 goals" : "Yes",
          reasoning:
            "Synthetic local preview: recent results include both matches that fit this market and matches that do not. This fixture and its statistics are test data, not a published betting recommendation.",
          manualSettlementOnly: false,
          matchSlugKey: matchSlug({ homeTeam: h, awayTeam: a, kickoff }),
          homeSlugKey: teamSlug(h),
          awaySlugKey: teamSlug(a),
          leagueSlugKey: leagueSlug(league.name, league.apiId),
          marketConfirmation:
            i === 0
              ? {
                  publicationQuoteEvidence: {
                    evidenceKind: "PUBLICATION_INDICATIVE",
                    entryPrice: 1.91,
                    entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
                    entryQuoteSelection: { market: qMarket, value: qValue },
                    entryBookmakers: 1,
                    entryQuoteSources: [
                      { bookmaker: "Synthetic Bookmaker", odd: 1.91 },
                    ],
                    quoteFetchedAt: new Date(+published - 60000).toISOString(),
                    confirmedAt: published.toISOString(),
                  },
                }
              : undefined,
        },
      });
      if (i === 0 && marketType === "OVER_UNDER") {
        matchHref = `/predictions/match/${row.matchSlugKey}`;
        firstId = row.id;
      }
      if (i === 1) missingHref = `/predictions/match/${row.matchSlugKey}`;
    }
    if (i === 0) {
      const key = matchKey({
        homeTeamApiId: homeId,
        awayTeamApiId: awayId,
        kickoff,
      })!;
      await prisma.fixtureDetailCache.create({
        data: {
          matchKey: key,
          fixtureApiId,
          homeTeamApiId: homeId,
          awayTeamApiId: awayId,
          kickoffDay: kickoff.toISOString().slice(0, 10),
          fetchedAt: now,
          detailJson: {
            venue: "Synthetic Preview Ground",
            city: "Preview",
            round: null,
            referee: null,
          },
        },
      });
      await prisma.fixtureOddsCache.create({
        data: {
          matchKey: key,
          fixtureApiId,
          fetchedAt: now,
          oddsJson: {
            bookmakerCount: 1,
            update: now.toISOString(),
            markets: [
              ["Goals Over/Under", "Over 2.5"],
              ["Both Teams Score", "Yes"],
            ].map(([market, value]) => ({
              market,
              selections: [
                {
                  value,
                  best: 2.05,
                  median: 2.05,
                  bookmakers: 1,
                  bestBookmaker: "Synthetic Bookmaker",
                  quotes: [{ bookmaker: "Synthetic Bookmaker", odd: 2.05 }],
                },
              ],
            })),
          },
        },
      });
      await prisma.prediction.create({
        data: {
          authorId: user.id,
          fixtureId: fixture.id,
          fixtureApiId,
          leagueApiId: league.apiId,
          leagueName: league.name,
          homeTeam: h,
          awayTeam: a,
          homeTeamApiId: homeId,
          awayTeamApiId: awayId,
          kickoff,
          matchSlugKey: matchSlug({ homeTeam: h, awayTeam: a, kickoff }),
          status: "PUBLISHED",
          publishedAt: published,
          category: "PREMIUM",
          categories: { create: [{ category: "PREMIUM" }] },
          provenance: "PREMIUM_GENERATED",
          marketType: "MATCH_WINNER",
          selection: { value: "AWAY" },
          market: "PRIVATE_PREVIEW_MARKET",
          pick: "PRIVATE_PREVIEW_SELECTION",
          confidence: 85,
          reasoning: "PRIVATE_PREVIEW_REASON",
          analysisJson: { v: 1, keyFactors: ["PRIVATE_PREVIEW_FACTOR"] },
        },
      });
    }
  }
  await prisma.userPreference.create({
    data: {
      userId: user.id,
      timezone: "America/New_York",
      preferredMarkets: ["OVER_UNDER"],
    },
  });
  await prisma.userFollow.create({
    data: {
      userId: user.id,
      targetType: "TEAM",
      targetKey: "1918000100",
      label: "Preview Athletic",
    },
  });
  const { savePrediction } = await import("../src/lib/personalizationData");
  await savePrediction(user.id, firstId, {
    tier: "PREMIUM",
    status: "ACTIVE",
    role: "USER",
  });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
  }).format(kickoff);
  const manifest = {
    synthetic: true,
    userId: user.id,
    date,
    matchHref,
    missingHref,
    firstId,
  };
  mkdirSync("work", { recursive: true });
  writeFileSync(
    "work/sprint08-preview.json",
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "Synthetic preview ready. Start the app with the same disposable database; see work/sprint08-preview.json. No production data used.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
