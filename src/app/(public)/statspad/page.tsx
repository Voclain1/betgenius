"use client";
import { useState } from "react";
import { MAJOR_LEAGUES, LEAGUE_TIER_LABELS } from "@/lib/leagues";

const LEAGUE_TIERS = Array.from(new Set(MAJOR_LEAGUES.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: MAJOR_LEAGUES.filter((l) => l.tier === tier),
}));

export default function StatsPad() {
  const [leagueId, setLeagueId] = useState(39);
  const [table, setTable] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const j = await fetch(`/api/standings?league=${leagueId}`).then((r) => r.json());
    setTable(j.table || []);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">StatsPad</h1>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">League
            <select value={leagueId} onChange={(e) => setLeagueId(Number(e.target.value))}
              className="ml-2 rounded-md border border-brand-border bg-brand-bg px-3 py-2">
              {LEAGUE_TIERS.map((g) => (
                <optgroup key={g.tier} label={g.label}>
                  {g.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}{l.country !== "World" ? ` (${l.country})` : ""}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={load}>Load stats</button>
        </div>
      </div>

      {loading && <div className="card text-gray-400">Loading…</div>}

      {table.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-2 font-semibold">Top attack (goals for)</h3>
            <ol className="space-y-1 text-sm">
              {[...table].sort((a, b) => b.all.goals.for - a.all.goals.for).slice(0, 5).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{r.team.name}</span><span className="text-brand">{r.all.goals.for}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h3 className="mb-2 font-semibold">Best defence (goals against)</h3>
            <ol className="space-y-1 text-sm">
              {[...table].sort((a, b) => a.all.goals.against - b.all.goals.against).slice(0, 5).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{r.team.name}</span><span className="text-brand">{r.all.goals.against}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h3 className="mb-2 font-semibold">Best form (recent)</h3>
            <ol className="space-y-1 text-sm">
              {table.slice(0, 5).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{r.team.name}</span>
                  <span className="font-mono text-xs text-gray-300">{r.form || "—"}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h3 className="mb-2 font-semibold">Goal difference leaders</h3>
            <ol className="space-y-1 text-sm">
              {[...table].sort((a, b) => b.goalsDiff - a.goalsDiff).slice(0, 5).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span>{r.team.name}</span><span className="text-brand">{r.goalsDiff > 0 ? "+" : ""}{r.goalsDiff}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
