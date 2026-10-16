"use client";
import Link from "next/link";
import { useState } from "react";
import { MatchLink } from "@/components/MatchLink";
import { trackEngagement } from "@/lib/engagement";
import {
  FEED_RESULTS_MAX_DAYS_BACK,
  FEED_RESULTS_PAGE_DAYS,
  resultsDayLabel,
  shiftDayKey,
  type DayResult,
} from "@/lib/feedResultsDays";

const OUTCOME: Record<string, { label: string; tone: string }> = {
  WON: { label: "Won", tone: "text-emerald-400" },
  LOST: { label: "Lost", tone: "text-red-400" },
  VOID: { label: "Void", tone: "text-gray-400" },
  PENDING: { label: "Awaiting result", tone: "text-gray-500" },
};

type DayState = { status: "loading" } | { status: "error" } | { status: "done"; results: DayResult[]; locked: boolean };

/**
 * Day-by-day results at the foot of the VIP, Premium and Banker pages. See
 * src/lib/feedResults.ts: the page renders only the list of days; a day's
 * results are fetched when the reader opens it, once.
 */
export function FeedResults({
  category,
  name,
  firstDay,
  unlockHref,
  unlockLabel,
}: {
  category: "VIP" | "PREMIUM" | "BANKER";
  /** "VIP", "Premium", "Banker" */
  name: string;
  /** Yesterday's Lagos day key, from the server, so server and client list the same days. */
  firstDay: string;
  unlockHref: string;
  unlockLabel: string;
}) {
  const [shown, setShown] = useState(FEED_RESULTS_PAGE_DAYS);
  const [open, setOpen] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, DayState>>({});

  const keys = Array.from({ length: shown }, (_, i) => shiftDayKey(firstDay, -i));
  const canShowMore = shown < FEED_RESULTS_MAX_DAYS_BACK;

  async function toggle(key: string) {
    const next = open === key ? null : key;
    setOpen(next);
    if (next) trackEngagement("track_record_day_open", { feed_category: category, days_ago: keys.indexOf(key) + 1 });
    if (!next || days[key]?.status === "done" || days[key]?.status === "loading") return;
    setDays((d) => ({ ...d, [key]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/predictions/results?category=${category}&day=${key}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: DayResult[]; locked: boolean };
      setDays((d) => ({ ...d, [key]: { status: "done", results: body.results, locked: body.locked } }));
    } catch {
      setDays((d) => ({ ...d, [key]: { status: "error" } }));
    }
  }

  return (
    <section aria-labelledby="feed-results-heading" className="space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Track record</p>
        <h2 id="feed-results-heading" className="mt-1 text-2xl font-black tracking-tight text-gray-100 sm:text-3xl">Past {name} results</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">Every {name} pick, win or lose, by the day its match was played. Open a day to see how its picks finished.</p>
      </div>

      <ul className="divide-y divide-brand-border overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
        {keys.map((key) => {
          const isOpen = open === key;
          const state = days[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-controls={`results-${key}`}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.03]"
              >
                <span className="font-bold text-gray-100">{resultsDayLabel(key)}</span>
                <span aria-hidden className={`text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
              </button>
              {isOpen && (
                <div id={`results-${key}`} className="px-5 pb-5">
                  {!state || state.status === "loading" ? (
                    <p className="text-sm text-gray-500">Loading results…</p>
                  ) : state.status === "error" ? (
                    <p className="text-sm text-gray-400">
                      Couldn&apos;t load this day.{" "}
                      <button type="button" onClick={() => { setDays((d) => { const { [key]: _, ...rest } = d; return rest; }); setOpen(null); }} className="font-semibold text-brand hover:underline">
                        Try again
                      </button>
                    </p>
                  ) : state.results.length === 0 ? (
                    <p className="text-sm text-gray-500">No {name} picks that day.</p>
                  ) : (
                    <>
                      {state.locked && (
                        <p className="mb-3 text-sm text-gray-400">
                          Results are public; the picks are for {name} readers.{" "}
                          <Link href={unlockHref} className="font-semibold text-brand hover:underline">{unlockLabel}</Link>
                        </p>
                      )}
                      <ul className="divide-y divide-brand-border">
                        {state.results.map((r) => {
                          const outcome = OUTCOME[r.outcome] ?? OUTCOME.PENDING;
                          return (
                            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-100">
                                  <MatchLink homeTeam={r.homeTeam} awayTeam={r.awayTeam} kickoff={r.kickoff} homeTeamApiId={r.homeTeamApiId} awayTeamApiId={r.awayTeamApiId} />
                                </div>
                                <div className="text-xs text-gray-400">
                                  {r.pick ? <><span className="font-bold text-gray-200">{r.pick}</span> · {r.market}</> : r.market}
                                </div>
                              </div>
                              <span className={`text-[11px] font-black uppercase tracking-[0.14em] ${outcome.tone}`}>{outcome.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canShowMore && (
        <button
          type="button"
          onClick={() => {
            const next = Math.min(shown + FEED_RESULTS_PAGE_DAYS, FEED_RESULTS_MAX_DAYS_BACK);
            trackEngagement("track_record_more_days", { feed_category: category, days_shown: next });
            setShown(next);
          }}
          className="rounded-xl border border-brand-border px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-brand hover:text-brand"
        >
          Show more days
        </button>
      )}
    </section>
  );
}
