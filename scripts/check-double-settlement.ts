/**
 * End-to-end check of double settlement against REAL leg outcomes.
 *
 * Creates two doubles from real settled predictions, publishes them, runs the
 * settlement pass, and asserts the composed outcomes match what the legs
 * actually did — then DELETES them. Every id is recorded before anything is
 * published and cleanup runs in `finally`, so an assertion failure or a crash
 * still removes the rows.
 *
 * Why write at all: settleSameGameDoubles reads status/outcome straight from
 * the database, so a dry run over a table with no doubles in it exercises
 * nothing. The alternative — asserting a reimplementation of the query — would
 * test the copy rather than the code the cron actually runs.
 *
 * The rows it creates sit on months-old fixtures, and every public feed filters
 * to the current Lagos day, so they are not reachable from the site while they
 * briefly exist.
 *
 * Run: npx tsx scripts/check-double-settlement.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { assembleSameGameDoubles, settleSameGameDoubles } = await import("../src/lib/sameGameDoubleAssembly");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const createdIds: string[] = [];
  const long_ago = new Date("2000-01-01T00:00:00Z");

  try {
    const asm = await assembleSameGameDoubles({ now: long_ago, limit: 5 });
    for (const c of asm.created) createdIds.push(c.predictionId);
    console.log(`created ${createdIds.length} double(s) for the check\n`);
    check("assembler created at least one double", createdIds.length > 0);

    const rows = await prisma.prediction.findMany({
      where: { id: { in: createdIds } },
      select: { id: true, status: true, outcome: true, marketType: true, confidence: true, selection: true, pick: true, reasoning: true },
    });

    check("created as PENDING_REVIEW, never straight to PUBLISHED",
      rows.every((r) => r.status === "PENDING_REVIEW"),
      [...new Set(rows.map((r) => r.status))].join("/"));
    check("created PENDING, not pre-settled", rows.every((r) => r.outcome === "PENDING"));
    check("reasoning quotes both legs verbatim",
      rows.every((r) => r.reasoning.includes("Both parts must land")));

    // A PENDING_REVIEW double must be invisible to the settlement pass.
    const beforePublish = await settleSameGameDoubles({ dryRun: true });
    check("an unpublished double is not settled",
      !beforePublish.some((r) => createdIds.includes(r.id)),
      `${beforePublish.length} row(s) seen`);

    await prisma.prediction.updateMany({ where: { id: { in: createdIds } }, data: { status: "PUBLISHED" } });

    const settled = await settleSameGameDoubles({ dryRun: true });
    const mine = settled.filter((r) => createdIds.includes(r.id));
    check("published doubles are picked up", mine.length === createdIds.length, `${mine.length}/${createdIds.length}`);

    console.log("");
    for (const r of mine) {
      console.log(`  ${r.match}`);
      console.log(`     legs ${r.detail}  ->  double ${r.result}`);
    }
    console.log("");

    // The real assertion: the composed outcome must match the legs.
    for (const r of mine) {
      const row = rows.find((x) => x.id === r.id)!;
      const legIds = (row.selection as { legIds: string[] }).legIds;
      const legs = await prisma.prediction.findMany({ where: { id: { in: legIds } }, select: { outcome: true } });
      const outcomes = legs.map((l) => l.outcome);
      const bothWon = outcomes.every((o) => o === "WON");
      const anyVoid = outcomes.some((o) => o === "VOID");
      const anyPending = outcomes.some((o) => o === "PENDING");
      const expected = anyPending ? "legs_pending" : anyVoid ? "VOID" : bothWon ? "WON" : "LOST";
      check(`${r.match}: composed ${r.result} from ${outcomes.join("/")}`, r.result === expected, `expected ${expected}`);
    }

    // Dry run must not have written anything.
    const afterDry = await prisma.prediction.findMany({ where: { id: { in: createdIds } }, select: { outcome: true, settledAt: true } });
    check("dry run left outcomes untouched", afterDry.every((r) => r.outcome === "PENDING" && r.settledAt === null));

    // Now for real, then confirm it persisted.
    await settleSameGameDoubles();
    const afterReal = await prisma.prediction.findMany({ where: { id: { in: createdIds } }, select: { outcome: true, settledAt: true } });
    check("a real run persists the outcome",
      afterReal.every((r) => r.outcome !== "PENDING" && r.settledAt !== null),
      afterReal.map((r) => r.outcome).join("/"));

    // And a settled double is not re-settled on the next pass.
    const rerun = await settleSameGameDoubles({ dryRun: true });
    check("a settled double is not picked up again", !rerun.some((r) => createdIds.includes(r.id)));

    // Assembler must not duplicate a fixture that now has a double.
    const again = await assembleSameGameDoubles({ dryRun: true, now: long_ago, limit: 5 });
    check("assembler skips fixtures that already have a double",
      again.created.length === 0 && again.rejected.some((r) => r.reason === "ALREADY_EXISTS"),
      `${again.created.length} would be created`);
  } finally {
    if (createdIds.length) {
      const del = await prisma.prediction.deleteMany({ where: { id: { in: createdIds } } });
      console.log(`\ncleanup: deleted ${del.count} of ${createdIds.length} created row(s)`);
      const left = await prisma.prediction.count({ where: { id: { in: createdIds } } });
      if (left !== 0) {
        failures++;
        console.log(`  FAIL  ${left} test row(s) still present`);
      } else {
        console.log(`  PASS  no test rows remain`);
      }
    }
    const strays = await prisma.prediction.count({ where: { marketType: "SAME_GAME_DOUBLE" } });
    console.log(`doubles remaining in database: ${strays}`);
    if (strays !== 0) { failures++; console.log(`  FAIL  expected 0`); }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
