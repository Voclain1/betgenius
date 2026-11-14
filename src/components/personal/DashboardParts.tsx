import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { SavePredictionButton } from "@/components/SavePredictionButton";
import { categoryChipLabel } from "@/lib/categoryPredictions";
import { kickoffInZone, shortDateInZone, timeInZone, type MatchReason, type UpcomingFixture } from "@/lib/personalization";
import { rowStatus } from "@/lib/predictionStatus";
import { OddsFigure } from "@/components/OddsFigure";
import type { DashboardPick, SavedItem } from "@/lib/personalizationData";

/** Section heading with an optional trailing link. Same weight across every dashboard section. */
export function SectionHeader({ title, action, count }: { title: string; action?: { href: string; label: string }; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
        {title}
        {count != null && <span className="ml-2 tabular-nums text-gray-500">{count}</span>}
      </h2>
      {action && (
        <Link href={action.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-gray-400 hover:text-brand">
          {action.label} <ArrowRight size={12} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** A helpful empty state: what's missing, why, and the one next step. Never placeholder data. */
export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: { href: string; label: string }; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-brand-border px-4 py-5">
      {icon && <div className="text-gray-500">{icon}</div>}
      <p className="text-sm font-semibold text-gray-100">{title}</p>
      <p className="max-w-prose text-sm text-gray-400">{body}</p>
      {action && (
        <Link href={action.href} className="mt-1 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          {action.label} <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  );
}

const REASON_LABEL: Record<MatchReason, string> = { team: "Your team", league: "Your competition", market: "Your market" };

function Teams({ home, away, homeId, awayId, href }: { home: string | null; away: string | null; homeId: number | null; awayId: number | null; href: string | null }) {
  const body = (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <TeamCrest teamApiId={homeId} name={home} size={16} />
        <span className="truncate">{home ?? "Home"}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <TeamCrest teamApiId={awayId} name={away} size={16} />
        <span className="truncate">{away ?? "Away"}</span>
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="min-w-0 text-sm font-semibold text-gray-100 hover:text-brand">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 text-sm font-semibold text-gray-100">{body}</div>
  );
}

/**
 * One prediction, compact: competition and time, the two sides, the market
 * and pick, the site's confidence figure (labelled as such, not as a
 * probability), why it is here, and the save control.
 */
/**
 * What this pick's match is doing, in one short run: nothing for an ordinary
 * upcoming match; "FT 2–1 · Won" once settled; "Kicked off", "Awaiting result"
 * or "Postponed" otherwise. The result is shown only because the row passed the
 * viewer's access check when it was loaded. Wording and rules:
 * src/lib/predictionStatus.ts.
 */
function PickStatus({ row }: { row: DashboardPick }) {
  const finalScore = row.finalHomeScore != null && row.finalAwayScore != null ? { home: row.finalHomeScore, away: row.finalAwayScore } : null;
  const status = rowStatus({ statusCode: row.statusCode, kickoff: row.kickoff, outcome: row.outcome, finalScore });
  if (!status.label) return null;
  const outcome = row.outcome === "WON" || row.outcome === "LOST" || row.outcome === "VOID" ? row.outcome : null;
  return (
    <span className={`shrink-0 text-[11px] font-semibold ${status.tone === "warn" ? "text-amber-400" : "text-gray-500"}`}>
      {status.kind === "final" ? (
        <>
          <span className="tabular-nums">FT{finalScore ? ` ${finalScore.home}–${finalScore.away}` : ""}</span>
          {outcome && <span className={`ml-1.5 font-black uppercase tracking-[0.1em] ${OUTCOME_TEXT[outcome]}`}>{outcome}</span>}
        </>
      ) : (
        status.label
      )}
    </span>
  );
}

export function PickRow({ row, reasons, timezone }: { row: DashboardPick; reasons: MatchReason[]; timezone: string }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-gray-400">
          <span className="min-w-0 truncate"><LeagueBadge leagueApiId={row.leagueApiId} leagueName={row.leagueName} size={14} /></span>
          <span className="shrink-0 tabular-nums">{row.kickoff ? timeInZone(row.kickoff, timezone) : ""}</span>
          <PickStatus row={row} />
        </div>
        <Teams home={row.homeTeam} away={row.awayTeam} homeId={row.homeTeamApiId} awayId={row.awayTeamApiId} href={row.href} />
      </div>
      <div className="col-start-1 min-w-0 sm:col-start-auto">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">{row.market}</div>
        <div className="truncate text-sm font-black text-brand">{row.pick}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
          <span>Confidence {row.confidence}%</span>
          <OddsFigure value={row.odds} lead="Odds " className="tabular-nums" />
          {/* "Today" says nothing on a list of today's picks; the others (Banker, Genius, Featured, Bet of the Day, VIP, Premium, Goals, Combo Bet) do. */}
          {row.presented !== "TODAY" && <span>{categoryChipLabel(row.presented)}</span>}
        </div>
        {reasons.length > 0 && (
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand">{reasons.map((r) => REASON_LABEL[r]).join(" · ")}</div>
        )}
      </div>
      <div className="col-start-2 row-span-2 row-start-1 flex items-start justify-end sm:col-start-auto sm:row-span-1 sm:row-start-auto sm:items-center">
        <SavePredictionButton predictionId={row.id} source="dashboard" />
      </div>
    </li>
  );
}

export function PickList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-brand-border overflow-hidden rounded-xl border border-brand-border bg-brand-card">{children}</ul>;
}

export function UpcomingList({ fixtures, timezone }: { fixtures: UpcomingFixture[]; timezone: string }) {
  return (
    <ul className="divide-y divide-brand-border overflow-hidden rounded-xl border border-brand-border bg-brand-card">
      {fixtures.map((f) => {
        const inner = (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
              <span className="min-w-0 truncate">{f.leagueName ?? "Fixture"}</span>
              <span className="shrink-0 tabular-nums">
                {shortDateInZone(f.kickoff, timezone)} · {timeInZone(f.kickoff, timezone)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-1 text-sm font-semibold text-gray-100">
                <div className="flex min-w-0 items-center gap-2"><TeamCrest teamApiId={f.homeTeamApiId} name={f.homeTeam} size={14} /><span className="truncate">{f.homeTeam}</span></div>
                <div className="flex min-w-0 items-center gap-2"><TeamCrest teamApiId={f.awayTeamApiId} name={f.awayTeam} size={14} /><span className="truncate">{f.awayTeam}</span></div>
              </div>
              <div className="shrink-0 text-right text-[11px]">
                <div className={f.status === "Starting soon" ? "font-semibold text-amber-300" : "text-gray-500"}>{f.status}</div>
                <div className={f.hasPrediction ? "font-semibold text-brand" : "text-gray-500"}>{f.hasPrediction ? "Prediction ready" : "No prediction yet"}</div>
              </div>
            </div>
          </>
        );
        return (
          <li key={f.key}>
            {f.href ? (
              <Link href={f.href} className="block px-4 py-3 transition hover:bg-brand-bg/60">{inner}</Link>
            ) : (
              <div className="px-4 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const OUTCOME_TEXT: Record<string, string> = { WON: "text-emerald-300", LOST: "text-red-300", VOID: "text-gray-300" };

/** State line for a saved pick: result for settled, kickoff for upcoming, plain words otherwise. */
export function SavedStatus({ item, timezone }: { item: SavedItem; timezone: string }) {
  const v = item.view;
  if (v.outcome) {
    return (
      <span className="text-[11px] font-black uppercase tracking-[0.12em]">
        <span className={OUTCOME_TEXT[v.outcome]}>{v.outcome}</span>
        {v.finalScore && <span className="ml-2 tabular-nums text-gray-400">FT {v.finalScore}</span>}
      </span>
    );
  }
  if (v.state === "settled") {
    // Locked: the result is part of what is paid for. Unlocked with no outcome:
    // the pick was rewritten into a market the final score alone cannot settle.
    return (
      <span className="text-[11px] text-gray-500">
        {v.locked ? "Settled" : "Settled · saved pick not graded"}
        {v.finalScore ? ` · FT ${v.finalScore}` : ""}
      </span>
    );
  }
  // Postponed, cancelled, abandoned or suspended: no result is coming, and the
  // pick is neither upcoming nor awaiting one.
  if (v.state === "unplayed") {
    const status = rowStatus({ statusCode: item.statusCode, kickoff: item.kickoff });
    return <span className="text-[11px] font-semibold text-amber-400">{status.label ?? "Not played"}</span>;
  }
  if (v.state === "upcoming" && item.kickoff) return <span className="text-[11px] tabular-nums text-gray-400">{kickoffInZone(item.kickoff, timezone)}</span>;
  if (v.state === "unavailable") return <span className="text-[11px] text-gray-500">No longer published · result unavailable</span>;
  return <span className="text-[11px] text-gray-400">Awaiting result</span>;
}

export function SavedRow({ item, timezone, actions }: { item: SavedItem; timezone: string; actions?: ReactNode }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-gray-400">
          <span className="min-w-0 truncate">{item.leagueName ?? categoryChipLabel(item.category)}</span>
          <SavedStatus item={item} timezone={timezone} />
        </div>
        <Teams home={item.homeTeam} away={item.awayTeam} homeId={item.homeTeamApiId} awayId={item.awayTeamApiId} href={item.view.locked ? null : item.href} />
        {item.view.locked ? (
          <div className="flex items-center gap-1.5 text-sm text-gray-400">
            <Lock size={13} aria-hidden /> {categoryChipLabel(item.category)} pick — <Link href="/pricing" className="font-semibold text-brand hover:underline">upgrade to view</Link>
          </div>
        ) : (
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">{item.market}</span>{" "}
            <span className="text-sm font-black text-brand">{item.pick}</span>
            <OddsFigure value={item.odds} lead="Odds " tail="when saved" className="ml-2 text-[11px] tabular-nums text-gray-500" />
            {item.view.changedTo && (
              <p className="mt-1 text-[11px] text-amber-300">Updated since you saved it — now {item.view.changedTo}. Your saved pick is shown and settled as saved.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-start">{actions}</div>
    </li>
  );
}
