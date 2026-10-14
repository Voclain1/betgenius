"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { classifyStatus, statusLabel } from "@/lib/matchStatus";
import type { FixtureRow } from "@/lib/football/api-football";

/**
 * Live scores and results on tips, in their own Score column (ScoreCell),
 * styled as on the Livescores page.
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

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

const STATUS = "whitespace-nowrap text-[10px] font-black uppercase tracking-[0.12em]";

/**
 * The Score column on a tip row, in the Livescores page's language
 * (src/components/MatchList.tsx): in play, the pulsing dot and the minute over
 * the score; half-time in amber; finished, "FT" in grey over the result.
 * Before kickoff, a dash.
 *
 * A finished match drops out of the in-play feed, so the result comes from the
 * last score seen on this page, or from the settled tip's stored final score.
 */
export function ScoreCell({
  homeTeamApiId,
  awayTeamApiId,
  kickoff,
  finalHomeScore,
  finalAwayScore,
}: {
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: string | Date | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
}) {
  const live = useLive(homeTeamApiId, awayTeamApiId, kickoff);
  const score = (h: number | null | undefined, a: number | null | undefined, tone: string) => (
    <div className={`text-sm font-black tabular-nums ${tone}`}>
      {h ?? "-"}
      <span className="mx-1 text-gray-500">-</span>
      {a ?? "-"}
    </div>
  );

  if (live && !live.ended) {
    const halfTime = live.short === "HT";
    return (
      <div className="space-y-0.5">
        {halfTime ? (
          <span className={`${STATUS} text-amber-400`}>HT</span>
        ) : (
          <div className="flex items-center gap-1.5 text-red-400">
            <LiveDot />
            <span className="text-xs font-bold tabular-nums">{live.elapsed != null ? `${live.elapsed}'` : statusLabel(live.short)}</span>
          </div>
        )}
        {score(live.home, live.away, "text-gray-100")}
      </div>
    );
  }
  if (finalHomeScore != null && finalAwayScore != null) {
    return (
      <div className="space-y-0.5">
        <span className={`${STATUS} text-gray-500`}>FT</span>
        {score(finalHomeScore, finalAwayScore, "text-gray-200")}
      </div>
    );
  }
  if (live?.ended) {
    return (
      <div className="space-y-0.5">
        <span className={`${STATUS} text-gray-500`}>FT</span>
        {score(live.home, live.away, "text-gray-200")}
      </div>
    );
  }
  return <span className="text-xs text-gray-500">—</span>;
}
