"use client";
import { useEffect, useState } from "react";

type Fx = {
  fixture: { id: number; date: string; status: { short: string } };
  league: { name: string; country: string };
  teams: { home: { name: string }; away: { name: string } };
};

export default function FixturesPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Fx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const j = await fetch(`/api/fixtures?date=${date}`).then((r) => r.json());
      setRows(j.fixtures || []);
      setLoading(false);
    })();
  }, [date]);

  const byLeague = rows.reduce<Record<string, Fx[]>>((acc, r) => {
    const k = `${r.league.country} · ${r.league.name}`;
    (acc[k] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Fixtures</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2" />
      </div>
      {loading && <div className="card text-gray-400">Loading…</div>}
      {Object.entries(byLeague).map(([league, fx]) => (
        <section key={league} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-gray-400">{league}</h2>
          <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-card">
            {fx.map((r) => (
              <div key={r.fixture.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium">{r.teams.home.name} vs {r.teams.away.name}</div>
                  <div className="text-xs text-gray-400">{new Date(r.fixture.date).toLocaleString()}</div>
                </div>
                <span className="chip bg-brand-border">{r.fixture.status.short}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!loading && rows.length === 0 && (
        <div className="card text-gray-400">No fixtures returned (check your API-Football key).</div>
      )}
    </div>
  );
}
