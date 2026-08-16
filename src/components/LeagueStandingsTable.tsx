"use client";
import { useState } from "react";
import Link from "next/link";
import { PillTabs } from "@/components/MatchList";
import { teamSlug } from "@/lib/slug";
import type { LeagueStandingRow, LeagueStandingSplit } from "@/lib/enrichment";

/** Rows shown before the reader expands — enough to see the title race without the page becoming a table. */
const COLLAPSED_ROWS = 6;

type View = "all" | "home" | "away";

/**
 * The overall figures live flat on the row (they predate the splits), so this
 * reshapes them into the same split shape the home/away views use.
 */
function splitFor(row: LeagueStandingRow, view: View): LeagueStandingSplit | null {
  if (view === "all") {
    return { played: row.played, win: row.win, draw: row.draw, loss: row.loss, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst };
  }
  return (view === "home" ? row.home : row.away) ?? null;
}

/** Points aren't reported per-venue, so they're derived the way the competition awards them. */
function pointsFor(row: LeagueStandingRow, view: View, split: LeagueStandingSplit): number {
  return view === "all" ? row.points : split.win * 3 + split.draw;
}

/**
 * Standings with Overall / Home / Away views and a collapsed-by-default table.
 *
 * All three views come from one cached /standings response — api-football
 * returns the home and away splits alongside the overall one, so switching
 * view is a re-read, never a re-fetch.
 *
 * Rows are re-ranked within Home and Away rather than keeping the league
 * ladder's positions: a home table ordered by overall rank isn't a home table.
 * Ordering matches the competition's own — points, then goal difference, then
 * goals scored.
 */
export function LeagueStandingsTable({ rows }: { rows: LeagueStandingRow[] }) {
  const [view, setView] = useState<View>("all");
  const [expanded, setExpanded] = useState(false);

  // Rows cached before the splits existed carry neither, in which case the
  // toggle is hidden entirely rather than offering two empty tables.
  const hasSplits = rows.some((r) => r.home || r.away);

  const ranked = rows
    .map((row) => ({ row, split: splitFor(row, view) }))
    .filter((r): r is { row: LeagueStandingRow; split: LeagueStandingSplit } => r.split !== null)
    .map((r) => ({ ...r, points: pointsFor(r.row, view, r.split) }))
    .sort((a, b) => {
      if (view === "all") return a.row.rank - b.row.rank;
      const gdA = a.split.goalsFor - a.split.goalsAgainst;
      const gdB = b.split.goalsFor - b.split.goalsAgainst;
      return b.points - a.points || gdB - gdA || b.split.goalsFor - a.split.goalsFor;
    });

  const visible = expanded ? ranked : ranked.slice(0, COLLAPSED_ROWS);
  const remaining = ranked.length - visible.length;

  return (
    <div className="space-y-3">
      {hasSplits && (
        <PillTabs
          active={view}
          onChange={setView}
          options={[
            { key: "all", label: "Overall" },
            { key: "home", label: "Home" },
            { key: "away", label: "Away" },
          ]}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Team</th>
              <th className="px-1 text-center">P</th>
              <th className="px-1 text-center">W</th>
              <th className="px-1 text-center">D</th>
              <th className="px-1 text-center">L</th>
              <th className="px-1 text-center">GD</th>
              <th className="px-1 text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, split, points }, i) => (
              <tr key={row.teamId} className="border-t border-brand-border">
                <td className="py-1 pr-2 text-gray-500">{view === "all" ? row.rank : i + 1}</td>
                <td className="py-1 pr-2">
                  <Link href={`/predictions/team/${teamSlug(row.teamName)}`} className="flex items-center gap-1.5 hover:underline">
                    {row.teamLogo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.teamLogo} alt="" width={16} height={16} loading="lazy" className="shrink-0 object-contain" />
                    )}
                    <span className="truncate">{row.teamName}</span>
                  </Link>
                </td>
                <td className="px-1 text-center">{split.played}</td>
                <td className="px-1 text-center">{split.win}</td>
                <td className="px-1 text-center">{split.draw}</td>
                <td className="px-1 text-center">{split.loss}</td>
                <td className="px-1 text-center">{split.goalsFor - split.goalsAgainst}</td>
                <td className="px-1 text-center font-semibold">{points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Same control the Fixtures/Recent-results lists use to reveal more. */}
      {remaining > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="btn btn-ghost w-full justify-center text-sm">
          Show full table ({remaining} more)
        </button>
      )}
      {expanded && ranked.length > COLLAPSED_ROWS && (
        <button type="button" onClick={() => setExpanded(false)} className="btn btn-ghost w-full justify-center text-sm">
          Show less
        </button>
      )}
    </div>
  );
}
