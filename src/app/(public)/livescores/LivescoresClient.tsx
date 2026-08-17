"use client";
import { useEffect, useMemo, useState } from "react";
import { StatusTabs, LeagueGroup, groupByLeague, EmptyState, type MatchLinkIndex } from "@/components/MatchList";
import { tabOfStatus, type MatchStatusGroup } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function LivescoresClient({ linkIndex }: { linkIndex: MatchLinkIndex }) {
  const [dateRows, setDateRows] = useState<FixtureRow[]>([]);
  const [liveRows, setLiveRows] = useState<FixtureRow[]>([]);
  // Tracked as two independent flags rather than one shared `loading` flag
  // set by whichever fetch happens to finish first — in dev, React Strict
  // Mode double-invokes this effect, so the two calls can settle in either
  // order; gating on "both have completed at least once" is the only
  // ordering-independent way to know the initial data is trustworthy.
  const [dateLoaded, setDateLoaded] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const loading = !dateLoaded || !liveLoaded;
  const [tab, setTab] = useState<MatchStatusGroup>("live");

  useEffect(() => {
    let alive = true;
    const loadDate = async () => {
      const res = await fetch(`/api/fixtures?date=${todayIso()}`);
      const j = await res.json();
      if (alive) {
        setDateRows(j.fixtures || []);
        setDateLoaded(true);
      }
    };
    const loadLive = async () => {
      const res = await fetch("/api/livescores");
      const j = await res.json();
      if (alive) {
        setLiveRows(j.live || []);
        setLiveLoaded(true);
      }
    };
    loadDate();
    loadLive();
    const liveTimer = setInterval(loadLive, 20_000);
    const dateTimer = setInterval(loadDate, 60_000);
    return () => {
      alive = false;
      clearInterval(liveTimer);
      clearInterval(dateTimer);
    };
  }, []);

  // Today's full slate (/api/fixtures?date=today) is the base — it's what
  // makes Upcoming/Finished tabs possible at all, since /api/livescores only
  // ever returns matches currently in play. The dedicated live feed is
  // overlaid on top for fresher scores/minutes between the slower date-poll,
  // and to catch a live match that started today but has crossed into a new
  // calendar date by kickoff-timezone (date-query would miss it otherwise).
  const merged = useMemo(() => {
    const byId = new Map<number, FixtureRow>();
    for (const r of dateRows) byId.set(r.fixture.id, r);
    for (const r of liveRows) byId.set(r.fixture.id, r);
    return Array.from(byId.values());
  }, [dateRows, liveRows]);

  const counts = useMemo(() => {
    const c: Record<MatchStatusGroup, number> = { live: 0, upcoming: 0, finished: 0 };
    // Postponed/cancelled/abandoned belong to no tab and so are counted in
    // none — the number beside "Finished" has to match the list under it.
    // Same rule as Fixtures, RecentResults and LeagueResults.
    for (const r of merged) {
      const g = tabOfStatus(r.fixture.status.short);
      if (g) c[g]++;
    }
    return c;
  }, [merged]);

  const filtered = useMemo(() => merged.filter((r) => tabOfStatus(r.fixture.status.short) === tab), [merged, tab]);
  const groups = useMemo(() => groupByLeague(filtered), [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Livescores</h1>
        <StatusTabs active={tab} onChange={setTab} counts={counts} />
      </div>

      {loading && <EmptyState>Loading fixtures…</EmptyState>}
      {!loading && groups.length === 0 && (
        <EmptyState>
          {tab === "live"
            ? "No live matches right now (or API-Football key not configured)."
            : tab === "upcoming"
              ? "No upcoming matches scheduled for today."
              : "No finished matches yet today."}
        </EmptyState>
      )}
      <div className="space-y-4">
        {groups.map((g) => (
          <LeagueGroup key={g.league.id} league={g.league} rows={g.rows} linkIndex={linkIndex} />
        ))}
      </div>
    </div>
  );
}
