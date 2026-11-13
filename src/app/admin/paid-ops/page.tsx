import { loadPaidOpsSnapshot } from "@/lib/paidOpsData";
import { effectivePaidSelection } from "@/lib/paidSelectionMode";
import type { PaidDayStatus } from "@/lib/paidOps";

/**
 * Paid-feed operations: one row per Lagos kickoff day, classified so a quiet
 * market is never confused with a broken pipeline (src/lib/paidOps.ts). Admin
 * only — the admin layout redirects anyone else before this renders.
 */
export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<PaidDayStatus, { label: string; tone: string }> = {
  OK: { label: "OK", tone: "text-emerald-300" },
  LOW_OPPORTUNITY: { label: "Low opportunity", tone: "text-gray-300" },
  MISSING_FIXTURES: { label: "Missing fixtures", tone: "text-red-300" },
  GENERATION_FAILURE: { label: "Generation failure", tone: "text-red-300" },
  PRICING_FAILURE: { label: "Pricing failure", tone: "text-red-300" },
  PUBLICATION_FAILURE: { label: "Publication / scheduling failure", tone: "text-red-300" },
};

export default async function PaidOpsPage() {
  const s = await loadPaidOpsSnapshot(14);
  const mode = effectivePaidSelection();
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) + " WAT" : "—");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-100">Paid operations</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-400">
          VIP and Premium by kickoff day. A failure status is checked before &ldquo;low opportunity&rdquo;, so a broken day is never written off as a quiet one.
          Alerts for failure statuses email <code>PAID_OPS_ALERT_EMAIL</code> when it is set ({process.env.PAID_OPS_ALERT_EMAIL ? "set" : "not set"}).
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Selection mode", `${mode.mode} · live ${mode.live}${mode.fallback ? ` · fallback ${mode.fallback}` : ""}`],
          ["Shadow log, 24h", `${s.shadow.last24h} records · last ${time(s.shadow.lastAt)}`],
          ["Paid pass, 24h", `${s.paidPassLast24h.runs} runs · ${s.paidPassLast24h.failedRuns} failed · last ${time(s.paidPassLast24h.lastAt)}`],
          ["Settlement backlog", `${s.settlementBacklog.pendingOver6h} unsettled >6h after kickoff · ${s.settlementBacklog.manualOnly} need manual settlement`],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{k}</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-100">{v}</dd>
          </div>
        ))}
      </dl>
      {s.shadow.lastSummary && <p className="text-xs text-gray-400">Latest shadow record: {s.shadow.lastSummary}</p>}

      <div className="overflow-x-auto rounded-2xl border border-brand-border">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-brand-card text-left text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
            <tr>
              <th className="px-3 py-2">Day</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Fixtures found / covered / failed</th>
              <th className="px-3 py-2 text-right">Paid scope priced</th>
              <th className="px-3 py-2 text-right">Attempts / errors</th>
              <th className="px-3 py-2 text-right">Promoted / published</th>
              <th className="px-3 py-2 text-right">Longest pass gap</th>
              <th className="px-3 py-2 text-right">VIP / Premium</th>
              <th className="px-3 py-2 text-right">Shadow</th>
              <th className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {[...s.days].reverse().map((d) => (
              <tr key={d.day} className="tabular-nums text-gray-200">
                <td className="px-3 py-2 font-semibold">{d.day}</td>
                <td className={`px-3 py-2 font-black ${STATUS_TEXT[d.status].tone}`}>{STATUS_TEXT[d.status].label}</td>
                <td className="px-3 py-2 text-right">{d.discovered} / {d.covered} / {d.failed}</td>
                <td className="px-3 py-2 text-right">{d.paidScopePriced} / {d.paidScope}</td>
                <td className="px-3 py-2 text-right">{d.attempts} / {d.attemptErrors}</td>
                <td className="px-3 py-2 text-right">{d.promoted} / {d.published}</td>
                <td className="px-3 py-2 text-right">{d.maxRunGapMinutes == null ? "—" : `${d.maxRunGapMinutes}m`}</td>
                <td className="px-3 py-2 text-right">{d.vipPicks} / {d.premiumPicks}</td>
                <td className="px-3 py-2 text-right">{d.shadowRuns}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{d.reasons.join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
