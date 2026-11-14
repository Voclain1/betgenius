"use client";

import { useState } from "react";
import { h2hWindow, pct, type H2HWindow } from "@/lib/matchCentre";
import type { H2HMeeting } from "@/lib/h2h";

/**
 * Head-to-head figures for the last 5 or 10 meetings. The server sends the
 * verified meetings once (h2hWindow, ≤ 10); both windows are the same pure
 * function over that list, so nothing is fetched here. Wins, goals and the home/away splits are from the
 * point of view of TODAY's home and away sides, wherever each meeting was
 * played.
 */
function day(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-brand-bg px-2 py-2.5 text-center">
      <dd className="text-xl font-black tabular-nums text-gray-100 sm:text-2xl">{value}</dd>
      {sub && <dd className="text-[10px] tabular-nums text-gray-500">{sub}</dd>}
      <dt className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</dt>
    </div>
  );
}

export function H2HBody({ meetings, homeTeamApiId, awayTeamApiId, kickoff, homeTeam, awayTeam, timeZone }: { meetings: H2HMeeting[]; homeTeamApiId: number; awayTeamApiId: number; kickoff: string; homeTeam: string; awayTeam: string; timeZone: string }) {
  const cutoff = new Date(kickoff);
  const windows = { 5: h2hWindow(meetings, homeTeamApiId, awayTeamApiId, 5, cutoff), 10: h2hWindow(meetings, homeTeamApiId, awayTeamApiId, 10, cutoff) } as const;
  const available = windows[10].played;
  const [size, setSize] = useState<H2HWindow>(available > 5 ? 10 : 5);
  const s = windows[size];
  const rec = (r: { w: number; d: number; l: number }) => `${r.w}-${r.d}-${r.l}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {available > 5 ? (
          <div role="group" aria-label="Number of meetings" className="inline-flex rounded-xl border border-brand-border bg-brand-bg p-0.5">
            {([5, 10] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={w === size}
                onClick={() => setSize(w)}
                className={`min-h-9 rounded-[10px] px-3 text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${w === size ? "bg-gray-100 text-brand-bg" : "text-gray-400 hover:text-gray-100"}`}
              >
                Last {w}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-300">{s.played} {s.played === 1 ? "meeting" : "meetings"}</span>
          {s.from && s.to && <> · {s.from === s.to ? day(s.to, timeZone) : `${day(s.from, timeZone)} – ${day(s.to, timeZone)}`}</>}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-brand-border">
        <Stat label={`${homeTeam} wins`} value={String(s.homeWins)} />
        <Stat label="Draws" value={String(s.draws)} />
        <Stat label={`${awayTeam} wins`} value={String(s.awayWins)} />
      </dl>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-brand-border sm:grid-cols-4">
        <Stat label="Goals" value={`${s.homeGoals}-${s.awayGoals}`} sub={s.avgGoals != null ? `${s.avgGoals.toFixed(1)} per meeting` : undefined} />
        <Stat label="Both scored" value={s.btts ? `${pct(s.btts)}%` : "—"} sub={s.btts ? `${s.btts.n} of ${s.btts.d}` : undefined} />
        <Stat label="Over 2.5" value={s.over25 ? `${pct(s.over25)}%` : "—"} sub={s.over25 ? `${s.over25.n} of ${s.over25.d}` : undefined} />
        <Stat label={`${homeTeam} host / visit`} value={`${rec(s.homeAsHost)} · ${rec(s.homeAsVisitor)}`} sub="W-D-L" />
      </dl>

      <ul className="divide-y divide-brand-border" aria-label="Meetings, most recent first">
        {s.meetings.map((m) => (
          <li key={m.fixtureApiId} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-2 text-sm">
            <span className="min-w-0 truncate text-right text-gray-300">{m.homeTeam}</span>
            <span className="shrink-0 text-center">
              <span className="block font-black tabular-nums text-gray-100">{m.homeGoals}-{m.awayGoals}</span>
              <span className="block text-[10px] tabular-nums text-gray-500">{day(m.date, timeZone)}</span>
            </span>
            <span className="min-w-0 truncate text-gray-300">
              {m.awayTeam}
              {m.leagueName && <span className="block truncate text-[10px] text-gray-500">{m.leagueName}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-500">Past meetings describe what happened, not what will happen. Scores as recorded by the data provider; abandoned or unscored meetings are not counted.</p>
    </div>
  );
}
