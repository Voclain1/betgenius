/**
 * Proves the route-aware provenance marker actually gates the paid feeds.
 *
 * The defect it exists to prevent is not observable by reading the code: a tag
 * records where a row ENDED UP and says nothing about how it was produced, so
 * a row generated under the GENIUS calibration route looked identical to one
 * generated under the VIP route once both cleared the confidence floor. 84 of
 * 148 audited VIP/PREMIUM rows had reached the paid feeds exactly that way.
 *
 * So the only convincing test is a real one: rows in the database, run through
 * the real curation, with a control that differs ONLY in provenance and is
 * MORE confident than the row that should win.
 *
 * Rows sit on a far-future Lagos day so the test sees only its own data, and
 * are deleted in `finally` with a zero-remaining assertion.
 *
 * Run: npx tsx scripts/check-tier-provenance.ts
 */
export {};

import { assertIntegrationDatabase } from "./lib/dbSafety";
const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  // Writes rows: refuses unless the target is a separate, non-Production database.
  await assertIntegrationDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const {
    curateVipTips,
    curatePremiumTips,
    VIP_ROUTE_PROVENANCE,
    VIP_GENERATED_PROVENANCE,
    PREMIUM_GENERATED_PROVENANCE,
    STANDARD_CURATED_PROVENANCE,
    DEDICATED_PAID_PROVENANCES,
    VIP_ROUTE_CUTOVER,
    VIP_CONFIDENCE_FLOOR,
    PREMIUM_CONFIDENCE_FLOOR,
  } = await import("../src/lib/geniusCuration");
  const { setPredictionCategories } = await import("../src/lib/predictions");
  const { lagosTodayBounds } = await import("../src/lib/lagosDate");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const createdIds: string[] = [];
  try {
    const author = await prisma.user.findFirst({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
      select: { id: true },
    });
    if (!author) throw new Error("no admin user to attribute test rows to");
    /**
     * A far-future Lagos day, so this test sees ONLY its own rows.
     *
     * Curation scores every published row kicking off on the day it is run
     * for, and today's real feed is already full — 16 grandfathered rows
     * against a CURATION_MAX of 15 — so an honest "is this row selected?"
     * assertion is unanswerable against live data. Same isolation trick
     * check-doubles-quota.ts uses.
     */
    const NOW = new Date("2099-06-15T08:00:00.000Z");
    const { start } = lagosTodayBounds(NOW);
    const kickoff = new Date(start.getTime() + 10 * 3_600_000);

    const make = async (
      label: string,
      confidence: number,
      provenance: string,
      opts: { tag?: boolean; createdAt?: Date; marketType?: string } = {},
    ) => {
      const row = await prisma.prediction.create({
        data: {
          category: "VIP",
          status: "PUBLISHED",
          kickoff,
          homeTeam: `ZZ TP ${label} A`,
          awayTeam: `ZZ TP ${label} B`,
          homeTeamApiId: -55601,
          awayTeamApiId: -55602,
          leagueApiId: 39,
          leagueName: "Premier League",
          marketType: opts.marketType ?? "MATCH_WINNER",
          selection: { value: "HOME" },
          market: "Match Winner",
          pick: `ZZ TP ${label} A to win`,
          confidence,
          reasoning: "temporary row from check-tier-provenance.ts",
          manualSettlementOnly: false,
          authorId: author.id,
          provenance,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        },
      });
      createdIds.push(row.id);
      if (opts.tag !== false) await setPredictionCategories(row.id, ["VIP", "PREMIUM"]);
      return row;
    };

    const beforeCutover = new Date(VIP_ROUTE_CUTOVER.getTime() - 3_600_000);

    // High confidence throughout, so the ONLY thing that can exclude a row is
    // its provenance. Absent the gate, every one of these would qualify.
    const routed = await make("routed", 88, VIP_ROUTE_PROVENANCE, { tag: false });
    const wrongRoute = await make("wrongroute", 89, STANDARD_CURATED_PROVENANCE, { tag: false });
    const grandfathered = await make("grandfathered", 88, STANDARD_CURATED_PROVENANCE, { createdAt: beforeCutover });
    const assembledDouble = await make("double", 88, STANDARD_CURATED_PROVENANCE, {
      tag: false,
      marketType: "SAME_GAME_DOUBLE",
    });
    // Between the two floors: clears VIP's 75, fails PREMIUM's 80. This is the
    // row that makes the tiers different rather than two names for one set.
    const vipOnly = await make("viponly", 77, VIP_ROUTE_PROVENANCE, { tag: false });

    console.log(`floors: VIP ${VIP_CONFIDENCE_FLOOR}, PREMIUM ${PREMIUM_CONFIDENCE_FLOOR}`);
    console.log(`cutover: ${VIP_ROUTE_CUTOVER.toISOString()}\n`);

    const vip = await curateVipTips(NOW);
    const premium = await curatePremiumTips(NOW);

    const tagged = async (id: string, category: string) =>
      (await prisma.predictionCategoryLink.count({ where: { predictionId: id, category } })) > 0;

    console.log("route gate — only VIP-route rows enter the paid feeds:");
    check("a VIP-route row is selected into VIP", await tagged(routed.id, "VIP"));
    check("a VIP-route row is selected into PREMIUM", await tagged(routed.id, "PREMIUM"));
    // The control. One point MORE confident than the row above and identical in
    // every other way except provenance. Under the old rule this is precisely
    // the row that reached the paid feeds; if it still does, the gate is inert.
    check("a MORE confident wrong-route row is NOT selected into VIP", !(await tagged(wrongRoute.id, "VIP")), "confidence 89 vs 88");
    check("a MORE confident wrong-route row is NOT selected into PREMIUM", !(await tagged(wrongRoute.id, "PREMIUM")));
    check("curation reports the exclusion rather than hiding it", vip.routeExcluded >= 1, `routeExcluded=${vip.routeExcluded}`);

    console.log("\ncarve-out — assembled doubles have no generation route by design:");
    check("an assembled SAME_GAME_DOUBLE is still selectable", await tagged(assembledDouble.id, "VIP"));

    console.log("\ngrandfathering — the cutover does not strip rows tagged before it:");
    check("a pre-cutover tagged row keeps VIP", await tagged(grandfathered.id, "VIP"));
    check("a pre-cutover tagged row keeps PREMIUM", await tagged(grandfathered.id, "PREMIUM"));
    check("it is never listed for removal", !vip.removed.includes(grandfathered.id) && !premium.removed.includes(grandfathered.id));
    check("curation reports it as grandfathered", vip.grandfathered >= 1, `grandfathered=${vip.grandfathered}`);

    console.log("\nsurvives recalculation — the property already proven for Market-Confirmed:");
    const vip2 = await curateVipTips(NOW);
    const premium2 = await curatePremiumTips(NOW);
    check("a second run still keeps the VIP-route row", !vip2.removed.includes(routed.id) && (await tagged(routed.id, "VIP")));
    check("a second run still keeps the grandfathered row", !vip2.removed.includes(grandfathered.id) && (await tagged(grandfathered.id, "VIP")));
    check("a second run still excludes the wrong-route row", !(await tagged(wrongRoute.id, "VIP")));
    check("PREMIUM behaves identically across runs", !premium2.removed.includes(routed.id));

    console.log("\ndedicated VIP/PREMIUM pass — the markers it stamps are honoured:");
    // The properties that matter are not "a confident row is selected" - the
    // route gate above already proves that. They are that a dedicated pick is
    // PROTECTED on evidence the confidence floor cannot see, and that VIP and
    // PREMIUM stay genuinely different sets.
    //
    // Confidence 76 throughout, DELIBERATELY BELOW PREMIUM_CONFIDENCE_FLOOR.
    // A PREMIUM_GENERATED row earns its tier from a market probability >= 80,
    // not from its own confidence, and PREMIUM carries hardFloor - so if the
    // protection were inert this row would be dropped outright rather than
    // merely left un-topped-up. That is the regression this case catches.
    const premiumGenerated = await make("premgen", 76, PREMIUM_GENERATED_PROVENANCE);

    // A VIP-only dedicated pick: tagged VIP alone, because its market
    // probability cleared 75 but not 80. It must never drift into PREMIUM.
    const vipGenerated = await make("vipgen", 76, VIP_GENERATED_PROVENANCE, { tag: false });
    await setPredictionCategories(vipGenerated.id, ["VIP"]);

    // Untagged, to prove hasRequiredRoute accepts the new markers on their own
    // - a dedicated row that lost its tag must be re-selectable, not exiled.
    const vipGenUntagged = await make("vipgenuntagged", 88, VIP_GENERATED_PROVENANCE, { tag: false });

    const vip3 = await curateVipTips(NOW);
    const premium3 = await curatePremiumTips(NOW);

    check("a PREMIUM_GENERATED row keeps VIP", await tagged(premiumGenerated.id, "VIP"));
    check(
      `a PREMIUM_GENERATED row keeps PREMIUM despite confidence 76 < ${PREMIUM_CONFIDENCE_FLOOR}`,
      await tagged(premiumGenerated.id, "PREMIUM"),
      "protected on market evidence, not on the confidence floor",
    );
    check(
      "the dedicated row is never listed for removal",
      !vip3.removed.includes(premiumGenerated.id) && !premium3.removed.includes(premiumGenerated.id),
    );
    check("a VIP_GENERATED row keeps VIP", await tagged(vipGenerated.id, "VIP"));
    check(
      "a VIP_GENERATED row does NOT drift into PREMIUM",
      !(await tagged(vipGenerated.id, "PREMIUM")),
      "PREMIUM is a strict subset, not a relabelling",
    );
    check(
      "curation counts the dedicated rows as protected",
      vip3.dedicatedProtected >= 2,
      `dedicatedProtected=${vip3.dedicatedProtected}`,
    );
    check(
      "an untagged VIP_GENERATED row satisfies the route requirement",
      await tagged(vipGenUntagged.id, "VIP"),
      "hasRequiredRoute accepts the dedicated markers",
    );

    console.log("\ntier differentiation — PREMIUM must not simply mirror VIP:");
    const vipSet = new Set(vip3.selectedIds);
    const premiumSet = new Set(premium3.selectedIds);
    check("PREMIUM is a subset of VIP", [...premiumSet].every((id) => vipSet.has(id)), `${premiumSet.size} of ${vipSet.size}`);
    check("PREMIUM is strictly SMALLER than VIP", premiumSet.size < vipSet.size, `premium=${premiumSet.size} vip=${vipSet.size}`);
    check("a 77-confidence row reaches VIP", await tagged(vipOnly.id, "VIP"));
    check("the same row does NOT reach PREMIUM", !(await tagged(vipOnly.id, "PREMIUM")));
    // Without the hard floor the top-up would drag a sub-80 row in to reach
    // CURATION_MIN, which is exactly how a premium tier stops being premium.
    //
    // Asserted on the PROPERTY, not on the count. This was once
    // `premiumSet.size < 5`, which only ever worked as a proxy while this
    // fixture set happened to produce fewer than CURATION_MIN qualifying rows —
    // adding legitimately-qualifying rows broke it while nothing was padded.
    // What must actually hold is that every sub-floor row in PREMIUM got there
    // by protection, never by top-up.
    const premiumRows = await prisma.prediction.findMany({
      where: { id: { in: [...premiumSet] } },
      select: { id: true, confidence: true, provenance: true, marketType: true, createdAt: true },
    });
    const padded = premiumRows.filter(
      (r) =>
        r.confidence < PREMIUM_CONFIDENCE_FLOOR &&
        !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "") &&
        r.createdAt >= VIP_ROUTE_CUTOVER,
    );
    check(
      "PREMIUM is not padded below its floor",
      padded.length === 0,
      `premium=${premiumSet.size}, sub-floor and unprotected=${padded.length}`,
    );
  } finally {
    if (createdIds.length) {
      await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: createdIds } } });
      const del = await prisma.prediction.deleteMany({ where: { id: { in: createdIds } } });
      const left = await prisma.prediction.count({ where: { id: { in: createdIds } } });
      console.log(`\ncleanup: deleted ${del.count}/${createdIds.length}, ${left} remaining`);
      if (left !== 0) {
        failures++;
        console.log("  FAIL  test rows still present");
      }
    }
    const strays = await prisma.prediction.count({ where: { homeTeamApiId: -55601 } });
    if (strays !== 0) {
      failures++;
      console.log(`  FAIL  ${strays} stray row(s)`);
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
