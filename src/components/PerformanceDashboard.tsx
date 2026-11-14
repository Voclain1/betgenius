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
  n == null ? "Insufficient sample" : `${(n * 100).toFixed(1)}%`;
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
                    : null) ?? s.label}
                <span className="mt-1 block text-xs text-gray-400">
                  {s.won} won · {s.lost} lost · {s.verified} verified /{" "}
                  {s.published} records
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
          Public record
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-4xl">
          Performance, in context
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Published predictions. Recorded outcomes. Evidence you can inspect.
        </p>
      </header>
      <form
        method="get"
        action="/track-record"
        aria-label="Filter historical performance"
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
            Period & filters
          </summary>
          <div className="grid min-w-0 gap-3 py-3 sm:grid-cols-3">
            {(
              [
                [
                  "months",
                  "Period",
                  [1, 3, 6, 12].map((n) => [
                    String(n),
                    `${n} calendar month${n === 1 ? "" : "s"}`,
                  ]),
                ],
                [
                  "category",
                  "Primary category",
                  [...new Set(rows.map((r) => r.category))]
                    .sort()
                    .map((v) => [v, CATEGORY_LABELS[v] ?? v]),
                ],
                [
                  "market",
                  "Market",
                  [...new Set(rows.map((r) => r.marketType))]
                    .sort()
                    .map((v) => [v, MARKET_LABELS[v] ?? v]),
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
                  "Recorded outcome",
                  ["WON", "LOST", "VOID", "PENDING", "OTHER"].map((v) => [
                    v,
                    v,
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
      <p className="text-xs leading-relaxed text-gray-400">
        {start.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}–
        {end.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })} ·
        Africa/Lagos ·{" "}
        {signedIn
          ? "Your currently accessible records"
          : "Publicly readable records only"}
        .{" "}
        {truncated &&
          "Limited to the earliest 5,000 records in this window. These are sample totals; narrow the period."}
      </p>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-b border-brand-border pb-5 sm:grid-cols-4">
        {[
          ["Published records", summary.published],
          ["Recorded settled", summary.recordedSettled],
          ["Score-verified decided", summary.decided],
          ["Score-verified win rate", pct(summary.rate)],
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
        Recorded: {summary.counts.WON} won · {summary.counts.LOST} lost ·{" "}
        {summary.counts.VOID} void · {summary.counts.PENDING} pending ·{" "}
        {summary.other} other. {summary.unverified} settled records lack
        independent verification or have duplicates. Score-verified win rate is
        verified wins ÷ verified wins and losses; it does not establish
        profitability.
      </p>
      {!filtered.length ? (
        <p role="status" className="py-5 text-sm text-gray-400">
          No published records match this period and these filters.
        </p>
      ) : (
        <>
          <section aria-labelledby="monthly-history">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="monthly-history" className="text-base font-bold">
                Monthly history
              </h2>
              <span className="text-xs text-gray-400">
                Kickoff month · minimum 20 decided
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
                      ? `${s.decided} decided`
                      : `${pct(s.rate)} · n=${s.decided}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            {comparisons("category", "By primary category")}
            {comparisons("marketType", "By market")}
          </div>
          <details className="border-y border-brand-border py-2">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
              By competition
            </summary>
            {comparisons("leagueName", "Competition comparison")}
            <p className="text-xs text-gray-400">
              Up to 20 competitions, by number of records. Use the competition
              filter to inspect another.
            </p>
          </details>
        </>
      )}
      <section
        aria-labelledby="indicative-returns"
        className="border-y border-brand-border py-4"
      >
        <h2 id="indicative-returns" className="text-base font-bold">
          Publication-price illustration
        </h2>
        <p className="mt-2 text-sm font-semibold">
          {summary.eligible >= 20
            ? `${pct(summary.roi)} indicative ROI`
            : "Insufficient qualifying price evidence"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          {summary.eligible} eligible · {summary.excluded} excluded ·{" "}
          {summary.net.toFixed(2)} net units in the eligible sample. Flat 1-unit
          stakes using verified publication-time indicative median prices; no
          current-price substitution. This is not executed betting performance
          or subscriber earnings.
        </p>
      </section>
      <details className="border-b border-brand-border pb-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
          Calculation methods & evidence limits
        </summary>
        <div className="space-y-3 text-xs leading-relaxed text-gray-400">
          <p>
            Counts cover currently readable records published and kicked off in
            the selected window, up to 5,000 rows. Filters apply to this bounded
            cohort. Category comparisons use the currently stored primary
            category, not historical category membership or cross-posted tags.
            Months use kickoff in Africa/Lagos; they are not settlement months.
          </p>
          <p>
            Verified outcomes require pre-kickoff publication, a valid
            settlement timestamp after kickoff and no later than this report,
            valid nonnegative final scores, and agreement between the current
            stored structured selection and the existing market resolver. This
            checks settlement arithmetic, not an unavailable immutable
            original-selection ledger. Unsupported, partial, manually voided
            without scores, missing or contradictory records remain visible but
            are excluded from verified rates and returns. At least 20 verified
            wins/losses are required to display a rate.
          </p>
          <p>
            Different rows for the same identified fixture and market type are
            excluded from verification and returns, including differing
            selections: we do not choose a favourable version. Different markets
            from one fixture remain correlated observations, not independent
            matches. Records without stable fixture identity are not eligible
            for the return illustration.
          </p>
          <p>
            One unit is staked per eligible record: win = decimal price minus
            one, loss = −1, void = 0. ROI = net units ÷ eligible stakes. Partial
            returns are excluded because no reliable partial-settlement ledger
            is stored. Rewritten records and missing, mismatched, derived or
            later prices are excluded. A quote observation does not prove an
            executable offer.
          </p>
          <p>
            Publication timestamps and stored selections are distinct from
            immutable original-selection evidence. Draft revisions are not a
            publication-version ledger; settlement edits have no complete
            correction history. We do not reconstruct either. Individual records
            state these limitations. Historical reporting is separate from
            prospective reliability research.
          </p>
          <p>
            Longest verified winning run: {summary.winStreak}; losing run:{" "}
            {summary.lossStreak}. Ordered by kickoff then record ID; void,
            pending, duplicate and unverifiable records break a run. These are
            observed record sequences, not subscriber betting strategies.
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
            Historical results
          </h2>
          <span className="text-xs text-gray-400">
            {filtered.length} records · newest kickoff first
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
                  {r.leagueName ?? "Competition unavailable"} ·{" "}
                  {date(r.kickoff)}
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
                    ? `Publication observation ${historyPrice(r)!.median.toFixed(2)}`
                    : "Publication price unavailable"}
                </p>
              </div>
              <span className="text-xs font-semibold text-gray-300">
                {r.outcome}
              </span>
            </article>
          ))}
        </div>
        <nav
          aria-label="History pagination"
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
        Browse current predictions →
      </Link>
    </div>
  );
}
