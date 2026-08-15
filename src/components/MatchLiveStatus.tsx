"use client";
import { useEffect, useState } from "react";
import { classifyStatus, isIrregular, statusLabel } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

const LIVE_POLL_MS = 60_000;

/**
 * Score and status for one fixture on its match page, read live rather than
 * from FixtureDetailCache — a cached score is a wrong score.
 *
 * Two existing endpoints, in order: /api/livescores (the same feed the
 * Livescores page uses) answers for in-play matches, and /api/fixtures?date=
 * (the Fixtures/Recent-results feed) covers finished and scheduled ones. The
 * fixture is picked out of either slate by both team ids, the same identity
 * matchKey is built from.
 *
 * Degrades to the kickoff time the page already knows if both calls fail or
 * neither slate contains the fixture, so this never renders empty.
 */
export function MatchLiveStatus({
  homeTeamApiId,
  awayTeamApiId,
  kickoff,
}: {
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: string;
}) {
  const [fixture, setFixture] = useState<FixtureRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (homeTeamApiId == null || awayTeamApiId == null) {
      setLoading(false);
      return;
    }
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
        setFixture(hit);
        // Only in-play matches are worth re-polling; a finished or scheduled
        // one won't change while the reader is on the page.
        if (hit && classifyStatus(hit.fixture.status.short) === "live") timer = setTimeout(load, LIVE_POLL_MS);
      } catch {
        if (alive) setFixture(null);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [homeTeamApiId, awayTeamApiId, kickoff]);

  const kickoffTime = new Date(kickoff).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (loading) return <span className="text-sm text-gray-500">Checking status…</span>;

  if (!fixture) {
    return (
      <span className="text-sm text-gray-400">
        {new Date(kickoff).getTime() > Date.now() ? `Kicks off ${kickoffTime}` : `Kicked off ${kickoffTime}`}
      </span>
    );
  }

  const code = fixture.fixture.status.short;
  const group = classifyStatus(code);

  if (group === "upcoming") return <span className="text-sm text-gray-400">Kicks off {kickoffTime}</span>;
  if (isIrregular(code)) return <span className="chip bg-amber-500/20 text-xs text-amber-400">{statusLabel(code)}</span>;

  const score = `${fixture.goals.home ?? "-"} - ${fixture.goals.away ?? "-"}`;

  if (group === "live") {
    return (
      <span className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="text-lg font-bold tabular-nums">{score}</span>
        <span className="text-xs font-bold text-red-400">
          {fixture.fixture.status.elapsed != null ? `${fixture.fixture.status.elapsed}'` : statusLabel(code)}
        </span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-lg font-bold tabular-nums">{score}</span>
      <span className="chip bg-gray-500/20 text-xs text-gray-400">{statusLabel(code)}</span>
    </span>
  );
}
