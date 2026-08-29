/**
 * Backfill the Combo Bet rename and remove the boilerplate opener from rows
 * that were already published.
 *
 * Three things were baked into stored text by describeDoubleReasoning before
 * it was fixed, and no amount of prompt work reaches rows that already exist:
 *
 *   1. `market` reads "Same-Game Double". It is a stored DISPLAY string, so
 *      cards render whatever the row carries — the rename does not reach it.
 *   2. Every reasoning opens with "Both parts must land for this to win.",
 *      which the card now states structurally above the confidence bar.
 *   3. Leg headings are wrapped in ** . Prose strips these at render, so this
 *      is belt-and-braces: it cleans OUR formatting out of the stored copy
 *      rather than relying on the renderer forever.
 *
 * Only rows with marketType SAME_GAME_DOUBLE are touched, and only text this
 * codebase wrote itself. The legs' own model-written reasoning is left alone.
 *
 * Dry run by default. Run: npx tsx scripts/backfill-combo-bet-copy.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

const OPENER = /^\s*(\*\*)?Both parts must land for this to win\.(\*\*)?\s*\n+/;

export function rewriteComboReasoning(text: string): string {
  return text
    .replace(OPENER, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    // A lone newline after the leg heading is a soft wrap to Prose, which
    // joined the heading onto its own body text. Promote it to a paragraph
    // break so each leg reads as a heading followed by its analysis.
    // Rebuild the paragraph structure. A leg heading is unambiguous — a pick
    // followed by " — NN% confidence" — so a break can be restored around it
    // even on rows whose newlines were already flattened. The closing note
    // gets its own paragraph too.
    .replace(/(?:^|\n+|(?<=\.)\s+)([A-Z][^\n]{0,60}? — \d{1,3}% confidence)\s*/g, "\n\n$1\n\n")
    .replace(/\s*(These two calls are about different parts)/, "\n\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\ba double can never be more likely\b/g, "a combo can never be more likely")
    .replace(/\bConfidence shown is the lower of the two\b/g, "The figure shown is the lower of the two")
    .trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../src/lib/prisma");

  const rows = await prisma.prediction.findMany({
    where: { marketType: "SAME_GAME_DOUBLE" },
    select: { id: true, market: true, reasoning: true },
  });

  let marketChanges = 0;
  let textChanges = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const nextMarket = "Combo Bet";
    const nextText = rewriteComboReasoning(r.reasoning ?? "");
    const marketDiffers = r.market !== nextMarket;
    const textDiffers = (r.reasoning ?? "") !== nextText;
    if (!marketDiffers && !textDiffers) continue;
    if (marketDiffers) marketChanges++;
    if (textDiffers) textChanges++;
    if (samples.length < 2) {
      samples.push(`  BEFORE: ${JSON.stringify((r.reasoning ?? "").slice(0, 110))}\n  AFTER : ${JSON.stringify(nextText.slice(0, 110))}`);
    }
    if (apply) {
      await prisma.prediction.update({ where: { id: r.id }, data: { market: nextMarket, reasoning: nextText } });
    }
  }

  console.log(`SAME_GAME_DOUBLE rows: ${rows.length}`);
  console.log(`  market label to update : ${marketChanges}`);
  console.log(`  reasoning to rewrite   : ${textChanges}`);
  if (samples.length) console.log(`\n${samples.join("\n\n")}`);
  console.log(`\n${apply ? "APPLIED" : "DRY RUN — re-run with --apply to write"}`);

  await prisma.$disconnect();
}

// Only run when invoked directly. check-combo-bet-copy.ts imports
// rewriteComboReasoning from here, and an unguarded main() meant merely
// importing the module opened a database connection and printed a dry run.
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
