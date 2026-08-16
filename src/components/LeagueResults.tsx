"use client";
import { useEffect, useMemo, useState } from "react";
import { DateGroupedMatches, groupByDate, EmptyState, type MatchLinkIndex } from "@/components/MatchList";
import { classifyStatus, isIrregular } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

const WINDOW_HOURS = 36;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Recently-finished matches for one league.
 *
 * Same feed and same 36h window as the homepage's Recent results — today's and
 * yesterday's /api/fixtures slates, trimmed by kickoff — filtered to this
 * league's id. Grouped by date rather than by league, since every row here is
 * the same league.
 *
 * Rows carry real team ids, so match-page links go through the id-keyed
 * linkIndex, unlike the upcoming list above which only has names.
 */
export function LeagueResults({ leagueApiId, linkIndex }: { leagueApiId: number | null; linkIndex?: MatchLinkIndex }) {
  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (leagueApiId == null) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const slates = await Promise.all(
          [isoDaysAgo(0), isoDaysAgo(1)].map((date) => fetch(`/api/fixtures?date=${date}`).then((r) => r.json())),
        );
        if (!alive) return;
        const byId = new Map<number, FixtureRow>();
        for (const s of slates) for (const r of (s.fixtures ?? []) as FixtureRow[]) byId.set(r.fixture.id, r);
        setRows([...byId.values()]);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueApiId]);

  const finished = useMemo(() => {
    const cutoff = Date.now() - WINDOW_HOURS * 3_600_000;
    return rows
      .filter(
        (r) =>
          r.league.id === leagueApiId &&
          classifyStatus(r.fixture.status.short) === "finished" &&
          !isIrregular(r.fixture.status.short) &&
          new Date(r.fixture.date).getTime() >= cutoff,
      )
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  }, [rows, leagueApiId]);

  const groups = useMemo(() => groupByDate(finished), [finished]);

  if (loading) return <EmptyState>Loading recent results…</EmptyState>;

  if (groups.length === 0) {
    return (
      <EmptyState>
        {failed
          ? "Results are unavailable right now — try again shortly."
          : `No matches in this league have finished in the last ${WINDOW_HOURS} hours.`}
      </EmptyState>
    );
  }

  return <DateGroupedMatches groups={groups} linkIndex={linkIndex} />;
}
