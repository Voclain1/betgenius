"use client";
import { useEffect, useState } from "react";
import { MAJOR_LEAGUES, LEAGUE_TIER_LABELS } from "@/lib/leagues";

const LEAGUE_TIERS = Array.from(new Set(MAJOR_LEAGUES.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: MAJOR_LEAGUES.filter((l) => l.tier === tier),
}));

type Row = {
  rank: number;
  team: { name: string };
  points: number;
  goalsDiff: number;
  form?: string;
  all: { played: number; win: number; draw: number; lose: number };
};

export default function StandingsPage() {
  const [leagueId, setLeagueId] = useState(39);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const j = await fetch(`/api/standings?league=${leagueId}`).then((r) => r.json());
      setRows(j.table || []);
      setLoading(false);
    })();
  }, [leagueId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Standings</h1>
        <select value={leagueId} onChange={(e) => setLeagueId(Number(e.target.value))}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2">
          {LEAGUE_TIERS.map((g) => (
            <optgroup key={g.tier} label={g.label}>
              {g.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}{l.country !== "World" ? ` (${l.country})` : ""}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {loading && <div className="card text-gray-400">Loading…</div>}
      {!loading && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2 text-right">P</th>
                <th className="px-3 py-2 text-right">W</th>
                <th className="px-3 py-2 text-right">D</th>
                <th className="px-3 py-2 text-right">L</th>
                <th className="px-3 py-2 text-right">GD</th>
                <th className="px-3 py-2 text-right">Pts</th>
                <th className="px-3 py-2">Form</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {rows.map((r) => (
                <tr key={r.rank}>
                  <td className="px-3 py-2 text-gray-400">{r.rank}</td>
                  <td className="px-3 py-2 font-medium">{r.team.name}</td>
                  <td className="px-3 py-2 text-right">{r.all.played}</td>
                  <td className="px-3 py-2 text-right">{r.all.win}</td>
                  <td className="px-3 py-2 text-right">{r.all.draw}</td>
                  <td className="px-3 py-2 text-right">{r.all.lose}</td>
                  <td className="px-3 py-2 text-right">{r.goalsDiff}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand">{r.points}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.form || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="card text-gray-400">No standings available (check API key).</div>
      )}
    </div>
  );
}
