/**
 * Proves selectBetOfTheDayTargets only ever returns fixtures the worker can
 * actually CLAIM.
 *
 * THE DEFECT THIS LOCKS OUT. Targeting read getCandidateOddsTargets, which
 * deliberately returns ledger rows in both the PENDING and SUCCEEDED states
 * because the odds workload wants to keep pricing a fixture after it has been
 * generated. selectCandidates only ever offers fixtures that still NEED
 * predictions, so a SUCCEEDED fixture handed to the worker through matchKeys
 * can never be claimed. A live run measured the consequence exactly: 12 targets,
 * ZERO claimable, nine of them with kickoffs already inside four hours.
 *
 * WHY SEEDED RATHER THAN LIVE. The positive case needs a PENDING fixture inside
 * the generation window, in a ranked league, already priced into the Bet of the
 * Day band. On this database no claimable fixture exists at all for long
 * stretches — ordinary generation claims each one a median of 23 minutes after
 * it appears — so a live probe can only ever show the absence, never the
 * presence. Seeding is what makes the positive assertion possible at all.
 *
 * Rows sit on a far-future day and are deleted in `finally` with a
 * zero-remaining assertion, the same isolation check-tier-provenance.ts uses.
 *
 * Run: npx tsx --env-file=.env scripts/check-betofday-targeting.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import type { prisma as PrismaClient } from "../src/lib/prisma";

/**
 * A 1X2 book whose HOME price is exactly `homePrice`.
 *
 * Bet of the Day gates on the best price of any single selection sitting inside
 * MIN_ODDS..MAX_ODDS, so the home price is the only one that has to be placed
 * deliberately; the other two are pushed far out of the band so they cannot
 * qualify the fixture by accident and make a passing test meaningless.
 */
function oddsWithHomePrice(homePrice: number, bookmakers = 6) {
  const far = 15.0;
  return {
    bookmakerCount: bookmakers,
    update: new Date().toISOString(),
    markets: [
      {
        market: "Match Winner",
        selections: [
          { value: "Home", best: homePrice, median: homePrice, bookmakers },
          { value: "Draw", best: far, median: far, bookmakers },
          { value: "Away", best: far, median: far, bookmakers },
        ],
      },
    ],
  };
}

async function main() {
  const { prisma } = (await import("../src/lib/prisma")) as { prisma: typeof PrismaClient };
  const { selectBetOfTheDayTargets, BET_OF_DAY_PRICE_BAND } = await import("../src/lib/betOfTheDay");
  const { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } = await import("../src/lib/generation/selector");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const matchKeys: string[] = [];
  let teamSeq = -77000;

  // A fixed "now" well clear of any real fixture, so the seeded rows are the
  // only things inside the window this run can see.
  const NOW = new Date("2099-03-10T12:00:00.000Z");
  const inWindowKickoff = new Date(NOW.getTime() + ((GENERATE_FROM_HOURS + GENERATE_UNTIL_HOURS) / 2) * 3_600_000);
  const tooSoonKickoff = new Date(NOW.getTime() + (GENERATE_FROM_HOURS - 2) * 3_600_000);

  try {
    const seed = async (opts: { label: string; status: string; kickoff: Date; homePrice: number }) => {
      const homeId = teamSeq--;
      const awayId = teamSeq--;
      const day = opts.kickoff.toISOString().slice(0, 10);
      const key = `${homeId}-${awayId}-${day}`;
      matchKeys.push(key);

      await prisma.generationAttempt.create({
        data: {
          matchKey: key,
          // A real provider id is required for targeting to consider the row at
          // all; the value never leaves this test.
          fixtureApiId: Math.abs(homeId) * 10,
          leagueApiId: 39,
          leagueName: "Premier League",
          homeTeam: `ZZ BOD ${opts.label} A`,
          awayTeam: `ZZ BOD ${opts.label} B`,
          kickoff: opts.kickoff,
          status: opts.status,
        },
      });
      await prisma.fixtureOddsCache.upsert({
        where: { matchKey: key },
        create: {
          matchKey: key,
          oddsJson: oddsWithHomePrice(opts.homePrice) as any,
          bookmakerCount: 6,
          fetchedAt: NOW,
        },
        update: {
          oddsJson: oddsWithHomePrice(opts.homePrice) as any,
          bookmakerCount: 6,
          fetchedAt: NOW,
        },
      });
      return key;
    };

    const inBand = (BET_OF_DAY_PRICE_BAND.min + BET_OF_DAY_PRICE_BAND.max) / 2;

    const claimableKey = await seed({ label: "claimable", status: "PENDING", kickoff: inWindowKickoff, homePrice: inBand });
    const alreadyDoneKey = await seed({ label: "done", status: "SUCCEEDED", kickoff: inWindowKickoff, homePrice: inBand });
    const tooSoonKey = await seed({ label: "toosoon", status: "PENDING", kickoff: tooSoonKickoff, homePrice: inBand });
    const outOfBandKey = await seed({
      label: "outofband",
      status: "PENDING",
      kickoff: inWindowKickoff,
      homePrice: BET_OF_DAY_PRICE_BAND.max + 2,
    });

    console.log(`price band ${BET_OF_DAY_PRICE_BAND.min}-${BET_OF_DAY_PRICE_BAND.max}, window ${GENERATE_FROM_HOURS}-${GENERATE_UNTIL_HOURS}h\n`);

    const selection = await selectBetOfTheDayTargets(NOW, 10);
    const keys = selection.targets.map((t) => t.matchKey);
    console.log(`targets: ${selection.targets.length}, claimable: ${selection.claimable}, pricedInBand: ${selection.pricedInBand}\n`);

    console.log("the positive case — this is what the old code could never produce:");
    check("a claimable, in-window, in-band fixture IS targeted", keys.includes(claimableKey));
    check("it is counted as claimable", selection.claimable >= 1, `claimable=${selection.claimable}`);

    console.log("\nthe three exclusions:");
    check(
      "an already-SUCCEEDED fixture is NOT targeted",
      !keys.includes(alreadyDoneKey),
      "this is the 12-of-12 defect",
    );
    check("a fixture too close to kickoff is NOT targeted", !keys.includes(tooSoonKey));
    check("a fixture priced outside the band is NOT targeted", !keys.includes(outOfBandKey));
    check(
      "the out-of-band fixture still counted as claimable",
      selection.claimable >= 2,
      "claimable and priced-in-band are separate stages, and a run that finds nothing must say which emptied",
    );

    console.log("\nevery returned target is usable:");
    const ledger = await prisma.generationAttempt.findMany({
      where: { matchKey: { in: keys } },
      select: { matchKey: true, status: true, kickoff: true },
    });
    const fromMs = NOW.getTime() + GENERATE_FROM_HOURS * 3_600_000;
    const untilMs = NOW.getTime() + GENERATE_UNTIL_HOURS * 3_600_000;
    const unusable = ledger.filter(
      (l) => l.status !== "PENDING" || l.kickoff.getTime() < fromMs || l.kickoff.getTime() > untilMs,
    );
    check("no target is unclaimable", unusable.length === 0, `${unusable.length} unusable of ${keys.length}`);
  } finally {
    if (matchKeys.length) {
      await prisma.generationAttempt.deleteMany({ where: { matchKey: { in: matchKeys } } });
      await prisma.fixtureOddsCache.deleteMany({ where: { matchKey: { in: matchKeys } } });
    }
    const strayLedger = await prisma.generationAttempt.count({ where: { matchKey: { in: matchKeys } } });
    const strayOdds = await prisma.fixtureOddsCache.count({ where: { matchKey: { in: matchKeys } } });
    console.log(`\ncleanup: ${strayLedger} stray ledger row(s), ${strayOdds} stray odds row(s)`);
    if (strayLedger !== 0 || strayOdds !== 0) {
      failures++;
      console.log("  FAIL  test data still present");
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
