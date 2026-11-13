import { loadPaidQualityDiagnostics } from "@/lib/paidQualityDiagnostics";
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
  const [s, quality] = await Promise.all([loadPaidOpsSnapshot(14), loadPaidQualityDiagnostics(90)]);
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
      <div className="card space-y-2">
        <h2 className="text-sm font-bold text-gray-100">Shadow integrity · last 24h</h2>
        <p className="text-xs text-gray-400">{s.integrityLast24h.auditedRuns} audited runs · {s.integrityLast24h.missingAssessments} selections without assessment records. Diagnostics only; no live filtering.</p>
        <div className="flex flex-wrap gap-2">{Object.entries(s.integrityLast24h.warnings).length ? Object.entries(s.integrityLast24h.warnings).map(([reason, count]) => <span key={reason} className="rounded-lg border border-amber-500/40 px-2 py-1 text-xs text-amber-300">{reason}: {count}</span>) : <span className="text-xs text-gray-400">No integrity warnings recorded in audited runs.</span>}</div>
      </div>
      {s.shadow.lastSummary && <p className="text-xs text-gray-400">Latest shadow record: {s.shadow.lastSummary}</p>}

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-100">Historical paid quality · last {quality.days} days</h2>
        <p className="text-sm text-gray-400">
          {quality.total} settled paid predictions; {quality.priced} with recorded entry prices.
          Missing entry odds are excluded from ROI, never filled using later bookmaker quotes.
          Segments are diagnostics, not instructions to change live selection.
        </p>
        {quality.dimensions.map(group => (
          <div key={group.dimension} className="overflow-x-auto rounded-2xl border border-brand-border">
            <div className="bg-brand-card px-3 py-3">
              <h3 className="text-sm font-bold capitalize text-gray-100">{group.dimension}</h3>
              <p className="text-xs text-gray-400">
                Chronological holdout: {group.holdout.trainingCount} training / {group.holdout.validationCount} validation
                {group.holdout.splitAt ? ` · split ${group.holdout.splitAt.slice(0, 10)}` : " · no split"}
              </p>
              {group.holdout.warnings.length > 0 && <p className="text-xs text-amber-300">
                Evidence warnings: {group.holdout.warnings.slice(0, 8).join(", ")}
                {group.holdout.warnings.length > 8 ? ` (+${group.holdout.warnings.length - 8} more)` : ""}
              </p>}
            </div>
            <table className="w-full min-w-[44rem] text-xs">
              <thead><tr className="text-left text-gray-400">
                <th className="p-2">Segment</th><th className="p-2">W/L</th><th className="p-2">95% win interval</th>
                <th className="p-2">Entry priced</th><th className="p-2">Entry ROI</th><th className="p-2">Warnings</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-border">
                {group.segments.map(s => <tr key={s.key} className="text-gray-200">
                  <td className="p-2">{s.key}</td><td className="p-2">{s.wins}/{s.losses}</td>
                  <td className="p-2">{s.winRateWilson95 ? s.winRateWilson95.map(x => (x * 100).toFixed(1) + "%").join(" – ") : "—"}</td>
                  <td className="p-2">{s.entryPriced}/{s.decided}</td>
                  <td className="p-2">{s.roiPct === null ? "Insufficient data" : s.roiPct.toFixed(1) + "%"}</td>
                  <td className="p-2 text-amber-300">{s.warning.join(", ") || "—"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        ))}
      </section>
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
