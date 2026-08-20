import { confidenceBand, verdictLine, CONFIDENCE_BAND_STYLES } from "@/lib/matchFacts";

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
  odds,
  overUnder,
}: {
  market: string;
  pick: string;
  confidence: number;
  odds: number | null;
  overUnder: string | null;
}) {
  const band = confidenceBand(confidence);

  return (
    <section className="card space-y-3 border-brand/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-heading">Our verdict</h2>
        <span className={`chip text-[10px] ${CONFIDENCE_BAND_STYLES[band]}`}>{band}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Market</div>
          <div className="text-sm font-medium">{market}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Pick</div>
          <div className="text-sm font-semibold text-brand">{pick}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Odds</div>
          <div className="text-sm font-medium">{odds ?? "—"}</div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>Confidence</span>
          <span>{confidence}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-brand-border">
          <div className="h-full rounded-full bg-brand" style={{ width: `${confidence}%` }} />
        </div>
      </div>

      <p className="text-sm text-gray-300">{verdictLine({ market, pick, confidence, overUnder })}</p>
    </section>
  );
}
