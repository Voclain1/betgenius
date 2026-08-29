import Link from "next/link";
import { Lock } from "lucide-react";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { leagueSlug } from "@/lib/slug";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import { MarketConfirmedBadge, type MarketConfirmation } from "@/components/MarketConfirmedBadge";
import { Prose } from "@/components/Prose";
import { categoryChipLabel } from "@/lib/categoryPredictions";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";

export type PredictionRow = {
  id: string;
  category: string;
  market: string;
  pick: string;
  /** Present so a same-game double can label its confidence honestly — see below. */
  marketType?: string | null;
  /**
   * Settled result, rendered as a chip beside the category. Populated only on
   * the Yesterday view — today and tomorrow leave it null so those days render
   * exactly as they did before this existed. Same chip pattern as Track Record.
   */
  outcome?: string | null;
  /** Set only on Market-Confirmed picks; renders the badge below the pick. */
  marketConfirmation?: MarketConfirmation | null;
  confidence: number | null;
  reasoning: string;
  matchPreview?: string | null;
  locked?: boolean;
  leagueApiId?: number | null;
  leagueName?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  kickoff?: string | Date | null;
  fixture?: {
    kickoff: string | Date;
    league: { name: string };
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
};

export const catStyles: Record<string, string> = {
  FEATURED: "bg-brand/20 text-brand",
  GENIUS: "bg-blue-500/20 text-blue-300",
  TODAY: "bg-emerald-500/20 text-emerald-300",
  BANKER: "bg-orange-500/20 text-orange-300",
  VIP: "bg-yellow-500/20 text-yellow-300",
  PREMIUM: "bg-purple-500/20 text-purple-300",
};

/**
 * `hideMatchHeader` drops the league + "Home vs Away" block for callers where
 * every card on the page is the same fixture and the header would repeat —
 * the match page. Everywhere else it stays on.
 */
export function PredictionCard({ p, hideMatchHeader = false }: { p: PredictionRow; hideMatchHeader?: boolean }) {
  const home = p.homeTeam ?? p.fixture?.homeTeam.name;
  const away = p.awayTeam ?? p.fixture?.awayTeam.name;
  const kickoff = p.kickoff ?? p.fixture?.kickoff;
  const leagueName = p.leagueName ?? p.fixture?.league.name;

  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`chip ${catStyles[p.category] ?? "bg-gray-500/20"}`}>{categoryChipLabel(p.category)}</span>
          {p.outcome && p.outcome !== "PENDING" && (
            <span className={`chip ${OUTCOME_STYLES[p.outcome] ?? "bg-brand-border"}`}>{p.outcome}</span>
          )}
        </div>
        {kickoff && !hideMatchHeader && (
          <span className="text-xs text-gray-400">
            {new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {!hideMatchHeader && (home || leagueName) && (
        <div>
          {leagueName && (
            <Link href={competitionPredictionsHref(p.leagueApiId, leagueSlug(leagueName, p.leagueApiId))} className="hover:underline">
              <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} />
            </Link>
          )}
          {!leagueName && <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} />}
          {home && (
            <div className="text-lg font-semibold">
              <MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} />
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Market</div>
          <div className="text-sm font-medium">{p.market}</div>
        </div>
        <div className="rounded-md bg-brand-bg p-2">
          <div className="text-[10px] uppercase text-gray-500">Pick</div>
          <div className="text-sm font-semibold text-brand flex items-center justify-center gap-1">
            {p.locked ? <><Lock size={14} /> Locked</> : p.pick}
          </div>
        </div>
      </div>
      {/* Below the pick, above the confidence bar: the badge qualifies the number
          that follows it, so it has to be read first. Locked rows never reach
          here — a reader who cannot see the pick is not shown its evidence. */}
      {p.marketConfirmation && !p.locked && <MarketConfirmedBadge confirmation={p.marketConfirmation} />}
      {p.confidence !== null && p.confidence !== undefined && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            {/*
              A same-game double's number is a CEILING, not an estimate.
              P(A and B) <= min(P(A), P(B)) holds under any correlation, so
              "no better than" is a true statement where a bare "Confidence"
              would read as a joint probability we have not computed and could
              not honestly compute — the legs are correlated. See
              comboConfidenceCeiling in src/lib/sameGameDouble.ts.
            */}
            <span>{p.marketType === "SAME_GAME_DOUBLE" ? "Both must land" : "Confidence"}</span>
            <span>
              {p.marketType === "SAME_GAME_DOUBLE" ? "no better than " : ""}
              {p.confidence}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-brand-border">
            <div className="h-full rounded-full bg-brand" style={{ width: `${p.confidence}%` }} />
          </div>
        </div>
      )}
      {/*
        Prose, not a raw <p>. Prose splits blank-line paragraphs and strips
        any markdown markers in the stored text. Without it a combo's leg
        heading printed literally as **Under 2.5 Goals** on the live card:
        every published combo carried them. Routing through Prose fixes the
        already-stored rows too, so no backfill is needed. Nothing in this
        app renders markdown by design - see src/components/Prose.tsx.
      */}
      <Prose text={p.reasoning} />
      {p.locked && (
        <Link href="/pricing" className="btn btn-primary justify-center text-sm">
          Upgrade to unlock
        </Link>
      )}
    </article>
  );
}
