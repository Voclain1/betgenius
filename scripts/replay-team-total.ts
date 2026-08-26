/**
 * Real replay for TEAM_TOTAL — what the model actually picks, on real evidence.
 *
 * Same method as every market-type change this session: replay the digest
 * stored on AIJob.context so the model sees the byte-identical prompt the
 * original job saw, and any difference is attributable to the prompt change
 * and nothing else. No api-football calls, nothing written.
 *
 * Two questions, and the second matters more:
 *
 *   1. Does TEAM_TOTAL ever get selected, and on what evidence?
 *   2. When it IS selected, is the line one generation is allowed to use?
 *      A model that reaches for "Over 2.5" or a whole-number line is exactly
 *      what isGeneratableTeamTotal exists to catch — so every emitted line is
 *      checked here rather than assumed.
 *
 * Run: npx tsx scripts/replay-team-total.ts [count]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { generatePredictionForFixture } = await import("../src/lib/ai/analysis");
  const { parseStoredContext } = await import("../src/lib/ai/context");
  const { resolveGenerationRisk } = await import("../src/lib/ai/generationRisk");
  const { deriveMarketAndPick, isValidSelection, isGeneratableTeamTotal } = await import("../src/lib/markets");

  const count = Number(process.argv[2] ?? 10);
  // A second argument skips ahead in the pool. The first slice was almost all
  // one obscure cup, and a market that needs team-specific evidence cannot be
  // judged on digests that do not carry any.
  const skip = Number(process.argv[3] ?? 0);

  const rows = await prisma.prediction.findMany({
    where: { aiJobId: { not: null }, homeTeam: { not: null }, awayTeam: { not: null } },
    select: {
      homeTeam: true, awayTeam: true, leagueName: true, leagueApiId: true,
      marketType: true, pick: true, confidence: true,
      aiJob: { select: { context: true, prompt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  // --stats-only replays ONLY digests whose coverage.stats is true. Without
  // it the sample is dominated by lower-tier cups where team scoring data did
  // not resolve — and a market that REQUIRES team-specific evidence cannot be
  // judged on evidence sets that contain none. 65% of stored digests carry it.
  const statsOnly = process.argv.includes("--stats-only");

  const seen = new Set<string>();
  const pool = rows
    .filter((r) => {
      const d = parseStoredContext(r.aiJob?.context) as any;
      if (!d) return false;
      if (statsOnly && d?.coverage?.stats !== true) return false;
      const k = `${r.homeTeam}|${r.awayTeam}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(skip, skip + count);

  console.log(`Replaying ${pool.length} fixtures on stored evidence.\n`);

  const mix = new Map<string, number>();
  const teamTotals: string[] = [];
  let illegalLines = 0;
  let invalid = 0;

  for (const row of pool) {
    const digest = parseStoredContext(row.aiJob!.context)!;
    let categories: string[] = [];
    try { categories = JSON.parse(row.aiJob!.prompt)?.categories ?? []; } catch {}
    const route = resolveGenerationRisk(categories, row.leagueApiId);

    try {
      const result = await generatePredictionForFixture({ digest, tiers: route.promptTiers, riskCalibration: "margin" });
      const preds = result.output.predictions ?? [];

      console.log(`  ${row.homeTeam} v ${row.awayTeam}  [${row.leagueName}]  tier=${route.promptTiers.join("+")}`);
      console.log(`     was: ${row.marketType} ${row.pick} @ ${row.confidence}%`);

      for (const p of preds) {
        mix.set(p.marketType, (mix.get(p.marketType) ?? 0) + 1);
        const ok = isValidSelection(p.marketType, p.selection);
        if (!ok) invalid++;
        const text = ok
          ? deriveMarketAndPick(p.marketType, p.selection, row.homeTeam!, row.awayTeam!, { market: p.marketType, pick: "" }).pick
          : "(invalid selection)";
        let flag = "";
        if (p.marketType === "TEAM_TOTAL") {
          const legal = isGeneratableTeamTotal(p.selection);
          if (!legal) { illegalLines++; flag = "  <-- LINE NOT ALLOWED, would be rejected at persist"; }
          teamTotals.push(`${row.homeTeam} v ${row.awayTeam}: ${text} @ ${Math.round(p.confidence)}%${legal ? "" : " (ILLEGAL LINE)"}`);
        }
        console.log(`     now: ${String(p.marketType).padEnd(15)} ${text} @ ${Math.round(p.confidence)}%${flag}`);
        console.log(`          ${String(p.reasoning ?? "").slice(0, 160)}`);
      }
      console.log("");
    } catch (err: any) {
      console.log(`  ${row.homeTeam} v ${row.awayTeam} — generation failed: ${err?.message ?? err}\n`);
    }
  }

  const total = [...mix.values()].reduce((a, b) => a + b, 0);
  console.log("===== MARKET MIX =====");
  for (const [m, c] of [...mix].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${m.padEnd(16)} ${String(c).padStart(3)}  (${((c / total) * 100).toFixed(1)}%)`);
  }

  console.log(`\nTEAM_TOTAL selections (${teamTotals.length}):`);
  for (const t of teamTotals) console.log(`   ${t}`);

  console.log(`\ninvalid selections emitted:        ${invalid}`);
  console.log(`TEAM_TOTAL on a disallowed line:   ${illegalLines}`);
  if (illegalLines > 0) {
    console.log("   (these would be rejected at persist by isGeneratableTeamTotal —");
    console.log("    the guard is working, but the prompt is not holding on its own)");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
