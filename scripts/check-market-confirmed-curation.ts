/**
 * Proves curation cannot strip a Market-Confirmed pick.
 *
 * This is the failure the provenance column exists to prevent, and it is not
 * observable from reading the code: curateCategory recalculates from scratch
 * and deletes any tagged row its own ranking did not select, so the only
 * convincing test is a real one — a dedicated pick that curation's ranking
 * would NOT have chosen, run through the real curation, and still there after.
 *
 * Creates rows with deliberately LOW confidence so the ranking has every reason
 * to drop them, then deletes everything in `finally` with a zero-remaining
 * assertion. Rows sit on today's date because curation only looks at today.
 *
 * Run: npx tsx scripts/check-market-confirmed-curation.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { curateVipTips, curatePremiumTips, CURATION_MAX, MARKET_CONFIRMED_PROVENANCE } = await import("../src/lib/geniusCuration");
  const { setPredictionCategories } = await import("../src/lib/predictions");
  const { lagosTodayBounds } = await import("../src/lib/lagosDate");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const createdIds: string[] = [];
  try {
    const author = await prisma.user.findFirst({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } }, select: { id: true } });
    if (!author) throw new Error("no admin user to attribute test rows to");
    const { start } = lagosTodayBounds();
    const kickoff = new Date(start.getTime() + 10 * 3_600_000);

    const make = async (label: string, confidence: number, provenance: string) => {
      const row = await prisma.prediction.create({
        data: {
          category: "VIP", status: "PUBLISHED", kickoff,
          homeTeam: `ZZ MC ${label} A`, awayTeam: `ZZ MC ${label} B`,
          homeTeamApiId: -55501, awayTeamApiId: -55502,
          leagueApiId: 39, leagueName: "Premier League",
          marketType: "MATCH_WINNER", selection: { value: "HOME" },
          market: "Match Winner", pick: `ZZ MC ${label} A to win`,
          confidence, reasoning: "temporary row from check-market-confirmed-curation.ts",
          manualSettlementOnly: false, authorId: author.id, provenance,
          marketConfirmation: provenance === MARKET_CONFIRMED_PROVENANCE
            ? { modelProbability: confidence, marketProbability: confidence + 1, gapPP: 1, bookmakers: 9 }
            : undefined,
        },
      });
      createdIds.push(row.id);
      await setPredictionCategories(row.id, ["VIP", "PREMIUM"]);
      return row;
    };

    // Confidence 40 is far below the VIP floor of 75 and below essentially
    // anything else published today, so ordinary ranking would never keep it.
    const dedicated = await make("dedicated", 40, MARKET_CONFIRMED_PROVENANCE);
    const ordinary = await make("ordinary", 41, "STANDARD_CURATED");

    console.log("before curation: both rows tagged VIP + PREMIUM, confidence 40 and 41\n");

    const vip = await curateVipTips();
    const premium = await curatePremiumTips();

    const stillTagged = async (id: string, category: string) =>
      (await prisma.predictionCategoryLink.count({ where: { predictionId: id, category } })) > 0;

    console.log("curation protection:");
    check("the Market-Confirmed pick keeps its VIP tag", await stillTagged(dedicated.id, "VIP"));
    check("the Market-Confirmed pick keeps its PREMIUM tag", await stillTagged(dedicated.id, "PREMIUM"));
    check("curation reports it as protected", (vip as any).marketConfirmedProtected >= 1, `${(vip as any).marketConfirmedProtected}`);
    // The control: an identical row, one point MORE confident, with only its
    // provenance different. If it survives too, the test proves nothing.
    check("an equivalent STANDARD_CURATED row is stripped", !(await stillTagged(ordinary.id, "VIP")), "control row");

    check("it is never listed for removal", !vip.removed.includes(dedicated.id) && !premium.removed.includes(dedicated.id));
    check("it counts toward the feed's selection", vip.selectedIds.includes(dedicated.id));
    check("the feed still respects the 15 maximum", vip.selected <= CURATION_MAX, `${vip.selected}`);
    check("PREMIUM behaves identically to VIP", premium.selectedIds.includes(dedicated.id));

    // Idempotence: a second run must not strip what the first protected.
    const vip2 = await curateVipTips();
    check("a second curation run still keeps it", !vip2.removed.includes(dedicated.id) && (await stillTagged(dedicated.id, "VIP")));
  } finally {
    if (createdIds.length) {
      await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: createdIds } } });
      const del = await prisma.prediction.deleteMany({ where: { id: { in: createdIds } } });
      const left = await prisma.prediction.count({ where: { id: { in: createdIds } } });
      console.log(`\ncleanup: deleted ${del.count}/${createdIds.length}, ${left} remaining`);
      if (left !== 0) { failures++; console.log("  FAIL  test rows still present"); }
    }
    const strays = await prisma.prediction.count({ where: { homeTeamApiId: -55501 } });
    if (strays !== 0) { failures++; console.log(`  FAIL  ${strays} stray row(s)`); }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
