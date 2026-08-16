"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  StatusTabs,
  LeagueScopeToggle,
  PillTabs,
  GroupedMatches,
  DateGroupedMatches,
  groupByLeague,
  groupByDate,
  EmptyState,
  type LeagueScope,
  type MatchLinkIndex,
} from "@/components/MatchList";
import { classifyStatus, type MatchStatusGroup } from "@/lib/matchStatus";
import { isMajorLeague } from "@/lib/leagues";
import type { FixtureRow } from "@/lib/football/api-football";

const GROUP_PAGE_SIZE = 10;

/**
 * Date ranges. "Results" is not a separate route — it's the `finished` status
 * tab, which this component already had; the change here is making it (and
 * every other filter) URL-addressable so a filtered view can be shared.
 */
type Range = "today" | "tomorrow" | "week";

const RANGE_OPTIONS: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
];

function isoDaysFromNow(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The dates a range covers. api-football has no range endpoint for "all
 * leagues", so a week is seven separate date queries — the reason the week
 * view fetches more and is not the default.
 */
function datesFor(range: Range): string[] {
  if (range === "today") return [isoDaysFromNow(0)];
  if (range === "tomorrow") return [isoDaysFromNow(1)];
  return Array.from({ length: 7 }, (_, i) => isoDaysFromNow(i));
}

export default function FixturesClient({ linkIndex }: { linkIndex: MatchLinkIndex }) {
  const router = useRouter();
  const params = useSearchParams();

  // URL is the source of truth for every filter, so a filtered view is
  // shareable and survives a reload — same reasoning as the dashboard's
  // ?section= pattern. Unset params fall back to the previous defaults.
  const range = (params.get("range") as Range) || "today";
  const tab = (params.get("status") as MatchStatusGroup) || "upcoming";
  const leagueScope = (params.get("league") as LeagueScope) || "major";

  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PAGE_SIZE);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      router.replace(`/fixtures?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const dates = useMemo(() => datesFor(range), [range]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const slates = await Promise.all(
        dates.map((d) => fetch(`/api/fixtures?date=${d}`).then((r) => r.json()).catch(() => ({ fixtures: [] }))),
      );
      if (!alive) return;
      // Dedupe across days — a kickoff near a date boundary can appear twice.
      const byId = new Map<number, FixtureRow>();
      for (const s of slates) for (const r of (s.fixtures ?? []) as FixtureRow[]) byId.set(r.fixture.id, r);
      setRows([...byId.values()]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [dates]);

  useEffect(() => {
    setVisibleGroupCount(GROUP_PAGE_SIZE);
  }, [tab, leagueScope, range]);

  // Filters combine rather than replace each other: league scope narrows the
  // set, status narrows it again, and the range decides which days were
  // fetched at all.
  const scopedRows = useMemo(
    () => (leagueScope === "major" ? rows.filter((r) => isMajorLeague(r.league.id)) : rows),
    [rows, leagueScope],
  );

  const counts = useMemo(() => {
    const c: Record<MatchStatusGroup, number> = { live: 0, upcoming: 0, finished: 0 };
    for (const r of scopedRows) c[classifyStatus(r.fixture.status.short)]++;
    return c;
  }, [scopedRows]);

  const filtered = useMemo(
    () =>
      scopedRows
        .filter((r) => classifyStatus(r.fixture.status.short) === tab)
        .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime()),
    [scopedRows, tab],
  );

  // A single day groups by league (its natural axis); a multi-day range groups
  // by date first, since "which day" is the question a week view raises.
  const multiDay = dates.length > 1;
  const leagueGroups = useMemo(() => groupByLeague(filtered), [filtered]);
  const dateGroups = useMemo(() => groupByDate(filtered), [filtered]);
  const groupCount = multiDay ? dateGroups.length : leagueGroups.length;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Fixtures</h1>

      {/* Controls wrap rather than scroll — three pill groups fit two rows at
          375px without pushing the page wider than the viewport. */}
      <div className="flex flex-wrap items-center gap-2">
        <PillTabs active={range} onChange={(r) => setParam("range", r)} options={RANGE_OPTIONS} />
        <LeagueScopeToggle scope={leagueScope} onChange={(s) => setParam("league", s)} />
        <StatusTabs active={tab} onChange={(t) => setParam("status", t)} counts={counts} />
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-xs text-gray-500">
          Showing {filtered.length} of {rows.length} matches
          {leagueScope === "major" ? " — Major Leagues only" : ""}
          {multiDay ? ` across ${dates.length} days` : ""}.
        </p>
      )}

      {loading && <EmptyState>Loading…</EmptyState>}

      {!loading && groupCount === 0 && (
        <EmptyState>
          {rows.length === 0
            ? "No fixtures returned for this range (check your API-Football key or plan limits)."
            : scopedRows.length === 0
              ? "No major-league matches in this range — try All Leagues."
              : `No ${tab} matches in this range.`}
        </EmptyState>
      )}

      {!loading &&
        groupCount > 0 &&
        (multiDay ? (
          <DateGroupedMatches groups={dateGroups} linkIndex={linkIndex} />
        ) : (
          <GroupedMatches
            groups={leagueGroups}
            visibleCount={visibleGroupCount}
            onShowMore={() => setVisibleGroupCount((c) => c + GROUP_PAGE_SIZE)}
            pageSize={GROUP_PAGE_SIZE}
            linkIndex={linkIndex}
          />
        ))}
    </div>
  );
}
