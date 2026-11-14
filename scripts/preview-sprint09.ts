const react = require("react");
react.cache ??= (f: unknown) => f;
import { prisma } from "../src/lib/prisma";
import { mkdirSync, writeFileSync } from "node:fs";
async function main() {
  const urls = [
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
  ].filter((v): v is string => !!v);
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !urls.length ||
    urls.some((value) => {
      const url = new URL(value);
      return (
        url.hostname !== "127.0.0.1" ||
        url.port !== "5432" ||
        url.pathname !== "/betgenius_paid_ci"
      );
    })
  )
    throw new Error("Explicit disposable localhost database required");

  const email = "sprint09-preview@example.invalid";
  if (await prisma.user.findUnique({ where: { email } }))
    throw new Error(
      "Preview exists; use work/sprint09-preview.json or recreate the disposable DB",
    );
  const user = await prisma.user.create({
    data: {
      email,
      name: "Synthetic history member",
      subscription: {
        create: {
          tier: "PREMIUM",
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() + 86400000),
        },
      },
    },
  });
  const ids: string[] = [];
  let privateId = "";
  const now = new Date();
  for (let i = 0; i < 46; i++) {
    const kickoff = new Date(+now - (i + 1) * 86400000),
      published = new Date(+kickoff - 7200000),
      settled = new Date(+kickoff + 10800000);
    const outcome =
      i === 44 ? "PENDING" : i === 43 ? "VOID" : i % 4 === 0 ? "LOST" : "WON";
    const paid = i >= 45;
    const row = await prisma.prediction.create({
      data: {
        authorId: user.id,
        fixtureApiId: 1949000000 + i,
        leagueApiId: 1949000000,
        leagueName: "Synthetic History League",
        homeTeam: `Synthetic History Home ${i}`,
        awayTeam: "Synthetic History Away",
        kickoff,
        publishedAt: published,
        settledAt: outcome === "PENDING" ? null : settled,
        status: "PUBLISHED",
        category: paid ? "PREMIUM" : "FEATURED",
        categories: { create: [{ category: paid ? "PREMIUM" : "FEATURED" }] },
        provenance: paid ? "PREMIUM_GENERATED" : "STANDARD_CURATED",
        marketType: "BTTS",
        selection: { value: "YES" },
        market: "Both teams to score",
        pick: paid ? "PRIVATE_S09_SELECTION" : "Yes",
        reasoning: paid
          ? "PRIVATE_S09_REASON"
          : "Synthetic preview record, not a betting recommendation.",
        confidence: 80,
        outcome,
        finalHomeScore: outcome === "VOID" ? null : 2,
        finalAwayScore: outcome === "VOID" ? null : outcome === "LOST" ? 0 : 1,
        manualSettlementOnly: false,
        marketConfirmation:
          i === 42
            ? undefined
            : {
                publicationQuoteEvidence: {
                  evidenceKind: "PUBLICATION_INDICATIVE",
                  entryPrice: 2,
                  entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
                  entryQuoteSelection: {
                    market: "Both Teams Score",
                    value: "Yes",
                  },
                  entryBookmakers: 1,
                  entryQuoteSources: [
                    { bookmaker: "Synthetic Historical Bookmaker", odd: 2 },
                  ],
                  quoteFetchedAt: new Date(+published - 60000).toISOString(),
                  confirmedAt: published.toISOString(),
                },
              },
      },
    });
    ids.push(row.id);
    if (paid) privateId = row.id;
  }
  const expired = await prisma.user.create({
    data: {
      email: "sprint09-expired@example.invalid",
      name: "Synthetic expired member",
      subscription: {
        create: {
          tier: "PREMIUM",
          status: "ACTIVE",
          currentPeriodEnd: new Date(Date.now() - 86400000),
        },
      },
    },
  });
  mkdirSync("work", { recursive: true });
  writeFileSync(
    "work/sprint09-preview.json",
    JSON.stringify(
      {
        synthetic: true,
        userId: user.id,
        expiredUserId: expired.id,
        publicId: ids[1],
        privateId,
        missingId: ids[42],
        ids,
        now: now.toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "Created 46 clearly synthetic historical records; no provider calls",
  );
}
main().finally(() => prisma.$disconnect());
