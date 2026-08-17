"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GroupedMatches, groupByLeague, EmptyState, type MatchLinkIndex } from "@/components/MatchList";
import { tabOfStatus } from "@/lib/matchStatus";
import { isMajorLeague } from "@/lib/leagues";
import type { FixtureRow } from "@/lib/football/api-football";

const WINDOW_HOURS = 36;
// Smaller than the Fixtures page's 10 — this is a homepage teaser sitting
// above the Genius/Featured tables, so it shouldn't push them off-screen on
// mobile before the reader has scrolled.
const GROUP_PAGE_SIZE = 3;
/** At most this many league groups — supporting content, not a feed. */
const MAX_GROUPS = 2;

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
 *
 * `linkIndex` (from getPublishedMatchIndex) makes the rows we have published
 * predictions for link through to their match page; the rest stay plain text.
 */
export function RecentResults({ linkIndex }: { linkIndex?: MatchLinkIndex }) {
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

  // tabOfStatus already excludes postponed/cancelled/abandoned from
  // "finished" — they aren't results. Same rule as the Fixtures page.
  const finished = useMemo(() => {
    const cutoff = Date.now() - WINDOW_HOURS * 3_600_000;
    return rows
      .filter(
        (r) =>
          tabOfStatus(r.fixture.status.short) === "finished" &&
          new Date(r.fixture.date).getTime() >= cutoff,
      )
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  }, [rows]);

  // Major leagues ONLY — no fallback to the full set. This block sits on the
  // homepage of a tips site covering major leagues; standing in Lithuanian or
  // Croatian results because nothing major has finished reads as a different
  // product entirely. An empty state is the honest answer in a quiet window.
  const major = useMemo(() => finished.filter((r) => isMajorLeague(r.league.id)), [finished]);
  // Capped: this is supporting content beneath the tips, not a scores feed.
  const groups = useMemo(() => groupByLeague(major).slice(0, MAX_GROUPS), [major]);

  if (loading) return <EmptyState>Loading recent results…</EmptyState>;

  if (groups.length === 0) {
    return (
      <EmptyState>
        {failed
          ? "Results are unavailable right now — try again shortly."
          : `No major-league matches have finished in the last ${WINDOW_HOURS} hours.`}{" "}
        <Link href="/livescores" className="text-brand hover:underline">
          See livescores →
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <GroupedMatches
        groups={groups}
        visibleCount={visibleGroupCount}
        onShowMore={() => setVisibleGroupCount((c) => c + GROUP_PAGE_SIZE)}
        pageSize={GROUP_PAGE_SIZE}
        linkIndex={linkIndex}
      />
    </div>
  );
}
