"use client";
import { useState } from "react";
import { impliedProbability, marketView, parseOdds, returnOn } from "@/lib/oddsCalculator";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-brand-border bg-brand-bg px-3 py-2.5 text-base font-bold tabular-nums text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-brand"
      />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className={`mt-1 text-3xl font-black tabular-nums tracking-tight ${accent ? "text-brand" : "text-gray-100"}`}>{value}</div>
    </div>
  );
}

/** The single-price and full-market calculators on /odds-calculator. */
export function OddsCalculator() {
  const [price, setPrice] = useState("2.50");
  const [stake, setStake] = useState("1000");
  const [three, setThree] = useState(true);
  const [market, setMarket] = useState(["2.10", "3.40", "3.60"]);

  const decimal = parseOdds(price);
  const stakeValue = Number(stake.replace(/[^\d.]/g, ""));
  const prices = (three ? market : market.slice(0, 2)).map(parseOdds);
  const view = prices.every((p): p is number => p != null) ? marketView(prices as number[]) : null;
  const labels = three ? ["Home", "Draw", "Away"] : ["Side A", "Side B"];

  return (
    <div className="space-y-8">
      <section aria-labelledby="single-heading" className="rounded-3xl border border-brand-border bg-brand-card p-5 sm:p-7">
        <h2 id="single-heading" className="text-xl font-black tracking-tight text-gray-100 sm:text-2xl">One price</h2>
        <p className="mt-1 text-sm text-gray-400">Decimal (2.50), fractional (6/4) or American (+150) odds.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Odds" value={price} onChange={setPrice} placeholder="2.50" />
          <Field label="Stake (₦)" value={stake} onChange={setStake} placeholder="1000" />
        </div>
        {decimal ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <Figure label="Implied chance" value={pct(impliedProbability(decimal))} accent />
            <Figure label="Decimal odds" value={decimal.toFixed(2)} />
            {stakeValue > 0 && <Figure label="Return if it wins" value={naira(returnOn(stakeValue, decimal).total)} />}
          </div>
        ) : (
          <p className="mt-6 text-sm text-gray-400">Enter odds above 1.00, such as 2.50, 6/4 or +150.</p>
        )}
        {decimal && (
          <p className="mt-5 text-sm leading-relaxed text-gray-300">
            At {decimal.toFixed(2)}, a selection has to win more than {pct(impliedProbability(decimal))} of the time, over many bets, just to break even.
            {stakeValue > 0 && <> If it loses, the whole {naira(stakeValue)} is lost.</>}
          </p>
        )}
      </section>

      <section aria-labelledby="market-heading" className="rounded-3xl border border-brand-border bg-brand-card p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="market-heading" className="text-xl font-black tracking-tight text-gray-100 sm:text-2xl">A full market</h2>
            <p className="mt-1 text-sm text-gray-400">Every outcome&apos;s price, to see the bookmaker&apos;s margin and fair chances.</p>
          </div>
          <div role="group" aria-label="Market type" className="inline-flex rounded-xl border border-brand-border p-1">
            {[true, false].map((isThree) => (
              <button
                key={String(isThree)}
                type="button"
                aria-pressed={three === isThree}
                onClick={() => setThree(isThree)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${three === isThree ? "bg-brand text-on-brand" : "text-gray-400 hover:text-gray-100"}`}
              >
                {isThree ? "Home / draw / away" : "Two-way"}
              </button>
            ))}
          </div>
        </div>
        <div className={`mt-5 grid gap-4 ${three ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {labels.map((label, i) => (
            <Field key={label} label={label} value={market[i]} onChange={(v) => setMarket((m) => m.map((x, j) => (j === i ? v : x)))} placeholder="2.00" />
          ))}
        </div>
        {view ? (
          <>
            <div className="mt-6">
              <Figure label="Bookmaker margin" value={pct(view.margin)} accent />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                  <tr><th className="py-2 pr-4">Outcome</th><th className="py-2 pr-4">Implied</th><th className="py-2 pr-4">Fair chance</th><th className="py-2">Fair odds</th></tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {labels.map((label, i) => (
                    <tr key={label}>
                      <td className="py-2.5 pr-4 font-bold text-gray-100">{label}</td>
                      <td className="py-2.5 pr-4 text-gray-400">{pct(impliedProbability((prices as number[])[i]))}</td>
                      <td className="py-2.5 pr-4 font-bold text-gray-100">{pct(view.fair[i])}</td>
                      <td className="py-2.5 text-gray-400">{view.fairOdds[i].toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-300">
              The implied chances add up to {pct(view.book)}. The extra {pct(view.margin)} is the bookmaker&apos;s margin; dividing it out gives the market&apos;s fair view.
            </p>
          </>
        ) : (
          <p className="mt-6 text-sm text-gray-400">Enter a price above 1.00 for every outcome.</p>
        )}
      </section>
    </div>
  );
}
