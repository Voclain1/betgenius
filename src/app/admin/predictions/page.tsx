"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LeagueBadge } from "@/components/LeagueBadge";

const CATEGORY_VALUES = ["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM"] as const;

type Row = {
  id: string;
  category: string;
  categories: { category: string }[];
  status: string;
  market: string;
  pick: string;
  overUnder: string | null;
  confidence: number;
  reasoning: string;
  createdAt: string;
  kickoff: string | null;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  contextComplete: boolean;
  manualSettlementOnly: boolean;
  outcome: string;
  settlementNote: string | null;
  fixture?: { homeTeam?: { name: string }; awayTeam?: { name: string } };
};

const OUTCOME_STYLES: Record<string, string> = {
  WON: "bg-emerald-500/20 text-emerald-300",
  LOST: "bg-red-500/20 text-red-300",
  VOID: "bg-gray-500/20 text-gray-300",
};

/**
 * Ordering options for the review queue.
 *
 * "Kickoff soonest" is the default and the one that matters: nothing
 * auto-publishes, so a candidate that reaches kickoff unreviewed is wasted
 * work, and the nearest kickoff is always the most perishable decision.
 */
const SORTS = {
  KICKOFF: "Kickoff soonest",
  CONFIDENCE: "Confidence high to low",
  CREATED: "Newest first",
} as const;
type SortKey = keyof typeof SORTS;

/** Inside this many hours, a still-unreviewed candidate is flagged as about to be wasted. */
const EXPIRY_WARNING_HOURS = 12;

export default function AdminPredictions() {
  const [rows, setRows] = useState<Row[]>([]);
  // Defaults to the review queue rather than ALL: at generation volume this
  // page is a work list first and an archive second.
  const [filter, setFilter] = useState<string>("PENDING_REVIEW");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [leagueFilter, setLeagueFilter] = useState<string>("ALL");
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [sort, setSort] = useState<SortKey>("KICKOFF");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoriesToAdd, setCategoriesToAdd] = useState<Set<string>>(new Set());
  const [categoriesToRemove, setCategoriesToRemove] = useState<Set<string>>(new Set());

  const load = async () => {
    const j = await fetch("/api/admin/predictions").then((r) => r.json());
    setRows(j.items);
    // Selections refer to rows that may have just changed status — clearing
    // avoids acting twice on something already actioned.
    setSelected(new Set());
  };
  useEffect(() => { load(); }, []);

  const act = async (id: string, action: "APPROVE" | "PUBLISH" | "ARCHIVE") => {
    await fetch(`/api/admin/predictions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this prediction? This cannot be undone.")) return;
    await fetch(`/api/admin/predictions/${id}`, { method: "DELETE" });
    load();
  };

  const settle = async (id: string, outcome: "WON" | "LOST" | "VOID") => {
    await fetch(`/api/admin/predictions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "SETTLE", patch: { outcome } }),
    });
    load();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (action: "APPROVE" | "PUBLISH" | "ARCHIVE") => {
    if (selected.size === 0) return;
    if (!confirm(`${action.toLowerCase()} ${selected.size} prediction(s)?`)) return;
    setBusy(true);
    try {
      const selectedIds = [...selected];
      // The API deliberately caps one database batch at 100 rows. Large review
      // selections are split here rather than rejected wholesale; each reply
      // is checked before the next batch starts, so a partial failure is visible
      // and the page reload shows exactly what changed.
      for (let offset = 0; offset < selectedIds.length; offset += 100) {
        const batch = selectedIds.slice(offset, offset + 100);
        const res = await fetch("/api/admin/predictions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch, action }),
        });
        const result = await res.json();
        if (!res.ok || result.failed?.length || result.missing?.length) {
          const message = result.error?.formErrors?.join(" ")
            || result.failed?.[0]?.error
            || (result.missing?.length ? `${result.missing.length} prediction(s) were not found` : null)
            || `${action.toLowerCase()} failed`;
          throw new Error(message);
        }
      }
      await load();
    } catch (error: any) {
      alert(error?.message ?? `${action.toLowerCase()} failed`);
      // Earlier batches may have completed before a later one failed. Reload
      // rather than leaving stale statuses on screen.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleCategoryChange = (category: string, mode: "add" | "remove") => {
    const own = mode === "add" ? setCategoriesToAdd : setCategoriesToRemove;
    const other = mode === "add" ? setCategoriesToRemove : setCategoriesToAdd;
    own((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
    other((prev) => { const next = new Set(prev); next.delete(category); return next; });
  };

  const manageCategories = async () => {
    if (selected.size === 0 || (categoriesToAdd.size === 0 && categoriesToRemove.size === 0)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/predictions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action: "MANAGE_CATEGORIES", add: [...categoriesToAdd], remove: [...categoriesToRemove] }),
      });
      const result = await res.json();
      if (!res.ok || result.failed?.length) throw new Error(result.error?.formErrors?.join(" ") || result.failed?.[0]?.error || "Category update failed");
      setCategoriesToAdd(new Set());
      setCategoriesToRemove(new Set());
      setShowCategoryManager(false);
      await load();
    } catch (error: any) {
      alert(error?.message ?? "Category update failed");
    } finally {
      setBusy(false);
    }
  };

  const leagues = [...new Set(rows.map((r) => r.leagueName).filter((l): l is string => !!l))].sort();

  const shown = rows
    .filter((r) => filter === "ALL" || r.status === filter)
    .filter(
      (r) =>
        categoryFilter === "ALL" ||
        (r.categories?.length ? r.categories.some((c) => c.category === categoryFilter) : r.category === categoryFilter),
    )
    .filter((r) => leagueFilter === "ALL" || r.leagueName === leagueFilter)
    .filter((r) => r.confidence >= minConfidence)
    .sort((a, b) => {
      if (sort === "CONFIDENCE") return b.confidence - a.confidence;
      if (sort === "CREATED") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      // Unknown kickoffs sort last rather than to the top, where they would
      // crowd out the rows that actually need a decision.
      const ak = a.kickoff ? new Date(a.kickoff).getTime() : Infinity;
      const bk = b.kickoff ? new Date(b.kickoff).getTime() : Infinity;
      return ak - bk;
    });

  const pendingCount = rows.filter((r) => r.status === "PENDING_REVIEW").length;
  const expiringSoon = rows.filter(
    (r) =>
      r.status === "PENDING_REVIEW" &&
      r.kickoff &&
      new Date(r.kickoff).getTime() - Date.now() < EXPIRY_WARNING_HOURS * 3600_000,
  ).length;
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Predictions</h1>
          <p className="text-sm text-gray-400">
            {pendingCount} awaiting review
            {expiringSoon > 0 && <span className="text-amber-400"> · {expiringSoon} kick off within {EXPIRY_WARNING_HOURS}h</span>}
          </p>
        </div>
        <Link href="/admin/predictions/new" className="btn btn-primary text-sm">Post prediction</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm">
          {["ALL", "DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm">
          {["ALL", "FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM", "BET_OF_THE_DAY"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm">
          <option>ALL</option>
          {leagues.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm">
          {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          Min confidence
          <input type="number" min={0} max={100} value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value) || 0)}
            className="w-16 rounded-md border border-brand-border bg-brand-card px-2 py-2 text-sm" />
        </label>
      </div>

      {/* Bulk bar appears only once rows are selected, so the reviewer opts into
          acting on many at once rather than having the option sit there. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-brand/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button disabled={busy} className="btn btn-ghost text-xs" onClick={() => bulk("APPROVE")}>Approve</button>
          <button disabled={busy} className="btn btn-primary text-xs" onClick={() => bulk("PUBLISH")}>Publish</button>
          <button disabled={busy} className="btn btn-ghost text-xs" onClick={() => bulk("ARCHIVE")}>Archive</button>
          <button disabled={busy} className="btn btn-ghost text-xs" onClick={() => setShowCategoryManager((v) => !v)}>Manage categories</button>
          <button className="text-xs text-gray-400 hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
          {showCategoryManager && (
            <div className="basis-full space-y-2 border-t border-brand-border pt-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-emerald-300">Add</div>
                  <div className="flex flex-wrap gap-2">{CATEGORY_VALUES.map((c) => <label key={`add-${c}`} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={categoriesToAdd.has(c)} onChange={() => toggleCategoryChange(c, "add")} />{c}</label>)}</div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-red-300">Remove</div>
                  <div className="flex flex-wrap gap-2">{CATEGORY_VALUES.map((c) => <label key={`remove-${c}`} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={categoriesToRemove.has(c)} onChange={() => toggleCategoryChange(c, "remove")} />{c}</label>)}</div>
                </div>
              </div>
              <button disabled={busy || (categoriesToAdd.size === 0 && categoriesToRemove.size === 0)} className="btn btn-primary text-xs" onClick={manageCategories}>Apply category changes</button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShownSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Kickoff</th>
              <th className="px-3 py-2">League</th>
              <th className="px-3 py-2">Categories</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Pick</th>
              <th className="px-3 py-2">Over/Under</th>
              <th className="px-3 py-2">Conf.</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {shown.map((r) => (
              <tr
                key={r.id}
                className={selected.has(r.id) ? "bg-brand/5" : !r.contextComplete ? "bg-amber-500/5" : undefined}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label="Select prediction" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    {!r.contextComplete && (
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" aria-label="Generated with no live data — verify manually" />
                    )}
                    {r.homeTeam
                      ? `${r.homeTeam} vs ${r.awayTeam}`
                      : r.fixture?.homeTeam?.name
                        ? `${r.fixture.homeTeam.name} vs ${r.fixture.awayTeam?.name}`
                        : "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-400">
                  {r.kickoff
                    ? new Date(r.kickoff).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <LeagueBadge leagueApiId={r.leagueApiId} leagueName={r.leagueName} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(r.categories?.length ? r.categories.map((c) => c.category) : [r.category]).map((c) => (
                      <span key={c} className="chip bg-brand-border text-[10px]">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">{r.market}</td>
                <td className="px-3 py-2 font-semibold text-brand">{r.pick}</td>
                <td className="px-3 py-2 text-gray-400">{r.overUnder ?? "—"}</td>
                <td className="px-3 py-2">{r.confidence}%</td>
                <td className="px-3 py-2"><span className="chip bg-brand-border">{r.status}</span></td>
                <td className="px-3 py-2">
                  {r.outcome !== "PENDING" ? (
                    <span className={`chip ${OUTCOME_STYLES[r.outcome] ?? "bg-brand-border"}`}>{r.outcome}</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {(r.manualSettlementOnly || r.settlementNote) && (
                        <AlertTriangle
                          size={13}
                          className={`shrink-0 ${r.manualSettlementOnly ? "text-purple-400" : "text-amber-400"}`}
                          aria-label={r.settlementNote ?? (r.manualSettlementOnly ? "Manual settlement required (Other market)" : undefined)}
                        />
                      )}
                      <div className="flex gap-1">
                        <button className="chip bg-emerald-500/10 text-[10px] text-emerald-300 hover:bg-emerald-500/20" onClick={() => settle(r.id, "WON")}>Won</button>
                        <button className="chip bg-red-500/10 text-[10px] text-red-300 hover:bg-red-500/20" onClick={() => settle(r.id, "LOST")}>Lost</button>
                        <button className="chip bg-gray-500/10 text-[10px] text-gray-300 hover:bg-gray-500/20" onClick={() => settle(r.id, "VOID")}>Void</button>
                      </div>
                    </div>
                  )}
                </td>
                <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                  <Link href={`/admin/predictions/${r.id}`} className="text-xs text-gray-300 hover:underline">Edit</Link>
                  <button className="text-xs text-blue-400 hover:underline" onClick={() => act(r.id, "APPROVE")}>Approve</button>
                  <button className="text-xs text-brand hover:underline" onClick={() => act(r.id, "PUBLISH")}>Publish</button>
                  <button className="text-xs text-gray-400 hover:underline" onClick={() => act(r.id, "ARCHIVE")}>Archive</button>
                  <button className="text-xs text-red-400 hover:underline" onClick={() => remove(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-gray-400">No predictions match these filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
