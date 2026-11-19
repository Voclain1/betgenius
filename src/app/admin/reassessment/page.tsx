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

export default function ReassessmentDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/reassessment/health", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("Could not load prediction health."); return r.json(); })
      .then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="space-y-7">
      <div className="space-y-2">
        <Link href="/admin/jobs" className="text-xs text-gray-400 hover:text-white">← Scheduled jobs</Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prediction health</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-gray-400">
          Upcoming fixture capture, early publication readiness and evidence-driven review.
          Material changes remain traceable; a suggestion is not an automatically published replacement.
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
                Confirm updated information before retaining, withdrawing or publishing a replacement.
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
                  <Link className="text-gray-400 underline" href={"/predictions/updates/" + p.id}>View public history</Link>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
