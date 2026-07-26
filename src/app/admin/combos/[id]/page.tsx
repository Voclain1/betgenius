"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { TipsPicker, type TipCategory, type TipOption } from "@/components/TipsPicker";

type Leg = { legId: string; matchLabel: string; market: string; pick: string; odds: number; predictionId: string | null };

type PredictionRow = {
  id: string;
  category: string;
  categories: { category: string }[];
  status: string;
  market: string;
  pick: string;
  odds: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
  fixture?: { homeTeam?: { name: string }; awayTeam?: { name: string } } | null;
};

export default function EditCombo({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [form, setForm] = useState<{ title: string; description: string; category: string; published: boolean } | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [draft, setDraft] = useState({ matchLabel: "", market: "1X2", pick: "Home", odds: "1.90" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards against React Strict Mode's dev-only double effect invocation:
  // if a stale in-flight load() resolves after a newer one (or after the
  // admin has already started adding legs), it must not clobber state with
  // the older response. Only the most recently *started* call is allowed
  // to apply its result, regardless of resolve order.
  const loadSeq = useRef(0);

  const load = async () => {
    const seq = ++loadSeq.current;
    const [comboRes, predictionsRes] = await Promise.all([
      fetch(`/api/admin/combos/${params.id}`).then((r) => r.json()),
      fetch("/api/admin/predictions").then((r) => r.json()),
    ]);
    if (loadSeq.current !== seq) return;
    if (comboRes.error) { setError(typeof comboRes.error === "string" ? comboRes.error : "Failed to load combo"); setLoading(false); return; }
    const combo = comboRes.combo;
    setForm({ title: combo.title, description: combo.description ?? "", category: combo.category, published: combo.published });
    setLegs(
      combo.legs.map((l: any) => ({
        legId: l.id,
        matchLabel: l.matchLabel,
        market: l.market,
        pick: l.pick,
        odds: l.odds,
        predictionId: l.predictionId,
      })),
    );
    setPredictions(predictionsRes.items ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [params.id]);

  // Admin sees every category unlocked — this is the exact "from our tips"
  // picker used on /bet-builder, fed from real published predictions instead
  // of the manual-entry-only form.
  const tipCategories: TipCategory[] = useMemo(() => {
    return PREDICTION_CATEGORIES.map((cat) => {
      const options: TipOption[] = predictions
        .filter((p) => p.status === "PUBLISHED" && p.odds != null)
        .filter((p) => (p.categories?.length ? p.categories.some((c) => c.category === cat) : p.category === cat))
        .map((p) => {
          const home = p.homeTeam ?? p.fixture?.homeTeam?.name;
          const away = p.awayTeam ?? p.fixture?.awayTeam?.name;
          return {
            id: p.id,
            label: home && away ? `${home} vs ${away}` : "Match TBD",
            market: p.market,
            pick: p.pick,
            odds: p.odds as number,
          };
        });
      return { key: cat, label: cat, locked: false, options };
    });
  }, [predictions]);

  const addedPredictionIds = useMemo(
    () => new Set(legs.filter((l) => l.predictionId).map((l) => l.predictionId as string)),
    [legs],
  );

  const addFromTip = (opt: TipOption) => {
    if (addedPredictionIds.has(opt.id)) return;
    // Functional update — two "Add" clicks in quick succession (fast
    // clicking, or a picker + manual add close together) must not both
    // read the same stale `legs` and have the second silently drop the first.
    setLegs((prev) => [...prev, { legId: crypto.randomUUID(), matchLabel: opt.label, market: opt.market, pick: opt.pick, odds: opt.odds, predictionId: opt.id }]);
  };

  const addManual = () => {
    if (!draft.matchLabel || !draft.odds) return;
    setLegs((prev) => [...prev, { legId: crypto.randomUUID(), matchLabel: draft.matchLabel, market: draft.market, pick: draft.pick, odds: Number(draft.odds), predictionId: null }]);
    setDraft({ ...draft, matchLabel: "" });
  };

  const move = (index: number, dir: -1 | 1) => {
    setLegs((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const combinedOdds = legs.reduce((a, l) => a * l.odds, 1);

  const save = async () => {
    if (!form) return;
    if (!form.title) { setError("Title is required."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/combos/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          category: form.category,
          published: form.published,
          legs: legs.map((l) => ({ matchLabel: l.matchLabel, market: l.market, pick: l.pick, odds: l.odds, predictionId: l.predictionId })),
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

  const remove = async () => {
    if (!confirm("Delete this combo? This cannot be undone.")) return;
    await fetch(`/api/admin/combos/${params.id}`, { method: "DELETE" });
    router.push("/admin/combos");
  };

  if (loading) return <div className="text-gray-400">Loading…</div>;
  if (error && !form) return <div className="card text-red-400">{error}</div>;
  if (!form) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/combos" className="text-sm text-gray-400 hover:underline">← Back to combos</Link>
          <h1 className="mt-1 text-2xl font-bold">{form.title || "Edit combo"}</h1>
        </div>
        <span className={`chip ${form.published ? "bg-emerald-500/10 text-emerald-300" : "bg-gray-500/10 text-gray-300"}`}>
          {form.published ? "Published" : "Draft"}
        </span>
      </div>

      <div className="card grid gap-3 md:grid-cols-2">
        <label className="text-sm md:col-span-2">Title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-2">Description <span className="text-gray-500">(optional)</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2" />
        </label>
        <label className="text-sm">Category
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="mt-1 w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            {PREDICTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          Published
        </label>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Legs</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input value={draft.matchLabel} onChange={(e) => setDraft({ ...draft, matchLabel: e.target.value })}
            placeholder="Arsenal vs Chelsea"
            className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm" />
          <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}
            className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm">
            {["1X2", "BTTS", "Over 2.5", "Under 2.5", "Double chance", "Correct score"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input value={draft.pick} onChange={(e) => setDraft({ ...draft, pick: e.target.value })}
            placeholder="Pick"
            className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm" />
          <input type="number" step="0.01" min="1.01" value={draft.odds} onChange={(e) => setDraft({ ...draft, odds: e.target.value })}
            className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm" />
          <button onClick={addManual} className="btn btn-primary text-sm">Add</button>
        </div>

        <details className="rounded-lg border border-brand-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-300">Pick from our tips</summary>
          <div className="border-t border-brand-border p-3">
            <TipsPicker categories={tipCategories} addedIds={addedPredictionIds} onAdd={addFromTip} />
          </div>
        </details>

        {legs.length === 0 ? (
          <p className="text-sm text-gray-400">No legs yet — add one manually or from our tips above.</p>
        ) : (
          <ul className="divide-y divide-brand-border rounded-lg border border-brand-border">
            {legs.map((l, i) => (
              <li key={l.legId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i + 1}. {l.matchLabel}</div>
                  <div className="truncate text-gray-400">{l.market} — {l.pick}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-brand">{l.odds.toFixed(2)}</span>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:text-white disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === legs.length - 1} className="rounded p-1 text-gray-400 hover:text-white disabled:opacity-30">
                    <ArrowDown size={14} />
                  </button>
                  <button onClick={() => setLegs((prev) => prev.filter((x) => x.legId !== l.legId))} className="rounded p-1 text-gray-400 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {legs.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Combined odds</span>
            <span className="font-semibold text-brand">{combinedOdds.toFixed(2)}</span>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <button disabled={busy} onClick={save} className="btn btn-primary disabled:opacity-50">
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button className="text-sm text-red-400 hover:underline" onClick={remove}>Delete combo</button>
      </div>
    </div>
  );
}
