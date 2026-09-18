/**
 * Does Bet of the Day suffer the same claim-window race the VIP/PREMIUM pass did?
 *
 * THE HYPOTHESIS. selectBetOfTheDayTargets reads getCandidateOddsTargets, which
 * deliberately returns ledger rows in BOTH the PENDING and SUCCEEDED states —
 * the odds workload wants to keep pricing a fixture after it has been generated.
 * Targeting does not want that: selectCandidates only ever offers fixtures that
 * still need predictions, so a SUCCEEDED fixture handed to the worker as a
 * matchKey can never be claimed. That is exactly the defect that made the first
 * live VIP/PREMIUM run report `claimed 0`.
 *
 * Bet of the Day contains no status filter, so on a reading of the code it has
 * the same race. This measures whether it actually bites, because "the code
 * looks wrong" and "production is losing picks" are different claims:
 *
 *   1. What does Bet of the Day target RIGHT NOW, and what state are those
 *      fixtures in? A target that is already SUCCEEDED is an unusable slot.
 *   2. Historically: how many BET_OF_THE_DAY jobs ran, and how many predictions
 *      did they actually produce? A large gap is the race biting.
 *   3. Is the single BET_OF_THE_DAY slot being filled from dedicated generation
 *      at all, or only by autoSelectBetOfTheDay picking over rows that ordinary
 *      generation produced — the same "curation wearing a dedicated pass's
 *      name" pattern the BANKER audit found?
 *
 * Read-only. No api-football calls, no model calls, no writes.
 * Run: npx tsx --env-file=.env scripts/research-betofday-claim-race.ts [days]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

// Imported dynamically inside main(): betOfTheDay.ts calls react.cache at module
// scope, which only exists once the shim above has run, and static imports hoist
// above it.
import type { prisma as PrismaClient } from "../src/lib/prisma";

const DAYS = Number(process.argv[2] ?? 90);
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

function categoriesOf(promptJson: string): string[] {
  try {
    return JSON.parse(promptJson)?.categories ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const { prisma } = (await import("../src/lib/prisma")) as { prisma: typeof PrismaClient };
  const { BET_OF_THE_DAY, selectBetOfTheDayTargets } = await import("../src/lib/betOfTheDay");
  const { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } = await import("../src/lib/generation/selector");

  const now = new Date();
  console.log(`\n=== Bet of the Day: claim-window race check — last ${DAYS} days ===\n`);

  // ---- 1. what would it target right now, and is any of it claimable? -----
  const selection = await selectBetOfTheDayTargets(now, 12);
  console.log(`--- 1. Live targeting right now ---`);
  console.log(`  candidates considered: ${selection.considered}`);
  console.log(`  claimable (PENDING, in generation window): ${selection.claimable}`);
  console.log(`  priced into the band:  ${selection.pricedInBand}`);
  console.log(`  targets it would take: ${selection.targets.length}`);

  if (selection.targets.length) {
    const ledger = await prisma.generationAttempt.findMany({
      where: { matchKey: { in: selection.targets.map((t) => t.matchKey) } },
      select: { matchKey: true, status: true, kickoff: true },
    });
    const byKey = new Map(ledger.map((l) => [l.matchKey, l]));
    let claimable = 0;
    const fromMs = now.getTime() + GENERATE_FROM_HOURS * 3_600_000;
    const untilMs = now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000;
    for (const t of selection.targets) {
      const l = byKey.get(t.matchKey);
      const ko = t.kickoff.getTime();
      const inWindow = ko >= fromMs && ko <= untilMs;
      const ok = l?.status === "PENDING" && inWindow;
      if (ok) claimable++;
      console.log(
        `      ${(l?.status ?? "?").padEnd(9)} ko+${((ko - now.getTime()) / 3_600_000).toFixed(1).padStart(6)}h ` +
          `${inWindow ? "in-window " : "OUTSIDE   "} ${ok ? "CLAIMABLE" : "unusable "}  ${t.homeTeam} v ${t.awayTeam} @ ${t.price}`,
      );
    }
    console.log(`  => claimable targets: ${claimable} of ${selection.targets.length}  ${pct(claimable, selection.targets.length)}`);
    if (claimable === 0) {
      console.log(`  => every target is unusable: the race is REAL and currently total.`);
    }
  } else {
    console.log(`  (nothing priced into the band right now — inconclusive on this run alone)`);
  }

  // ---- 2. historical jobs vs predictions produced -------------------------
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, prompt: true, createdAt: true },
  });
  const bodJobs = jobs.filter((j) => categoriesOf(j.prompt).includes(BET_OF_THE_DAY));
  const bodDays = new Set(bodJobs.map((j) => j.createdAt.toISOString().slice(0, 10)));

  console.log(`\n--- 2. Did dedicated Bet of the Day generation ever run? ---`);
  console.log(`  AIJobs carrying BET_OF_THE_DAY in their requested categories: ${bodJobs.length} on ${bodDays.size} distinct day(s)`);
  if (bodJobs.length === 0) {
    console.log(`  => the dedicated bolder-path generation has NEVER run in this window.`);
  } else {
    const produced = await prisma.prediction.count({ where: { aiJobId: { in: bodJobs.map((j) => j.id) } } });
    console.log(`  predictions produced by those jobs: ${produced}`);
  }

  // ---- 3. where does the slot's occupant actually come from? --------------
  const tagged = await prisma.prediction.findMany({
    where: { createdAt: { gte: since }, categories: { some: { category: BET_OF_THE_DAY } } },
    select: { id: true, provenance: true, confidence: true, createdAt: true, aiJob: { select: { prompt: true } } },
  });
  console.log(`\n--- 3. Rows that have worn the BET_OF_THE_DAY tag ---`);
  console.log(`  tagged rows: ${tagged.length}`);
  const fromBod = tagged.filter((r) => r.aiJob && categoriesOf(r.aiJob.prompt).includes(BET_OF_THE_DAY)).length;
  console.log(`  ...generated WITH Bet of the Day intent:      ${fromBod}  ${pct(fromBod, tagged.length)}`);
  console.log(`  ...tagged afterwards by auto-selection alone: ${tagged.length - fromBod}  ${pct(tagged.length - fromBod, tagged.length)}`);
  if (tagged.length && fromBod === 0) {
    console.log(`  => every Bet of the Day has been ordinary output relabelled, exactly as the`);
    console.log(`     BANKER audit found before its dedicated pass was built.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
