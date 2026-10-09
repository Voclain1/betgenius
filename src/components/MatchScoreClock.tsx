"use client";
import { useEffect, useState } from "react";
import { classifyStatus, isIrregular, statusLabel } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

const LIVE_POLL_MS = 60_000;

/**
 * The centre of the match masthead: the kickoff time before the match, the
 * score once it has started.
 *
 * The score is read live rather than from FixtureDetailCache — a cached score
 * is a wrong score. Two existing endpoints, in order: /api/livescores (the
 * Livescores page's feed) answers for in-play matches, and /api/fixtures?date=
 * covers finished and scheduled ones. The fixture is picked out of either
 * slate by both team ids, the same identity matchKey is built from.
 *
 * The first render is exactly the upcoming layout (big time, day under it),
 * so an upcoming match never changes and a failed fetch degrades to it. A
 * settled prediction's stored final score is passed in as `finalScore`, so a
 * finished match renders its result straight away instead of flashing the
 * kickoff time first.
 */
export function MatchScoreClock({
  homeTeamApiId,
  awayTeamApiId,
  kickoff,
  timeLabel,
  dayLabel,
  finalScore,
}: {
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: string;
  /** "12:30", formatted on the server in Lagos time. */
  timeLabel: string;
  /** "SAT 10 OCT", formatted on the server in Lagos time. */
  dayLabel: string;
  finalScore?: { home: number; away: number } | null;
}) {
  const [fixture, setFixture] = useState<FixtureRow | null>(null);

  useEffect(() => {
    // Nothing to look up before kickoff: the clock is already right.
    if (homeTeamApiId == null || awayTeamApiId == null || new Date(kickoff).getTime() > Date.now()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const find = (rows: FixtureRow[]) =>
      rows.find((f) => f.teams.home.id === homeTeamApiId && f.teams.away.id === awayTeamApiId) ?? null;

    const load = async () => {
      try {
        const live = await fetch("/api/livescores").then((r) => r.json());
        let hit = find((live.live ?? []) as FixtureRow[]);
        if (!hit) {
          const day = new Date(kickoff).toISOString().slice(0, 10);
          const slate = await fetch(`/api/fixtures?date=${day}`).then((r) => r.json());
          hit = find((slate.fixtures ?? []) as FixtureRow[]);
        }
        if (!alive) return;
        if (hit) setFixture(hit);
        // Only in-play matches are worth re-polling.
        if (hit && classifyStatus(hit.fixture.status.short) === "live") timer = setTimeout(load, LIVE_POLL_MS);
      } catch {
        // Keep whatever is showing: the stored score or the kickoff time.
      }
    };

    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [homeTeamApiId, awayTeamApiId, kickoff]);

  const code = fixture?.fixture.status.short;
  const group = code ? classifyStatus(code) : null;
  const irregular = code ? isIrregular(code) : false;

  let score: { home: number | null; away: number | null } | null = null;
  let label: React.ReactNode = null;
  if (fixture && code && !irregular && group !== "upcoming") {
    score = { home: fixture.goals.home, away: fixture.goals.away };
    label =
      group === "live" ? (
        <span className="inline-flex items-center gap-1.5 text-red-400">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          {fixture.fixture.status.elapsed != null ? `Live ${fixture.fixture.status.elapsed}'` : statusLabel(code)}
        </span>
      ) : (
        <span className="text-gray-300">{statusLabel(code) === "FT" ? "Full time" : statusLabel(code)}</span>
      );
  } else if (!fixture && finalScore) {
    score = finalScore;
    label = <span className="text-gray-300">Full time</span>;
  }

  const small = "whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.16em]";

  if (!score) {
    return (
      <div className="text-center">
        <div className="text-4xl font-black tabular-nums tracking-tight text-gray-100 sm:text-5xl">{timeLabel}</div>
        <div className={`mt-1.5 text-gray-400 ${small}`}>{dayLabel}</div>
        {irregular && code && <div className={`mt-1 text-amber-400 ${small}`}>{statusLabel(code)}</div>}
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className={small}>{label}</div>
      <div className="mt-1 text-4xl font-black tabular-nums tracking-tight text-gray-100 sm:text-5xl">
        {score.home ?? "-"}
        <span className="mx-1.5 text-gray-500">-</span>
        {score.away ?? "-"}
      </div>
      <div className={`mt-1.5 text-gray-400 ${small}`}>
        {dayLabel} · {timeLabel}
      </div>
    </div>
  );
}
