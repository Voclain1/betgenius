"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DuplicatePublishReview, type DuplicateChoice } from "@/components/admin/DuplicatePublishReview";
import type { DuplicateReview } from "@/lib/duplicatePublication";
import type { QueueItem } from "@/lib/reviewQueue";

type Queue = { ready: QueueItem[]; attention: QueueItem[]; updatesAwaitingDecision: number };
type BulkResult = { failed: { id: string; error?: string }[]; needsReview: DuplicateReview[]; reviews: DuplicateReview[]; clean: string[]; missing: string[]; updated: number; overridden: number };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT" : "No kickoff";

async function bulk(action: "PUBLISH" | "ARCHIVE", ids: string[], extra: Record<string, unknown> = {}): Promise<BulkResult> {
  const merged: BulkResult = { failed: [], needsReview: [], reviews: [], clean: [], missing: [], updated: 0, overridden: 0 };
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch("/api/admin/predictions/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(i, i + 100), action, ...extra }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(typeof r.error === "string" ? r.error : r.error?.formErrors?.join(" ") || `${action.toLowerCase()} failed`);
    merged.failed.push(...(r.failed ?? [])); merged.needsReview.push(...(r.needsReview ?? [])); merged.reviews.push(...(r.reviews ?? []));
    merged.clean.push(...(r.clean ?? [])); merged.missing.push(...(r.missing ?? [])); merged.updated += r.updated ?? 0; merged.overridden += r.overridden ?? 0;
  }
  return merged;
}

function Row({ item, ready, busy, working, onPublish, onArchive, onRewrite, onRepick }: {
  item: QueueItem; ready: boolean; busy: boolean; working: string | null;
  onPublish: () => void; onArchive: () => void; onRewrite: () => void; onRepick: () => void;
}) {
  const mine = working?.startsWith(item.id) ? working.slice(item.id.length + 1) : null;
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{item.fixture}</p>
          <p className="text-xs text-gray-400">{when(item.kickoff)}{item.league ? ` · ${item.league}` : ""}</p>
        </div>
        <p className="text-sm tabular-nums text-gray-300">{item.confidence}%</p>
      </div>
      <p className="text-sm"><span className="text-gray-400">{item.market}:</span> <b className="text-brand">{item.pick}</b></p>
      <p className={`text-sm ${item.price.status === "TOO_SHORT" || item.price.status === "NO_PRICE" ? "text-red-300" : "text-gray-300"}`}>Price: {item.price.label}</p>
      {item.problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-300">{item.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {item.betterOptions.length > 0 && (
        <p className="text-sm text-gray-300"><span className="text-gray-400">Better priced markets on file:</span> {item.betterOptions.join(" · ")}</p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-400">Read the preview and reasoning</summary>
        {item.matchPreview && <p className="mt-2 whitespace-pre-line text-gray-400">{item.matchPreview}</p>}
        <p className="mt-2 whitespace-pre-line text-gray-200">{item.reasoning}</p>
      </details>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {ready && <button className="btn btn-primary text-sm" disabled={busy} onClick={onPublish}>Approve &amp; publish</button>}
        <button className={`btn text-sm ${ready ? "btn-ghost" : "btn-primary"}`} disabled={busy} onClick={onRepick}>{mine === "repick" ? "Finding a better pick…" : "Find better pick"}</button>
        <button className="btn btn-ghost text-sm" disabled={busy} onClick={onRewrite}>{mine === "rewrite" ? "Rewriting…" : "Rewrite text"}</button>
        <Link href={`/admin/predictions/${item.id}`} className="btn btn-ghost text-sm">Edit by hand</Link>
        <button className="btn btn-ghost text-sm" disabled={busy} onClick={onArchive}>Archive</button>
      </div>
    </li>
  );
}

export default function ReviewQueuePage() {
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [dup, setDup] = useState<{ reviews: DuplicateReview[]; clean: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/review");
      if (!res.ok) throw new Error("Could not load the review queue");
      setQ(await res.json()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const summarize = (r: BulkResult, skipped = 0) => {
    const parts = [`${r.updated} published`];
    if (skipped) parts.push(`${skipped} skipped after duplicate review`);
    if (r.needsReview.length) parts.push(`${r.needsReview.length} held: a duplicate appeared while publishing`);
    if (r.failed.length) parts.push(`${r.failed.length} not published (${r.failed[0].error ?? "see queue"})`);
    return parts.join(" · ");
  };

  async function publish(ids: string[]) {
    if (!ids.length) return;
    setBusy(true); setNotice("");
    try {
      const preview = await bulk("PUBLISH", ids, { dryRun: true });
      if (preview.missing.length) throw new Error(`${preview.missing.length} pick(s) were not found`);
      if (preview.reviews.length) { setDup({ reviews: preview.reviews, clean: preview.clean }); return; }
      setNotice(summarize(await bulk("PUBLISH", ids)));
    } catch (e) { setNotice(e instanceof Error ? e.message : "publish failed"); }
    finally { setBusy(false); await load(); }
  }

  async function confirmDuplicates(choices: Record<string, DuplicateChoice>) {
    if (!dup) return;
    setBusy(true);
    try {
      const additional = Object.fromEntries(dup.reviews.filter((r) => choices[r.predictionId]?.publish)
        .map((r) => [r.predictionId, { choice: "PUBLISH_ADDITIONAL" as const, reason: choices[r.predictionId].reason.trim() }]));
      const ids = [...dup.clean, ...Object.keys(additional)];
      const skipped = dup.reviews.length - Object.keys(additional).length;
      setNotice(ids.length ? summarize(await bulk("PUBLISH", ids, { duplicateDecisions: additional }), skipped) : `Nothing published; ${skipped} skipped after duplicate review`);
      setDup(null);
    } catch (e) { setNotice(e instanceof Error ? e.message : "publish failed"); }
    finally { setBusy(false); await load(); }
  }

  /** One click: a fresh preview and reasoning ("rewrite") or a different, better-priced market ("repick"). */
  async function redo(id: string, mode: "rewrite" | "repick") {
    setBusy(true); setWorking(`${id}:${mode}`); setNotice("");
    try {
      const res = await fetch(`/api/admin/predictions/${id}/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof r.error === "string" ? r.error : "That did not work. Try again shortly.");
      setNotice(mode === "rewrite" ? "Rewritten. Read it, then approve." : r.priceCleared === false
        ? "No better-priced market was supported by the evidence, so the strongest option is shown and still needs attention. Edit it by hand or archive it."
        : `New pick: ${r.prediction?.pick ?? ""}. Read it, then approve.`);
    } catch (e) { setNotice(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); setWorking(null); await load(); }
  }

  async function archive(id: string) {
    setBusy(true); setNotice("");
    try {
      const r = await bulk("ARCHIVE", [id]);
      setNotice(r.failed.length ? (r.failed[0].error ?? "archive failed") : "Archived.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "archive failed"); }
    finally { setBusy(false); await load(); }
  }

  const ready = q?.ready ?? [];
  const attention = q?.attention ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Review queue</h1>
        <p className="max-w-2xl text-sm text-gray-400">
          Every pick waiting for a decision, in kickoff order. Read a pick, then approve it in one tap. If you do not like it, or its price is too short, tap Find better pick for a new market with fresh preview and reasoning, or Rewrite text to keep the pick and reword it.
        </p>
        {q && <p className="text-sm text-gray-300">{ready.length} ready · {attention.length} need attention</p>}
      </header>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-brand-border bg-brand-card px-3 py-2 text-sm text-gray-200">{notice}</p>}
      {dup && <DuplicatePublishReview reviews={dup.reviews} unaffected={dup.clean.length} busy={busy} onConfirm={confirmDuplicates} onCancel={() => { setDup(null); setNotice("Nothing was published."); }} />}

      {q && q.updatesAwaitingDecision > 0 && (
        <Link href="/admin/updates" className="card flex items-center justify-between gap-3 hover:bg-white/5">
          <span className="text-sm font-semibold text-amber-300">{q.updatesAwaitingDecision} published pick{q.updatesAwaitingDecision === 1 ? "" : "s"} need a keep-or-withdraw decision</span>
          <span className="text-sm text-gray-300">Decide →</span>
        </Link>
      )}

      {!q && !error && <p className="text-sm text-gray-400">Loading…</p>}

      {q && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Ready to publish</h2>
            {ready.length > 0 && <button className="btn btn-primary text-sm" disabled={busy} onClick={() => publish(ready.map((i) => i.id))}>Approve &amp; publish all {ready.length}</button>}
          </div>
          <ul className="space-y-3">
            {ready.map((i) => <Row key={i.id} item={i} ready busy={busy} working={working} onPublish={() => publish([i.id])} onArchive={() => archive(i.id)} onRewrite={() => redo(i.id, "rewrite")} onRepick={() => redo(i.id, "repick")} />)}
          </ul>
          {ready.length === 0 && <p className="text-sm text-gray-400">Nothing is ready right now.</p>}
        </section>
      )}

      {q && attention.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Needs attention</h2>
          <ul className="space-y-3">
            {attention.map((i) => <Row key={i.id} item={i} ready={false} busy={busy} working={working} onPublish={() => undefined} onArchive={() => archive(i.id)} onRewrite={() => redo(i.id, "rewrite")} onRepick={() => redo(i.id, "repick")} />)}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500">
        Need the full list, filters or settlement? <Link href="/admin/predictions" className="underline">All predictions</Link>
      </p>
    </div>
  );
}
