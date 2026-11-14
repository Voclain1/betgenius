import { OddsFigure } from "./OddsFigure";
import { formatOdds } from "@/lib/oddsFormat";
import { PremiumPanel } from "./PremiumPanel";
import {
  MARKET_MEANINGS,
  publicationObservation,
  selectionObservations,
} from "@/lib/predictionExplanation";
import type { TeamDigest } from "@/lib/ai/digest";
import type { DiscoverySource } from "@/lib/predictionDiscoveryData";
import { discoveryQuote } from "@/lib/selectionQuote";
import { categoryChipLabel } from "@/lib/categoryPredictions";

/** Server only. Caller supplies ONLY rows the viewer may read. */
export function PublishedMarketComparison({
  rows,
  cache,
  confirmations,
  contexts = new Map(),
  now = new Date(),
}: {
  rows: Array<
    Omit<DiscoverySource, "selection"> & {
      selection: unknown;
      publishedAt: Date | null;
    }
  >;
  cache: {
    fixtureApiId: number | null;
    fetchedAt: Date | null;
    oddsJson: unknown;
  } | null;
  confirmations: Map<string, unknown>;
  contexts?: Map<
    string,
    {
      home: TeamDigest | null;
      away: TeamDigest | null;
      recordedAt: Date | null;
    }
  >;
  now?: Date;
}) {
  const stamp = (d: Date) =>
    d.toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " WAT";
  return (
    <PremiumPanel
      kicker="Compare"
      title="Published market comparison"
      id="market-comparison"
    >
      <p className="mb-4 text-xs leading-relaxed text-gray-400">
        Only markets available to your account are shown. Published observations
        are frozen indicative prices; cached quotes are separate observations,
        not guaranteed offers or evidence of odds movement.
      </p>
      {rows.length ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {rows.slice(0, 12).map((r) => {
            const context = contexts.get(r.id);
            const observations =
              r.kickoff && context
                ? selectionObservations({
                    marketType: r.marketType,
                    selection: r.selection,
                    kickoff: r.kickoff,
                    home: context.home,
                    away: context.away,
                    now,
                  })
                : [];
            const current = discoveryQuote(r, cache ?? undefined, now);
            const entry = r.kickoff
              ? publicationObservation({
                  confirmation: confirmations.get(r.id),
                  kickoff: r.kickoff,
                  publishedAt: r.publishedAt,
                  marketType: r.marketType,
                  selection: r.selection,
                })
              : null;
            return (
              <article
                key={r.id}
                className="min-w-0 space-y-3 rounded-xl border border-brand-border p-4"
              >
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand">
                    {categoryChipLabel(r.category)}
                  </p>
                  <h3 className="mt-1 text-sm font-bold">{r.market}</h3>
                  <p className="mt-1 break-words text-base font-semibold">
                    {r.pick}
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-gray-400">
                  {MARKET_MEANINGS[r.marketType] ??
                    "Review the published market's settlement terms."}
                </p>
                <details className="text-xs leading-relaxed text-gray-400">
                  <summary className="min-h-11 cursor-pointer py-3 font-semibold text-gray-300">
                    Evidence for this market
                  </summary>
                  <p>
                    {context?.recordedAt
                      ? `Original context recorded ${stamp(context.recordedAt)}.`
                      : "Original context unavailable; any observations below use later cached context, not a reconstructed publication decision."}
                  </p>
                  {observations.length ? (
                    <ul className="mt-2 space-y-2">
                      {observations.map((o) => (
                        <li key={o.team}>
                          {o.team}: {o.support} of {o.sample} recent matches
                          matched this market; {o.against} went against it
                          {o.neutral
                            ? `; ${o.neutral} were stake-return results`
                            : ""}
                          . All competitions, scored matches before kickoff
                          only.
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2">
                      No verified recent-score comparison is available for this
                      selection.
                    </p>
                  )}
                  <p className="mt-2">
                    Historical samples are small and do not estimate this
                    fixture&apos;s probability. Read the published reasoning in
                    the picks below.
                  </p>
                </details>
                <dl className="space-y-3 border-t border-brand-border pt-3 text-xs">
                  <div>
                    <dt className="font-semibold text-gray-300">
                      Published indicative median
                    </dt>
                    <dd className="mt-1 text-gray-400">
                      {entry ? (
                        <>
                          <OddsFigure value={entry.median} /> · observed{" "}
                          {stamp(entry.at)}
                          <br />
                          Named sources:{" "}
                          {entry.sources
                            .map((q) => `${q.bookmaker} ${formatOdds(q.odd)}`)
                            .join("; ")}
                        </>
                      ) : (
                        "Verified publication quote unavailable. No price is reconstructed."
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-300">
                      {current?.kind === "archived"
                        ? "Archived pre-match cache"
                        : "Latest usable cached quote"}
                    </dt>
                    <dd className="mt-1 text-gray-400">
                      {current ? (
                        <>
                          <OddsFigure value={current.decimal} /> ·{" "}
                          {current.bookmaker}
                          <br />
                          {current.timeBasis === "provider"
                            ? "Provider quote"
                            : "Cache fetched"}{" "}
                          {stamp(current.at)}. Check availability with the
                          bookmaker.
                        </>
                      ) : (
                        "Unavailable, stale or not quoted for this market."
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          No published markets are readable with your current access. Match
          reference data does not unlock a prediction.
        </p>
      )}
      {rows.length > 12 && (
        <p className="mt-3 text-xs text-gray-500">
          Comparison shows the first 12 accessible published markets. All
          published picks remain below.
        </p>
      )}
    </PremiumPanel>
  );
}
