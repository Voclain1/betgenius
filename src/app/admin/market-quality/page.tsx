import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { loadMarketQualityReport } from "@/lib/marketQualityReport";
import { marketSelectionMode, marketQualityRankingEnabled } from "@/lib/marketSelection";

export const dynamic = "force-dynamic";

/**
 * Market-quality monitoring: what markets are being published, whether their
 * prices are verified, how the market-selection guard is deciding, calibration
 * drift, API use and paid availability. Read-only; admin-only; never public.
 * See src/lib/marketQualityReport.ts and docs/PREDICTION_MARKET_QUALITY_2026-11-23.md.
 */
export default async function MarketQualityPage({ searchParams }: { searchParams?: { days?: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) redirect("/login");
  const days = [7, 14, 30].includes(Number(searchParams?.days)) ? Number(searchParams?.days) : 7;
  const r = await loadMarketQualityReport({ days });
  const m = r.metrics;
  const Table = ({ data }: { data: Record<string, Record<string, number>> }) => {
    const markets = [...new Set(Object.values(data).flatMap((v) => Object.keys(v)))].sort();
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-gray-400"><th className="py-2 pr-3">Group</th><th className="py-2 pr-3">n</th>{markets.map((x) => <th key={x} className="py-2 pr-3">{x.replace(/_/g, " ").toLowerCase()}</th>)}</tr></thead>
          <tbody className="divide-y divide-brand-border">
            {Object.entries(data).map(([k, v]) => {
              const n = Object.values(v).reduce((a, b) => a + b, 0);
              return <tr key={k}><td className="py-2 pr-3 font-semibold">{k}</td><td className="py-2 pr-3 tabular-nums">{n}</td>
                {markets.map((x) => <td key={x} className="py-2 pr-3 tabular-nums text-gray-300">{n ? `${Math.round((100 * (v[x] ?? 0)) / n)}%` : "—"}</td>)}</tr>;
            })}
          </tbody>
        </table>
      </div>
    );
  };
  const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div className="card"><div className="text-xs text-gray-400">{label}</div><div className="text-2xl font-bold tabular-nums">{value}</div>{note && <div className="text-xs text-gray-500">{note}</div>}</div>
  );
  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Market quality</h1>
        <p className="max-w-3xl text-sm text-gray-400">
          Published singles with kickoff in the last {days} days. Prices are the cached bookmaker median for the exact selection.
          Selection mode: <b className="text-gray-200">{marketSelectionMode()}</b> · quality ranking: <b className="text-gray-200">{marketQualityRankingEnabled() ? "on" : "off"}</b>.
        </p>
        <nav className="flex gap-3 text-sm">{[7, 14, 30].map((d) => <Link key={d} href={`/admin/market-quality?days=${d}`} className={d === days ? "font-semibold text-white" : "text-gray-400 hover:text-white"}>{d} days</Link>)}</nav>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Alerts</h2>
        {r.alerts.length === 0 ? <p className="flex items-center gap-1.5 text-sm text-gray-300"><CheckCircle2 size={15} aria-hidden />No deterioration against the measured baseline.</p> : (
          <ul className="space-y-1.5">{r.alerts.map((a) => <li key={a.key} className={`flex items-start gap-1.5 text-sm ${a.level === "warn" ? "text-amber-300" : "text-gray-300"}`}>
            {a.level === "warn" ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> : <Info size={15} className="mt-0.5 shrink-0" aria-hidden />}{a.message}</li>)}</ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Published singles" value={String(m.publishedSingles)} />
        <Stat label="Verified price" value={`${m.verifiedPricePct ?? "—"}%`} note={`baseline ${r.baseline.verifiedPricePct.baseline}%`} />
        <Stat label="No executable price" value={`${m.unpricedPct ?? "—"}%`} note={`baseline ${r.baseline.unpricedPct.baseline}%`} />
        <Stat label="Median price" value={m.medianPrice?.toFixed(2) ?? "—"} note={`short (<1.20): ${m.shortPricePct ?? "—"}%`} />
        <Stat label="Below 1.12 (automatic)" value={String(m.belowFloorAutomatic)} />
        <Stat label="FEATURED fixtures with >1 pick" value={`${m.duplicateFixturePct ?? "—"}%`} note={`baseline ${r.baseline.duplicateFixturePct.baseline}%`} />
        <Stat label="Double Chance in FEATURED" value={`${m.doubleChanceFeaturedPct ?? "—"}%`} note={`baseline ${r.baseline.doubleChanceFeaturedPct.baseline}%`} />
        <Stat label="VIP / Premium published" value={String(m.paid.vipPremiumPublished)} note={`30-day rate: ${m.paid.expectedFrom30d}`} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Market mix by category</h2>
        <Table data={m.marketsByCategory} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Market mix by generation route</h2>
        <Table data={m.marketsByRoute} />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">Selection decisions (rows with a generation record)</h2>
          <p className="text-sm text-gray-400">{m.selection.recordedRows} rows · hold {m.selection.holdPct ?? "—"}%</p>
          <ul className="text-sm text-gray-300">{Object.entries(m.selection.decisions).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          <ul className="text-sm text-gray-400">{Object.entries(m.selection.holdReasons).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          <p className="text-xs text-gray-500">Price tiers now: {Object.entries(m.tiers).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">Calibration, last 30 days (settled)</h2>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-gray-400"><th className="py-1 pr-3">Market</th><th className="py-1 pr-3">n</th><th className="py-1 pr-3">Strike</th><th className="py-1 pr-3">Stated</th><th className="py-1">Gap</th></tr></thead>
            <tbody>{Object.entries(m.calibration30d).map(([k, c]) => <tr key={k}><td className="py-1 pr-3">{k.replace(/_/g, " ").toLowerCase()}</td><td className="py-1 pr-3 tabular-nums">{c.n}</td><td className="py-1 pr-3 tabular-nums">{c.strike}%</td><td className="py-1 pr-3 tabular-nums">{c.meanConfidence}%</td><td className="py-1 tabular-nums">{c.gapPP > 0 ? "+" : ""}{c.gapPP}</td></tr>)}</tbody></table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">API-Football requests per UTC day</h2>
        <p className="text-sm text-gray-300 tabular-nums">{Object.entries(m.apiPerDay).sort().map(([d, n]) => `${d.slice(5)}: ${n}`).join(" · ") || "—"}</p>
      </section>
    </div>
  );
}
