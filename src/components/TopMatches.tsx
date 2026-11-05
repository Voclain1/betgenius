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
 * The homepage's Today's highlights: three or four short score cards, crest
 * and name either side, the kickoff or score in the middle with the status
 * and competition crest under it. Every card opens the match's prediction page.
 *
 * Rows arrive from the server (getTopMatches in src/lib/topMatches.ts), with
 * the live feed already laid over them. While a card is between kickoff and
 * the end of its live window, the strip polls the shared /api/livescores copy
 * so the minute and score move without a reload. A match that leaves the
 * in-play feed after we saw it there keeps its last score under "FT", as on
 * tip rows (src/components/LiveScores.tsx). Nothing polls once every card is
 * settled or still to come.
 *
 * Phones get a swipeable row of exactly two cards per screen; from sm up the
 * cards sit in one row.
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
      className={`top-matches -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:grid sm:gap-3 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden ${
        cards.length >= 4 ? "sm:grid-cols-4" : cards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"
      }`}
    >
      {cards.map((c) => (
        <li key={c.fixture.id} className="w-[calc(50%-0.25rem)] shrink-0 snap-start sm:w-auto">
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

const STATUS = "text-[9px] font-black uppercase tracking-[0.12em] sm:text-[10px]";

function Status({ c }: { c: FixtureRow }) {
  const code = c.fixture.status.short;
  const group = classifyStatus(code);
  if (group === "live") {
    if (code === "HT") return <span className={`${STATUS} text-amber-400`}>HT</span>;
    return (
      <span className="flex items-center gap-1 text-red-400">
        <LiveDot />
        <span className="text-[10px] font-bold leading-none tabular-nums">{c.fixture.status.elapsed != null ? `${c.fixture.status.elapsed}'` : statusLabel(code)}</span>
      </span>
    );
  }
  if (isIrregular(code)) return <span className={`${STATUS} text-amber-400`}>{statusLabel(code)}</span>;
  if (group === "finished") return <span className={`${STATUS} text-gray-500`}>{statusLabel(code)}</span>;
  return <span className={`${STATUS} text-gray-500`}>WAT</span>;
}

/** Common short forms for the names that would not fit a half-width card. */
const SHORT_NAMES: Record<string, string> = {
  "Manchester United": "Man Utd",
  "Manchester City": "Man City",
  "Paris Saint Germain": "PSG",
  "Wolverhampton Wanderers": "Wolves",
  "Nottingham Forest": "Nott'm Forest",
  "Brighton & Hove Albion": "Brighton",
  "Borussia Dortmund": "Dortmund",
  "Bayer Leverkusen": "Leverkusen",
  "Bayern München": "Bayern",
  "Bayern Munich": "Bayern",
  "Borussia Mönchengladbach": "Gladbach",
  "Atletico Madrid": "Atlético",
  "Athletic Club": "Athletic",
  "Sheffield Wednesday": "Sheff Wed",
  "Sheffield Utd": "Sheff Utd",
  "Queens Park Rangers": "QPR",
  "West Bromwich Albion": "West Brom",
};

/** "Manchester United" → "Man Utd", "Stoke City" → "Stoke City". Pure. */
export function shortTeamName(name: string): string {
  return SHORT_NAMES[name] ?? name.replace(/ United$/, " Utd");
}

function Side({ id, name }: { id: number; name: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-bg ring-1 ring-brand-border transition group-hover:ring-brand sm:h-8 sm:w-8">
        <TeamCrest teamApiId={id} name={name} size={18} className="sm:!h-[22px] sm:!w-[22px]" />
      </span>
      <span className="w-full truncate text-[10px] font-bold leading-tight tracking-tight text-gray-200 sm:text-[11px] sm:tracking-normal">
        <span className="sm:hidden">{shortTeamName(name)}</span>
        <span className="hidden sm:inline">{name}</span>
      </span>
    </div>
  );
}

/**
 * A short score card: crest and name either side, the time or score in the
 * middle with the status and competition crest under it. Two fit across a
 * phone; swipe for the rest.
 */
function Card({ c }: { c: TopMatchCard }) {
  const group = classifyStatus(c.fixture.status.short);
  const showScore = group !== "upcoming" && !isIrregular(c.fixture.status.short);
  const label = `${c.teams.home.name} v ${c.teams.away.name} prediction, ${c.league.name}`;
  return (
    <Link
      href={c.href}
      aria-label={label}
      title={`${c.teams.home.name} v ${c.teams.away.name} · ${c.league.name}`}
      className="group grid h-full grid-cols-[1fr,auto,1fr] items-center gap-1 rounded-2xl border border-brand-border bg-brand-card px-1.5 py-2 transition hover:border-brand sm:px-3 sm:py-2.5"
    >
      <Side id={c.teams.home.id} name={c.teams.home.name} />
      <div className="flex min-w-[2.5rem] flex-col items-center gap-1">
        {showScore ? (
          <span className={`text-[15px] font-black leading-none tabular-nums sm:text-lg ${group === "live" ? "text-gray-100" : "text-gray-200"}`}>
            {c.goals.home ?? "-"}
            <span className="mx-0.5 text-gray-600">-</span>
            {c.goals.away ?? "-"}
          </span>
        ) : (
          <span className="text-sm font-black leading-none tabular-nums text-gray-100 sm:text-base" suppressHydrationWarning>
            {kickoffTime(c.fixture.date).replace(" WAT", "")}
          </span>
        )}
        <span className="flex items-center gap-1">
          {c.league.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.league.logo} alt="" width={10} height={10} loading="lazy" className="h-2.5 w-2.5 shrink-0 object-contain" />
          )}
          <Status c={c} />
        </span>
      </div>
      <Side id={c.teams.away.id} name={c.teams.away.name} />
    </Link>
  );
}
