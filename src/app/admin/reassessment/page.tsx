"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Dashboard = {
  now: string; fixtures: number; queuedGeneration: number; awaitingPublication: number;
  reviewRequired: number; recentlyWithdrawn: number; monitoringDue: number;
  flagged: Array<{ id: string; fixture: string; kickoff: string; pick: string; confidence: number;
    reason: string | null; checkedAt: string | null; proposedMarket: string | null;
    proposedConfidence: number | null; predictionStatus: string; provenance: string }>;
};

function ReviewActions({ id, allowReplacement, onResolved }: { id: string; allowReplacement: boolean; onResolved: () => void }) {
  const [action, setAction] = useState<"KEEP" | "WITHDRAW" | "REPLACE">("KEEP");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rewrite, setRewrite] = useState<{
    revisionId: string;
    draft: { reasoning: string; matchPreview: string; confidence: number;
      marketType: string; sameSelection: boolean };
  } | null>(null);
  async function rewriteAction(kind: "GENERATE" | "APPLY") {
    if (note.trim().length < 10) { setError("Enter review direction of at least 10 characters."); return; }
    if (kind === "APPLY" && (!rewrite?.draft.sameSelection ||
      !window.confirm("Publish the new reasoning and preview to this existing prediction? The original selection and confidence will remain unchanged."))) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/reassessment/rewrite", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ predictionId: id, action: kind, note,
          ...(kind === "APPLY" ? { revisionId: rewrite?.revisionId } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string"
        ? payload.error : "Rewrite request failed.");
      if (kind === "GENERATE") setRewrite({ revisionId: payload.revisionId, draft: payload.draft });
      else { setRewrite(null); onResolved(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (note.trim().length < 10) { setError("Please include a reason of at least 10 characters."); return; }
    if (action !== "KEEP" && !window.confirm("Remove the original public selection? This is an explicit administrator action and will be recorded.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/reassessment/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ predictionId: id, action, note }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === "string" ? payload.error : "Review decision failed.");
      }
      onResolved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 border-t border-brand-border pt-4">
      <label className="block text-xs font-semibold text-gray-400">Decision
        <select value={action} onChange={e => setAction(e.target.value as "KEEP" | "WITHDRAW" | "REPLACE")}
          className="mt-1 block w-full rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200">
          <option value="KEEP">Retain original after review</option>
          <option value="WITHDRAW">Withdraw original selection</option>
          {allowReplacement && <option value="REPLACE">Approve replacement and archive original</option>}
        </select>
      </label>
      <label className="block text-xs font-semibold text-gray-400">Reason
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="What changed and why is this decision justified?"
          className="mt-1 block w-full rounded-lg border border-brand-border bg-brand-card p-2 text-sm text-gray-200" />
      </label>
      <div className="rounded-xl border border-brand-border p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-200">Request a private rewrite</p>
          <p className="text-xs text-gray-400">The model uses saved evidence, not new football API calls. It cannot publish or remove anything. Review the draft before approving an explanation-only update.</p>
        </div>
        <button type="button" disabled={busy || note.trim().length < 10}
          onClick={() => void rewriteAction("GENERATE")}
          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-brand-card disabled:opacity-50">
          {busy ? "Working…" : "Generate rewrite draft"}
        </button>
        {rewrite && (
          <div className="space-y-2 rounded-lg bg-brand-card p-3">
            <p className="text-xs font-semibold text-gray-300">Private draft · {rewrite.draft.confidence}% proposed confidence · {rewrite.draft.marketType}</p>
            <p className="whitespace-pre-wrap text-sm text-gray-300">{rewrite.draft.matchPreview}</p>
            <p className="whitespace-pre-wrap text-sm text-gray-300">{rewrite.draft.reasoning}</p>
            {!rewrite.draft.sameSelection ? (
              <p className="text-xs text-amber-300">This draft proposes a different market or selection. It cannot overwrite the original. Consider a separately approved replacement under the existing qualification gates.</p>
            ) : (
              <button type="button" disabled={busy}
                onClick={() => void rewriteAction("APPLY")}
                className="rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-brand-card disabled:opacity-50">
                Approve revised explanation
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" disabled={busy || note.trim().length < 10}
        onClick={() => void submit()}
        className="rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-brand-card disabled:opacity-50">
        {busy ? "Saving decision…" : "Record review decision"}
      </button>
    </div>
  );
}

export default function ReassessmentDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const refresh = () => fetch("/api/admin/reassessment/health", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("Could not load prediction health."); return r.json(); })
    .then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void refresh(); }, []);

  return (
    <main className="space-y-7">
      <div className="space-y-2">
        <Link href="/admin/jobs" className="text-xs text-gray-400 hover:text-white">← Scheduled jobs</Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prediction health</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-gray-400">
          Upcoming fixture capture, early publication readiness and evidence-driven review.
          All new evidence and rewrite proposals are private. Published predictions remain unchanged and public until an administrator explicitly decides otherwise.
        </p>
      </div>
      {error && <p className="text-red-400">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-400">Loading current monitoring state…</p>}
      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Upcoming fixtures (14d)", count: data.fixtures },
              { title: "Queued for generation", count: data.queuedGeneration },
              { title: "Awaiting publication review", count: data.awaitingPublication },
              { title: "Require reassessment", count: data.reviewRequired },
              { title: "Monitoring checks due", count: data.monitoringDue },
              { title: "Withdrawn in 7d", count: data.recentlyWithdrawn },
            ].map(item => (
              <div key={item.title} className="rounded-2xl border border-brand-border p-5">
                <div className="text-3xl font-semibold">{item.count}</div>
                <div className="mt-2 text-sm text-gray-400">{item.title}</div>
              </div>
            ))}
          </section>
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Predictions requiring attention</h2>
              <p className="mt-1 text-sm text-gray-400">
                Review the evidence, retain the original, request a private rewrite, or explicitly remove a prediction. Monitoring never changes what visitors see.
              </p>
            </div>
            {!data.flagged.length && <p className="text-sm text-gray-400">No open reassessment cases.</p>}
            {data.flagged.map(p => (
              <article key={p.id} className="space-y-3 rounded-2xl border border-brand-border p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{p.fixture}</h3>
                  <span className="text-xs text-gray-400">{new Date(p.kickoff).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} WAT</span>
                </div>
                <p className="text-sm text-gray-300">
                  Published: {p.pick} ({p.confidence}%)
                  {p.proposedConfidence != null ? " · Proposed reassessment: " + p.proposedConfidence + "%" : ""}
                </p>
                <p className="text-sm leading-relaxed text-gray-400">{p.reason ?? "Evidence requires review."}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <Link className="font-medium underline" href={"/admin/predictions/" + p.id}>Review prediction</Link>
                  <Link className="text-gray-400 underline" href={"/predictions/updates/" + p.id}>Internal review history</Link>
                </div>
                <ReviewActions id={p.id} allowReplacement={p.proposedConfidence != null && p.proposedConfidence >= 80}
                  onResolved={() => void refresh()} />
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
