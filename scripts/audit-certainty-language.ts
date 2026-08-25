/**
 * Audits every published prediction against the prohibited-certainty list.
 *
 * The existing prompt has carried "Never claim a prediction is guaranteed"
 * since the beginning (analysis.ts rule 3) with NO deterministic check behind
 * it — a real gap independent of Market-Confirmed, and this is what says
 * whether the prompt alone has actually been holding.
 *
 * Read-only. Run: npx tsx scripts/audit-certainty-language.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { scanDraftForCertainty, PROHIBITED_CERTAINTY_TERMS } = await import("../src/lib/certaintyLanguage");

  const rows = await prisma.prediction.findMany({
    select: { id: true, homeTeam: true, awayTeam: true, status: true, reasoning: true, matchPreview: true, analysisJson: true },
  });
  console.log(`scanning ${rows.length} predictions against ${PROHIBITED_CERTAINTY_TERMS.length} prohibited terms\n`);

  let clean = 0;
  const hits: Array<{ id: string; match: string; label: string; field: string; where: string }> = [];

  for (const r of rows) {
    const keyFactors = ((r.analysisJson as any)?.keyFactors ?? []) as string[];
    const v = scanDraftForCertainty({ reasoning: r.reasoning, matchPreview: r.matchPreview, keyFactors });
    if (v.length === 0) { clean++; continue; }
    for (const x of v) hits.push({ id: r.id, match: x.match, label: x.label, field: x.field, where: `${r.homeTeam} v ${r.awayTeam} [${r.status}]` });
  }

  console.log(`clean:      ${clean}/${rows.length}`);
  console.log(`violations: ${hits.length} across ${new Set(hits.map((h) => h.id)).size} prediction(s)\n`);

  const byLabel = new Map<string, number>();
  for (const h of hits) byLabel.set(h.label, (byLabel.get(h.label) ?? 0) + 1);
  for (const [l, c] of [...byLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${l}`);

  console.log("");
  for (const h of hits.slice(0, 25)) console.log(`  ${h.where}\n     ${h.field}: "${h.match}"  (${h.label})`);
  if (hits.length > 25) console.log(`  ... and ${hits.length - 25} more`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
