import { resultLabel } from "@/lib/performanceCopy";
import Link from "next/link";
import { MARKET_LABELS, CATEGORY_LABELS } from "@/lib/performanceLabels";
import {
  performanceSummary,
  performanceBreakdown,
  historyPrice,
  duplicateIds,
  type PerformanceFilter,
  type PerformanceRow,
} from "@/lib/performanceTransparency";
const number = (n: number) => n.toLocaleString("en-NG");
const pct = (n: number | null) =>
  n == null ? "Not enough results yet" : `${(n * 100).toFixed(1)}%`;
const date = (d: Date | null) =>
  d
    ? d.toLocaleString("en-GB", {
        timeZone: "Africa/Lagos",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " WAT"
    : "Unavailable";
const field =
  "min-h-11 min-w-0 w-full rounded-xl border border-brand-border bg-brand-card px-3 text-sm";
export function PerformanceDashboard({
  rows,
  filter: f,
  truncated,
  start,
  end,
  signedIn,
}: {
  rows: PerformanceRow[];
  filter: PerformanceFilter;
  truncated: boolean;
  start: Date;
  end: Date;
  signedIn: boolean;
}) {
  const filtered = rows.filter(
    (r) =>
      (!f.team ||
        `${r.homeTeam} ${r.awayTeam}`
          .toLowerCase()
          .includes(f.team.toLowerCase())) &&
      (!f.category || r.category === f.category) &&
      (!f.market || r.marketType === f.market) &&
      (!f.league || r.leagueName === f.league) &&
      (!f.outcome ||
        (f.outcome === "OTHER"
          ? !["WON", "LOST", "VOID", "PENDING"].includes(r.outcome)
          : r.outcome === f.outcome)),
  );
  const allDuplicates = duplicateIds(rows);
  const verifiedCohort = filtered.map((r) =>
    allDuplicates.has(r.id) ? { ...r, settledAt: null } : r,
  );
  const summary = performanceSummary(verifiedCohort, end),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    page = Math.min(f.page, pages);
  const history = [...filtered].reverse().slice((page - 1) * 20, page * 20);
  const months = performanceBreakdown(verifiedCohort, "month", end).sort(
    (a, b) => a.label.localeCompare(b.label),
  );
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f))
      if (k !== "page" && v) q.set(k, String(v));
    q.set("page", String(p));
    return `/track-record?${q}#history`;
  };
  const comparisons = (
    dimension: "category" | "marketType" | "leagueName",
    title: string,
  ) => (
    <section aria-label={title}>
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      <div className="divide-y divide-brand-border">
        {performanceBreakdown(verifiedCohort, dimension, end)
          .slice(0, 20)
          .map((s) => (
            <div
              key={s.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 text-sm"
            >
              <div className="min-w-0 break-words">
                {(dimension === "category"
                  ? CATEGORY_LABELS[s.label]
                  : dimension === "marketType"
                    ? MARKET_LABELS[s.label]
                    : null) ?? (dimension === "leagueName" ? s.label : "Other")}
                <span className="mt-1 block text-xs text-gray-400">
                  {s.won} won · {s.lost} lost · {s.verified} checked /{" "}
                  {s.published} predictions
                </span>
              </div>
              <span className="text-right text-xs font-semibold text-gray-300">
                {pct(s.rate)}
              </span>
            </div>
          ))}
      </div>
    </section>
  );
  return (
    <div className="space-y-7">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-brand">
          Track Record
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">
          Prediction Results
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          See how past predictions finished and compare results over time.
        </p>
      </header>

      <p className="text-xs leading-relaxed text-gray-400">
        {start.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}–
        {end.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })} · West
        Africa Time ·{" "}
        {signedIn ? "Predictions included in your plan" : "Public predictions"}.{" "}
        {truncated &&
          "Showing the first 5,000 predictions in this period. Choose a shorter period to see more recent results."}
      </p>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-b border-brand-border pb-5 sm:grid-cols-4">
        {[
          ["Win Rate", pct(summary.rate)],
          ["Checked wins & losses", summary.decided],
          ["Predictions", summary.published],
          ["Finished results", summary.recordedSettled],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-xs text-gray-400">{label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">
              {typeof value === "number" ? number(value) : value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-gray-400">
        All results: {summary.counts.WON} won · {summary.counts.LOST} lost ·{" "}
        {summary.counts.VOID} void · {summary.counts.PENDING} pending ·{" "}
        {summary.other} need review. Win Rate uses only predictions whose
        published choice and final score we can check. {summary.unverified}{" "}
        finished results are left out because checks are incomplete or entries
        overlap. A high win rate does not guarantee a profit.
      </p>
      <form
        method="get"
        action="/track-record"
        aria-label="Filter past predictions"
        className="space-y-3 border-y border-brand-border py-3"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="sr-only" htmlFor="history-team">
            Team
          </label>
          <input
            id="history-team"
            name="team"
            defaultValue={f.team}
            maxLength={80}
            placeholder="Search either team"
            className={field}
          />
          <button className="btn btn-primary min-h-11">Search</button>
        </div>
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-300">
            Dates & filters
          </summary>
          <div className="grid min-w-0 gap-3 py-3 sm:grid-cols-3">
            {(
              [
                [
                  "months",
                  "Period",
                  [1, 3, 6, 12].map((n) => [
                    String(n),
                    `${n} month${n === 1 ? "" : "s"}`,
                  ]),
                ],
                [
                  "category",
                  "Category",
                  [...new Set(rows.map((r) => r.category))]
                    .sort()
                    .map((v) => [v, CATEGORY_LABELS[v] ?? "Other category"]),
                ],
                [
                  "market",
                  "Market",
                  [...new Set(rows.map((r) => r.marketType))]
                    .sort()
                    .map((v) => [v, MARKET_LABELS[v] ?? "Other market"]),
                ],
                [
                  "league",
                  "Competition",
                  [
                    ...new Set(
                      rows
                        .map((r) => r.leagueName)
                        .filter((v): v is string => !!v),
                    ),
                  ]
                    .sort()
                    .map((v) => [v, v]),
                ],
                [
                  "outcome",
                  "Result",
                  ["WON", "LOST", "VOID", "PENDING", "OTHER"].map((v) => [
                    v,
                    resultLabel(v),
                  ]),
                ],
              ] as Array<[keyof PerformanceFilter, string, string[][]]>
            ).map(([key, label, options]) => (
              <label key={key} className="min-w-0 text-xs text-gray-400">
                {label}
                <select
                  className={`${field} mt-1`}
                  name={key}
                  defaultValue={String(f[key])}
                >
                  {key !== "months" && <option value="">All</option>}
                  {options.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Link
            href="/track-record"
            className="inline-flex min-h-11 items-center text-xs text-brand"
          >
            Reset filters
          </Link>
        </details>
      </form>
      {!filtered.length ? (
        <p role="status" className="py-5 text-sm text-gray-400">
          No past predictions found. Try another team, date or filter.
        </p>
      ) : (
        <>
          <section aria-labelledby="monthly-history">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="monthly-history" className="text-base font-bold">
                Monthly Performance
              </h2>
              <span className="text-xs text-gray-400">
                By match month · 20 checked wins or losses needed
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {months.map((s) => (
                <div
                  key={s.label}
                  className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs"
                >
                  <span>{s.label}</span>
                  <div
                    className="h-1.5 rounded-full bg-brand-border"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${(s.rate ?? 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-right text-gray-400">
                    {s.rate == null
                      ? `${s.decided} checked`
                      : `${pct(s.rate)} · ${s.decided} checked`}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            {comparisons("category", "Results by Category")}
            {comparisons("marketType", "Results by Market")}
          </div>
          <details className="border-y border-brand-border py-2">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
              Results by League
            </summary>
            {comparisons("leagueName", "Results by League")}
            <p className="text-xs text-gray-400">
              Showing up to 20 leagues with the most predictions. Choose a
              league in the filters to see another.
            </p>
          </details>
        </>
      )}
      <section
        aria-labelledby="indicative-returns"
        className="border-y border-brand-border py-4"
      >
        <h2 id="indicative-returns" className="text-base font-bold">
          Estimated Returns
        </h2>
        <p className="mt-2 text-sm font-semibold">
          {summary.eligible >= 20
            ? `${pct(summary.roi)} estimated return`
            : "Not enough confirmed past odds"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          Based on {summary.eligible} predictions with confirmed past odds;{" "}
          {summary.excluded} left out. Estimated profit or loss:{" "}
          {summary.net.toFixed(2)} points, assuming 1 point on each included
          prediction. These are calculations using recorded odds, not real bets
          or anyone’s earnings.
        </p>
      </section>
      <details className="border-b border-brand-border pb-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          How Results Are Calculated
        </summary>
        <div className="space-y-3 text-xs leading-relaxed text-gray-400">
          <p>
            Win Rate is checked wins divided by checked wins and losses. Voids
            do not count towards it. We show a rate only after 20 checked wins
            or losses.
          </p>
          <p>
            To include a result, we need a matching choice and odds recorded
            around publication, a publication time before kickoff, and a final
            score that agrees with the result. Without these checks, it stays in
            All results but is left out of Win Rate and Estimated Returns. This
            checked group may not represent every prediction we publish.
          </p>
          <p>
            The dates cover predictions published and played during your chosen
            period, using West Africa Time. Categories use the prediction’s
            current category, which may differ from its category when first
            published. Monthly figures use the match date.
          </p>
          <p>
            If the same match and market appear more than once, we leave those
            entries out of checked figures rather than choose between them.
            Different markets from one match can still appear separately. We
            also leave out results we cannot confirm, including bets with
            part-wins or part-losses and quarter-goal lines.
          </p>
          <p>
            Estimated Returns assumes a 1-point bet on each included prediction,
            using confirmed odds recorded at publication. A win adds the odds
            minus 1 point; a loss subtracts 1 point; a void returns the stake,
            with no profit or loss. The return percentage is total profit or
            loss divided by all points staked, including voids. At least 20
            included predictions are needed to show a percentage.
          </p>
          <p>
            We never fill gaps with today’s odds. Missing or conflicting odds,
            changed predictions and incomplete results are left out. Recorded
            odds do not prove that a bookmaker would have accepted your bet at
            that price.
          </p>
          <p>
            A complete history of earlier published choices and later result
            changes is not available. Each prediction page explains what can be
            checked. These past results do not predict future success.
          </p>
          <p>
            Longest checked winning run: {summary.winStreak}; losing run:{" "}
            {summary.lossStreak}. Runs follow match kickoff order. A void,
            pending result, repeated entry or incomplete check ends a run. These
            are sequences of predictions, not a betting strategy.
          </p>
        </div>
      </details>
      <section
        id="history"
        aria-labelledby="history-heading"
        className="scroll-mt-24"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history-heading" className="text-lg font-bold">
            Past Predictions
          </h2>
          <span className="text-xs text-gray-400">
            {filtered.length} predictions · latest matches first
          </span>
        </div>
        <div className="mt-3 divide-y divide-brand-border">
          {history.map((r) => (
            <article
              key={r.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-4"
            >
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400">
                  {r.leagueName ?? "League not listed"} · {date(r.kickoff)}
                </p>
                <h3 className="mt-1 break-words text-sm font-bold">
                  <Link
                    href={`/track-record/prediction/${r.id}`}
                    className="hover:text-brand"
                  >
                    {r.homeTeam ?? "Home"} vs {r.awayTeam ?? "Away"}
                  </Link>
                </h3>
                <p className="mt-1 break-words text-xs text-gray-300">
                  {r.market} · {r.pick}
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  {historyPrice(r)
                    ? `Odds at publication ${historyPrice(r)!.median.toFixed(2)}`
                    : "Past odds not available"}
                </p>
              </div>
              <span className="text-xs font-semibold text-gray-300">
                {resultLabel(r.outcome)}
              </span>
            </article>
          ))}
        </div>
        <nav
          aria-label="Past predictions pages"
          className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm"
        >
          {page > 1 ? (
            <Link href={href(page - 1)} className="text-brand">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-gray-400">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="text-brand">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
      <Link
        href="/predictions"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
      >
        See today’s predictions →
      </Link>
    </div>
  );
}
