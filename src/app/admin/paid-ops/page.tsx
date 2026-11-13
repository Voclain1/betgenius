import { loadPaidQualityDiagnostics } from "@/lib/paidQualityDiagnostics";
import { loadPaidOpsSnapshot } from "@/lib/paidOpsData";
import { exploreCompetition, loadCoverageDiagnostics, WELSH_COMPETITION_IDS } from "@/lib/coverageDiagnostics";
import { GLOBAL_AUDIT_ROWS, laneCompetitionIds } from "@/lib/generation/competitionEligibility";
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

export default async function PaidOpsPage({ searchParams }: { searchParams?: { competition?: string } }) {
  const [s, quality, coverage] = await Promise.all([loadPaidOpsSnapshot(14), loadPaidQualityDiagnostics(90), loadCoverageDiagnostics(14)]);
  const mode = effectivePaidSelection();
  // Explorer input: a positive integer competition id, or the first Welsh id.
  const requested = Number.parseInt(searchParams?.competition ?? "", 10);
  const exploreId = Number.isInteger(requested) && requested > 0 && requested < 1_000_000 ? requested : WELSH_COMPETITION_IDS[0];
  const explorer = exploreCompetition(exploreId, coverage);
  const included = GLOBAL_AUDIT_ROWS.filter((r) => r.decision === "INCLUDE");
  const laneIds = new Set(laneCompetitionIds());
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

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-100">League coverage · last {coverage.days} days</h2>
        <p className="max-w-3xl text-sm text-gray-400">
          Where fixtures leave the pipeline, per competition: discovered (ledger), generated, published, and VIP / Premium picks.
          Eligibility rollout <code>COVERAGE_ROLLOUT</code> is <strong className="text-gray-200">{coverage.rollout}</strong>;
          in shadow the proposed rules are only recorded, never acted on.
        </p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Discovery runs", `${coverage.discovery.runs} · ${Object.entries(coverage.discovery.modes).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}`],
            ["Fallback sweeps", `${coverage.discovery.sweeps} run · ${Object.values(coverage.discovery.skipped).reduce((a, b) => a + b, 0)} skipped while widened`],
            ["Shadow sweeps", `${coverage.discovery.shadowSweeps} compared current vs proposed rules`],
            ["Quality shadow, 24h", `${coverage.quality.runs} runs · ${coverage.quality.liveSelectedRejected} live picks the proposed bars would reject`],
          ].map(([k, v]) => (
            <div key={k} className="card">
              <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{k}</dt>
              <dd className="mt-1 text-sm font-semibold text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="card space-y-3" id="explorer">
          <h3 className="text-sm font-bold text-gray-100">Competition coverage explorer</h3>
          <form method="get" action="/admin/paid-ops#explorer" className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-400">
              Provider competition id
              <input name="competition" type="number" min={1} defaultValue={exploreId} className="mt-1 block w-32 rounded-lg border border-brand-border bg-brand-card px-2 py-1 text-sm text-gray-100" />
            </label>
            <button type="submit" className="rounded-lg border border-brand-border px-3 py-1 text-sm font-semibold text-gray-100">Explain</button>
          </form>
          <p className="text-sm font-semibold text-gray-200">{explorer.name} · id {explorer.leagueApiId}</p>
          <dl className="space-y-2">
            {explorer.answers.map((a) => (
              <div key={a.question}>
                <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{a.question}</dt>
                <dd className="text-xs text-gray-300">{a.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-gray-400">
            Quick links: {[...WELSH_COMPETITION_IDS, ...included.map((r) => r.id)].slice(0, 40).map((id, i) => (
              <span key={id}>{i ? " · " : ""}<a className="underline" href={`/admin/paid-ops?competition=${id}#explorer`}>{id}</a></span>
            ))}
          </p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-brand-border">
          <div className="bg-brand-card px-3 py-3">
            <h3 className="text-sm font-bold text-gray-100">Global competition audit · {GLOBAL_AUDIT_ROWS.length} uncatalogued competitions</h3>
            <p className="text-xs text-gray-400">
              {included.length} meet every evaluation criterion, {GLOBAL_AUDIT_ROWS.filter((r) => r.decision === "WATCH").length} are on watch, {GLOBAL_AUDIT_ROWS.filter((r) => r.decision === "EXCLUDE").length} are excluded.
              Included competitions are evaluated only with <code>COVERAGE_ROLLOUT=on</code>; nothing is published because of inclusion.
            </p>
          </div>
          <table className="w-full min-w-[48rem] text-xs">
            <thead className="text-left text-gray-400"><tr>
              <th className="p-2">Decision</th><th className="p-2">Competition</th><th className="p-2">Region</th>
              <th className="p-2 text-right">Upcoming</th><th className="p-2 text-right">Books</th><th className="p-2">Lane</th><th className="p-2">Reasons</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-border">
              {GLOBAL_AUDIT_ROWS.filter((r) => r.decision !== "EXCLUDE").map((r) => (
                <tr key={r.id} className="text-gray-200">
                  <td className="p-2 font-semibold">{r.decision}</td>
                  <td className="p-2"><a className="underline" href={`/admin/paid-ops?competition=${r.id}#explorer`}>{r.name}</a> <span className="text-gray-500">({r.country}, {r.id})</span></td>
                  <td className="p-2 text-gray-400">{r.region}</td>
                  <td className="p-2 text-right tabular-nums">{r.upcoming}</td>
                  <td className="p-2 text-right tabular-nums">{r.sampledBookmakers.join(", ") || "—"}</td>
                  <td className="p-2 text-gray-400">{laneIds.has(r.id) ? "yes" : "—"}</td>
                  <td className="p-2 text-gray-400">{r.reasons.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Object.keys(coverage.quality.decisions).length > 0 && (
          <p className="text-xs text-gray-400">
            Candidate-quality decisions (shadow only, last 24h): {Object.entries(coverage.quality.decisions).map(([k, n]) => `${k} ${n}`).join(" · ")}.
            Proposed tiers: {Object.entries(coverage.quality.proposedTiers).map(([k, n]) => `${k} ${n}`).join(" · ")}.
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl border border-brand-border">
          <table className="w-full min-w-[48rem] text-xs">
            <thead className="bg-brand-card text-left text-gray-400"><tr>
              <th className="p-2">Tier</th><th className="p-2">Competition</th><th className="p-2 text-right">Discovered</th>
              <th className="p-2 text-right">Generated</th><th className="p-2 text-right">Failed / abandoned</th><th className="p-2 text-right">Priced</th>
              <th className="p-2 text-right">Published</th><th className="p-2 text-right">VIP / Premium</th><th className="p-2">Gate rejections</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-border">
              {coverage.funnel.leagues.slice(0, 120).map((l) => {
                const rej = l.leagueApiId != null ? coverage.discovery.rejectedByLeague[l.leagueApiId] : undefined;
                return (
                  <tr key={`${l.leagueApiId}-${l.name}`} className="tabular-nums text-gray-200">
                    <td className="p-2 text-gray-400">{l.tier ?? "—"}</td><td className="p-2">{l.name ?? "—"}</td>
                    <td className="p-2 text-right">{l.discovered}</td><td className="p-2 text-right">{l.succeeded}</td>
                    <td className="p-2 text-right">{l.failed} / {l.abandoned}</td><td className="p-2 text-right">{l.priced}</td>
                    <td className="p-2 text-right">{l.published}</td><td className="p-2 text-right">{l.vip} / {l.premium}</td>
                    <td className="p-2 text-gray-400">{rej ? Object.entries(rej).map(([k, n]) => `${k} ${n}`).join(", ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
