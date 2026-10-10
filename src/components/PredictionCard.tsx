import Link from "next/link";
import { Lock } from "lucide-react";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { leagueSlug } from "@/lib/slug";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import { MarketConfirmedBadge, type MarketConfirmation } from "@/components/MarketConfirmedBadge";
import { Prose } from "@/components/Prose";
import { ReasoningExcerpt } from "@/components/ReasoningExcerpt";
import { categoryChipLabel } from "@/lib/categoryPredictions";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { textTone } from "@/lib/tone";

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
  /** API-Football team ids; when present, each team name shows its crest. */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
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
export function PredictionCard({
  p,
  hideMatchHeader = false,
  reasoningExcerpt = false,
}: {
  p: PredictionRow;
  hideMatchHeader?: boolean;
  /** Collapse the reasoning to its opening sentence or two, with a "Show full reasoning" control (team pages). */
  reasoningExcerpt?: boolean;
}) {
  const home = p.homeTeam ?? p.fixture?.homeTeam.name;
  const away = p.awayTeam ?? p.fixture?.awayTeam.name;
  const kickoff = p.kickoff ?? p.fixture?.kickoff;
  const leagueName = p.leagueName ?? p.fixture?.league.name;

  const isDouble = p.marketType === "SAME_GAME_DOUBLE";
  const hasConfidence = p.confidence !== null && p.confidence !== undefined;

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-brand-border bg-brand-card p-5">
      {/* Category and result as coloured small caps, never as tinted pills. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-[11px] font-black uppercase tracking-[0.14em]">
          <span className={textTone(catStyles[p.category] ?? "text-gray-400")}>{categoryChipLabel(p.category)}</span>
          {p.outcome && p.outcome !== "PENDING" && (
            <span className={textTone(OUTCOME_STYLES[p.outcome] ?? "text-gray-400")}>{p.outcome}</span>
          )}
        </div>
        {kickoff && !hideMatchHeader && (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-400">
            {new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {!hideMatchHeader && (home || leagueName) && (
        <div className="space-y-1.5">
          {leagueName && (
            <Link href={competitionPredictionsHref(p.leagueApiId, leagueSlug(leagueName, p.leagueApiId))} className="hover:underline">
              <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} />
            </Link>
          )}
          {!leagueName && <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} />}
          {home && (
            <div className="text-lg font-black leading-snug tracking-tight text-gray-100">
              <MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} homeTeamApiId={p.homeTeamApiId} awayTeamApiId={p.awayTeamApiId} />
            </div>
          )}
        </div>
      )}
      {/* The pick, set like the match page's verdict: market small, pick large,
          confidence as a big numeral. */}
      <div className="rounded-2xl bg-brand-bg/70 p-4 ring-1 ring-brand-border">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{p.locked ? "Market" : p.market}</div>
            <div className="mt-1 flex items-center gap-1.5 break-words text-xl font-black leading-tight text-brand">
              {p.locked ? <><Lock size={16} /> Locked</> : p.pick}
            </div>
          </div>
          {hasConfidence && (
            <div className="shrink-0 text-right">
              <div className="text-2xl font-black leading-none tabular-nums text-gray-100">
                {p.confidence}
                <span className="text-sm text-gray-500">%</span>
              </div>
              {/*
                A same-game double's number is a CEILING, not an estimate.
                P(A and B) <= min(P(A), P(B)) holds under any correlation, so
                "no better than" is a true statement where a bare "Confidence"
                would read as a joint probability we have not computed and could
                not honestly compute — the legs are correlated. See
                comboConfidenceCeiling in src/lib/sameGameDouble.ts.
              */}
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                {isDouble ? "Both must land · no better than" : "Confidence"}
              </div>
            </div>
          )}
        </div>
        {hasConfidence && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-brand-border" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${p.confidence}%` }} />
          </div>
        )}
      </div>
      {/* Below the pick, above the reasoning: the badge qualifies the number
          before it is relied on. Locked rows never reach here — a reader who
          cannot see the pick is not shown its evidence. */}
      {p.marketConfirmation && !p.locked && <MarketConfirmedBadge confirmation={p.marketConfirmation} />}
      {/*
        Prose, not a raw <p>. Prose splits blank-line paragraphs and strips
        any markdown markers in the stored text. Without it a combo's leg
        heading printed literally as **Under 2.5 Goals** on the live card:
        every published combo carried them. Routing through Prose fixes the
        already-stored rows too, so no backfill is needed. Nothing in this
        app renders markdown by design - see src/components/Prose.tsx.
      */}
      {reasoningExcerpt ? <ReasoningExcerpt text={p.reasoning} /> : <Prose text={p.reasoning} />}
      {p.locked && (
        <Link href="/pricing" className="flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-black text-on-brand transition hover:bg-brand-dark">
          Upgrade to unlock
        </Link>
      )}
    </article>
  );
}
