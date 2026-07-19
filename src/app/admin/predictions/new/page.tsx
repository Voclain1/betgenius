"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MAJOR_LEAGUES, LEAGUE_TIER_LABELS } from "@/lib/leagues";

const CATS = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"] as const;

const LEAGUE_TIERS = Array.from(new Set(MAJOR_LEAGUES.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: MAJOR_LEAGUES.filter((l) => l.tier === tier),
}));

export default function NewPrediction() {
  const router = useRouter();
  const [form, setForm] = useState({
    homeTeam: "",
    awayTeam: "",
    kickoff: "",
    leagueApiId: undefined as number | undefined,
    leagueName: "",
    market: "",
    pick: "",
    overUnder: "",
    odds: "",
    confidence: 70,
    reasoning: "",
    matchPreview: "",
    categories: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (c: string) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c],
    }));
  };

  const create = async () => {
    if (form.categories.length === 0) { setError("Select at least one category."); return; }
    if (!form.market || !form.pick || !form.overUnder || !form.reasoning) {
      setError("Market, pick, over/under, and reasoning are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeTeam: form.homeTeam || undefined,
          awayTeam: form.awayTeam || undefined,
          kickoff: form.kickoff ? new Date(form.kickoff).toISOString() : undefined,
          leagueApiId: form.leagueApiId,
          leagueName: form.leagueName || undefined,
          market: form.market,
          pick: form.pick,
          overUnder: form.overUnder,
          odds: form.odds ? Number(form.odds) : undefined,
          confidence: form.confidence,
          reasoning: form.reasoning,
          matchPreview: form.matchPreview || undefined,
          categories: form.categories,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Failed to create prediction");
      router.push(`/admin/predictions/${j.prediction.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/predictions" className="text-sm text-gray-400 hover:underline">← Back to predictions</Link>
        <h1 className="mt-1 text-2xl font-bold">Post a prediction</h1>
        <p className="text-sm text-gray-400">
          For tips prepared offline — enter it directly, no AI involved. It lands as Pending review, same as everything else,
          so you can double-check before it goes live.
        </p>
      </div>

      <div className="card grid gap-3 md:grid-cols-2">
        <label className="text-sm">Home team
          <input value={form.homeTeam} onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Away team
          <input value={form.awayTeam} onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">League
          <select value={form.leagueApiId ?? "Other"}
            onChange={(e) => {
              if (e.target.value === "Other") { setForm({ ...form, leagueApiId: undefined, leagueName: "" }); return; }
              const found = MAJOR_LEAGUES.find((l) => l.id === Number(e.target.value));
              setForm({ ...form, leagueApiId: found?.id, leagueName: found?.name ?? "" });
            }}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            <option value="Other">None / other</option>
            {LEAGUE_TIERS.map((g) => (
              <optgroup key={g.tier} label={g.label}>
                {g.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}{l.country !== "World" ? ` (${l.country})` : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-sm">Kickoff
          <input type="datetime-local" value={form.kickoff} onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Market
          <input value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })}
            placeholder="e.g. Match Result"
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Pick
          <input value={form.pick} onChange={(e) => setForm({ ...form, pick: e.target.value })}
            placeholder="e.g. Arsenal to win"
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Over/Under
          <input value={form.overUnder} onChange={(e) => setForm({ ...form, overUnder: e.target.value })}
            placeholder="e.g. Over 2.5 Goals"
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Odds
          <input type="number" step="0.01" value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Confidence %
          <input type="number" min={0} max={100} value={form.confidence}
            onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Reasoning
          <textarea rows={4} value={form.reasoning} onChange={(e) => setForm({ ...form, reasoning: e.target.value })}
            placeholder="Why this pick — form, injuries, head-to-head, whatever you based it on."
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Match preview <span className="text-gray-500">(optional)</span>
          <textarea rows={3} value={form.matchPreview} onChange={(e) => setForm({ ...form, matchPreview: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <div className="md:col-span-2">
          <div className="mb-1 text-sm">Categories <span className="text-gray-500">(post to multiple feeds at once)</span></div>
          <div className="flex flex-wrap gap-3">
            {CATS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.categories.includes(c)} onChange={() => toggleCategory(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        {error && <div className="md:col-span-2 text-sm text-red-400">{error}</div>}
        <div className="md:col-span-2 flex justify-end">
          <button disabled={busy} onClick={create} className="btn btn-primary disabled:opacity-50">
            {busy ? "Posting…" : "Post prediction"}
          </button>
        </div>
      </div>
    </div>
  );
}
