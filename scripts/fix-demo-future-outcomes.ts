/**
 * Un-settle demo rows whose kickoff is still in the future.
 *
 * seed-demo.ts jitters each kickoff by up to +/-4h. Settled specs use an
 * offset of -randInt(0, 25), which includes 0 (today), so seeding late in the
 * evening pushed some settled rows past midnight — "tomorrow, already won".
 * The homepage Genius table renders any outcome that is not PENDING, so those
 * appeared as decided results on matches that have not kicked off.
 *
 * seed-demo.ts no longer produces them. This repairs rows already written.
 *
 * outcome is NOT the only field to reset. A settled row also carries a final
 * scoreline and a settlement audit trail, and leaving those behind would swap
 * one inconsistency for a subtler one: a PENDING row with a full-time score.
 * All six fields go back to their unsettled state.
 *
 * SAFETY: refuses to run unless the target host differs from the production
 * host, and only touches rows belonging to the demo seed job.
 *
 * Dry run by default. Run: npx tsx scripts/fix-demo-future-outcomes.ts [--apply]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

const PRODUCTION_HOST_FRAGMENT = "ep-weathered-rain-awisggd0";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL ?? "";
  const host = url.replace(/.*@/, "").replace(/\/.*/, "");

  if (!host) throw new Error("DATABASE_URL is not set.");
  if (host.includes(PRODUCTION_HOST_FRAGMENT)) {
    throw new Error(`Refusing to run: ${host} is the PRODUCTION database. This script is for the isolated preview database only.`);
  }
  console.log(`target host: ${host}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const { DEMO_AIJOB_ID } = await import("./demo-seed-id");

  const now = new Date();
  const where = {
    aiJobId: DEMO_AIJOB_ID,
    kickoff: { gt: now },
    outcome: { not: "PENDING" },
  } as const;

  const affected = await prisma.prediction.findMany({
    where,
    select: { id: true, kickoff: true, outcome: true, finalHomeScore: true, finalAwayScore: true },
    orderBy: { kickoff: "asc" },
  });

  console.log(`\ndemo rows with a future kickoff AND a settled outcome: ${affected.length}`);
  for (const r of affected.slice(0, 8)) {
    console.log(`  ${r.kickoff?.toISOString()}  ${r.outcome}  score ${r.finalHomeScore}-${r.finalAwayScore}`);
  }
  if (affected.length > 8) console.log(`  ... and ${affected.length - 8} more`);

  if (affected.length === 0) {
    console.log("\nNothing to fix.");
    await prisma.$disconnect();
    return;
  }

  if (apply) {
    const res = await prisma.prediction.updateMany({
      where,
      data: {
        outcome: "PENDING",
        finalHomeScore: null,
        finalAwayScore: null,
        settledAt: null,
        settledById: null,
        settlementNote: null,
      },
    });
    console.log(`\nAPPLIED — ${res.count} row(s) reset to PENDING with the scoreline and audit trail cleared.`);
    const left = await prisma.prediction.count({ where });
    console.log(`remaining future-dated settled demo rows: ${left}`);
  } else {
    console.log("\nDRY RUN — re-run with --apply to write.");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
