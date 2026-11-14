import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { loadOperations } from "@/lib/operationsData";
import { RecoveryControls } from "./RecoveryControls";
export const dynamic = "force-dynamic";
export default async function PredictionOperations({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) redirect("/login");
  const competition = Number(searchParams?.competition),
    category = [
      "VIP",
      "PREMIUM",
      "FEATURED",
      "TODAY",
      "GENIUS",
      "BANKER",
      "GOALS",
    ].includes(searchParams?.category ?? "")
      ? searchParams!.category
      : undefined;
  const s = await loadOperations({
    days: Number(searchParams?.days),
    competition:
      Number.isInteger(competition) && competition > 0 && competition < 1000000
        ? competition
        : undefined,
    category,
    severity: ["CRITICAL", "WARNING", "INFO"].includes(
      searchParams?.severity ?? "",
    )
      ? searchParams!.severity
      : undefined,
  }).catch(() => null);
  if (!s)
    return (
      <div className="card text-amber-300">
        Operational diagnostics unavailable. This does not pause publication.
      </div>
    );
  const time = (date: Date | null) =>
    date
      ? date.toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) + " WAT"
      : "Not observed";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black">Prediction operations</h1>
      <p className="text-sm text-gray-400">
        Read-only lookback: {s.days} day(s), plus 72 hours upcoming.{" "}
        {s.universe} predictions sampled
        {s.truncated ? " · 500-row cap reached; incomplete cohort" : ""}.
        Unknown evidence is not healthy evidence.
      </p>
      <form className="card grid gap-3 sm:grid-cols-4">
        <label>
          Window
          <select name="days" className="input w-full" defaultValue={s.days}>
            <option value="1">Daily</option>
            <option value="7">Weekly</option>
          </select>
        </label>
        <label>
          Competition id
          <input
            name="competition"
            className="input w-full"
            defaultValue={searchParams?.competition}
          />
        </label>
        <label>
          Category
          <input
            name="category"
            className="input w-full"
            defaultValue={category}
          />
        </label>
        <label>
          Severity
          <select
            name="severity"
            className="input w-full"
            defaultValue={searchParams?.severity ?? ""}
          >
            <option value="">All</option>
            {["CRITICAL", "WARNING", "INFO"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondary">Filter</button>
      </form>
      <section className="card">
        <h2 className="text-xl font-bold">
          Publishing, freshness and settlement
        </h2>
        <p className="text-sm">
          States: {JSON.stringify(s.publishing)} · Fresh odds:{" "}
          {s.metrics.freshOdds}/{s.metrics.oddsDenominator} sampled rows · Late
          publication: {s.metrics.latePublications}/{s.metrics.published}{" "}
          published · Result discrepancies: {s.metrics.discrepancies}
        </p>
        <p className="text-xs text-gray-400">
          Settlement latency is measured from kickoff, not final whistle. Failed
          deliveries: {s.failedNotifications}
          {s.notificationCountCapped ? " (capped)" : ""}. Expired leases:{" "}
          {s.expiredLeases.length} (up to 50); existing workers reclaim their
          own leases. Generation ledger rows: {s.ledger.length} (up to 100).
        </p>
      </section>
      <p className="text-sm text-gray-400">
        Recovery success: {s.metrics.recoverySuccesses}/
        {s.metrics.recoveryAttempts} completed attempts. Retry success:{" "}
        {s.metrics.retrySuccesses}/{s.metrics.retryAttempts} completed retries.
        These are bounded observed counts; API error rate is unavailable because
        usage counters do not retain every response classification.
      </p>
      <section className="card overflow-x-auto">
        <h2 className="text-xl font-bold">Job outcomes</h2>
        <table className="w-full min-w-[48rem] text-xs">
          <thead>
            <tr>
              {[
                "Job",
                "Last run / success",
                "Useful / observed",
                "HTTP success / observed",
                "Failures / unknown",
                "Schedule",
              ].map((h) => (
                <th className="p-2 text-left" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.jobs.map((j) => (
              <tr key={j.job} className="border-t border-brand-border">
                <td className="p-2">{j.job}</td>
                <td className="p-2">
                  {time(j.lastAt)}
                  <br />
                  {time(j.lastSuccess)}
                </td>
                <td className="p-2">
                  {j.useful}/{j.runs}
                  {j.truncated ? " capped" : ""}
                </td>
                <td className="p-2">
                  {j.transportSuccess}/{j.runs}
                </td>
                <td className="p-2">
                  {j.failed} / {j.unknown}
                </td>
                <td className="p-2">Unverified external schedule</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card space-y-2">
        <h2 className="text-xl font-bold">Reconciliation findings</h2>
        {s.findings.length ? (
          s.findings.slice(0, 200).map((f, i) => (
            <div
              key={`${f.predictionId}-${f.code}-${i}`}
              className="rounded-lg border border-brand-border p-3 text-sm"
            >
              <span
                className={
                  f.severity === "CRITICAL" ? "text-red-300" : "text-amber-300"
                }
              >
                {f.severity} · {f.code}
              </span>
              <p className="break-all">{f.predictionId}</p>
              <p className="text-gray-400">
                {f.detail} · {f.repair ?? "Observation only"}
              </p>
            </div>
          ))
        ) : (
          <p className="text-gray-400">
            No findings in this bounded sample. This is not a whole-database
            health guarantee.
          </p>
        )}
      </section>
      <details className="card">
        <summary>Freshness evidence (first 100)</summary>
        <pre className="overflow-auto text-xs">
          {JSON.stringify(s.freshness.slice(0, 100), null, 2)}
        </pre>
      </details>
      <RecoveryControls enabled={process.env.OPS_RECOVERY_MODE === "manual"} />
      <details className="card">
        <summary>Recovery audit and terminal failures (up to 100)</summary>
        <pre className="overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(s.executions, null, 2)}
        </pre>
      </details>
    </div>
  );
}
