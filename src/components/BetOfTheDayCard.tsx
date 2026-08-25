import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { matchSlug } from "@/lib/slug";
import { quoteAge } from "@/lib/odds";
import type { BetOfTheDayView } from "@/lib/betOfTheDay";

/**
 * The Bet of the Day pick, with its bookmaker price.
 *
 * Shared between the homepage slot (`variant="hero"`, above Featured) and the
 * dedicated /predictions/bet-of-the-day page (`variant="page"`, which adds the
 * reasoning), so the two can never disagree about the price they quote.
 *
 * The price block degrades in one direction only. Odds come from a cron-filled
 * cache with the usual `fetchedAt` contract, so "no price yet" is a normal
 * state (the refresh hasn't reached this fixture, or no book has opened it) —
 * the card renders the pick without a price rather than a placeholder number.
 * Nothing here ever invents or estimates a price.
 */
export function BetOfTheDayCard({ data, variant = "page" }: { data: BetOfTheDayView; variant?: "hero" | "page" }) {
  const { row, gate, oddsFetchedAt } = data;
  const slug = matchSlug({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff });
  const href = slug ? `/predictions/match/${slug}` : null;
  const age = quoteAge(oddsFetchedAt);
  const settled = row.outcome !== "PENDING";

  const body = (
    <div className="card space-y-4 border-brand/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="chip bg-brand/20 text-brand">★ Bet of the Day</span>
          <LeagueBadge leagueApiId={row.leagueApiId} leagueName={row.leagueName} showName={false} />
        </div>
        {settled && <span className={`chip ${OUTCOME_STYLES[row.outcome] ?? "bg-brand-border"}`}>{row.outcome}</span>}
      </div>

      <div>
        <div className="text-lg font-semibold">
          {row.homeTeam} vs {row.awayTeam}
        </div>
        {row.kickoff && (
          <div className="text-xs text-gray-400">
            {new Date(row.kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase text-gray-400">{row.market}</div>
          <div className="text-xl font-bold text-brand">{row.pick}</div>
        </div>

        {gate?.price != null ? (
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{gate.price.toFixed(2)}</div>
            <div className="text-xs text-gray-400">
              best of {gate.bookmakers} bookmaker{gate.bookmakers === 1 ? "" : "s"}
              {/* The quote's age, always shown when a price is. A price with no
                  staleness signal is the one number on this page a reader could
                  act on directly, and act on wrongly. */}
              {age ? ` · ${age}` : ""}
            </div>
          </div>
        ) : (
          <div className="text-right text-xs text-gray-500">Price not available yet</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-brand-border pt-3 text-xs text-gray-400">
        <span>{row.confidence}% confidence</span>
        {gate?.impliedProbability != null && (
          <span className="tabular-nums">
            market implies {gate.impliedProbability}%
            {gate.edgePP != null && gate.edgePP > 0 ? ` · +${gate.edgePP}pp edge` : ""}
          </span>
        )}
      </div>

      {variant === "page" && row.reasoning && <p className="text-sm leading-relaxed text-gray-300">{row.reasoning}</p>}
    </div>
  );

  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}
