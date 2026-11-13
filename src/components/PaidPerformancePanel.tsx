import { footballDate } from "@/lib/footballTime";
import { PAID_RETURN_MIN_SAMPLE, type PaidPerformance, type PriceReturn } from "@/lib/paidPerformance";

/**
 * A paid tier's settled record, for subscribers. Server component: rendered
 * only after the feed page's entitlement check, and never for a locked reader
 * (whose page shows no counts or rates at all, by design).
 *
 * Honest by construction: pending picks are not counted, voids are shown and
 * excluded from the win rate, and a return figure appears only when enough
 * picks with that kind of price have settled — and then whatever its sign.
 */
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${(100 * v).toFixed(d)}%`);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const OUTCOME_TONE: Record<string, string> = { WON: "text-emerald-300", LOST: "text-red-300", VOID: "text-gray-300" };

function ReturnFigure({ title, r, note, empty }: { title: string; r: PriceReturn; note: string; empty: string }) {
  return (
    <div className="rounded-2xl bg-brand-bg/70 p-4 ring-1 ring-brand-border">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{title}</div>
      {r.returnPct != null ? (
        <>
          <div className={`mt-1 text-2xl font-black tabular-nums ${r.returnPct < 0 ? "text-red-300" : "text-gray-100"}`}>{signed(r.returnPct)}</div>
          <div className="mt-1 text-xs text-gray-400">
            {r.units! >= 0 ? "+" : "−"}{Math.abs(r.units!).toFixed(2)} units over {r.priced} picks · average odds {r.averageOdds?.toFixed(2)}
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm font-semibold text-gray-300">{empty.replace("{n}", String(r.priced)).replace("{min}", String(PAID_RETURN_MIN_SAMPLE))}</div>
      )}
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{note}</p>
    </div>
  );
}

export function PaidPerformancePanel({ tier, perf }: { tier: "VIP" | "Premium"; perf: PaidPerformance }) {
  const { record } = perf;
  const since = footballDate(`${perf.since}T12:00:00Z`, { day: "numeric", month: "long", year: "numeric" });
  return (
    <section aria-labelledby="paid-performance-heading" className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Performance</p>
        <h2 id="paid-performance-heading" className="mt-1 text-2xl font-black tracking-tight text-gray-100 sm:text-3xl">{tier} record since {since}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
          Every settled {tier} pick since the current {tier} rules began, wins and losses alike. Picks still awaiting a result are not counted.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-3xl border border-brand-border bg-brand-border sm:grid-cols-6">
        {[
          ["Settled", String(record.total)],
          ["Won", String(record.won)],
          ["Lost", String(record.lost)],
          ["Void", String(record.void)],
          ["Win rate", pct(record.rate)],
          ["Awaiting result", String(perf.pending)],
        ].map(([label, value]) => (
          <div key={label} className="bg-brand-card p-4">
            <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</dt>
            <dd className="mt-1 text-xl font-black tabular-nums text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 md:grid-cols-2">
        <ReturnFigure
          title="Return at the price when published"
          r={perf.entry}
          empty="Shown once {min} settled picks carry a recorded price ({n} so far)."
          note="Flat one-unit stakes at the median bookmaker price recorded when each pick was published. Prices are recorded from 13 November 2026."
        />
        <ReturnFigure
          title="Return at closing prices"
          r={perf.closing}
          empty="Shown once {min} settled picks have a closing quote ({n} so far)."
          note={`Flat one-unit stakes at the median of the last bookmaker quote before kickoff — a real price, but taken after publication, so not necessarily the price you got. ${pct(perf.closing.coverage, 0)} of settled picks have one.`}
        />
      </div>

      {perf.byMarket.length > 0 && (
        <div className="overflow-x-auto rounded-3xl border border-brand-border bg-brand-card">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">{tier} record by market</caption>
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                <th className="px-4 py-3">Market</th><th className="px-4 py-3 text-right">Settled</th><th className="px-4 py-3 text-right">Won–lost–void</th><th className="px-4 py-3 text-right">Win rate</th><th className="px-4 py-3 text-right">Return at close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {perf.byMarket.map((m) => (
                <tr key={m.marketType} className="tabular-nums text-gray-200">
                  <td className="px-4 py-3 font-semibold">{m.label}</td>
                  <td className="px-4 py-3 text-right">{m.record.total}</td>
                  <td className="px-4 py-3 text-right">{m.record.won}–{m.record.lost}–{m.record.void}</td>
                  <td className="px-4 py-3 text-right">{pct(m.record.rate)}</td>
                  <td className={`px-4 py-3 text-right ${m.closingReturnPct != null && m.closingReturnPct < 0 ? "text-red-300" : ""}`}>{m.closingReturnPct == null ? "—" : signed(m.closingReturnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 text-xs text-gray-500">Markets with at least 30 settled picks. A return is shown where 30 or more of them have a closing quote.</p>
        </div>
      )}

      {perf.recent.length > 0 && (
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-gray-400">Latest settled</h3>
          <ul className="mt-3 divide-y divide-brand-border overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
            {perf.recent.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-100">{r.homeTeam} v {r.awayTeam}</div>
                  <div className="truncate text-xs text-gray-400">{footballDate(r.kickoff, { day: "numeric", month: "short" })} · {r.market}: {r.pick}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[11px] font-black uppercase tracking-[0.14em] ${OUTCOME_TONE[r.outcome] ?? "text-gray-400"}`}>{r.outcome === "VOID" ? "Void" : r.outcome === "WON" ? "Won" : "Lost"}</div>
                  {(r.entryPrice ?? r.closingPrice) != null && <div className="text-xs tabular-nums text-gray-500">{(r.entryPrice ?? r.closingPrice)!.toFixed(2)}{r.entryPrice != null ? "" : " close"}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="max-w-3xl text-xs leading-relaxed text-gray-500">
        Win rate is won ÷ (won + lost). A void — a draw no bet that ends level, a postponed match — returns the stake and counts as neither. Confidence is our estimate of a pick&apos;s chance, not a guarantee, and past results do not guarantee future ones.
      </p>
    </section>
  );
}

/** One paragraph above a paid feed, for subscribers: what each number on a card means. */
export function PaidFeedIntro({ tier }: { tier: "VIP" | "Premium" }) {
  return (
    <p className="max-w-3xl text-sm leading-relaxed text-gray-400">
      Each {tier} pick shows its confidence — our estimate of its chance of landing, not a guarantee — the median bookmaker price and where that price comes from, when it was published, and its status through to the result. Your bookmaker&apos;s price may differ.
    </p>
  );
}
