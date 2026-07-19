"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { MAJOR_LEAGUES, LEAGUE_TIER_LABELS } from "@/lib/leagues";
import { MarketSelectionFields, emptyMarketFormState, type MarketFormState } from "@/components/MarketSelectionFields";
import { isValidSelection, type MarketType } from "@/lib/markets";

const CATS = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"] as const;

const LEAGUE_TIERS = Array.from(new Set(MAJOR_LEAGUES.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: MAJOR_LEAGUES.filter((l) => l.tier === tier),
}));

type Prediction = {
  id: string;
  status: string;
  market: string;
  pick: string;
  marketType: MarketType;
  selection: unknown;
  overUnder: string | null;
  ouLine: number | null;
  ouDirection: string | null;
  odds: number | null;
  confidence: number;
  reasoning: string;
  matchPreview: string | null;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  kickoff: string | null;
  contextComplete: boolean;
  categories: { category: string }[];
  fixture?: { homeTeam?: { name: string }; awayTeam?: { name: string }; league?: { name: string }; kickoff?: string } | null;
};

export default function EditPrediction({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [p, setP] = useState<Prediction | null>(null);
  const [form, setForm] = useState<{
    odds: string; confidence: number; reasoning: string; matchPreview: string; categories: string[];
    leagueApiId: number | undefined; leagueName: string;
    homeTeam: string; awayTeam: string; kickoff: string;
  } | null>(null);
  const [market, setMarket] = useState<MarketFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const j = await fetch(`/api/admin/predictions/${params.id}`).then((r) => r.json());
    if (j.error) { setError(j.error); return; }
    const pred = j.prediction;
    setP(pred);
    setForm({
      odds: pred.odds?.toString() ?? "",
      confidence: pred.confidence,
      reasoning: pred.reasoning,
      matchPreview: pred.matchPreview ?? "",
      categories: pred.categories.map((c: any) => c.category),
      leagueApiId: pred.leagueApiId ?? undefined,
      leagueName: pred.leagueName ?? "",
      homeTeam: pred.homeTeam ?? "",
      awayTeam: pred.awayTeam ?? "",
      kickoff: pred.kickoff ? new Date(pred.kickoff).toISOString().slice(0, 16) : "",
    });
    setMarket({
      marketType: pred.marketType ?? "OTHER",
      selection: pred.marketType && pred.marketType !== "OTHER" ? pred.selection : null,
      otherMarket: pred.marketType === "OTHER" ? pred.market : "",
      otherPick: pred.marketType === "OTHER" ? pred.pick : "",
      ouLine: pred.ouLine?.toString() ?? "",
      ouDirection: (pred.ouDirection as "OVER" | "UNDER") ?? "OVER",
    });
  };
  useEffect(() => { load(); }, [params.id]);

  const toggleCategory = (c: string) => {
    if (!form) return;
    setForm({
      ...form,
      categories: form.categories.includes(c) ? form.categories.filter((x) => x !== c) : [...form.categories, c],
    });
  };

  const save = async () => {
    if (!form || !market || form.categories.length === 0) { setError("Select at least one category."); return; }
    if (market.marketType === "OTHER") {
      if (!market.otherMarket || !market.otherPick) { setError("Market and pick are required."); return; }
    } else if (!isValidSelection(market.marketType, market.selection)) {
      setError("Finish the selection for the chosen market type.");
      return;
    }
    if (!market.ouLine) { setError("Over/Under line is required."); return; }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/predictions/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EDIT",
          patch: {
            odds: form.odds ? Number(form.odds) : undefined,
            confidence: form.confidence,
            reasoning: form.reasoning,
            matchPreview: form.matchPreview,
            categories: form.categories,
            leagueApiId: form.leagueApiId ?? null,
            leagueName: form.leagueName || null,
            homeTeam: form.homeTeam || null,
            awayTeam: form.awayTeam || null,
            kickoff: form.kickoff ? new Date(form.kickoff).toISOString() : null,
            marketType: market.marketType,
            selection: market.marketType === "OTHER" ? undefined : market.selection,
            otherMarket: market.marketType === "OTHER" ? market.otherMarket : undefined,
            otherPick: market.marketType === "OTHER" ? market.otherPick : undefined,
            ouLine: Number(market.ouLine),
            ouDirection: market.ouDirection,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Save failed");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: "APPROVE" | "PUBLISH" | "ARCHIVE") => {
    await fetch(`/api/admin/predictions/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  };

  const remove = async () => {
    if (!confirm("Delete this prediction? This cannot be undone.")) return;
    await fetch(`/api/admin/predictions/${params.id}`, { method: "DELETE" });
    router.push("/admin/predictions");
  };

  if (error && !p) return <div className="card text-red-400">{error}</div>;
  if (!p || !form || !market) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/predictions" className="text-sm text-gray-400 hover:underline">← Back to predictions</Link>
          <h1 className="mt-1 text-2xl font-bold">
            {p.homeTeam ? `${p.homeTeam} vs ${p.awayTeam}` : p.fixture?.homeTeam?.name ? `${p.fixture.homeTeam.name} vs ${p.fixture.awayTeam?.name}` : "Edit prediction"}
          </h1>
          {(p.leagueName ?? p.fixture?.league?.name) && <p className="text-sm text-gray-400">{p.leagueName ?? p.fixture?.league?.name}</p>}
        </div>
        <span className="chip bg-brand-border">{p.status}</span>
      </div>

      {!p.contextComplete && (
        <div className="card flex items-start gap-3 border-amber-500/40 bg-amber-500/10">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-200">
            <b>Generated with no live data.</b> Every football-data lookup (team form, injuries, standings, head-to-head)
            came back empty for this fixture — the AI reasoned from team names alone. Double-check the pick and reasoning
            before approving, and consider verifying the football-data API is actually returning data (plan/season coverage,
            rate limit) before generating more like it.
          </div>
        </div>
      )}

      {market.marketType === "OTHER" && (
        <div className="card flex items-start gap-3 border-brand-border bg-brand-card/50">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="text-sm text-gray-300">
            <b>Manual settlement only.</b> "Other" market tips are never auto-resolved — you'll need to set the outcome yourself once the match finishes.
          </div>
        </div>
      )}

      <div className="card grid gap-3 md:grid-cols-2">
        <label className="text-sm">Home team
          <input value={form.homeTeam} onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Away team
          <input value={form.awayTeam} onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Kickoff
          <input type="datetime-local" value={form.kickoff} onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>

        <MarketSelectionFields value={market} onChange={setMarket} homeTeam={form.homeTeam} awayTeam={form.awayTeam} />

        <label className="text-sm">Odds
          <input type="number" step="0.01" value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Confidence %
          <input type="number" min={0} max={100} value={form.confidence}
            onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">League
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
        <label className="text-sm md:col-span-2">Reasoning
          <textarea rows={4} value={form.reasoning} onChange={(e) => setForm({ ...form, reasoning: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Match preview
          <textarea rows={4} value={form.matchPreview} onChange={(e) => setForm({ ...form, matchPreview: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <div className="md:col-span-2">
          <div className="mb-1 text-sm">Categories <span className="text-gray-500">(show this tip in multiple feeds at once)</span></div>
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
        <div className="md:col-span-2 flex justify-end gap-2">
          <button disabled={busy} onClick={save} className="btn btn-primary disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button className="btn btn-ghost text-sm" onClick={() => act("APPROVE")}>Approve</button>
          <button className="btn btn-primary text-sm" onClick={() => act("PUBLISH")}>Publish</button>
          <button className="btn btn-ghost text-sm" onClick={() => act("ARCHIVE")}>Archive</button>
        </div>
        <button className="text-sm text-red-400 hover:underline" onClick={remove}>Delete prediction</button>
      </div>
    </div>
  );
}
