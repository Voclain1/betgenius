"use client";
import { useMemo, useState } from "react";

type Leg = { id: string; label: string; market: string; pick: string; odds: number };

export default function BetBuilder() {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [stake, setStake] = useState(10);
  const [draft, setDraft] = useState<Leg>({ id: "", label: "", market: "1X2", pick: "Home", odds: 1.9 });
  const total = useMemo(() => legs.reduce((a, l) => a * l.odds, 1), [legs]);
  const potential = total * stake;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="space-y-4 md:col-span-2">
        <h1 className="text-2xl font-bold">Bet builder</h1>
        <div className="card space-y-3">
          <h2 className="font-semibold">Add a leg</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Match
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value, id: crypto.randomUUID() })}
                placeholder="Arsenal vs Chelsea"
                className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
            </label>
            <label className="text-sm">Market
              <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}
                className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
                {["1X2", "BTTS", "Over 2.5", "Under 2.5", "Double chance", "Correct score"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-sm">Pick
              <input value={draft.pick} onChange={(e) => setDraft({ ...draft, pick: e.target.value })}
                className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
            </label>
            <label className="text-sm">Odds
              <input type="number" step="0.01" min="1.01" value={draft.odds}
                onChange={(e) => setDraft({ ...draft, odds: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
            </label>
          </div>
          <button className="btn btn-primary"
            onClick={() => {
              if (!draft.label) return;
              setLegs([...legs, { ...draft, id: crypto.randomUUID() }]);
              setDraft({ ...draft, label: "", pick: "Home" });
            }}>Add leg</button>
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">Your legs</h2>
          {legs.length === 0 ? (
            <p className="text-sm text-gray-400">Add at least one leg to build your slip.</p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {legs.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{l.label}</div>
                    <div className="text-gray-400">{l.market} — {l.pick}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-brand">{l.odds.toFixed(2)}</span>
                    <button onClick={() => setLegs(legs.filter((x) => x.id !== l.id))}
                      className="text-xs text-gray-400 hover:text-red-400">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="card h-fit space-y-3">
        <h2 className="font-semibold">Summary</h2>
        <label className="block text-sm">Stake
          <input type="number" min="0" value={stake} onChange={(e) => setStake(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <div className="text-sm">Total odds: <span className="font-semibold text-brand">{total.toFixed(2)}</span></div>
        <div className="text-sm">Potential return: <span className="font-semibold text-brand">{potential.toFixed(2)}</span></div>
        <p className="text-xs text-gray-500">Bet builder is a calculator only. Odds are not linked to a bookmaker.</p>
      </aside>
    </div>
  );
}
