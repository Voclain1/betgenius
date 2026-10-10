import { confidenceBand, verdictLine, CONFIDENCE_BAND_STYLES } from "@/lib/matchFacts";
import { SectionHead } from "@/components/TeamProfile";
import { textTone } from "@/lib/tone";

/**
 * The headline call for this fixture, above the evidence.
 *
 * Answers the reader's actual question first — what is the pick and how
 * confident are we — instead of making them scan a grid of market cards to
 * find the strongest one. Fed the highest-confidence row the reader is entitled
 * to see, so a locked VIP market never leaks its pick through here.
 *
 * Every value is read from the stored prediction; the sentence is assembled by
 * verdictLine() from those same values. Nothing here is generated at render
 * time and nothing is AI-written.
 */
export function MatchVerdict({
  market,
  pick,
  confidence,
  overUnder,
}: {
  market: string;
  pick: string;
  confidence: number;
  overUnder: string | null;
}) {
  const band = confidenceBand(confidence);

  return (
    <section aria-labelledby="verdict">
      <SectionHead kicker="Our call" title="Our verdict" id="verdict" />
      <div className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.16),transparent)]" />
        <div className="relative grid items-center gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-7">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{market}</div>
            <div className="mt-1.5 break-words text-3xl font-black leading-tight tracking-tight text-brand sm:text-4xl">{pick}</div>
            <p className="mt-3 text-sm leading-relaxed text-gray-300">{verdictLine({ market, pick, confidence, overUnder })}</p>
          </div>
          <div className="flex items-end gap-3 sm:block sm:text-right">
            <div className="text-5xl font-black leading-none tabular-nums tracking-tight text-gray-100 sm:text-6xl">
              {confidence}
              <span className="text-2xl text-gray-500">%</span>
            </div>
            <div className="pb-1 sm:mt-2 sm:pb-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Confidence</div>
              <div className={`text-sm font-black ${textTone(CONFIDENCE_BAND_STYLES[band])}`}>{band}</div>
            </div>
          </div>
        </div>
        <div className="h-1.5 w-full bg-brand-border/60" aria-hidden>
          <div className="h-full bg-brand" style={{ width: `${confidence}%` }} />
        </div>
      </div>
    </section>
  );
}
