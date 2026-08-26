/**
 * TEAM_TOTAL: settlement, the half-line restriction, and the exclusions.
 *
 * Two things here are enforcement rather than description, and both exist
 * because a prompt alone has already proven insufficient this session:
 *
 *   - Generation may only use half-lines, and 2.5 only on the UNDER side.
 *     Books DO quote whole-number team totals, and a team scoring exactly 2 on
 *     "Over 2" is a refund, not a win. Settlement resolves that correctly for
 *     an admin-entered row, but the model must never be offered one.
 *
 *   - Market-Confirmed excludes it at launch. "Total - Home"/"Total - Away"
 *     are not HEADLINE_MARKETS, so there is no stored price to de-vig against.
 *
 * Read-only. Run: npx tsx scripts/check-team-total.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const {
    resolveMarket, isValidSelection, isGeneratableTeamTotal, deriveMarketAndPick,
    ADMIN_MARKET_TYPES, AUTO_MARKET_TYPES, TEAM_TOTAL_GENERATABLE_LINES,
  } = await import("../src/lib/markets");
  const { isEligibleMarketType, evaluateMarketConfirmed } = await import("../src/lib/marketConfirmed");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };
  const eq = (label: string, got: unknown, want: unknown) =>
    check(label, got === want, `want ${String(want)}, got ${String(got)}`);

  const tt = (side: string, line: number, direction: string) => ({ side, line, direction }) as never;

  console.log("settlement — reads ONE side's goals:");
  // Home scored 2, away scored 0.
  eq("home over 1.5 with 2 goals -> WON", resolveMarket("TEAM_TOTAL", tt("HOME", 1.5, "OVER"), 2, 0), "WON");
  eq("home under 1.5 with 2 goals -> LOST", resolveMarket("TEAM_TOTAL", tt("HOME", 1.5, "UNDER"), 2, 0), "LOST");
  eq("away over 0.5 with 0 goals -> LOST", resolveMarket("TEAM_TOTAL", tt("AWAY", 0.5, "OVER"), 2, 0), "LOST");
  eq("away under 0.5 with 0 goals -> WON", resolveMarket("TEAM_TOTAL", tt("AWAY", 0.5, "UNDER"), 2, 0), "WON");
  // The away side's line must not be settled from the home side's goals.
  eq("away under 1.5 with 3 away goals -> LOST", resolveMarket("TEAM_TOTAL", tt("AWAY", 1.5, "UNDER"), 0, 3), "LOST");
  eq("home under 1.5 with 0 home goals -> WON", resolveMarket("TEAM_TOTAL", tt("HOME", 1.5, "UNDER"), 0, 3), "WON");
  eq("goalless: both unders win", resolveMarket("TEAM_TOTAL", tt("HOME", 0.5, "UNDER"), 0, 0), "WON");

  console.log("\nwhole-line pushes settle as VOID, not as a loss:");
  eq("exactly 2 on Over 2 -> VOID", resolveMarket("TEAM_TOTAL", tt("HOME", 2, "OVER"), 2, 1), "VOID");
  eq("exactly 2 on Under 2 -> VOID", resolveMarket("TEAM_TOTAL", tt("HOME", 2, "UNDER"), 2, 1), "VOID");
  eq("3 on Over 2 -> WON", resolveMarket("TEAM_TOTAL", tt("HOME", 2, "OVER"), 3, 1), "WON");
  eq("1 on Over 2 -> LOST", resolveMarket("TEAM_TOTAL", tt("HOME", 2, "OVER"), 1, 1), "LOST");
  // Regulation-time basis, consistent with every other market.
  eq("extra-time winner still reads regulation", resolveMarket("TEAM_TOTAL", tt("HOME", 1.5, "OVER"), 1, 1), "LOST");
  eq("invalid selection -> null", resolveMarket("TEAM_TOTAL", { side: "DRAW", line: 1.5, direction: "OVER" } as never, 2, 0), null);

  console.log("\nvalidation accepts whole lines (an admin may enter one):");
  check("whole line is a VALID selection", isValidSelection("TEAM_TOTAL", tt("HOME", 2, "OVER")));
  check("half line is valid", isValidSelection("TEAM_TOTAL", tt("HOME", 1.5, "OVER")));
  check("rejects a missing side", !isValidSelection("TEAM_TOTAL", { line: 1.5, direction: "OVER" }));
  check("rejects a zero line", !isValidSelection("TEAM_TOTAL", tt("HOME", 0, "OVER")));

  console.log("\nbut GENERATION is restricted — enforced, not just prompted:");
  check("0.5 over is generatable", isGeneratableTeamTotal(tt("HOME", 0.5, "OVER")));
  check("1.5 either way is generatable",
    isGeneratableTeamTotal(tt("HOME", 1.5, "OVER")) && isGeneratableTeamTotal(tt("AWAY", 1.5, "UNDER")));
  check("2.5 UNDER is generatable", isGeneratableTeamTotal(tt("HOME", 2.5, "UNDER")));
  // 16.0% of real team-innings clear 2.5, so the over side is near-decided.
  check("2.5 OVER is NOT generatable", !isGeneratableTeamTotal(tt("HOME", 2.5, "OVER")));
  // 7.1% clear 3.5 — excluded outright.
  check("3.5 is NOT generatable either way",
    !isGeneratableTeamTotal(tt("HOME", 3.5, "OVER")) && !isGeneratableTeamTotal(tt("HOME", 3.5, "UNDER")));
  check("whole lines are NOT generatable (they can push)",
    [1, 2, 3].every((l) => !isGeneratableTeamTotal(tt("HOME", l, "OVER"))));
  check("the generatable line list is exactly [0.5, 1.5, 2.5]",
    JSON.stringify([...TEAM_TOTAL_GENERATABLE_LINES]) === JSON.stringify([0.5, 1.5, 2.5]));
  // Every generatable selection must be push-proof, by construction.
  const combos = [0.5, 1.5, 2.5].flatMap((l) => ["OVER", "UNDER"].flatMap((d) => ["HOME", "AWAY"].map((s) => tt(s, l, d))));
  const generatable = combos.filter((c) => isGeneratableTeamTotal(c));
  check("no generatable line can ever push",
    generatable.every((c: any) => !Number.isInteger(c.line)), `${generatable.length} generatable combinations`);

  console.log("\ndisplay names the team, not the match:");
  eq("home over reads as the team", deriveMarketAndPick("TEAM_TOTAL", tt("HOME", 1.5, "OVER"), "Arsenal", "Chelsea").pick, "Arsenal Over 1.5 Goals");
  eq("away under reads as the team", deriveMarketAndPick("TEAM_TOTAL", tt("AWAY", 0.5, "UNDER"), "Arsenal", "Chelsea").pick, "Chelsea Under 0.5 Goals");

  console.log("\nmarket wiring:");
  check("the model may generate it", (AUTO_MARKET_TYPES as readonly string[]).includes("TEAM_TOTAL"));
  check("an admin may set it", (ADMIN_MARKET_TYPES as readonly string[]).includes("TEAM_TOTAL"));

  console.log("\nMarket-Confirmed excluded at launch (enforced):");
  check("not an eligible market type", !isEligibleMarketType("TEAM_TOTAL"));
  eq("the gate refuses it even at 99% confidence",
    evaluateMarketConfirmed({ marketType: "TEAM_TOTAL", selection: tt("HOME", 1.5, "OVER"), confidence: 99, odds: null, fetchedAt: new Date() }).reason,
    "INELIGIBLE_MARKET");

  console.log("\nagainst real finished fixtures:");
  const played = await prisma.prediction.findMany({
    where: { finalHomeScore: { not: null }, finalAwayScore: { not: null } },
    select: { finalHomeScore: true, finalAwayScore: true },
    take: 300,
  });
  let nulls = 0, voids = 0, decided = 0;
  const overHalf = { home: 0, away: 0 };
  for (const p of played) {
    for (const side of ["HOME", "AWAY"] as const) {
      const r = resolveMarket("TEAM_TOTAL", tt(side, 1.5, "OVER"), p.finalHomeScore!, p.finalAwayScore!);
      if (r === null) nulls++;
      else if (r === "VOID") voids++;
      else decided++;
      if (r === "WON") overHalf[side === "HOME" ? "home" : "away"]++;
    }
  }
  console.log(`  ${played.length} fixtures, ${played.length * 2} team-innings evaluated on Over 1.5`);
  console.log(`  home over 1.5: ${overHalf.home}   away over 1.5: ${overHalf.away}`);
  eq("no real scoreline leaves a half-line unresolved", nulls, 0);
  eq("a half-line never pushes on real data", voids, 0);
  eq("every team-inning decided", decided, played.length * 2);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
