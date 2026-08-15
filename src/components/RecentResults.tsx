"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GroupedMatches, groupByLeague, EmptyState } from "@/components/MatchList";
import { classifyStatus, isIrregular } from "@/lib/matchStatus";
import { isMajorLeague } from "@/lib/leagues";
import type { FixtureRow } from "@/lib/football/api-football";

const WINDOW_HOURS = 36;
// Smaller than the Fixtures page's 10 — this is a homepage teaser sitting
// above the Genius/Featured tables, so it shouldn't push them off-screen on
// mobile before the reader has scrolled.
const GROUP_PAGE_SIZE = 3;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Recently-finished matches for the homepage, off the same /api/fixtures feed
 * Fixtures/Livescores use and rendered with the same MatchList primitives.
 *
 * The API is one-date-at-a-time, so a 36h window needs both today's and
 * yesterday's slates fetched and then trimmed by kickoff time — 36h rather
 * than 24h so a late kickoff from the previous evening is still shown the
 * following morning.
 */
export function RecentResults() {
  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const slates = await Promise.all(
          [isoDaysAgo(0), isoDaysAgo(1)].map((date) => fetch(`/api/fixtures?date=${date}`).then((r) => r.json())),
        );
        if (!alive) return;
        // Dedupe by fixture id — a match can appear in both slates depending
        // on how api-football buckets a kickoff near the date boundary.
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
  }, []);

  // Irregular codes (postponed/cancelled/abandoned) classify as "finished" for
  // tab-filtering purposes but aren't results, so they're excluded here.
  const finished = useMemo(() => {
    const cutoff = Date.now() - WINDOW_HOURS * 3_600_000;
    return rows
      .filter(
        (r) =>
          classifyStatus(r.fixture.status.short) === "finished" &&
          !isIrregular(r.fixture.status.short) &&
          new Date(r.fixture.date).getTime() >= cutoff,
      )
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  }, [rows]);

  // Major leagues first, same curated default as Fixtures/Livescores. In a
  // quiet window where nothing major has finished, fall back to the full set
  // rather than showing an empty section next to results that do exist.
  const major = useMemo(() => finished.filter((r) => isMajorLeague(r.league.id)), [finished]);
  const shown = major.length > 0 ? major : finished;
  const groups = useMemo(() => groupByLeague(shown), [shown]);

  if (loading) return <EmptyState>Loading recent results…</EmptyState>;

  if (groups.length === 0) {
    return (
      <EmptyState>
        {failed
          ? "Results are unavailable right now — try again shortly."
          : `No matches have finished in the last ${WINDOW_HOURS} hours.`}{" "}
        <Link href="/livescores" className="text-brand hover:underline">
          See livescores →
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {major.length === 0 && <p className="text-xs text-gray-500">No major-league matches finished recently — showing all leagues.</p>}
      <GroupedMatches
        groups={groups}
        visibleCount={visibleGroupCount}
        onShowMore={() => setVisibleGroupCount((c) => c + GROUP_PAGE_SIZE)}
        pageSize={GROUP_PAGE_SIZE}
      />
    </div>
  );
}
