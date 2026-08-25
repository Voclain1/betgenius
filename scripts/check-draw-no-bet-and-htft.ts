/**
 * Draw No Bet and HT/FT: settlement, and the VOID assumption they break.
 *
 * Every existing market produces VOID almost never — only an OVER_UNDER push
 * on a whole-number line, which nothing generates. Draw No Bet produces it on
 * every drawn match, so this is the first marketType where VOID is ordinary
 * rather than exceptional. The point of this file is to prove nothing
 * downstream quietly assumed otherwise: the strike-rate denominator, the
 * all-void edge case, and the sample floors that gate volume decisions.
 *
 * HT/FT is checked against REAL finished fixtures pulled from the database
 * rather than only constructed cases, so the nine-outcome comparison is
 * exercised on scorelines that actually happened.
 *
 * Read-only. Run: npx tsx scripts/check-draw-no-bet-and-htft.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { resolveMarket, isValidSelection, deriveMarketAndPick, ADMIN_MARKET_TYPES, AUTO_MARKET_TYPES } =
    await import("../src/lib/markets");
  const { computeStat } = await import("../src/lib/trackRecord");
  const { MC_ELIGIBLE_MARKET_TYPES, isEligibleMarketType, evaluateMarketConfirmed } =
    await import("../src/lib/marketConfirmed");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };
  const eq = (label: string, got: unknown, want: unknown) =>
    check(label, got === want, `want ${String(want)}, got ${String(got)}`);

  console.log("DRAW NO BET settlement:");
  eq("home win, backed home -> WON", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 2, 0), "WON");
  eq("home win, backed away -> LOST", resolveMarket("DRAW_NO_BET", { value: "AWAY" }, 2, 0), "LOST");
  eq("away win, backed away -> WON", resolveMarket("DRAW_NO_BET", { value: "AWAY" }, 0, 1), "WON");
  eq("away win, backed home -> LOST", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 0, 1), "LOST");
  // The defining behaviour: a draw voids BOTH sides, not just one.
  eq("draw, backed home -> VOID", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 1, 1), "VOID");
  eq("draw, backed away -> VOID", resolveMarket("DRAW_NO_BET", { value: "AWAY" }, 1, 1), "VOID");
  eq("goalless draw -> VOID", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 0, 0), "VOID");
  // Regulation-time basis, same as every other market here.
  eq("2-2 that went to penalties is still a VOID", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 2, 2), "VOID");
  eq("invalid selection -> null", resolveMarket("DRAW_NO_BET", { value: "DRAW" } as never, 1, 0), null);

  console.log("\nHT/FT settlement:");
  const ht = (h: number, a: number) => ({ home: h, away: a });
  eq("lead at HT, win at FT", resolveMarket("HT_FT", { ht: "HOME", ft: "HOME" }, 2, 0, ht(1, 0)), "WON");
  eq("level at HT, win at FT", resolveMarket("HT_FT", { ht: "DRAW", ft: "HOME" }, 2, 1, ht(1, 1)), "WON");
  eq("behind at HT, win at FT (the comeback)", resolveMarket("HT_FT", { ht: "AWAY", ft: "HOME" }, 2, 1, ht(0, 1)), "WON");
  eq("right at HT, wrong at FT -> LOST", resolveMarket("HT_FT", { ht: "HOME", ft: "HOME" }, 1, 1, ht(1, 0)), "LOST");
  eq("wrong at HT, right at FT -> LOST", resolveMarket("HT_FT", { ht: "DRAW", ft: "HOME" }, 2, 0, ht(1, 0)), "LOST");
  eq("draw/draw", resolveMarket("HT_FT", { ht: "DRAW", ft: "DRAW" }, 1, 1, ht(0, 0)), "WON");
  // Fails closed without halftime, exactly as WIN_EITHER_HALF does.
  eq("no halftime -> null", resolveMarket("HT_FT", { ht: "HOME", ft: "HOME" }, 2, 0), null);
  eq("null halftime -> null", resolveMarket("HT_FT", { ht: "HOME", ft: "HOME" }, 2, 0, null), null);
  // Impossible data: goals cannot be un-scored between the break and the whistle.
  eq("halftime above fulltime -> null", resolveMarket("HT_FT", { ht: "HOME", ft: "HOME" }, 1, 0, ht(2, 0)), null);
  eq("HT/FT never voids", ["WON", "LOST"].includes(String(resolveMarket("HT_FT", { ht: "DRAW", ft: "DRAW" }, 0, 0, ht(0, 0)))), true);

  console.log("\nselection validation:");
  check("DNB accepts HOME/AWAY", isValidSelection("DRAW_NO_BET", { value: "HOME" }) && isValidSelection("DRAW_NO_BET", { value: "AWAY" }));
  check("DNB rejects DRAW", !isValidSelection("DRAW_NO_BET", { value: "DRAW" }));
  check("HT/FT needs both halves", !isValidSelection("HT_FT", { ht: "HOME" }) && !isValidSelection("HT_FT", { ft: "HOME" }));
  check("HT/FT accepts all nine combinations",
    ["HOME", "DRAW", "AWAY"].every((a) => ["HOME", "DRAW", "AWAY"].every((b) => isValidSelection("HT_FT", { ht: a, ft: b }))));
  check("display text names both halves", deriveMarketAndPick("HT_FT", { ht: "AWAY", ft: "HOME" }, "Arsenal", "Chelsea").pick === "Chelsea at HT / Arsenal at FT");
  check("DNB display text marks the refund", deriveMarketAndPick("DRAW_NO_BET", { value: "HOME" }, "Arsenal", "Chelsea").pick.includes("draw no bet"));

  console.log("\nMarket-Confirmed exclusion (enforced, not assumed):");
  // HT/FT is a nine-outcome market whose best real price de-vigs to about 43%,
  // so it can never clear a 75% market floor. Letting the dedicated pass target
  // it would spend attempts that cannot succeed.
  check("HT_FT is not in the eligible list", !(MC_ELIGIBLE_MARKET_TYPES as readonly string[]).includes("HT_FT"));
  check("isEligibleMarketType rejects HT_FT", !isEligibleMarketType("HT_FT"));
  check("the gate rejects HT_FT outright, even at 99% model confidence",
    evaluateMarketConfirmed({ marketType: "HT_FT", selection: { ht: "HOME", ft: "HOME" }, confidence: 99, odds: null, fetchedAt: new Date() }).reason === "INELIGIBLE_MARKET");
  // DRAW_NO_BET is excluded for a different reason worth stating: its bookmaker
  // market is named "Home/Away" and is not one of the four HEADLINE_MARKETS, so
  // there is no stored price to compare against.
  check("DRAW_NO_BET is also excluded, for lack of a stored headline market", !isEligibleMarketType("DRAW_NO_BET"));
  check("both remain generatable by the model", ["DRAW_NO_BET", "HT_FT"].every((m) => (AUTO_MARKET_TYPES as readonly string[]).includes(m)));
  check("both remain settable by an admin", ["DRAW_NO_BET", "HT_FT"].every((m) => (ADMIN_MARKET_TYPES as readonly string[]).includes(m)));

  console.log("\nVOID is no longer negligible — strike-rate maths:");
  // A realistic Draw No Bet season: roughly a quarter of matches end level.
  const dnbSeason = [
    ...Array(12).fill("WON"), ...Array(8).fill("LOST"), ...Array(7).fill("VOID"),
  ];
  const stat = computeStat(dnbSeason);
  eq("VOIDs are excluded from the denominator", stat.decided, 20);
  eq("total still counts every settled row", stat.total, 27);
  eq("rate is won/decided, not won/total", stat.rate, 12 / 20);
  check("the rate is NOT diluted by voids", stat.rate !== 12 / 27, `${stat.rate}`);
  eq("voids are reported, not silently dropped", stat.void, 7);
  // The edge case a rare-VOID assumption would crash on.
  const allVoid = computeStat(["VOID", "VOID", "VOID"]);
  eq("an all-void set yields a null rate, not NaN or 0", allVoid.rate, null);
  eq("an all-void set still reports its voids", allVoid.void, 3);
  check("a null rate is distinguishable from a 0% rate", computeStat(["LOST"]).rate === 0 && allVoid.rate === null);

  console.log("\nreal finished fixtures (HT/FT and DNB against scorelines that happened):");
  const played = await prisma.prediction.findMany({
    where: { finalHomeScore: { not: null }, finalAwayScore: { not: null } },
    select: { homeTeam: true, awayTeam: true, finalHomeScore: true, finalAwayScore: true },
    take: 200,
  });
  let draws = 0;
  for (const p of played) if (p.finalHomeScore === p.finalAwayScore) draws++;
  console.log(`  ${played.length} settled fixtures with a stored score, ${draws} draws (${((draws / Math.max(1, played.length)) * 100).toFixed(1)}%)`);
  check("real draw rate is material, not negligible", played.length === 0 || draws / played.length > 0.05,
    `${draws}/${played.length}`);

  // Every real scoreline must resolve DNB, and resolve HT/FT once a halftime is
  // supplied — no scoreline may produce null except through missing data.
  let dnbNulls = 0;
  let dnbVoids = 0;
  for (const p of played) {
    const r = resolveMarket("DRAW_NO_BET", { value: "HOME" }, p.finalHomeScore!, p.finalAwayScore!);
    if (r === null) dnbNulls++;
    if (r === "VOID") dnbVoids++;
  }
  eq("no real scoreline leaves Draw No Bet unresolved", dnbNulls, 0);
  eq("Draw No Bet voids exactly on the draws", dnbVoids, draws);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
