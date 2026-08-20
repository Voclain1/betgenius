import { parseAnalysis } from "@/lib/predictionAnalysis";

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
    <section className="card space-y-2">
      <h2 className="section-heading">Key factors</h2>
      <ul className="space-y-1.5">
        {analysis.keyFactors.map((f, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-300">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
