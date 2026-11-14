import { PremiumPanel } from "@/components/PremiumPanel";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { textTone } from "@/lib/tone";
import {
  EVENT_LABEL,
  MATCH_STATE_LABEL,
  minuteLabel,
  resultLabel,
  type FixtureResult,
  type MatchEvent,
  type MatchState,
  type ScorePair,
} from "@/lib/matchCentre";

/**
 * The record of a match that has been played — or a plain statement that it
 * was not. Rendered only for finished and irregular fixtures; a scheduled or
 * live match never shows a "result".
 *
 * Every line comes from FixtureDetailCache.detailJson.result (captured from
 * responses settlement and the fixture refresh already fetch — no call on a
 * page view) or from the settled Prediction rows. Events and statistics are
 * shown only when the provider supplied them; their absence is said, never
 * filled in. Pick outcomes are shown only for picks this reader can see:
 * a locked pick's result is part of what is paid for.
 */

type VisiblePick = { id: string; market: string; pick: string; outcome: string | null };

const KEY_EVENTS: ReadonlySet<MatchEvent["kind"]> = new Set(["goal", "own-goal", "penalty-goal", "missed-penalty", "red-card", "second-yellow"]);
const EVENT_SHORT: Record<MatchEvent["kind"], string> = {
  goal: "GOAL",
  "own-goal": "OG",
  "penalty-goal": "PEN",
  "missed-penalty": "MISS",
  "red-card": "RED",
  "second-yellow": "2Y",
  "yellow-card": "YC",
  substitution: "SUB",
  var: "VAR",
};

function EventRow({ e, homeTeamApiId }: { e: MatchEvent; homeTeamApiId: number | null }) {
  const home = e.teamApiId === homeTeamApiId;
  const who = e.kind === "substitution" ? `${e.related ?? "?"} on, ${e.player ?? "?"} off` : e.player ?? "Unknown player";
  const extra = e.kind === "goal" && e.related ? ` (assist ${e.related})` : "";
  const label = `${minuteLabel(e)} ${EVENT_LABEL[e.kind]}, ${home ? "home" : "away"}: ${who}${extra}`;
  const tag = (
    <span className={`inline-block w-10 shrink-0 text-center text-[10px] font-black tracking-[0.08em] ${e.kind === "red-card" || e.kind === "second-yellow" ? "text-red-300" : e.kind === "yellow-card" ? "text-yellow-300" : e.kind === "substitution" || e.kind === "var" ? "text-gray-500" : "text-brand"}`}>
      {EVENT_SHORT[e.kind]}
    </span>
  );
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <span className="sr-only">{label}</span>
      <span aria-hidden className={`min-w-0 truncate text-right ${home ? "text-gray-100" : ""}`}>
        {home && <>{who}{extra && <span className="text-xs text-gray-500">{extra}</span>} {tag}</>}
      </span>
      <span aria-hidden className="text-center text-xs font-bold tabular-nums text-gray-400">{minuteLabel(e)}</span>
      <span aria-hidden className={`min-w-0 truncate ${!home ? "text-gray-100" : ""}`}>
        {!home && <>{tag} {who}{extra && <span className="text-xs text-gray-500">{extra}</span>}</>}
      </span>
    </li>
  );
}

function statNumber(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

export function MatchResultPanel({
  state,
  result,
  finalScore,
  homeTeam,
  awayTeam,
  homeTeamApiId,
  picks,
  lockedCount,
  timeZone,
}: {
  state: MatchState;
  result: FixtureResult | null;
  /** From settled prediction rows — the score settlement used. */
  finalScore: ScorePair | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  picks: VisiblePick[];
  lockedCount: number;
  timeZone: string;
}) {
  if (state === "scheduled" || state === "live") return null;
  const irregular = state !== "finished" && state !== "unknown";
  const ft = result?.fulltime ?? finalScore;
  const ht = result?.halftime ?? null;
  const events = result?.events ?? null;
  const keyEvents = events?.filter((e) => KEY_EVENTS.has(e.kind)) ?? [];
  const otherEvents = events?.filter((e) => !KEY_EVENTS.has(e.kind)) ?? [];
  const captured = result ? new Date(result.capturedAt).toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }) : null;

  if (state === "unknown" && !ft && !picks.some((p) => p.outcome && p.outcome !== "PENDING")) return null;

  return (
    <PremiumPanel kicker="Result" title={irregular ? MATCH_STATE_LABEL[state] : "Match result"} id="result">
      {irregular ? (
        <p className="text-sm text-gray-300">
          {state === "postponed" && "This match was postponed. No result has been recorded; any rescheduled date will appear once the provider confirms it."}
          {state === "cancelled" && "This match was cancelled and has no result."}
          {state === "abandoned" && "This match was abandoned before it finished. Any score at the time is not a final result."}
          {state === "awarded" && "The result of this match was awarded rather than decided on the pitch."}
          {state === "suspended" && "Play in this match was suspended. The result is not final."}
        </p>
      ) : ft ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{result ? resultLabel(result) : "Full time"}</div>
            <div className="mt-1 text-3xl font-black tabular-nums text-gray-100">
              {homeTeam} {ft.home}<span className="mx-1.5 text-gray-500">-</span>{ft.away} {awayTeam}
            </div>
          </div>
          {ht && <div className="text-sm tabular-nums text-gray-400">Half-time {ht.home}-{ht.away}</div>}
        </div>
      ) : (
        <p className="text-sm text-gray-400">The final score has not been confirmed yet.</p>
      )}

      {!irregular && ft && (
        <div className="mt-4">
          {events === null ? (
            <p className="text-xs text-gray-500">Goal times, cards and substitutions are not available for this match.</p>
          ) : keyEvents.length === 0 && otherEvents.length === 0 ? (
            <p className="text-xs text-gray-500">The provider recorded no events for this match.</p>
          ) : (
            <>
              <ul className="divide-y divide-brand-border" aria-label="Goals and red cards">
                {keyEvents.map((e, i) => <EventRow key={`k${i}`} e={e} homeTeamApiId={homeTeamApiId} />)}
              </ul>
              {otherEvents.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-gray-400 hover:text-gray-100">Bookings and substitutions ({otherEvents.length})</summary>
                  <ul className="mt-1 divide-y divide-brand-border">{otherEvents.map((e, i) => <EventRow key={`o${i}`} e={e} homeTeamApiId={homeTeamApiId} />)}</ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {!irregular && result?.statistics?.length ? (
        <table className="mt-5 w-full table-fixed text-sm">
          <caption className="mb-2 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Match statistics</caption>
          <tbody>
            {result.statistics.map((s) => {
              const h = statNumber(s.home);
              const a = statNumber(s.away);
              const total = h != null && a != null && h + a > 0 ? h + a : null;
              const label = s.type === "expected_goals" ? "Expected goals (xG)" : s.type;
              return (
                <tr key={s.type}>
                  <td className="w-1/4 py-1.5 text-right font-bold tabular-nums text-gray-100">{s.home ?? "—"}</td>
                  <th scope="row" className="px-2 py-1.5 text-center text-xs font-semibold text-gray-400">
                    {label}
                    {total != null && (
                      // Split bar: home share then away share, so both sides are drawn rather than one bar on an empty track.
                      <div aria-hidden className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                        <div className="h-full rounded-l-full bg-brand" style={{ width: `${(h! / total) * 100}%` }} />
                        <div className="h-full flex-1 rounded-r-full bg-gray-500" />
                      </div>
                    )}
                  </th>
                  <td className="w-1/4 py-1.5 text-left font-bold tabular-nums text-gray-100">{s.away ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {(picks.length > 0 || lockedCount > 0) && (
        <div className="mt-5 border-t border-brand-border pt-4">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Our published picks</h3>
          <ul className="mt-2 space-y-1.5">
            {picks.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-xs text-gray-500">{p.market}</span> <span className="font-bold text-gray-100">{p.pick}</span>
                </span>
                <span className={`shrink-0 text-[11px] font-black uppercase tracking-[0.1em] ${p.outcome && p.outcome !== "PENDING" ? textTone(OUTCOME_STYLES[p.outcome] ?? "text-gray-400") : "text-gray-500"}`}>
                  {p.outcome && p.outcome !== "PENDING" ? p.outcome : "Not settled"}
                </span>
              </li>
            ))}
          </ul>
          {lockedCount > 0 && <p className="mt-2 text-xs text-gray-500">{lockedCount} subscriber {lockedCount === 1 ? "pick is" : "picks are"} not shown.</p>}
        </div>
      )}

      {captured && <p className="mt-4 text-[11px] text-gray-500">Result record from the data provider, captured {captured}.</p>}
    </PremiumPanel>
  );
}
