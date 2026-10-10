import { parseAnalysis } from "@/lib/predictionAnalysis";
import { PremiumPanel } from "@/components/PremiumPanel";

/**
 * The model's key factors for this fixture.
 *
 * One of only three places on the page carrying AI-written text (the others
 * being the match preview and each market's reasoning) — everything else is
 * rendered from the enrichment caches. That separation is deliberate: these
 * bullets INTERPRET the evidence shown elsewhere on the page, so a reader can
 * check any claim made here against the team news, statistics and head-to-head
 * panels directly beneath it.
 *
 * Renders nothing when the prediction has no stored analysis — rows generated
 * before the column existed, or whose backfill found no factors. An absent
 * block is correct; an empty "Key factors" heading would not be.
 */
export function KeyFactors({ analysisJson }: { analysisJson: unknown }) {
  const analysis = parseAnalysis(analysisJson);
  if (!analysis) return null;

  return (
    <PremiumPanel kicker="Analysis" title="Key factors" id="key-factors">
      <ol className="divide-y divide-brand-border">
        {analysis.keyFactors.map((f, i) => (
          <li key={i} className="flex gap-4 py-3 first:pt-0 last:pb-0">
            <span aria-hidden className="w-6 shrink-0 text-lg font-black leading-snug tabular-nums text-brand">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm leading-relaxed text-gray-200">{f}</span>
          </li>
        ))}
      </ol>
    </PremiumPanel>
  );
}
