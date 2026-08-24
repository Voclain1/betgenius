"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LEAGUE_CATALOGUE, LEAGUE_TIER_LABELS } from "@/lib/leagues";
import { MarketSelectionFields, emptyMarketFormState, type MarketFormState } from "@/components/MarketSelectionFields";
import { isValidSelection, type MarketType } from "@/lib/markets";
import { RewriteRequest } from "@/components/RewriteRequest";

const CATS = ["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"] as const;

type ArchivedDraft = {
  matchPreview: string | null;
  reasoning: string;
  market: string;
  pick: string;
  confidence: number;
  replacedAt: string;
  reviewerNote: string | null;
};

const LEAGUE_TIERS = Array.from(new Set(LEAGUE_CATALOGUE.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: LEAGUE_CATALOGUE.filter((l) => l.tier === tier),
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
  confidence: number;
  reasoning: string;
  matchPreview: string | null;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  kickoff: string | null;
  contextComplete: boolean;
  manualSettlementOnly: boolean;
  outcome: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  settledAt: string | null;
  settledBy: { name: string | null; email: string } | null;
  settlementNote: string | null;
  rewriteCount: number;
  rewriteRequestedAt: string | null;
  rewriteRequestedBy: { name: string | null; email: string } | null;
  previousDrafts: ArchivedDraft[] | null;
  categories: { category: string }[];
  fixture?: { homeTeam?: { name: string }; awayTeam?: { name: string }; league?: { name: string }; kickoff?: string } | null;
};

const OUTCOME_STYLES: Record<string, string> = {
  PENDING: "bg-brand-border text-gray-300",
  WON: "bg-emerald-500/20 text-emerald-300",
  LOST: "bg-red-500/20 text-red-300",
  VOID: "bg-gray-500/20 text-gray-300",
};

export default function EditPrediction({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [p, setP] = useState<Prediction | null>(null);
  const [form, setForm] = useState<{
    confidence: number; reasoning: string; matchPreview: string; categories: string[];
    leagueApiId: number | undefined; leagueName: string;
    homeTeam: string; awayTeam: string; kickoff: string;
  } | null>(null);
  const [market, setMarket] = useState<MarketFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settleForm, setSettleForm] = useState({ outcome: "PENDING", homeScore: "", awayScore: "" });
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  const load = async () => {
    const j = await fetch(`/api/admin/predictions/${params.id}`).then((r) => r.json());
    if (j.error) { setError(j.error); return; }
    const pred = j.prediction;
    setP(pred);
    setForm({
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
    setSettleForm({
      outcome: pred.outcome ?? "PENDING",
      homeScore: pred.finalHomeScore?.toString() ?? "",
      awayScore: pred.finalAwayScore?.toString() ?? "",
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

  const settle = async () => {
    setSettleBusy(true);
    setSettleError(null);
    try {
      const res = await fetch(`/api/admin/predictions/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SETTLE",
          patch: {
            outcome: settleForm.outcome,
            finalHomeScore: settleForm.homeScore !== "" ? Number(settleForm.homeScore) : null,
            finalAwayScore: settleForm.awayScore !== "" ? Number(settleForm.awayScore) : null,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Failed to set outcome");
      await load();
    } catch (e: any) {
      setSettleError(e.message);
    } finally {
      setSettleBusy(false);
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
            came back empty for this fixture — the analysis used team names alone. Double-check the pick and reasoning
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

        <label className="text-sm">Confidence %
          <input type="number" min={0} max={100} value={form.confidence}
            onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">League
          <select value={form.leagueApiId ?? "Other"}
            onChange={(e) => {
              if (e.target.value === "Other") { setForm({ ...form, leagueApiId: undefined, leagueName: "" }); return; }
              const found = LEAGUE_CATALOGUE.find((l) => l.id === Number(e.target.value));
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

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm uppercase text-gray-400">Result</h3>
          <span className={`chip ${OUTCOME_STYLES[p.outcome] ?? OUTCOME_STYLES.PENDING}`}>{p.outcome}</span>
        </div>

        {p.outcome === "PENDING" && (
          <div className="flex items-start gap-3 rounded-md border border-brand-border bg-brand-bg p-3 text-sm text-gray-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <span>
              {p.manualSettlementOnly
                ? 'Manual settlement required — "Other" market tips are never auto-resolved.'
                : p.settlementNote
                  ? p.settlementNote
                  : "Awaiting auto-settlement — checked daily once kickoff is a few hours past."}
            </span>
          </div>
        )}

        {p.settledAt && (
          <p className="text-xs text-gray-500">
            Settled {new Date(p.settledAt).toLocaleString()} — {p.settledBy ? `manually by ${p.settledBy.name ?? p.settledBy.email}` : "auto"}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">Outcome
            <select value={settleForm.outcome} onChange={(e) => setSettleForm({ ...settleForm, outcome: e.target.value })}
              className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
              {["PENDING", "WON", "LOST", "VOID"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="text-sm">{p.homeTeam ?? "Home"} score
            <input type="number" min={0} step={1} value={settleForm.homeScore}
              onChange={(e) => setSettleForm({ ...settleForm, homeScore: e.target.value })}
              className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          </label>
          <label className="text-sm">{p.awayTeam ?? "Away"} score
            <input type="number" min={0} step={1} value={settleForm.awayScore}
              onChange={(e) => setSettleForm({ ...settleForm, awayScore: e.target.value })}
              className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
          </label>
          <div className="flex items-end">
            <button disabled={settleBusy} onClick={settle} className="btn btn-primary w-full disabled:opacity-50">
              {settleBusy ? "Saving…" : "Save outcome"}
            </button>
          </div>
        </div>
        {settleError && <div className="text-sm text-red-400">{settleError}</div>}
      </div>

      {(p.previousDrafts?.length ?? 0) > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm uppercase text-gray-400">Draft history</h3>
            <span className="chip bg-brand-border">{p.rewriteCount} rewrite{p.rewriteCount === 1 ? "" : "s"}</span>
          </div>
          {p.rewriteRequestedAt && (
            <p className="text-xs text-gray-500">
              Last rewrite {new Date(p.rewriteRequestedAt).toLocaleString()}
              {p.rewriteRequestedBy ? ` — requested by ${p.rewriteRequestedBy.name ?? p.rewriteRequestedBy.email}` : ""}
            </p>
          )}
          <p className="text-xs text-gray-500">Superseded drafts, oldest first. The version above is the current one.</p>
          <ol className="space-y-3">
            {p.previousDrafts!.map((d, i) => (
              <li key={i} className="rounded-md border border-brand-border bg-brand-bg p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <span className="chip bg-brand-border">v{i + 1}</span>
                  <span>{new Date(d.replacedAt).toLocaleString()}</span>
                  <span className="text-gray-500">·</span>
                  <span>{d.market}: <b className="text-gray-300">{d.pick}</b> @ {d.confidence}%</span>
                </div>
                {d.reviewerNote ? (
                  <p className="mt-2 border-l-2 border-brand pl-2 text-xs italic text-gray-300">
                    Direction given: “{d.reviewerNote}”
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-gray-500">Plain regenerate — no direction given.</p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-400">{d.reasoning}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost text-sm" onClick={() => act("APPROVE")}>Approve</button>
          <button className="btn btn-primary text-sm" onClick={() => act("PUBLISH")}>Publish</button>
          <button className="btn btn-ghost text-sm" onClick={() => act("ARCHIVE")}>Archive</button>
        </div>
        <button className="text-sm text-red-400 hover:underline" onClick={remove}>Delete prediction</button>
      </div>

      {p.status === "PENDING_REVIEW" && (
        <div className="card space-y-2">
          <h3 className="text-sm uppercase text-gray-400">Not happy with this draft?</h3>
          <RewriteRequest predictionId={p.id} rewriteCount={p.rewriteCount} onDone={() => load()} />
        </div>
      )}
    </div>
  );
}
