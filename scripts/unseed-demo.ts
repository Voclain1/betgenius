// Removes everything scripts/seed-demo.ts created. Run via:
//   npx tsx scripts/unseed-demo.ts
// The removal marker is a single foreign key: every demo Prediction has
// aiJobId === DEMO_AIJOB_ID. Delete those, then the AIJob row itself —
// PredictionCategoryLink rows cascade automatically (see schema.prisma).
import { PrismaClient } from "@prisma/client";
import { DEMO_AIJOB_ID } from "./seed-demo";

const prisma = new PrismaClient();

async function main() {
  const job = await prisma.aIJob.findUnique({ where: { id: DEMO_AIJOB_ID } });
  if (!job) {
    console.log(`No AIJob '${DEMO_AIJOB_ID}' found — nothing to unseed.`);
    return;
  }

  let realPredictionCountBeforeSeed: number | null = null;
  try {
    const parsed = JSON.parse(job.rawOutput);
    if (typeof parsed.realPredictionCountBeforeSeed === "number") realPredictionCountBeforeSeed = parsed.realPredictionCountBeforeSeed;
  } catch {
    // Ignore — falls back to skipping the before/after comparison below.
  }

  const { count: deletedCount } = await prisma.prediction.deleteMany({ where: { aiJobId: DEMO_AIJOB_ID } });
  await prisma.aIJob.delete({ where: { id: DEMO_AIJOB_ID } });

  const realPredictionCountAfter = await prisma.prediction.count();

  console.log(`Deleted ${deletedCount} demo predictions and the '${DEMO_AIJOB_ID}' AIJob row.`);
  if (realPredictionCountBeforeSeed != null) {
    const matches = realPredictionCountAfter === realPredictionCountBeforeSeed;
    console.log(
      `Real prediction count before seeding: ${realPredictionCountBeforeSeed}. After unseeding: ${realPredictionCountAfter}. ${
        matches ? "MATCH — clean removal." : "MISMATCH — investigate before trusting the data is fully clean."
      }`,
    );
  } else {
    console.log(`Real prediction count after unseeding: ${realPredictionCountAfter}. (No stored before-count to compare against — job.rawOutput wasn't parseable.)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
