"use client";
import { useState } from "react";
import Link from "next/link";
import { PillTabs, EmptyState } from "@/components/MatchList";
import { teamSlug } from "@/lib/slug";
import type { LeaguePlayerStat } from "@/lib/enrichment";

type Board = "scorers" | "assists" | "cards";

const BOARD_META: Record<Board, { label: string; column: string }> = {
  scorers: { label: "Scorers", column: "Goals" },
  assists: { label: "Assists", column: "Assists" },
  cards: { label: "Cards", column: "Yellow" },
};

function Row({ stat, rank, board }: { stat: LeaguePlayerStat; rank: number; board: Board }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="w-4 shrink-0 text-xs text-gray-500 tabular-nums">{rank}</span>
      {stat.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stat.photo}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          className="h-7 w-7 shrink-0 rounded-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <span className="h-7 w-7 shrink-0 rounded-full bg-brand-bg" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{stat.name}</div>
        <Link href={`/predictions/team/${teamSlug(stat.teamName)}`} className="truncate text-xs text-gray-500 hover:underline">
          {stat.teamName}
        </Link>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-base font-bold tabular-nums">{stat.value}</div>
        {board === "cards" && stat.redCards ? (
          <div className="text-[10px] text-red-400">{stat.redCards} red</div>
        ) : (
          stat.appearances != null && <div className="text-[10px] text-gray-500">{stat.appearances} apps</div>
        )}
      </div>
    </div>
  );
}

export function TopScorersLeaderboard({ scorers }: { scorers: LeaguePlayerStat[] }) {
  if (scorers.length === 0) return <EmptyState>No scorers recorded for this cup season yet.</EmptyState>;
  return (
    <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase text-gray-500">
        <span className="w-4 shrink-0">#</span><span className="flex-1">Player</span><span>Goals</span>
      </div>
      {scorers.map((stat, index) => <Row key={stat.playerId} stat={stat} rank={index + 1} board="scorers" />)}
    </div>
  );
}

/**
 * Top scorers / assists / cards for a league.
 *
 * All three boards come from one cached refresh, so switching tab is a
 * re-read. A board is empty far more often than you'd expect — a season that
 * hasn't kicked off, or card data that hasn't populated while goals already
 * have — so each tab carries its own empty state naming the likely reason,
 * rather than the section vanishing or claiming a failure.
 *
 * Red cards ride along on the cards board from the same payload; there's no
 * separate red-card leaderboard, which would cost a call to re-order data we
 * already hold.
 */
export function LeaguePlayerStats({
  scorers,
  assists,
  cards,
}: {
  scorers: LeaguePlayerStat[];
  assists: LeaguePlayerStat[];
  cards: LeaguePlayerStat[];
}) {
  const [board, setBoard] = useState<Board>("scorers");
  const rows = board === "scorers" ? scorers : board === "assists" ? assists : cards;

  return (
    <div className="space-y-3">
      <PillTabs
        active={board}
        onChange={setBoard}
        options={(Object.keys(BOARD_META) as Board[]).map((k) => ({ key: k, label: BOARD_META[k].label }))}
      />

      {rows.length === 0 ? (
        <EmptyState>
          {board === "cards"
            ? "No card data for this season yet — it usually appears later than goals and assists."
            : `No ${BOARD_META[board].label.toLowerCase()} recorded for this season yet.`}
        </EmptyState>
      ) : (
        <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60">
          <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase text-gray-500">
            <span className="w-4 shrink-0">#</span>
            <span className="flex-1">Player</span>
            <span className="shrink-0">{BOARD_META[board].column}</span>
          </div>
          {rows.map((s, i) => (
            <Row key={`${s.playerId}-${board}`} stat={s} rank={i + 1} board={board} />
          ))}
        </div>
      )}
    </div>
  );
}
