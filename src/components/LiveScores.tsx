"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { classifyStatus, statusLabel } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

/**
 * Live scores on tips, in place of what is already there: the score replaces
 * the "vs" between the team names, and the minute replaces the kickoff time.
 * No row, badge or spacing is added, so nothing on the page moves.
 *
 * ONE poll per page, and only while a match on it can be in play: from kickoff
 * to LIVE_WINDOW_MS after. A page of upcoming or settled tips never polls. The
 * poll reads /api/livescores, which serves a shared snapshot, so readers do not
 * add provider calls (src/lib/liveSnapshot.ts).
 */

const POLL_MS = 30_000;
/** Kickoff to full time with stoppage and a half-time over-run. */
export const LIVE_WINDOW_MS = 150 * 60_000;

type Entry = { home: number; away: number; kickoff: number };
type Live = { home: number | null; away: number | null; short: string; elapsed: number | null; ended: boolean };

type Ctx = { register: (e: Entry) => () => void; scores: Map<string, Live> };
const LiveCtx = createContext<Ctx | null>(null);

const keyOf = (home: number, away: number) => `${home}-${away}`;

/** Is any of these matches between kickoff and the end of its live window? */
export function anyInPlayWindow(entries: Iterable<Entry>, now: number): boolean {
  for (const e of entries) if (now >= e.kickoff && now <= e.kickoff + LIVE_WINDOW_MS) return true;
  return false;
}

export function LiveScoresProvider({ children }: { children: React.ReactNode }) {
  const entries = useRef(new Map<string, Entry & { count: number }>());
  const [scores, setScores] = useState<Map<string, Live>>(new Map());
  const [version, setVersion] = useState(0);

  const register = (e: Entry) => {
    const k = keyOf(e.home, e.away);
    const existing = entries.current.get(k);
    entries.current.set(k, { ...e, count: (existing?.count ?? 0) + 1 });
    setVersion((v) => v + 1);
    return () => {
      const cur = entries.current.get(k);
      if (!cur) return;
      if (cur.count <= 1) entries.current.delete(k);
      else entries.current.set(k, { ...cur, count: cur.count - 1 });
    };
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      if (anyInPlayWindow(entries.current.values(), Date.now())) {
        try {
          const body = (await fetch("/api/livescores").then((r) => r.json())) as { live?: FixtureRow[] };
          if (!alive) return;
          const seen = new Map<string, FixtureRow>();
          for (const r of body.live ?? []) seen.set(keyOf(r.teams.home.id, r.teams.away.id), r);
          setScores((prev) => {
            const next = new Map<string, Live>();
            for (const k of entries.current.keys()) {
              const r = seen.get(k);
              if (r && classifyStatus(r.fixture.status.short) === "live") {
                next.set(k, { home: r.goals.home, away: r.goals.away, short: r.fixture.status.short, elapsed: r.fixture.status.elapsed ?? null, ended: false });
              } else if (prev.has(k)) {
                // Gone from the in-play feed: keep the last score so it does not
                // vanish at the whistle, without a minute that is no longer true.
                next.set(k, { ...prev.get(k)!, ended: true });
              }
            }
            return next;
          });
        } catch {
          // Keep what is showing.
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [version > 0]);

  return <LiveCtx.Provider value={{ register, scores }}>{children}</LiveCtx.Provider>;
}

function useLive(home?: number | null, away?: number | null, kickoff?: string | Date | null): Live | null {
  const ctx = useContext(LiveCtx);
  const t = kickoff ? new Date(kickoff).getTime() : NaN;
  useEffect(() => {
    if (!ctx || home == null || away == null || Number.isNaN(t)) return;
    return ctx.register({ home, away, kickoff: t });
    // ctx.register is stable for the provider's life in practice; the ids and kickoff identify the entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, away, t]);
  if (!ctx || home == null || away == null) return null;
  return ctx.scores.get(keyOf(home, away)) ?? null;
}

/** "vs" until the match is live, then the score in the same place. */
export function LiveVs({ homeTeamApiId, awayTeamApiId, kickoff }: { homeTeamApiId?: number | null; awayTeamApiId?: number | null; kickoff?: string | Date | null }) {
  const live = useLive(homeTeamApiId, awayTeamApiId, kickoff);
  if (!live || live.home == null || live.away == null) return <span className="text-gray-500">vs</span>;
  return (
    <span className="font-black tabular-nums text-gray-100" aria-label={`score ${live.home} to ${live.away}`}>
      {live.home}–{live.away}
    </span>
  );
}

/** The kickoff time until the match is live, then the minute (or HT) in the same place. */
export function LiveKickoff({
  homeTeamApiId,
  awayTeamApiId,
  kickoff,
  children,
}: {
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: string | Date | null;
  children: React.ReactNode;
}) {
  const live = useLive(homeTeamApiId, awayTeamApiId, kickoff);
  if (!live || live.ended) return <>{children}</>;
  return <span className="font-bold text-red-400">{live.elapsed != null && live.short !== "HT" ? `${live.elapsed}'` : statusLabel(live.short)}</span>;
}
