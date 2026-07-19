"use client";
import { useState } from "react";
import Link from "next/link";
import { MAJOR_LEAGUES, LEAGUE_TIER_LABELS } from "@/lib/leagues";
import { LeagueBadge } from "@/components/LeagueBadge";

const CATS = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"] as const;
const FREE_CATS = ["FEATURED", "GENIUS", "TODAY", "BANKER"] as const;

const LEAGUE_TIERS = Array.from(new Set(MAJOR_LEAGUES.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: MAJOR_LEAGUES.filter((l) => l.tier === tier),
}));

export default function AIPanel() {
  const [form, setForm] = useState({
    home: "",
    away: "",
    league: MAJOR_LEAGUES[0].name as string,
    leagueApiId: MAJOR_LEAGUES[0].id as number | undefined,
    kickoff: new Date().toISOString().slice(0, 16),
    category: "TODAY" as (typeof CATS)[number],
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Failed");
      setResult(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const [bulkForm, setBulkForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    leagueApiIds: [MAJOR_LEAGUES[0].id] as number[],
    categories: ["TODAY"] as string[],
    limit: 5,
  });
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleLeague = (id: number) => {
    setBulkForm((f) => ({
      ...f,
      leagueApiIds: f.leagueApiIds.includes(id) ? f.leagueApiIds.filter((x) => x !== id) : [...f.leagueApiIds, id],
    }));
  };
  const toggleBulkCategory = (c: string) => {
    setBulkForm((f) => ({
      ...f,
      categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
    }));
  };

  const bulkGenerate = async () => {
    setBulkBusy(true);
    setBulkError(null);
    setBulkResult(null);
    try {
      const res = await fetch("/api/admin/ai/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkForm),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Failed");
      setBulkResult(j);
    } catch (e: any) {
      setBulkError(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const act = async (id: string, action: "APPROVE" | "PUBLISH" | "ARCHIVE") => {
    await fetch(`/api/admin/predictions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setResult((r: any) => ({
      ...r,
      predictions: r.predictions.map((p: any) => (p.id === id ? { ...p, status: action === "PUBLISH" ? "PUBLISHED" : action === "APPROVE" ? "APPROVED" : "ARCHIVED" } : p)),
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI panel</h1>
        <p className="text-sm text-gray-400">
          Generate a match preview and pick candidates with Gemini. Nothing goes live until you approve and publish.
        </p>
      </div>

      <div className="card grid gap-3 md:grid-cols-2">
        <label className="text-sm">Home team
          <input value={form.home} onChange={(e) => setForm({ ...form, home: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Away team
          <input value={form.away} onChange={(e) => setForm({ ...form, away: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">League
          <select value={form.leagueApiId ?? "Other"}
            onChange={(e) => {
              if (e.target.value === "Other") { setForm({ ...form, league: "Other", leagueApiId: undefined }); return; }
              const found = MAJOR_LEAGUES.find((l) => l.id === Number(e.target.value));
              setForm({ ...form, league: found?.name ?? "Other", leagueApiId: found?.id });
            }}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            {LEAGUE_TIERS.map((g) => (
              <optgroup key={g.tier} label={g.label}>
                {g.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}{l.country !== "World" ? ` (${l.country})` : ""}</option>)}
              </optgroup>
            ))}
            <option value="Other">Other</option>
          </select>
        </label>
        <label className="text-sm">Kickoff
          <input type="datetime-local" value={form.kickoff}
            onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Category
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as any })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <div className="md:col-span-2 flex justify-end">
          <button disabled={busy || !form.home || !form.away} onClick={generate}
            className="btn btn-primary disabled:opacity-50">
            {busy ? "Generating…" : "Generate with Gemini"}
          </button>
        </div>
      </div>

      {error && <div className="card text-red-400">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="mb-2 text-sm uppercase text-gray-400">Match preview (draft)</h3>
            <p className="whitespace-pre-wrap text-gray-100">{result.preview}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {result.predictions.map((p: any) => (
              <div key={p.id} className="card space-y-2">
                <div className="flex items-center justify-between">
                  <span className="chip bg-brand/20 text-brand">{p.category}</span>
                  <span className="chip bg-brand-border">{p.status}</span>
                </div>
                <LeagueBadge leagueApiId={p.leagueApiId} leagueName={p.leagueName} />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-xs text-gray-400">Market</div><div className="font-semibold">{p.market}</div></div>
                  <div><div className="text-xs text-gray-400">Pick</div><div className="font-semibold text-brand">{p.pick}</div></div>
                  <div><div className="text-xs text-gray-400">Confidence</div><div className="font-semibold">{p.confidence}%</div></div>
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{p.reasoning}</p>
                <div className="flex gap-2">
                  <button className="btn btn-ghost text-sm" onClick={() => act(p.id, "APPROVE")}>Approve</button>
                  <button className="btn btn-primary text-sm" onClick={() => act(p.id, "PUBLISH")}>Publish</button>
                  <button className="btn btn-ghost text-sm" onClick={() => act(p.id, "ARCHIVE")}>Archive</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card text-xs text-gray-500">
        <b>Accuracy note.</b> No model can guarantee 99% accuracy. Gemini returns probabilistic picks and a preview grounded
        in the fixture/form/injuries/standings data we pass it — capped at 90% confidence in the prompt. Treat every tip as a probability, not a certainty.
      </div>

      <div className="border-t border-brand-border pt-6">
        <h2 className="text-xl font-bold">Bulk generate — free tiers</h2>
        <p className="text-sm text-gray-400">
          Auto-generate tips for a whole day's fixtures across the free categories (Featured, Genius, Today, Banker).
          VIP and Premium tips stay manual, one at a time, above. Everything lands as Pending review — nothing publishes automatically.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The football data API is capped at 10 requests/minute, so each fixture takes roughly a minute to fully research and generate — a run of 5 fixtures takes several minutes. Leagues on their off-season (no scheduled matches on the chosen date) will just come back with 0 found.
        </p>
      </div>

      <div className="card grid gap-4 md:grid-cols-2">
        <label className="text-sm">Date
          <input type="date" value={bulkForm.date} onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Max fixtures
          <input type="number" min={1} max={20} value={bulkForm.limit}
            onChange={(e) => setBulkForm({ ...bulkForm, limit: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <div className="md:col-span-2">
          <div className="mb-1 text-sm">Leagues</div>
          <div className="space-y-2">
            {LEAGUE_TIERS.map((g) => (
              <div key={g.tier}>
                <div className="text-xs uppercase text-gray-500">{g.label}</div>
                <div className="flex flex-wrap gap-3 mt-1">
                  {g.leagues.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={bulkForm.leagueApiIds.includes(l.id)} onChange={() => toggleLeague(l.id)} />
                      {l.name}{l.country !== "World" ? ` (${l.country})` : ""}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm">Tag as categories</div>
          <div className="flex flex-wrap gap-3">
            {FREE_CATS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bulkForm.categories.includes(c)} onChange={() => toggleBulkCategory(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button disabled={bulkBusy || bulkForm.leagueApiIds.length === 0 || bulkForm.categories.length === 0}
            onClick={bulkGenerate} className="btn btn-primary disabled:opacity-50">
            {bulkBusy ? "Generating…" : "Bulk generate"}
          </button>
        </div>
      </div>

      {bulkError && <div className="card text-red-400">{bulkError}</div>}

      {bulkResult && (
        <div className="card space-y-2">
          <h3 className="text-sm uppercase text-gray-400">
            {bulkResult.found} fixture{bulkResult.found === 1 ? "" : "s"} found · {bulkResult.results.filter((r: any) => r.ok).length} generated
          </h3>
          {bulkResult.results.length === 0 ? (
            <p className="text-sm text-gray-400">No upcoming fixtures found for that date/league selection.</p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {bulkResult.results.map((r: any, i: number) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>{r.home} vs {r.away}</span>
                  {r.ok ? (
                    <span className="flex gap-2">
                      {r.predictionIds.map((id: string) => (
                        <Link key={id} href={`/admin/predictions/${id}`} className="chip bg-brand/20 text-brand hover:underline">Review</Link>
                      ))}
                    </span>
                  ) : (
                    <span className="chip bg-red-500/20 text-red-300">{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
