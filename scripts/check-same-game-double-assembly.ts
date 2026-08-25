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
  const { assembleSameGameDoubles } = await import("../src/lib/sameGameDoubleAssembly");

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

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
