/**
 * How quickly the Doubles pipeline reaches the 30-settled floor at quota.
 *
 * Every input here is measured from real rows rather than assumed. The number
 * that matters is not doubles GENERATED per day — it is doubles SETTLED, and
 * those are separated by three real lags: a human review, the wait until
 * kickoff, and the settlement buffer afterwards. Quoting the generation rate
 * as if it were the settlement rate would overstate how fast the sample grows.
 *
 * Read-only. Run: npx tsx scripts/measure-doubles-sample-growth.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

const HOURS = 3_600_000;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { DOUBLES_DAILY_QUOTA } = await import("../src/lib/doublesTargeting");
  const { BET_OF_DAY_MIN_CALIBRATION_SAMPLE } = await import("../src/lib/betOfTheDay");

  // --- Lag 1: generation -> published (the human review) ---
  const reviewed = await prisma.prediction.findMany({
    where: { publishedAt: { not: null } },
    select: { createdAt: true, publishedAt: true },
  });
  const reviewLags = reviewed
    .map((r) => (r.publishedAt!.getTime() - r.createdAt.getTime()) / HOURS)
    .filter((h) => h >= 0 && h < 24 * 30);
  console.log(`review lag (created -> published), n=${reviewLags.length}`);
  console.log(`  median ${median(reviewLags).toFixed(1)}h   mean ${(reviewLags.reduce((a, b) => a + b, 0) / reviewLags.length).toFixed(1)}h`);

  // --- Lag 2: generation -> kickoff (how far ahead we generate) ---
  const withKickoff = await prisma.prediction.findMany({
    where: { kickoff: { not: null } },
    select: { createdAt: true, kickoff: true },
  });
  const leadLags = withKickoff
    .map((r) => (r.kickoff!.getTime() - r.createdAt.getTime()) / HOURS)
    .filter((h) => h > -24 && h < 24 * 14);
  console.log(`\nlead time (created -> kickoff), n=${leadLags.length}`);
  console.log(`  median ${median(leadLags).toFixed(1)}h   mean ${(leadLags.reduce((a, b) => a + b, 0) / leadLags.length).toFixed(1)}h`);

  // --- Lag 3: kickoff -> settled ---
  const settled = await prisma.prediction.findMany({
    where: { settledAt: { not: null }, kickoff: { not: null } },
    select: { kickoff: true, settledAt: true },
  });
  const settleLags = settled
    .map((r) => (r.settledAt!.getTime() - r.kickoff!.getTime()) / HOURS)
    .filter((h) => h > 0 && h < 24 * 14);
  console.log(`\nsettlement lag (kickoff -> settled), n=${settleLags.length}`);
  console.log(`  median ${median(settleLags).toFixed(1)}h   mean ${(settleLags.reduce((a, b) => a + b, 0) / settleLags.length).toFixed(1)}h`);

  // --- Measured conversion: fixtures generated -> doubles assembled ---
  // From the multi-market yield run: 12 of 12 replayed fixtures returned >=2
  // market calls, and 12 of 12 produced at least one assemblable pair. The
  // assembler publishes at most ONE double per fixture.
  const MEASURED_FIXTURES = 12;
  const MEASURED_WITH_PAIR = 12;
  const assembleRate = MEASURED_WITH_PAIR / MEASURED_FIXTURES;

  const perDay = DOUBLES_DAILY_QUOTA * assembleRate;
  const floor = BET_OF_DAY_MIN_CALIBRATION_SAMPLE;

  // The three lags are NOT additive. Review runs while the fixture is still
  // in the future — median review is 8.4h against a median 21.4h lead time —
  // so a double is gated by whichever of the two finishes LAST, then by the
  // settlement wait after kickoff. Summing all three would invent a delay that
  // does not exist.
  const gatingLagH = Math.max(median(reviewLags), median(leadLags));
  const pipelineLagH = gatingLagH + median(settleLags);
  const daysToGenerate = floor / perDay;

  console.log(`\n===== GROWTH AT QUOTA =====`);
  console.log(`daily quota:                       ${DOUBLES_DAILY_QUOTA} fixtures/day`);
  console.log(`measured assembly rate:            ${(assembleRate * 100).toFixed(0)}% of fixtures yield a pair (n=${MEASURED_FIXTURES})`);
  console.log(`doubles created per day:           ${perDay.toFixed(1)}`);
  console.log(`settled-sample floor:              ${floor}`);
  console.log(`days of generation to reach floor: ${daysToGenerate.toFixed(1)}`);
  console.log(`gating lag  max(review, lead):     ${gatingLagH.toFixed(1)}h`);
  console.log(`pipeline lag  gating + settlement:  ${pipelineLagH.toFixed(1)}h  (${(pipelineLagH / 24).toFixed(1)} days)`);
  console.log(`\ncalendar days until 30 have SETTLED: ~${(daysToGenerate + pipelineLagH / 24).toFixed(1)}`);

  // Sensitivity: the 100% assembly rate comes from n=12 and will not hold.
  console.log(`\nsensitivity — if the assembly rate is lower than measured:`);
  for (const rate of [1.0, 0.75, 0.5, 0.25]) {
    const d = floor / (DOUBLES_DAILY_QUOTA * rate);
    console.log(`  ${(rate * 100).toFixed(0).padStart(3)}% -> ${(DOUBLES_DAILY_QUOTA * rate).toFixed(1)} doubles/day, ${d.toFixed(1)} days generating, ~${(d + pipelineLagH / 24).toFixed(1)} days to floor`);
  }

  console.log(`\nnote: the 100% rate is n=12 on a non-random sample and is the single`);
  console.log(`most optimistic input here. Treat the 50-75% rows as the planning range.`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
