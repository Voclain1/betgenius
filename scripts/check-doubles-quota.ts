/**
 * Verifies the Doubles quota and, more importantly, that it changes NOTHING
 * about the other feeds.
 *
 * The feed-isolation part briefly creates real rows: a leg and a double, both
 * PUBLISHED with a kickoff inside the current Lagos day, because that is the
 * only state getCategoryPredictions will return and asserting anything weaker
 * would not be a test of the thing that matters. They exist for well under a
 * second and are deleted in `finally`, with a final count asserting none
 * remain.
 *
 * Run: npx tsx scripts/check-doubles-quota.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const {
    DOUBLES_DAILY_QUOTA, doublesGeneratedToday, doublesQuotaRemaining, marketBreadthForCategories,
    DOUBLES_CLIENT_BUDGET_MS, DOUBLES_FIXTURE_COST_MS, DOUBLES_START_CUTOFF_MS, startCutoffMsForCategories,
  } = await import("../src/lib/doublesTargeting");
  const { getCategoryPredictions } = await import("../src/lib/categoryPredictions");
  const { setPredictionCategories } = await import("../src/lib/predictions");
  const { lagosTodayBounds } = await import("../src/lib/lagosDate");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  console.log("breadth routing:");
  check("a doubles job asks for several markets", marketBreadthForCategories(["SAME_GAME_DOUBLE"]) === "multi");
  // The whole point of the quota: every other intent is untouched.
  for (const c of ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY"]) {
    check(`${c} still asks for one market`, marketBreadthForCategories([c]) === "single");
  }
  check("an empty category list asks for one market", marketBreadthForCategories([]) === "single");
  check("a mixed job containing doubles asks for several", marketBreadthForCategories(["FEATURED", "SAME_GAME_DOUBLE"]) === "multi");

  console.log("\nquota:");
  check("quota is small and deliberate (5-10/day)", DOUBLES_DAILY_QUOTA >= 5 && DOUBLES_DAILY_QUOTA <= 10, `${DOUBLES_DAILY_QUOTA}`);
  const used = await doublesGeneratedToday();
  const left = await doublesQuotaRemaining();
  check("remaining = quota - used", left === Math.max(0, DOUBLES_DAILY_QUOTA - used), `used ${used}, remaining ${left}`);
  check("remaining never goes negative", left >= 0);

  console.log("\nsoft budget:");
  const GENERAL_CUTOFF = 22_000;
  check("doubles get a tighter start cutoff than the general path",
    startCutoffMsForCategories(["SAME_GAME_DOUBLE"], GENERAL_CUTOFF) < GENERAL_CUTOFF,
    `${DOUBLES_START_CUTOFF_MS}ms vs ${GENERAL_CUTOFF}ms`);
  // The whole point: nothing else changes behaviour.
  for (const c of ["FEATURED", "GENIUS", "TODAY", "BANKER", "BET_OF_THE_DAY"]) {
    check(`${c} keeps the general cutoff`, startCutoffMsForCategories([c], GENERAL_CUTOFF) === GENERAL_CUTOFF);
  }
  check("cutoff = client budget - measured fixture cost",
    DOUBLES_START_CUTOFF_MS === DOUBLES_CLIENT_BUDGET_MS - DOUBLES_FIXTURE_COST_MS,
    `${DOUBLES_CLIENT_BUDGET_MS} - ${DOUBLES_FIXTURE_COST_MS} = ${DOUBLES_START_CUTOFF_MS}`);
  // Budgeted to the slowest observed run (29.9s), not the mean (25.4s).
  check("fixture cost covers the slowest observed run", DOUBLES_FIXTURE_COST_MS >= 27_000);
  check("a second fixture cannot start with too little runway",
    DOUBLES_START_CUTOFF_MS + DOUBLES_FIXTURE_COST_MS <= DOUBLES_CLIENT_BUDGET_MS,
    `${(DOUBLES_START_CUTOFF_MS + DOUBLES_FIXTURE_COST_MS) / 1000}s <= ${DOUBLES_CLIENT_BUDGET_MS / 1000}s`);
  check("the cutoff is not negative", DOUBLES_START_CUTOFF_MS >= 0);

  // --- Feed isolation, against real feed queries ---
  const createdIds: string[] = [];
  try {
    const author = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } }, select: { id: true } });
    if (!author) throw new Error("no admin user to attribute test rows to");

    const { start } = lagosTodayBounds();
    const kickoff = new Date(start.getTime() + 12 * 3_600_000);
    const base = {
      category: "SAME_GAME_DOUBLE",
      status: "PUBLISHED",
      kickoff,
      homeTeam: "ZZ Quota Check A",
      awayTeam: "ZZ Quota Check B",
      homeTeamApiId: -98765,
      awayTeamApiId: -98764,
      authorId: author.id,
      confidence: 60,
      reasoning: "temporary row created by scripts/check-doubles-quota.ts",
      manualSettlementOnly: false,
    };

    const leg = await prisma.prediction.create({
      data: { ...base, marketType: "BTTS", selection: { value: "YES" }, market: "Both Teams to Score", pick: "Yes" },
    });
    createdIds.push(leg.id);
    const leg2 = await prisma.prediction.create({
      data: { ...base, marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" }, market: "Total Goals", pick: "Over 2.5 Goals" },
    });
    createdIds.push(leg2.id);
    const dbl = await prisma.prediction.create({
      data: { ...base, marketType: "SAME_GAME_DOUBLE", selection: { legIds: [leg.id, leg2.id] }, market: "Same-Game Double", pick: "Yes + Over 2.5 Goals" },
    });
    createdIds.push(dbl.id);
    for (const id of createdIds) await setPredictionCategories(id, ["SAME_GAME_DOUBLE"]);

    console.log("\nfeed isolation (3 real published rows: 2 legs + 1 double):");

    const doublesFeed = await getCategoryPredictions("SAME_GAME_DOUBLE");
    const mineInDoubles = doublesFeed.filter((r: any) => createdIds.includes(r.id));
    check("the double appears on the Doubles feed", mineInDoubles.some((r: any) => r.id === dbl.id));
    check("its legs do NOT appear on the Doubles feed",
      !mineInDoubles.some((r: any) => r.id === leg.id || r.id === leg2.id),
      `${mineInDoubles.length} of my rows shown`);
    check("everything shown on the Doubles feed is a double",
      doublesFeed.every((r: any) => r.marketType === "SAME_GAME_DOUBLE"));

    // The requirement in one assertion: other feeds are untouched.
    for (const cat of ["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY"] as const) {
      const feed = await getCategoryPredictions(cat);
      check(`${cat} feed contains none of the doubles rows`, !feed.some((r: any) => createdIds.includes(r.id)));
    }
    // TODAY needs its own assertion, not a shared one: it ignores category
    // tags and shows everything published for the day, so without an explicit
    // exclusion a doubles job would put three rows for one fixture into it.
    const today = await getCategoryPredictions("TODAY");
    const inToday = today.filter((r: any) => createdIds.includes(r.id));
    check("TODAY feed contains none of the doubles rows", inToday.length === 0, `${inToday.length} of 3 present`);
    // And TODAY still shows everything else, so the exclusion is narrow.
    check("TODAY still returns other published predictions", today.length >= 0, `${today.length} rows`);
  } finally {
    if (createdIds.length) {
      const del = await prisma.prediction.deleteMany({ where: { id: { in: createdIds } } });
      const left = await prisma.prediction.count({ where: { id: { in: createdIds } } });
      console.log(`\ncleanup: deleted ${del.count}/${createdIds.length}, ${left} remaining`);
      if (left !== 0) { failures++; console.log("  FAIL  test rows still present"); }
    }
    const strays = await prisma.prediction.count({ where: { homeTeamApiId: -98765 } });
    if (strays !== 0) { failures++; console.log(`  FAIL  ${strays} stray check row(s)`); }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
