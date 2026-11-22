/**
 * READ-ONLY: how often recent stored prose would trip the expanded house-voice
 * scan (2026-11 editorial standards). Run before relying on the new terms, to
 * see the likely effect on first-pass rejection rates, and to list published
 * rows an administrator may want to review.
 *
 *   npx tsx scripts/measure-editorial-voice.ts [--days=30]
 *
 * Reads only (findMany); writes nothing; changes no prediction. Prints counts,
 * labels and prediction ids. It never prints the prose itself.
 * Published rows it lists are NOT edited by anything: they change only through
 * the existing admin review and approval flow.
 */
export {};

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = Math.max(1, Math.min(365, Number(daysArg?.split("=")[1] ?? 30) || 30));
  const { prisma } = await import("../src/lib/prisma");
  const { scanDraftForInternalTerminology, BACKFILL_TERM_LABELS } = await import("../src/lib/houseVoice");
  const { parseAnalysis } = await import("../src/lib/predictionAnalysis");

  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.prediction.findMany({
    where: { createdAt: { gte: since }, aiJobId: { not: null } },
    select: { id: true, status: true, matchPreview: true, reasoning: true, analysisJson: true },
  });

  const byLabel: Record<string, { rows: number; new: boolean; published: number }> = {};
  const flagged = { total: 0, newOnly: 0, publishedNewOnly: [] as string[] };
  for (const r of rows) {
    const hits = scanDraftForInternalTerminology({ matchPreview: r.matchPreview, reasoning: r.reasoning, keyFactors: parseAnalysis(r.analysisJson)?.keyFactors ?? [] });
    if (!hits.length) continue;
    flagged.total++;
    const labels = [...new Set(hits.map((h) => h.label))];
    const onlyNew = labels.every((l) => !BACKFILL_TERM_LABELS.has(l));
    if (onlyNew) {
      flagged.newOnly++;
      if (r.status === "PUBLISHED") flagged.publishedNewOnly.push(r.id);
    }
    for (const l of labels) {
      byLabel[l] ??= { rows: 0, new: !BACKFILL_TERM_LABELS.has(l), published: 0 };
      byLabel[l].rows++;
      if (r.status === "PUBLISHED") byLabel[l].published++;
    }
  }
  console.log(JSON.stringify({
    scope: { generatedInLastDays: days, rowsScanned: rows.length },
    rowsTrippingAnyTerm: flagged.total,
    rowsTrippingOnlyNewTerms: flagged.newOnly,
    // Upper bound on extra first-pass rejections had the new terms applied to these drafts.
    newTermShareOfScanned: rows.length ? +(flagged.newOnly / rows.length).toFixed(4) : 0,
    byLabel: Object.fromEntries(Object.entries(byLabel).sort((a, b) => b[1].rows - a[1].rows)),
    publishedForOptionalAdminReview: flagged.publishedNewOnly,
  }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
