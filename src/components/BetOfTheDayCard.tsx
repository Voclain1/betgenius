import Link from "next/link";
import Image from "next/image";
import { LeagueBadge } from "@/components/LeagueBadge";
import { matchSlug } from "@/lib/slug";
import { quoteAge } from "@/lib/odds";
import type { BetOfTheDayView } from "@/lib/betOfTheDay";
import { betOfTheDayState, type BetOfTheDayState } from "@/lib/betOfTheDayStatus";
import { Prose } from "@/components/Prose";

/**
 * The Bet of the Day pick, with its bookmaker price.
 *
 * Shared between the homepage slot (`variant="hero"`) and the dedicated
 * /predictions/bet-of-the-day page (`variant="page"`, which adds the
 * reasoning), so the two can never disagree about the price they quote.
 *
 * LAYOUT, phone first. A header line (competition and kickoff, with the match
 * state on the right), the two teams stacked one per row with their crests (and
 * the score once settled), then ONE pick panel: market and pick on the left,
 * and on the right whatever matters now — the price before kickoff, "In play"
 * after it, the result once settled. Confidence and the market's view sit in
 * a quiet footer. There is no "★ Bet of the Day" chip: the section heading and
 * the page title already say what this is.
 *
 * The price degrades in one direction only. Odds come from a cron-filled cache
 * with the usual `fetchedAt` contract, so "no price yet" is a normal state; the
 * card says so rather than inventing a number. Once the match has started the
 * pre-match price is withheld: it is no longer a price anyone can take.
 */
const KICKOFF_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function kickoffLabel(kickoff: Date | string | null): string | null {
  if (!kickoff) return null;
  const d = new Date(kickoff);
  if (Number.isNaN(d.getTime())) return null;
  // "Tue 7 Oct, 19:00" -> "Tue 7 Oct · 19:00" (West Africa Time, the site's day)
  return KICKOFF_FORMAT.format(d).replace(",", " ·");
}

const RESULT_STYLE: Record<string, { label: string; className: string }> = {
  WON: { label: "Won", className: "text-emerald-400" },
  LOST: { label: "Lost", className: "text-red-400" },
  VOID: { label: "Void", className: "text-gray-300" },
};

function TeamRow({ name, crest, score }: { name: string | null; crest?: string | null; score?: number | null }) {
  const initials = (name ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3">
      {crest ? (
        <Image src={crest} alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-border text-[10px] font-semibold text-gray-300">
          {initials}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-lg font-black tracking-tight text-gray-100">{name}</span>
      {score != null && <span className="text-2xl font-black tabular-nums text-gray-100">{score}</span>}
    </div>
  );
}

export function BetOfTheDayCard({
  data,
  variant = "page",
  inactive,
  state: stateProp,
  crests,
}: {
  data: BetOfTheDayView;
  variant?: "hero" | "page";
  /** Kicked off or settled. Derived from the row when omitted; kept for callers that already know. */
  inactive?: boolean;
  /** The pick's lifecycle state; derived from the row when omitted. */
  state?: BetOfTheDayState;
  /** Team crests, when the caller has them. Initials stand in otherwise. */
  crests?: { home?: string | null; away?: string | null };
}) {
  const { row, gate, oddsFetchedAt } = data;
  const state = stateProp ?? betOfTheDayState(row);
  const live = inactive === undefined ? state === "LIVE" : !inactive;
  const settled = row.outcome !== "PENDING";
  const slug = matchSlug({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff });
  const href = slug ? `/predictions/match/${slug}` : null;
  const age = quoteAge(oddsFetchedAt);
  const when = kickoffLabel(row.kickoff);
  const result = settled ? RESULT_STYLE[row.outcome] : null;
  const showScore = settled && row.finalHomeScore != null && row.finalAwayScore != null;
  const confidence = Math.max(0, Math.min(100, row.confidence));

  // Match state as plain small caps, never a tinted pill: when it kicks off,
  // that it is in play, or that it has finished.
  const caps = "shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em]";
  const statusLabel = settled ? (
    <span className={`${caps} text-gray-300`}>Full time</span>
  ) : !live ? (
    <span className={`${caps} inline-flex items-center gap-1.5 text-red-400`}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" aria-hidden />
      In play
    </span>
  ) : when ? (
    <span className={`${caps} tabular-nums text-gray-300`}>{when}</span>
  ) : null;

  const body = (
    <div className="space-y-5 rounded-3xl border border-brand-border bg-brand-card p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <LeagueBadge leagueApiId={row.leagueApiId} leagueName={row.leagueName} showName={false} size={16} />
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">{row.leagueName}</span>
        </div>
        {statusLabel}
      </div>

      <div className="space-y-2.5">
        <TeamRow name={row.homeTeam} crest={crests?.home} score={showScore ? row.finalHomeScore : null} />
        <TeamRow name={row.awayTeam} crest={crests?.away} score={showScore ? row.finalAwayScore : null} />
      </div>

      {/* The pick, set like the prediction cards: market small, pick large,
          and whatever matters now as the big figure on the right. */}
      <div className="rounded-2xl bg-brand-bg/70 p-4 ring-1 ring-brand-border">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{row.market}</div>
            <div className="mt-1 break-words text-xl font-black leading-tight text-brand">{row.pick}</div>
          </div>
          <div className="shrink-0 text-right">
            {result ? (
              <>
                <div className={`text-2xl font-black leading-none ${result.className}`}>{result.label}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Result</div>
              </>
            ) : !live ? (
              <>
                <div className="text-base font-black leading-none text-gray-300">In play</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Status</div>
              </>
            ) : gate?.price != null ? (
              <>
                <div className="text-3xl font-black leading-none tabular-nums text-gray-100">{gate.price.toFixed(2)}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Odds</div>
              </>
            ) : (
              <div className="max-w-[7rem] text-xs text-gray-500">Price not available yet</div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-brand-border" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${confidence}%` }} />
          </div>
          <span className="text-xs font-bold tabular-nums text-gray-200">
            {row.confidence}% <span className="font-semibold text-gray-500">confidence</span>
          </span>
        </div>
        {live && gate?.price != null && (
          <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span>
              Best of {gate.bookmakers} bookmaker{gate.bookmakers === 1 ? "" : "s"}
              {/* The quote's age, always shown when a price is: a price with no
                  staleness signal is the one number here a reader could act on wrongly. */}
              {age ? ` · ${age}` : ""}
            </span>
            {gate.impliedProbability != null && (
              <span className="tabular-nums">
                Market {gate.impliedProbability}%
                {gate.edgePP != null && gate.edgePP > 0 ? ` · +${gate.edgePP}pp edge` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {variant === "page" && <Prose text={row.reasoning} />}
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
