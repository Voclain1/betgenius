"use client";
import { useCallback, useEffect, useState } from "react";

type JobRow = {
  job: string;
  lastRanAt: string | null;
  lastOk: boolean | null;
  lastSummary: string | null;
  lastMs: number | null;
  neverRan: boolean;
  recent: Array<{ id: string; ranAt: string; ok: boolean; summary: string | null; ms: number | null }>;
};

type Pool = {
  horizonHours: number;
  fixtures: number;
  paidTierFixtures: number;
  pendingTotal: number;
  pendingPaidTier: number;
  reservedForPaidTier: number;
  oddsAny: number;
  oddsFresh: number;
  oddsFreshnessLimitHours: number;
  oddsMissing: number;
};

// How long since a job last ran before that is itself the story. These are the
// cadences the recommended schedule uses, plus generous slack — the point is to
// catch "not scheduled at all", not to alert on a single missed tick.
const EXPECTED_WITHIN_MIN: Record<string, number> = {
  "refresh-odds": 60,
  "generate-vip-premium": 60,
  "generate-ordinary": 60,
  "generate-bet-of-the-day": 26 * 60,
  "select-bet-of-the-day": 26 * 60,
  "curate-accumulators": 26 * 60,
  settle: 26 * 60,
};

const LABEL: Record<string, string> = {
  "refresh-odds": "Odds refresh",
  "generate-vip-premium": "VIP / Premium pass",
  "generate-ordinary": "Ordinary generation",
  "generate-bet-of-the-day": "Bet of the Day generation",
  "select-bet-of-the-day": "Bet of the Day selection",
  "curate-accumulators": "Accumulator curation",
  settle: "Settlement",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export default function AdminJobs() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/jobs");
    if (!res.ok) return setErr("Could not load job health.");
    const j = await res.json();
    setJobs(j.jobs ?? []);
    setPool(j.pool ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Scheduled jobs</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-400">
          Production scheduling lives in cron-job.org, which this app cannot see. This page is how a starving pass
          is told apart from one that was never scheduled — both produce nothing, and only one is a code problem.
        </p>
      </div>

      {err && <div className="card text-red-400">{err}</div>}

      <div className="overflow-hidden rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Last run</th>
              <th className="px-3 py-2">What it did</th>
              <th className="px-3 py-2">Took</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {jobs.map((j) => {
              const overdueBy = EXPECTED_WITHIN_MIN[j.job];
              const stale =
                !j.neverRan && j.lastRanAt && overdueBy != null
                  ? (Date.now() - new Date(j.lastRanAt).getTime()) / 60000 > overdueBy
                  : false;
              const tone = j.neverRan
                ? "text-red-300"
                : j.lastOk === false
                  ? "text-red-300"
                  : stale
                    ? "text-amber-300"
                    : "text-emerald-300";
              return (
                <tr key={j.job} className="align-top">
                  <td className="px-3 py-2">
                    <button onClick={() => setOpen(open === j.job ? null : j.job)} className="text-left hover:underline">
                      {LABEL[j.job] ?? j.job}
                    </button>
                    <div className="font-mono text-xs text-gray-500">{j.job}</div>
                    {open === j.job && j.recent.length > 0 && (
                      <div className="mt-2 space-y-1 border-l border-brand-border pl-2">
                        {j.recent.map((r) => (
                          <div key={r.id} className="text-xs text-gray-400">
                            <span className={r.ok ? "text-emerald-400" : "text-red-400"}>●</span> {ago(r.ranAt)} — {r.summary ?? "—"}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 ${tone}`}>
                    {j.neverRan ? "never run — check the schedule" : ago(j.lastRanAt)}
                    {stale && " (overdue)"}
                  </td>
                  <td className="px-3 py-2 text-gray-300">{j.lastSummary ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{j.lastMs != null ? `${(j.lastMs / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pool && (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Candidate pool — next {pool.horizonHours}h
          </h2>
          <p className="text-xs text-gray-500">
            These are what make “claimed 0” readable. A pass that found nothing when the pool was empty behaved
            correctly; one that found nothing while fixtures sat unclaimed did not.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Fixtures", value: pool.fixtures },
              { label: "In paid-tier leagues", value: pool.paidTierFixtures },
              { label: "Unclaimed (PENDING)", value: pool.pendingTotal },
              { label: "Reserved for paid pass", value: pool.reservedForPaidTier },
              { label: "With any odds", value: pool.oddsAny },
              { label: `With fresh odds (<= ${pool.oddsFreshnessLimitHours}h)`, value: pool.oddsFresh },
              { label: "With no odds at all", value: pool.oddsMissing },
              { label: "Unclaimed, paid-tier", value: pool.pendingPaidTier },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-brand-border bg-brand-bg p-3">
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
