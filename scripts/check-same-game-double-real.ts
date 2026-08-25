/**
 * Runs the same-game-double decision layer over REAL settled predictions.
 *
 * check-leg-compatibility.ts asserts the rules against hand-written cases. This
 * one turns them loose on the actual database: every pair of auto-settleable
 * predictions that share a fixture, filtered by checkLegCompatibility, then
 * composed with composeComboOutcome and checked against what the two legs
 * really did. Hand-written cases prove the rules say what I meant; this proves
 * they survive contact with rows the pipeline actually produced.
 *
 * It also reports the observed strike rate of assemblable doubles against the
 * individual legs — the baseline for whether this belongs in a paid tier. That
 * number governs nothing yet: the same 30-settled-sample floor that gates
 * BET_OF_DAY_DAILY_QUOTA applies here, and the real count is far below it.
 *
 * Read-only. Run: npx tsx scripts/check-same-game-double-real.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { checkLegCompatibility, composeComboOutcome, comboConfidenceCeiling, type Leg } from "../src/lib/sameGameDouble";
import type { Outcome } from "../src/lib/enums";
import type { MarketType, Selection } from "../src/lib/markets";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { deriveMarketAndPick, isValidSelection } = await import("../src/lib/markets");

  const rows = await prisma.prediction.findMany({
    where: {
      homeTeamApiId: { not: null },
      awayTeamApiId: { not: null },
      kickoff: { not: null },
      manualSettlementOnly: false,
    },
    select: {
      id: true, marketType: true, selection: true, confidence: true, outcome: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
    },
  });

  // Same identity the odds cache uses: the two team ids plus the UTC day.
  // Prediction carries no fixture id, so this is what "same fixture" means.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.homeTeamApiId}-${r.awayTeamApiId}-${r.kickoff!.toISOString().slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  let failures = 0;
  let pairsSeen = 0;
  let assemblable = 0;
  const rejected = new Map<string, number>();
  const settledDoubles: Array<{ label: string; outcome: Outcome; ceiling: number }> = [];
  let legWon = 0;
  let legSettled = 0;

  console.log("Real same-fixture pairs:\n");

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!isValidSelection(a.marketType as MarketType, a.selection as Selection)) continue;
        if (!isValidSelection(b.marketType as MarketType, b.selection as Selection)) continue;

        const legA: Leg = { marketType: a.marketType as MarketType, selection: a.selection as Selection };
        const legB: Leg = { marketType: b.marketType as MarketType, selection: b.selection as Selection };
        pairsSeen++;

        const pickOf = (r: typeof a) =>
          deriveMarketAndPick(r.marketType as MarketType, r.selection as Selection, r.homeTeam!, r.awayTeam!, {
            market: r.marketType,
            pick: "",
          }).pick;

        const label = `${a.homeTeam} v ${a.awayTeam}: ${pickOf(a)} + ${pickOf(b)}`;
        const verdict = checkLegCompatibility(legA, legB);

        if (!verdict.ok) {
          rejected.set(verdict.reason, (rejected.get(verdict.reason) ?? 0) + 1);
          console.log(`  ${verdict.reason.padEnd(14)} ${label}`);
          console.log(`  ${"".padEnd(14)}   ${verdict.detail}`);
          continue;
        }

        assemblable++;
        const composed = composeComboOutcome(a.outcome as Outcome, b.outcome as Outcome);
        const ceiling = comboConfidenceCeiling(a.confidence, b.confidence);

        // The invariant, checked against real outcomes rather than asserted:
        // a double is WON only where BOTH legs are WON, and is never settled
        // while either leg is still pending.
        const bothWon = a.outcome === "WON" && b.outcome === "WON";
        if (composed === "WON" && !bothWon) {
          failures++;
          console.log(`  FAIL           ${label} — composed WON but legs were ${a.outcome}/${b.outcome}`);
        }
        if (composed !== null && (a.outcome === "PENDING" || b.outcome === "PENDING")) {
          failures++;
          console.log(`  FAIL           ${label} — settled ${composed} with a pending leg`);
        }
        if (composed === null && a.outcome !== "PENDING" && b.outcome !== "PENDING") {
          failures++;
          console.log(`  FAIL           ${label} — both legs settled (${a.outcome}/${b.outcome}) but composed null`);
        }

        console.log(`  OK             ${label}`);
        console.log(`  ${"".padEnd(14)}   legs ${a.outcome}/${b.outcome} -> double ${composed ?? "PENDING"}   ceiling ${ceiling}% (legs ${a.confidence}/${b.confidence})`);

        if (composed !== null) settledDoubles.push({ label, outcome: composed, ceiling });
      }
    }
  }

  for (const r of rows) {
    if (r.outcome === "WON" || r.outcome === "LOST") {
      legSettled++;
      if (r.outcome === "WON") legWon++;
    }
  }

  const won = settledDoubles.filter((d) => d.outcome === "WON").length;
  const lost = settledDoubles.filter((d) => d.outcome === "LOST").length;
  const void_ = settledDoubles.filter((d) => d.outcome === "VOID").length;
  const decided = won + lost;

  console.log(`\n===== SUMMARY =====`);
  console.log(`same-fixture pairs examined:   ${pairsSeen}`);
  console.log(`assemblable after filtering:   ${assemblable}`);
  for (const [reason, count] of rejected) console.log(`rejected ${reason.padEnd(14)} ${count}`);
  console.log(`\nfully-settled doubles:         ${settledDoubles.length}  (WON ${won}, LOST ${lost}, VOID ${void_})`);
  if (decided > 0) {
    console.log(`double strike rate:            ${(won / decided * 100).toFixed(1)}%  (n=${decided})`);
  }
  if (legSettled > 0) {
    console.log(`single-leg strike rate:        ${(legWon / legSettled * 100).toFixed(1)}%  (n=${legSettled})`);
  }

  // Same floor as BET_OF_DAY_MIN_CALIBRATION_SAMPLE. Below it, the rate above
  // is reported but must not be used to argue for a tier or a volume.
  const FLOOR = 30;
  console.log(
    decided >= FLOOR
      ? `\nsample meets the ${FLOOR}-double floor — the rate above may inform tier placement.`
      : `\nBELOW the ${FLOOR}-double floor (${decided}). The rate above is descriptive only and must not be used to argue for tier placement or volume.`,
  );

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} invariant failure(s) over ${assemblable} real assemblable pair(s)`);
  if (failures) process.exitCode = 1;

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
