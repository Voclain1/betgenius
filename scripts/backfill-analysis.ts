/**
 * Backfill Prediction.analysisJson from the AI output already on disk.
 *
 * keyFactors has been requested by the prompt since the beginning and discarded
 * at persist time, so it is sitting in every completed AIJob.rawOutput. This
 * recovers it — no model call, no api-football call, no cost. Without it, key
 * factors would only ever appear on predictions generated after Phase 3, and
 * every existing published page would stay thinner for no reason.
 *
 * Idempotent and safely re-runnable: only touches rows where analysisJson is
 * still null, so an interrupted run just leaves the remainder for next time.
 * Rows whose job is missing, unparseable, or carried no usable factors are
 * counted and skipped rather than written as an empty analysis — parseAnalysis
 * treats an empty factor list as "nothing to render" anyway, so writing one
 * would only make the row look processed.
 *
 * Run manually: npx tsx --env-file=.env scripts/backfill-analysis.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { buildAnalysis } from "../src/lib/predictionAnalysis";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.prediction.findMany({
    where: { analysisJson: { equals: Prisma.DbNull }, aiJobId: { not: null } },
    select: { id: true, homeTeam: true, awayTeam: true, aiJob: { select: { rawOutput: true, status: true } } },
  });

  console.log(`${rows.length} predictions with no analysisJson and a linked AI job`);

  let written = 0;
  let noFactors = 0;
  let unparseable = 0;

  for (const r of rows) {
    const raw = r.aiJob?.rawOutput;
    if (!raw) { unparseable++; continue; }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // FAILED jobs store the error message here rather than JSON — expected,
      // not a problem worth reporting per row.
      unparseable++;
      continue;
    }

    const analysis = buildAnalysis(parsed ?? {});
    if (analysis.keyFactors.length === 0) { noFactors++; continue; }

    await prisma.prediction.update({
      where: { id: r.id },
      data: { analysisJson: analysis as unknown as Prisma.InputJsonValue },
    });
    written++;
  }

  console.log(`written: ${written}`);
  console.log(`skipped — job output carried no usable key factors: ${noFactors}`);
  console.log(`skipped — job output missing or not JSON (e.g. FAILED jobs): ${unparseable}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
