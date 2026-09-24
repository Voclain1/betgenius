/**
 * Dry-runs the assembler over REAL predictions and asserts its invariants.
 *
 * Nothing is written: every call passes dryRun, so this is safe to run against
 * the production database. `now` is wound back so the assembler sees real
 * historical fixtures as upcoming — otherwise this would only ever exercise
 * whatever happens to be scheduled at the moment it runs, which is no test at
 * all on a quiet day.
 *
 * Run: npx tsx scripts/check-same-game-double-assembly.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { assembleSameGameDoubles, describeDouble, describeDoubleReasoning } =
    await import("../src/lib/sameGameDoubleAssembly");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  // Far enough back that every stored fixture is still "upcoming".
  const long_ago = new Date("2000-01-01T00:00:00Z");

  const result = await assembleSameGameDoubles({ dryRun: true, now: long_ago, limit: 50 });

  console.log(`fixtures considered: ${result.fixturesConsidered}`);
  console.log(`would create:        ${result.created.length}`);
  console.log(`rejected:            ${result.rejected.length}\n`);

  for (const c of result.created) {
    console.log(`  CREATE  ${c.fixture}`);
    console.log(`          ${c.pick}`);
    console.log(`          ceiling ${c.ceiling}%   legs ${c.legIds[0].slice(0, 8)}/${c.legIds[1].slice(0, 8)}`);
  }
  for (const r of result.rejected) {
    console.log(`  ${r.reason.padEnd(15)} ${r.fixture} — ${r.detail}`);
  }

  console.log(`\ninvariants:`);
  check("dry run wrote nothing", result.created.every((c) => c.predictionId === "(dry-run)"));

  // At most one double per fixture: publishing every valid pair would put the
  // same match in the feed several times with heavily overlapping content.
  const fixtures = result.created.map((c) => c.fixture);
  check("at most one double per fixture", new Set(fixtures).size === fixtures.length,
    `${fixtures.length} created across ${new Set(fixtures).size} fixtures`);

  check("no double pairs a row with itself", result.created.every((c) => c.legIds[0] !== c.legIds[1]));

  check("every ceiling is a real percentage", result.created.every((c) => c.ceiling > 0 && c.ceiling <= 100));

  // The ceiling must equal the LOWER leg confidence, never a product or an average.
  const legIds = result.created.flatMap((c) => c.legIds);
  const legRows = await prisma.prediction.findMany({
    where: { id: { in: legIds } },
    select: { id: true, confidence: true, marketType: true, status: true },
  });
  const conf = new Map(legRows.map((l) => [l.id, l.confidence]));
  check("ceiling equals the lower leg confidence", result.created.every((c) => {
    const a = conf.get(c.legIds[0]);
    const b = conf.get(c.legIds[1]);
    return a != null && b != null && c.ceiling === Math.min(a, b);
  }));

  check("no leg is itself a double", legRows.every((l) => l.marketType !== "SAME_GAME_DOUBLE"));
  check("every leg was human-approved", legRows.every((l) => l.status === "APPROVED" || l.status === "PUBLISHED"),
    [...new Set(legRows.map((l) => l.status))].join("/"));

  // The redundant pairs the pipeline really produced must be among the
  // rejections, not among the creations.
  const redundant = result.rejected.filter((r) => r.reason === "REDUNDANT");
  check("known redundant pairs are rejected, not published", redundant.length > 0,
    `${redundant.length} redundant rejection(s)`);

  // Running twice must not double up.
  const second = await assembleSameGameDoubles({ dryRun: true, now: long_ago, limit: 50 });
  check("a second dry run is deterministic", JSON.stringify(second.created.map((c) => c.pick)) === JSON.stringify(result.created.map((c) => c.pick)));

  // The headline and the reasoning headings are assembled from the same leg
  // formatter, so they cannot describe the same leg two different ways. Built
  // from literal rows rather than from whatever is in the database, so these
  // assert the strings exactly on any day.
  console.log(`\ncombo display strings:`);
  const legRow = (over: Partial<Record<string, unknown>>) => ({
    id: "x", marketType: "OTHER", selection: null, confidence: 70, reasoning: "Because.",
    market: "Other", pick: "", homeTeam: "Doma United", awayTeam: "Rivers United",
    homeTeamApiId: 1, awayTeamApiId: 2, kickoff: new Date("2026-01-01T00:00:00Z"),
    leagueApiId: 1, leagueName: "NPFL", authorId: "a", fixtureId: null, fixtureApiId: null,
    ...over,
  }) as never;
  const dc = legRow({ id: "dc", marketType: "DOUBLE_CHANCE", selection: { value: "HOME_OR_DRAW" }, market: "Double Chance", pick: "Doma United or Draw", confidence: 78 });
  const bttsNo = legRow({ id: "bttsNo", marketType: "BTTS", selection: { value: "NO" }, market: "Both Teams to Score", pick: "No", confidence: 71 });
  const bttsYes = legRow({ id: "bttsYes", marketType: "BTTS", selection: { value: "YES" }, market: "Both Teams to Score", pick: "Yes", confidence: 69 });
  const over25 = legRow({ id: "ou", marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" }, market: "Total Goals", pick: "Over 2.5 Goals", confidence: 66 });
  const arsenalWin = legRow({ id: "mw", marketType: "MATCH_WINNER", selection: { value: "HOME" }, market: "Match Winner", pick: "Doma United to win", confidence: 74 });

  const headline = (a: never, b: never) => describeDouble(a, b).pick;
  check("Double Chance + BTTS No", headline(dc, bttsNo) === "Doma United or Draw + BTTS No", headline(dc, bttsNo));
  check("Double Chance + BTTS Yes", headline(dc, bttsYes) === "Doma United or Draw + BTTS Yes", headline(dc, bttsYes));
  check("BTTS Yes + Over 2.5 Goals", headline(bttsYes, over25) === "BTTS Yes + Over 2.5 Goals", headline(bttsYes, over25));
  check("Match Winner + BTTS No", headline(arsenalWin, bttsNo) === "Doma United to win + BTTS No", headline(arsenalWin, bttsNo));
  check("no headline ends in a bare Yes/No",
    result.created.every((c) => !/[+] (Yes|No)$/.test(c.pick)),
    result.created.map((c) => c.pick).filter((p) => /[+] (Yes|No)$/.test(p)).join(" | "));
  check("the stored market label is Combo Bet", describeDouble(dc, bttsNo).market === "Combo Bet");

  // A reader seeing "BTTS No" in the headline must find "BTTS No" as the
  // heading of the paragraph explaining it, not a bare "No".
  const reasoning = describeDoubleReasoning(dc, bttsNo);
  check("reasoning heading reads BTTS No", reasoning.includes("BTTS No — 71% confidence"), reasoning.split("\n")[0]);
  check("no bare Yes/No heading survives", !/(?:^|\n)(Yes|No) — \d+% confidence/.test(reasoning));
  check("the other leg's heading is unchanged", reasoning.includes("Doma United or Draw — 78% confidence"));
  check("both legs' own reasoning still appears", reasoning.includes("Because."));
  check("headline and reasoning cannot disagree",
    headline(dc, bttsNo).split(" + ").every((part) => reasoning.includes(`${part} — `)));
  const yesReasoning = describeDoubleReasoning(bttsYes, over25);
  check("reasoning heading reads BTTS Yes", yesReasoning.includes("BTTS Yes — 69% confidence"));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
