"use client";
import { useEffect, useMemo, useState } from "react";
import { StatusTabs, LeagueScopeToggle, GroupedMatches, groupByLeague, EmptyState, type LeagueScope } from "@/components/MatchList";
import { classifyStatus, type MatchStatusGroup } from "@/lib/matchStatus";
import { isMajorLeague } from "@/lib/leagues";
import type { FixtureRow } from "@/lib/football/api-football";

const GROUP_PAGE_SIZE = 10;

export default function FixturesPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MatchStatusGroup>("upcoming");
  // API-Football returns every match worldwide for a date — hundreds of
  // lower-tier/youth fixtures alongside the ones anyone actually follows.
  // Default to the curated major-league list; "All Leagues" is one click away.
  const [leagueScope, setLeagueScope] = useState<LeagueScope>("major");
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const j = await fetch(`/api/fixtures?date=${date}`).then((r) => r.json());
      if (alive) {
        setRows(j.fixtures || []);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date]);

  // Collapse back to the first page whenever the visible set changes shape —
  // otherwise a "show more" expansion from one filter view would carry over
  // and look arbitrary under a different one.
  useEffect(() => {
    setVisibleGroupCount(GROUP_PAGE_SIZE);
  }, [tab, leagueScope, date]);

  // The API is queried one date at a time (no range endpoint exists), so
  // "grouped by date" here is a single always-one-member group — the date
  // heading below — with league sub-groups inside it, same as Livescores.
  const scopedRows = useMemo(
    () => (leagueScope === "major" ? rows.filter((r) => isMajorLeague(r.league.id)) : rows),
    [rows, leagueScope],
  );

  const counts = useMemo(() => {
    const c: Record<MatchStatusGroup, number> = { live: 0, upcoming: 0, finished: 0 };
    for (const r of scopedRows) c[classifyStatus(r.fixture.status.short)]++;
    return c;
  }, [scopedRows]);

  const filtered = useMemo(() => scopedRows.filter((r) => classifyStatus(r.fixture.status.short) === tab), [scopedRows, tab]);
  const groups = useMemo(() => groupByLeague(filtered), [filtered]);

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Fixtures</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{dateLabel}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <LeagueScopeToggle scope={leagueScope} onChange={setLeagueScope} />
          <StatusTabs active={tab} onChange={setTab} counts={counts} />
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-xs text-gray-500">
          Showing {scopedRows.length} of {rows.length} matches on this date
          {leagueScope === "major" ? " — Major Leagues only." : "."}
        </p>
      )}

      {loading && <EmptyState>Loading…</EmptyState>}
      {!loading && groups.length === 0 && (
        <EmptyState>
          {rows.length === 0
            ? "No fixtures returned for this date (check your API-Football key or plan limits)."
            : scopedRows.length === 0
              ? "No major-league matches on this date — try All Leagues."
              : `No ${tab} matches on this date.`}
        </EmptyState>
      )}
      <GroupedMatches groups={groups} visibleCount={visibleGroupCount} onShowMore={() => setVisibleGroupCount((c) => c + GROUP_PAGE_SIZE)} pageSize={GROUP_PAGE_SIZE} />
    </div>
  );
}
