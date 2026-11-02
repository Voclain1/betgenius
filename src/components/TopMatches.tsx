"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TeamCrest } from "@/components/TeamCrest";
import { classifyStatus, isIrregular, statusLabel } from "@/lib/matchStatus";
import { kickoffTime } from "@/lib/footballTime";
import type { FixtureRow } from "@/lib/football/api-football";

/** Matches the shared live snapshot's fastest refresh. */
const POLL_MS = 15_000;
/** Kickoff to full time with stoppage and a half-time over-run (as LiveScores.tsx). */
const LIVE_WINDOW_MS = 150 * 60_000;

export type TopMatchCard = FixtureRow & { href: string };

/**
 * The homepage's Top matches: three or four score cards, crest either side of
 * the score, the minute or kickoff above it and the competition below.
 *
 * Rows arrive from the server (getTopMatches in src/lib/topMatches.ts), with
 * the live feed already laid over them. While a card is between kickoff and
 * the end of its live window, the strip polls the shared /api/livescores copy
 * so the minute and score move without a reload. A match that leaves the
 * in-play feed after we saw it there keeps its last score under "FT", as on
 * tip rows (src/components/LiveScores.tsx). Nothing polls once every card is
 * settled or still to come.
 *
 * Phones get a swipeable row with the next card peeking in; from sm up the
 * cards sit in a grid.
 */
export function TopMatches({ rows }: { rows: TopMatchCard[] }) {
  const [cards, setCards] = useState(rows);
  const seenLive = useRef(new Set<number>());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inWindow = () => {
      const now = Date.now();
      return cards.some((c) => {
        const t = new Date(c.fixture.date).getTime();
        return classifyStatus(c.fixture.status.short) !== "finished" && now >= t && now <= t + LIVE_WINDOW_MS;
      });
    };
    const tick = async () => {
      if (!alive) return;
      if (inWindow()) {
        try {
          const body = (await fetch("/api/livescores").then((r) => r.json())) as { live?: FixtureRow[] };
          if (!alive) return;
          const live = new Map((body.live ?? []).map((r) => [r.fixture.id, r]));
          setCards((prev) =>
            prev.map((c) => {
              const l = live.get(c.fixture.id);
              if (l && classifyStatus(l.fixture.status.short) === "live") {
                seenLive.current.add(c.fixture.id);
                return { ...c, fixture: { ...c.fixture, status: l.fixture.status }, goals: l.goals };
              }
              if (seenLive.current.has(c.fixture.id) && classifyStatus(c.fixture.status.short) === "live") {
                // Gone from the in-play feed after we saw it there: the whistle.
                return { ...c, fixture: { ...c.fixture, status: { short: "FT", elapsed: null } } };
              }
              return c;
            }),
          );
        } catch {
          // Keep what is showing.
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // The poll reads `cards` through its closure each tick; restarting it on
    // every score change is what keeps that closure current.
  }, [cards]);

  return (
    <ul
      className={`-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden ${
        cards.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      }`}
    >
      {cards.map((c) => (
        <li key={c.fixture.id} className="w-[82%] shrink-0 snap-start sm:w-auto">
          <Card c={c} />
        </li>
      ))}
    </ul>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

const STATUS = "text-[10px] font-black uppercase tracking-[0.16em]";

function Status({ c }: { c: FixtureRow }) {
  const code = c.fixture.status.short;
  const group = classifyStatus(code);
  if (group === "live") {
    if (code === "HT") return <span className={`${STATUS} text-amber-400`}>Half-time</span>;
    return (
      <span className="flex items-center gap-1.5 text-red-400">
        <LiveDot />
        <span className="text-xs font-bold tabular-nums">{c.fixture.status.elapsed != null ? `${c.fixture.status.elapsed}'` : statusLabel(code)}</span>
      </span>
    );
  }
  if (isIrregular(code)) return <span className={`${STATUS} text-amber-400`}>{statusLabel(code)}</span>;
  if (group === "finished") return <span className={`${STATUS} text-gray-500`}>{statusLabel(code)}</span>;
  return (
    <span className={`${STATUS} text-gray-400`}>Kick-off</span>
  );
}

function Side({ id, name }: { id: number; name: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-bg ring-1 ring-brand-border transition group-hover:ring-brand">
        <TeamCrest teamApiId={id} name={name} size={34} />
      </span>
      <span className="line-clamp-2 min-h-[2.5em] w-full text-xs font-bold leading-tight text-gray-200">{name}</span>
    </div>
  );
}

function Card({ c }: { c: TopMatchCard }) {
  const group = classifyStatus(c.fixture.status.short);
  const showScore = group !== "upcoming" && !isIrregular(c.fixture.status.short);
  const label = `${c.teams.home.name} v ${c.teams.away.name}, ${c.league.name}`;
  return (
    <Link
      href={c.href}
      aria-label={label}
      className="group block h-full rounded-3xl border border-brand-border bg-brand-card p-4 transition hover:-translate-y-0.5 hover:border-brand sm:p-5"
    >
      <div className="grid grid-cols-[1fr,auto,1fr] items-start gap-2">
        <Side id={c.teams.home.id} name={c.teams.home.name} />
        <div className="flex min-w-[5.5rem] flex-col items-center gap-1.5 pt-1">
          <Status c={c} />
          {showScore ? (
            <span className={`text-3xl font-black tabular-nums tracking-tight ${group === "live" ? "text-gray-100" : "text-gray-200"}`}>
              {c.goals.home ?? "-"}
              <span className="mx-1.5 text-gray-600">–</span>
              {c.goals.away ?? "-"}
            </span>
          ) : (
            <span className="text-xl font-black tabular-nums tracking-tight text-gray-100" suppressHydrationWarning>
              {kickoffTime(c.fixture.date).replace(" WAT", "")}
            </span>
          )}
          {!showScore && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">WAT</span>}
        </div>
        <Side id={c.teams.away.id} name={c.teams.away.name} />
      </div>
      <div className="mt-4 flex items-center justify-center gap-1.5 border-t border-brand-border pt-3">
        {c.league.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.league.logo} alt="" width={14} height={14} loading="lazy" className="h-3.5 w-3.5 shrink-0 object-contain" />
        )}
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">{c.league.name}</span>
      </div>
    </Link>
  );
}
