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
import { isMajorLeague, isKnownLeague } from "@/lib/leagues";
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
  const majorRows = useMemo(() => rows.filter((r) => isMajorLeague(r.league.id)), [rows]);
  const knownRows = useMemo(() => rows.filter((r) => isKnownLeague(r.league.id)), [rows]);

  /**
   * Major Leagues widens exactly ONE step when the current filter — range and
   * status tab together — has no major matches: to the leagues we recognise
   * (LEAGUE_CATALOGUE). It never widens beyond that.
   *
   * There used to be a third step to everything api-football returns, and it
   * is deliberately gone. On a quiet day that step put Slovak 3. Liga,
   * Canadian and Polish women's football on the default view of a football
   * tips site — the same off-brand substitution that got the fallback removed
   * from the homepage's Recent results. When neither tier has matches, saying
   * so is the honest answer; All Leagues is one click away for anyone who
   * actually wants the whole world's slate.
   *
   * Evaluated per tab rather than per scope: today's major set holds finished
   * matches and no upcoming ones, so a scope-level test would decide there was
   * major content and still land the visitor on an empty Upcoming tab.
   *
   * An explicit All Leagues choice never widens — it's already the widest set,
   * and the toggle means what it says.
   */
  const tabOf = (set: FixtureRow[]) => set.filter((r) => classifyStatus(r.fixture.status.short) === tab);
  const widenedToKnown = useMemo(() => {
    if (leagueScope !== "major" || tabOf(majorRows).length > 0) return false;
    return tabOf(knownRows).length > 0;
  }, [leagueScope, majorRows, knownRows, tab]);

  const scopedRows = leagueScope !== "major" ? rows : widenedToKnown ? knownRows : majorRows;

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
          {leagueScope === "major" && !widenedToKnown ? " — Major Leagues only" : ""}
          {multiDay ? ` across ${dates.length} days` : ""}.
        </p>
      )}

      {/* The toggle still reads "Major Leagues" because that IS the active
          choice; this says what was actually rendered instead, so the two
          never silently disagree. */}
      {!loading && widenedToKnown && (
        <p className="rounded-lg border border-brand-border bg-brand-card px-3 py-2 text-xs text-gray-400">
          No {tab} matches in the major leagues for this range — showing other leagues we cover instead.
        </p>
      )}

      {loading && <EmptyState>Loading…</EmptyState>}

      {!loading && groupCount === 0 && (
        <EmptyState>
          {rows.length === 0
            ? "No fixtures returned for this range (check your API-Football key or plan limits)."
            : leagueScope === "major"
              ? // Both tiers are empty for this tab. Naming the scope matters:
                // without it this reads as "there is no football today", when
                // what's true is "none in the leagues we cover" — and All
                // Leagues, one click away, may well have plenty.
                `No ${tab} matches in the leagues we cover for this range.`
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
