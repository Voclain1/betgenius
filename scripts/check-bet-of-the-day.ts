/**
 * Verification for Bet of the Day, against the live database.
 *
 * Four properties, each one a thing that would be materially wrong in
 * production if it broke:
 *
 *   1. SINGLE SLOT survives a real replace. Pin A, pin B, and exactly one row
 *      is tagged — with A untagged, not merely ranked lower.
 *   2. A MANUAL PIN SURVIVES THE CRON. Pin by hand, run the real
 *      auto-selection, and the pinned row is still the one holding the slot.
 *   3. THE ODDS GATE excludes both ends. A short-priced favourite and the
 *      "Over 6.5 Goals @ 80.0" long-shot case from the research must both be
 *      rejected, and for the stated reason — not merely rejected by accident
 *      via some other condition.
 *   4. DISPLAY renders price, bookmaker count and staleness age.
 *
 * Writes: tests 1 and 2 move the real BET_OF_THE_DAY tag. The original slot
 * holder is captured at the start and restored at the end, including the pin
 * metadata, so running this leaves the database as it found it.
 *
 * Run: npx tsx --env-file=.env scripts/check-bet-of-the-day.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { qualifiesForBetOfDay, trimOdds, quoteAge, MIN_ODDS, MAX_ODDS, MIN_BOOKMAKERS, MIN_VALUE_EDGE_PP, type FixtureOdds } from "../src/lib/odds";

const failures: string[] = [];
let passed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${got === undefined ? "" : `\n          got: ${JSON.stringify(got)}`}`);
  }
};

/** Build an odds payload from a raw shape, so the gate is exercised through trimOdds like production. */
function odds(market: string, values: Array<{ value: string; odd: string }>, bookmakerCount = 10): FixtureOdds {
  const bookmakers = Array.from({ length: bookmakerCount }, (_, i) => ({
    id: i + 1,
    name: `Book${i + 1}`,
    bets: [{ id: 1, name: market, values }],
  }));
  return trimOdds({ fixture: { id: 1 }, update: new Date().toISOString(), bookmakers })!;
}

async function main() {
  const { setBetOfTheDay, autoSelectBetOfTheDay, getBetOfTheDay, getBetOfTheDayCandidates, hasManualPinToday, BET_OF_THE_DAY } = await import(
    "../src/lib/betOfTheDay"
  );

  // ---------- 3. Odds gate ----------
  console.log("\n[3] Odds gate — excludes short favourites and absurd long shots");

  const favourite = qualifiesForBetOfDay({
    odds: odds("Match Winner", [{ value: "Home", odd: "1.45" }]),
    marketType: "MATCH_WINNER",
    selection: { value: "HOME" },
    confidence: 85,
  });
  check("short-priced favourite (1.45) is rejected", !favourite.qualifies, favourite.reasons);
  check(
    "  ...specifically for being below the floor",
    favourite.reasons.some((r) => r.includes(`below the ${MIN_ODDS} floor`)),
    favourite.reasons,
  );

  // The exact case the research surfaced: Goals Over/Under spans 1.00-80.0, so
  // an unbounded "highest odd" rule picks this every day.
  const longShot = qualifiesForBetOfDay({
    odds: odds("Goals Over/Under", [{ value: "Over 6.5", odd: "80.0" }]),
    marketType: "OVER_UNDER",
    selection: { line: 6.5, direction: "OVER" },
    confidence: 95,
  });
  check("absurd long shot (Over 6.5 @ 80.0) is rejected", !longShot.qualifies, longShot.reasons);
  check(
    "  ...specifically for being above the ceiling",
    longShot.reasons.some((r) => r.includes(`above the ${MAX_ODDS} ceiling`)),
    longShot.reasons,
  );

  const thin = qualifiesForBetOfDay({
    odds: odds("Match Winner", [{ value: "Away", odd: "3.10" }], 2),
    marketType: "MATCH_WINNER",
    selection: { value: "AWAY" },
    confidence: 60,
  });
  check(`thin book (2 < ${MIN_BOOKMAKERS} bookmakers) is rejected`, !thin.qualifies, thin.reasons);

  // In the band, well quoted, but the model merely agrees with the market.
  const noEdge = qualifiesForBetOfDay({
    odds: odds("Match Winner", [{ value: "Home", odd: "3.00" }]),
    marketType: "MATCH_WINNER",
    selection: { value: "HOME" },
    confidence: 34, // implied is 33.3% — a ~0.7pp edge
  });
  check(`no-value pick (edge < ${MIN_VALUE_EDGE_PP}pp) is rejected`, !noEdge.qualifies, noEdge.reasons);

  const exotic = qualifiesForBetOfDay({
    odds: odds("Total Corners (3 way)", [{ value: "Over 2", odd: "3.00" }]),
    marketType: "CORRECT_SCORE",
    selection: { home: 2, away: 1 },
    confidence: 80,
  });
  check("market type outside the four headline markets is rejected", !exotic.qualifies, exotic.reasons);

  const good = qualifiesForBetOfDay({
    odds: odds("Match Winner", [{ value: "Home", odd: "3.00" }]),
    marketType: "MATCH_WINNER",
    selection: { value: "HOME" },
    confidence: 50, // implied 33.3%, edge 16.7pp
  });
  check("a genuine value pick at 3.00 with a 16.7pp edge QUALIFIES", good.qualifies, good.reasons);
  check("  ...and reports its price and book count", good.price === 3 && good.bookmakers === 10, good);

  // Boundaries are inclusive, as specified.
  const atFloor = qualifiesForBetOfDay({ odds: odds("Match Winner", [{ value: "Home", odd: String(MIN_ODDS) }]), marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 70 });
  const atCeiling = qualifiesForBetOfDay({ odds: odds("Match Winner", [{ value: "Home", odd: String(MAX_ODDS) }]), marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 60 });
  check(`price exactly at the ${MIN_ODDS} floor is accepted`, atFloor.qualifies, atFloor.reasons);
  check(`price exactly at the ${MAX_ODDS} ceiling is accepted`, atCeiling.qualifies, atCeiling.reasons);

  // ---------- 4. Display fields ----------
  console.log("\n[4] Display — price, bookmaker count, staleness");
  check("staleness renders minutes", quoteAge(new Date(Date.now() - 25 * 60_000)) === "25m ago", quoteAge(new Date(Date.now() - 25 * 60_000)));
  check("staleness renders hours", quoteAge(new Date(Date.now() - 3 * 3_600_000)) === "3h ago", quoteAge(new Date(Date.now() - 3 * 3_600_000)));
  check("staleness is null when never fetched", quoteAge(null) === null);
  check("trimOdds keeps best AND median per selection", (() => {
    const mixed = trimOdds({
      fixture: { id: 1 },
      bookmakers: [
        { id: 1, name: "A", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "3.00" }] }] },
        { id: 2, name: "B", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "3.40" }] }] },
        { id: 3, name: "C", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "3.20" }] }] },
      ],
    });
    const sel = mixed?.markets[0].selections[0];
    return sel?.best === 3.4 && sel?.median === 3.2 && sel?.bestBookmaker === "B";
  })());
  check("trimOdds drops unpayable prices (<= 1.01)", (() => {
    const t = trimOdds({
      fixture: { id: 1 },
      bookmakers: [{ id: 1, name: "A", bets: [{ id: 1, name: "Goals Over/Under", values: [{ value: "Under 6.5", odd: "1.00" }, { value: "Over 2.5", odd: "1.90" }] }] }],
    });
    const values = t?.markets[0].selections.map((s) => s.value) ?? [];
    return values.includes("Over 2.5") && !values.includes("Under 6.5");
  })());

  // ---------- 1 & 2. Live invariants ----------
  console.log("\n[1] Single-slot invariant under a real replace");

  const original = await prisma.prediction.findFirst({
    where: { categories: { some: { category: BET_OF_THE_DAY } } },
    select: { id: true, betOfDayPinnedAt: true, betOfDayPinnedById: true },
  });

  const published = await prisma.prediction.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, homeTeam: true, awayTeam: true },
    take: 2,
    orderBy: { id: "asc" },
  });

  if (published.length < 2) {
    console.log("  SKIP  need two PUBLISHED predictions to exercise a replace");
  } else {
    const [a, b] = published;
    const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true } });

    await setBetOfTheDay(a.id, admin?.id ?? null);
    let tagged = await prisma.predictionCategoryLink.findMany({ where: { category: BET_OF_THE_DAY }, select: { predictionId: true } });
    check("after pinning A, exactly one row is tagged", tagged.length === 1 && tagged[0].predictionId === a.id, tagged);

    await setBetOfTheDay(b.id, admin?.id ?? null);
    tagged = await prisma.predictionCategoryLink.findMany({ where: { category: BET_OF_THE_DAY }, select: { predictionId: true } });
    check("after replacing with B, still exactly one row is tagged", tagged.length === 1, tagged);
    check("  ...and it is B", tagged[0]?.predictionId === b.id, tagged);
    check("  ...and A is untagged (the replaced pick never reappears)", !tagged.some((t) => t.predictionId === a.id), tagged);

    const view = await getBetOfTheDay();
    check("getBetOfTheDay returns the replacement", view?.row.id === b.id, view?.row.id);

    // ---------- 2 ----------
    console.log("\n[2] A manual pin survives a same-day auto-selection cycle");

    if (admin) {
      await setBetOfTheDay(a.id, admin.id); // manual pin, today
      check("manual pin is detected for today", await hasManualPinToday());

      const result = await autoSelectBetOfTheDay();
      check("auto-selection stands down", result.action === "skipped-manual-pin", result);

      const afterCron = await prisma.predictionCategoryLink.findMany({ where: { category: BET_OF_THE_DAY }, select: { predictionId: true } });
      check("the manually pinned pick still holds the slot after the cron ran", afterCron.length === 1 && afterCron[0].predictionId === a.id, afterCron);

      // And the converse: with no manual pin, the cron is free to act.
      await prisma.prediction.updateMany({ where: { betOfDayPinnedAt: { not: null } }, data: { betOfDayPinnedAt: null, betOfDayPinnedById: null } });
      check("with the pin cleared, no manual pin is reported", !(await hasManualPinToday()));
      const freeRun = await autoSelectBetOfTheDay();
      check("auto-selection is free to run once unpinned", freeRun.action !== "skipped-manual-pin", freeRun);
    } else {
      console.log("  SKIP  no admin user to attribute a manual pin to");
    }

    // ---------- restore ----------
    await prisma.predictionCategoryLink.deleteMany({ where: { category: BET_OF_THE_DAY } });
    await prisma.prediction.updateMany({ where: { betOfDayPinnedAt: { not: null } }, data: { betOfDayPinnedAt: null, betOfDayPinnedById: null } });
    if (original) {
      await prisma.prediction.update({
        where: { id: original.id },
        data: {
          categories: { create: { category: BET_OF_THE_DAY } },
          betOfDayPinnedAt: original.betOfDayPinnedAt,
          betOfDayPinnedById: original.betOfDayPinnedById,
        },
      });
    }
    const restored = await prisma.predictionCategoryLink.count({ where: { category: BET_OF_THE_DAY } });
    check("database restored to its starting state", restored === (original ? 1 : 0), { restored, hadOriginal: !!original });
  }

  // ---------- real candidate pool ----------
  console.log("\n[pool] Today's real candidates");
  const { eligible, rejected } = await getBetOfTheDayCandidates();
  console.log(`  eligible: ${eligible.length}, rejected: ${rejected.length}`);
  for (const r of rejected.slice(0, 5)) console.log(`    - ${r.homeTeam} v ${r.awayTeam} (${r.pick}): ${r.gate.reasons.join("; ")}`);
  for (const e of eligible.slice(0, 3)) console.log(`    + ${e.homeTeam} v ${e.awayTeam} (${e.pick}) @ ${e.gate.price} — ${e.gate.bookmakers} books, +${e.gate.edgePP}pp`);

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`);
  await prisma.$disconnect();
  if (failures.length) process.exitCode = 1;
}

main();
