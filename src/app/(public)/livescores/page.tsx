"use client";
import { useEffect, useState } from "react";

type Fx = {
  fixture: { id: number; status: { short: string } };
  league: { name: string; country: string };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
};

export default function LivescoresPage() {
  const [rows, setRows] = useState<Fx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/livescores");
      const j = await res.json();
      if (alive) {
        setRows(j.live || []);
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Livescores</h1>
      {loading && <div className="card text-gray-400">Loading live fixtures…</div>}
      {!loading && rows.length === 0 && (
        <div className="card text-gray-400">
          No live matches right now (or API-Football key not configured).
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.fixture.id} className="card flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400">{r.league.country} · {r.league.name}</div>
              <div className="font-medium">{r.teams.home.name} vs {r.teams.away.name}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{r.goals.home ?? 0} – {r.goals.away ?? 0}</div>
              <div className="text-xs text-brand">{r.fixture.status.short}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
