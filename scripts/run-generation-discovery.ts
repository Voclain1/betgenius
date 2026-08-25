/**
 * Manually advance the generation discovery cursor — the same code path the
 * scheduled discovery job runs, so the candidate ledger it fills is the real
 * thing rather than a fixture.
 *
 * Run: npx tsx --env-file=.env scripts/run-generation-discovery.ts [cycles] [batch]
 */
export {};

import { prisma } from "../src/lib/prisma";
import { discoverGenerationCandidates } from "../src/lib/generation/queue";

async function main() {
  const cycles = Math.min(30, Math.max(1, Number(process.argv[2]) || 5));
  const batch = Math.min(4, Math.max(1, Number(process.argv[3]) || 4));
  let calls = 0;
  let queued = 0;

  for (let i = 0; i < cycles; i++) {
    const r = await discoverGenerationCandidates({ batchSize: batch });
    calls += r.discoveryCalls;
    queued += r.candidatesQueued;
    console.log(`cycle ${i + 1}: cursor ${r.cursorStart}->${r.cursorEnd} scanned=${r.leaguesScanned} found=${r.candidatesFound} queued=${r.candidatesQueued} calls=${r.discoveryCalls}`);
  }

  const pending = await prisma.generationAttempt.count({ where: { status: "PENDING", kickoff: { gt: new Date() } } });
  console.log(`\ntotal discovery calls: ${calls} | newly queued: ${queued} | PENDING with future kickoff: ${pending}`);
  await prisma.$disconnect();
}

main();
