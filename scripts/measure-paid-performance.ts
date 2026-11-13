/**
 * Paid-tier performance audit: one read-only report over settled history.
 *
 *   A. Per feed (VIP, PREMIUM, BANKER, GENIUS, GOALS, FREE) and, inside VIP,
 *      dedicated vs ordinary: n, W/L/V/unresolved, strike, decimal odds
 *      (mean/median), flat one-unit ROI, longest losing run, max drawdown,
 *      Brier (model and market) and closing-line value where a price exists.
 *   B. The same split by market, odds band, confidence tier and league.
 *   C. Calibration: stated confidence against realised strike, per band.
 *   D. Settlement audit: every auto-settleable row re-resolved from its stored
 *      final score with resolveMarket, compared with the stored outcome.
 *   E. Daily paid-feed counts and one day in detail (argv[3], default today in
 *      Lagos): every published row on that day and why it was, or was not, in VIP.
 *
 * PRICES, AND HOW LOOK-AHEAD IS AVOIDED. Prediction.odds is stored null, so the
 * price a reader saw is the fixture's cached bookmaker quote. FixtureOddsCache
 * keeps one row per fixture, overwritten on refresh, so for a settled fixture it
 * holds the LAST quote taken. It is used only when fetchedAt is before kickoff
 * (a pre-match price, near the close); otherwise the row counts as unpriced and
 * is excluded from ROI rather than priced with post-kickoff information. The
 * median across books is used, not the best: the best is an outlier by
 * construction and would flatter ROI. A dedicated paid pick also carries the
 * de-vigged market probability frozen at promotion (marketConfirmation), which
 * is its entry price; entry vs the last pre-kickoff quote is its CLV.
 *
 * DUPLICATES. Each prediction counts once per feed. A fixture carried twice in a
 * feed (it should not be) is reported, and only its first row is scored.
 *
 * READ-ONLY. No provider calls, no writes.
 *
 * Run: npx tsx --env-file=.env scripts/measure-paid-performance.ts [days=90] [day=YYYY-MM-DD]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { resolveMarket, type MarketType, type Selection } from "../src/lib/markets";
import type { FixtureOdds } from "../src/lib/odds";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { DEDICATED_PAID_PROVENANCES, VIP_ROUTE_PROVENANCE, VIP_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { matchKey } from "../src/lib/slug";
import { pickPrice, type PricedPick } from "../src/lib/paidSelection";

const H = 3_600_000;
const DAY = 24 * H;

type Row = {
  id: string; kickoff: Date; leagueApiId: number | null; leagueName: string | null; homeTeam: string | null; awayTeam: string | null;
  marketType: string; selection: unknown; market: string; pick: string; confidence: number; outcome: string; provenance: string | null;
  categories: string[]; finalHomeScore: number | null; finalAwayScore: number | null; manualSettlementOnly: boolean;
  fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; marketConfirmation: any;
  publishedAt: Date | null; createdAt: Date;
  price: PricedPick | null; entryFair: number | null; aiJob?: { model: string } | null;
};

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const f2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Wilson 95% interval for a strike rate — the uncertainty a sample this size carries. */
function wilson(k: number, n: number): string {
  if (!n) return "—";
  const z = 1.96, p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return `${(100 * (c - h)).toFixed(0)}–${(100 * (c + h)).toFixed(0)}%`;
}

type Stats = ReturnType<typeof summarise>;
function summarise(rows: Row[]) {
  const ordered = [...rows].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
  const won = ordered.filter((r) => r.outcome === "WON").length;
  const lost = ordered.filter((r) => r.outcome === "LOST").length;
  const voided = ordered.filter((r) => r.outcome === "VOID").length;
  const pending = ordered.length - won - lost - voided;
  const decided = won + lost;
  // ROI only over rows with a pre-kickoff price; a void returns the stake.
  let staked = 0, profit = 0, bank = 0, peak = 0, maxDd = 0;
  const odds: number[] = [];
  for (const r of ordered) {
    if (!r.price || !["WON", "LOST", "VOID"].includes(r.outcome)) continue;
    staked++;
    odds.push(r.price.median);
    const pnl = r.outcome === "WON" ? r.price.median - 1 : r.outcome === "LOST" ? -1 : 0;
    profit += pnl;
    bank += pnl;
    peak = Math.max(peak, bank);
    maxDd = Math.max(maxDd, peak - bank);
  }
  let run = 0, maxRun = 0;
  for (const r of ordered) {
    if (r.outcome === "LOST") maxRun = Math.max(maxRun, ++run);
    else if (r.outcome === "WON") run = 0;
  }
  // Brier over decided rows: model's stated confidence, and the market's
  // de-vigged close on the same rows where it exists (a like-for-like subset).
  const dec = ordered.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const brier = (ps: Array<[number, number]>) => (ps.length ? ps.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / ps.length : null);
  const both = dec.filter((r) => r.price?.fair != null);
  const modelBrier = brier(dec.map((r) => [r.confidence / 100, r.outcome === "WON" ? 1 : 0]));
  const modelBrierBoth = brier(both.map((r) => [r.confidence / 100, r.outcome === "WON" ? 1 : 0]));
  const marketBrierBoth = brier(both.map((r) => [r.price!.fair! / 100, r.outcome === "WON" ? 1 : 0]));
  const clv = ordered.filter((r) => r.entryFair != null && r.price?.fair != null).map((r) => r.price!.fair! - r.entryFair!);
  const meanConf = dec.length ? dec.reduce((s, r) => s + r.confidence, 0) / dec.length : null;
  return {
    n: ordered.length, won, lost, voided, pending, decided,
    strike: decided ? won / decided : null, ci: wilson(won, decided),
    staked, profit, roi: staked ? profit / staked : null, maxDd, maxRun,
    meanOdds: odds.length ? odds.reduce((a, b) => a + b, 0) / odds.length : null, medianOdds: median(odds),
    modelBrier, modelBrierBoth, marketBrierBoth, pricedDecided: both.length,
    clvN: clv.length, clvMean: clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null,
    meanConf,
  };
}

function line(label: string, s: Stats, w = 26) {
  return [
    label.slice(0, w).padEnd(w),
    String(s.n).padStart(4),
    `${s.won}/${s.lost}/${s.voided}/${s.pending}`.padStart(13),
    (s.strike == null ? "—" : `${(100 * s.strike).toFixed(1)}%`).padStart(6),
    s.ci.padStart(8),
    (s.meanConf == null ? "—" : s.meanConf.toFixed(1)).padStart(5),
    f2(s.meanOdds).padStart(5), f2(s.medianOdds).padStart(5),
    String(s.staked).padStart(4),
    (s.roi == null ? "—" : `${(100 * s.roi).toFixed(1)}%`).padStart(7),
    s.profit.toFixed(2).padStart(7),
    s.maxDd.toFixed(2).padStart(6),
    String(s.maxRun).padStart(3),
    f2(s.modelBrier).padStart(5),
    s.pricedDecided ? `${f2(s.modelBrierBoth)}/${f2(s.marketBrierBoth)}`.padStart(10) : "—".padStart(10),
    s.clvN ? `${s.clvMean! >= 0 ? "+" : ""}${s.clvMean!.toFixed(1)}pp n=${s.clvN}` : "",
  ].join(" ");
}
const HEADER = `${"".padEnd(26)}    n  W/L/V/unres  strike  95% CI  conf  mOdd  med%  stk     ROI     P/L    mDD  LR brier mdl/mkt  CLV`;

function table(title: string, groups: Map<string, Row[]>, minN = 1, w = 26) {
  console.log(`\n${title}`);
  console.log(HEADER.replace("med%", "medO"));
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, rows] of sorted) if (rows.length >= minN) console.log(line(k, summarise(rows), w));
  const small = sorted.filter(([, r]) => r.length < minN).length;
  if (small) console.log(`  (${small} groups under n=${minN} not shown)`);
}

const group = (rows: Row[], key: (r: Row) => string | null) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
};

const oddsBand = (r: Row) => {
  const o = r.price?.median;
  if (o == null) return "unpriced";
  if (o < 1.2) return "a <1.20";
  if (o < 1.35) return "b 1.20–1.34";
  if (o < 1.5) return "c 1.35–1.49";
  if (o < 1.7) return "d 1.50–1.69";
  if (o < 2.0) return "e 1.70–1.99";
  if (o < 2.5) return "f 2.00–2.49";
  return "g 2.50+";
};
const confBand = (r: Row) => (r.confidence >= 85 ? "85+" : r.confidence >= 80 ? "80–84" : r.confidence >= 75 ? "75–79" : r.confidence >= 70 ? "70–74" : r.confidence >= 65 ? "65–69" : "<65");

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.max(1, Number(process.argv[2]) || 90);
  const now = new Date();
  const focusDay = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[3] ?? "") ? process.argv[3] : lagosDateKey(now);
  const since = new Date(now.getTime() - days * DAY);

  const raw = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: since, lte: new Date(now.getTime() + 3 * DAY) }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, kickoff: true, leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, marketType: true, selection: true,
      market: true, pick: true, confidence: true, outcome: true, provenance: true, finalHomeScore: true, finalAwayScore: true,
      manualSettlementOnly: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, marketConfirmation: true,
      publishedAt: true, createdAt: true, categories: { select: { category: true } }, aiJob: { select: { model: true } },
    },
  });
  // Hidden combo legs (a single carrying the SAME_GAME_DOUBLE tag) were never shown as singles.
  const visible = raw.filter((r) => r.kickoff && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));

  const keys = [...new Set(visible.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }

  let postKickoffQuotes = 0;
  const rows: Row[] = visible.map((r) => {
    const k = matchKey(r);
    const q = k ? quotes.get(k) : undefined;
    const preKickoff = !!q?.fetchedAt && q.fetchedAt.getTime() < r.kickoff!.getTime();
    if (q?.fetchedAt && !preKickoff) postKickoffQuotes++;
    const price = preKickoff ? pickPrice(q!.oddsJson, r.marketType, r.selection) : null;
    const mc = r.marketConfirmation as any;
    return {
      ...r, kickoff: r.kickoff!, categories: r.categories.map((c) => c.category),
      price, entryFair: typeof mc?.marketProbability === "number" ? mc.marketProbability : null,
    };
  });

  const settledWindow = rows.filter((r) => r.kickoff.getTime() < now.getTime() - 3 * H);
  console.log(`\nWindow: kickoffs ${lagosDateKey(since)} .. ${lagosDateKey(now)} (${days} days). Published singles: ${settledWindow.length}; ` +
    `with a pre-kickoff price: ${settledWindow.filter((r) => r.price).length}; quotes dropped as post-kickoff: ${postKickoffQuotes}.`);
  console.log("Legend: W/L/V/unres = won/lost/void/unresolved. ROI is flat 1 unit at the median bookmaker price, priced rows only. " +
    "mDD = max drawdown in units. LR = longest losing run. brier mdl/mkt = model vs de-vigged market close on the same priced rows (lower is better). " +
    "CLV = last pre-kickoff fair probability minus entry fair probability (positive: the market moved toward the pick).");

  // ── A. Feeds ─────────────────────────────────────────────────────────────
  const feeds = new Map<string, Row[]>();
  const push = (k: string, r: Row) => (feeds.get(k) ?? feeds.set(k, []).get(k)!).push(r);
  const dupes: Record<string, number> = {};
  for (const feed of ["VIP", "PREMIUM", "BANKER", "GENIUS", "GOALS"]) {
    const seen = new Set<string>();
    for (const r of settledWindow.filter((x) => x.categories.includes(feed))) {
      const k = matchKey(r) ?? r.id;
      if (seen.has(k)) { dupes[feed] = (dupes[feed] ?? 0) + 1; continue; }
      seen.add(k);
      push(feed, r);
      if (feed === "VIP") push(`VIP · ${(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "") ? "dedicated" : "ordinary"}`, r);
    }
  }
  for (const r of settledWindow) if (!isPaidOnlyProvenance(r.provenance) && !r.categories.some((c) => c === "VIP" || c === "PREMIUM")) push("FREE (all free singles)", r);
  for (const r of settledWindow) if (!isPaidOnlyProvenance(r.provenance) && r.confidence >= VIP_CONFIDENCE_FLOOR && !r.categories.includes("VIP")) push("free, conf>=75, not in VIP", r);
  table("A. Feeds (each fixture once per feed)", feeds);
  if (Object.keys(dupes).length) console.log(`  Duplicate fixtures inside a feed, excluded: ${JSON.stringify(dupes)}`);

  const vip = feeds.get("VIP") ?? [];
  const free = feeds.get("FREE (all free singles)") ?? [];
  table("B1. VIP by market", group(vip, (r) => r.marketType));
  table("B2. VIP by odds band (median price)", group(vip, oddsBand));
  table("B3. VIP by confidence", group(vip, confBand));
  table("B4. VIP by league (n>=5)", group(vip, (r) => r.leagueName ?? String(r.leagueApiId)), 5, 30);
  table("B5. All free singles by market", group(free, (r) => r.marketType));
  table("B6. All free singles by odds band", group(free, oddsBand));
  table("B7. All published singles by market × odds band (n>=10)", group(settledWindow, (r) => `${r.marketType} ${oddsBand(r)}`), 10, 34);
  table("B8. All published singles by league (n>=15)", group(settledWindow, (r) => r.leagueName ?? String(r.leagueApiId)), 15, 30);

  // ── C. Calibration ───────────────────────────────────────────────────────
  console.log("\nC. Calibration, all published singles: stated confidence vs realised strike (decided rows)");
  console.log("   band     n   mean conf  strike   95% CI   | priced n  mean mkt fair  strike  | model edge over market");
  for (const [band, rs] of [...group(settledWindow, confBand).entries()].sort()) {
    const dec = rs.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
    const won = dec.filter((r) => r.outcome === "WON").length;
    const priced = dec.filter((r) => r.price?.fair != null);
    const pw = priced.filter((r) => r.outcome === "WON").length;
    const mc = dec.length ? dec.reduce((s, r) => s + r.confidence, 0) / dec.length : 0;
    const mf = priced.length ? priced.reduce((s, r) => s + r.price!.fair!, 0) / priced.length : 0;
    const pc = priced.length ? priced.reduce((s, r) => s + r.confidence, 0) / priced.length : 0;
    console.log(`   ${band.padEnd(6)} ${String(dec.length).padStart(4)}   ${mc.toFixed(1).padStart(6)}   ${pct(won, dec.length).padStart(6)}  ${wilson(won, dec.length).padStart(8)} | ${String(priced.length).padStart(5)}   ${mf.toFixed(1).padStart(8)}     ${pct(pw, priced.length).padStart(6)}  | conf ${pc.toFixed(1)} vs mkt ${mf.toFixed(1)}`);
  }

  // Market-implied vs realised, in market-probability bands — is the market itself calibrated here?
  console.log("\nC2. De-vigged market probability band vs realised (priced decided singles) and model-minus-market edge");
  const mband = (r: Row) => { const p = r.price?.fair; if (p == null) return null; return p >= 87 ? "87+" : p >= 80 ? "80–86" : p >= 75 ? "75–79" : p >= 65 ? "65–74" : p >= 55 ? "55–64" : p >= 45 ? "45–54" : "<45"; };
  for (const [band, rs] of [...group(settledWindow.filter((r) => r.outcome === "WON" || r.outcome === "LOST"), mband).entries()].sort()) {
    const won = rs.filter((r) => r.outcome === "WON").length;
    const s = summarise(rs);
    const edgeHi = rs.filter((r) => r.confidence - r.price!.fair! >= 5);
    const edgeLo = rs.filter((r) => r.confidence - r.price!.fair! < 5);
    const sh = summarise(edgeHi), sl = summarise(edgeLo);
    console.log(`   mkt ${band.padEnd(6)} n=${String(rs.length).padStart(4)} strike ${pct(won, rs.length).padStart(6)} ${wilson(won, rs.length).padStart(8)} ROI ${s.roi == null ? "—" : (100 * s.roi).toFixed(1) + "%"} | model>=mkt+5: n=${edgeHi.length} ROI ${sh.roi == null ? "—" : (100 * sh.roi).toFixed(1) + "%"} | else n=${edgeLo.length} ROI ${sl.roi == null ? "—" : (100 * sl.roi).toFixed(1) + "%"}`);
  }

  // ── D. Settlement audit ──────────────────────────────────────────────────
  const auditable = settledWindow.filter((r) => !r.manualSettlementOnly && r.finalHomeScore != null && r.finalAwayScore != null && ["WON", "LOST", "VOID"].includes(r.outcome));
  const mismatches: string[] = [];
  let unresolvable = 0;
  for (const r of auditable) {
    let expected: string | null = null;
    try {
      expected = resolveMarket(r.marketType as MarketType, r.selection as Selection, r.finalHomeScore!, r.finalAwayScore!);
    } catch { expected = null; }
    if (expected == null) { unresolvable++; continue; }
    if (expected !== r.outcome) mismatches.push(`${lagosDateKey(r.kickoff)} ${r.homeTeam} v ${r.awayTeam} ${r.marketType} ${JSON.stringify(r.selection)} ${r.finalHomeScore}-${r.finalAwayScore}: stored ${r.outcome}, expected ${expected}`);
  }
  const stale = settledWindow.filter((r) => r.outcome === "PENDING" && r.kickoff.getTime() < now.getTime() - 6 * H);
  console.log(`\nD. Settlement audit: ${auditable.length} auto-settleable rows re-resolved from stored scores; ${mismatches.length} disagree; ${unresolvable} not re-resolvable from full-time score alone (half-time markets).`);
  for (const m of mismatches.slice(0, 25)) console.log(`   ${m}`);
  console.log(`   Unresolved more than 6h after kickoff: ${stale.length} (${[...group(stale, (r) => `${r.manualSettlementOnly ? "manual-only " : ""}${r.marketType}`).entries()].map(([k, v]) => `${k} ${v.length}`).join(", ") || "none"})`);

  // ── F. By generation model and by week ──────────────────────────────────
  const provider = (r: Row) => (r.aiJob?.model ?? "none").split(":")[0];
  table("F1. All published singles by generation provider", group(settledWindow, provider));
  table("F2. VIP-route (core-league) singles by generation provider", group(settledWindow.filter((r) => r.provenance === VIP_ROUTE_PROVENANCE), provider));
  console.log("\nF3. Confidence distribution of ordinary singles by Lagos ISO week and provider: n, mean conf, share >=75, share >=80");
  const week = (d: Date) => { const k = lagosDateKey(d); const t = new Date(`${k}T00:00:00Z`); const dow = (t.getUTCDay() + 6) % 7; return lagosDateKey(new Date(t.getTime() - dow * DAY)); };
  const ord = rows.filter((r) => !isPaidOnlyProvenance(r.provenance) && !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "") && r.provenance !== "GOALS_GENERATED");
  for (const [k, rs] of [...group(ord, (r) => `${week(r.kickoff)} ${provider(r)}`).entries()].sort()) {
    const m = rs.reduce((s, r) => s + r.confidence, 0) / rs.length;
    const vr = rs.filter((r) => r.provenance === VIP_ROUTE_PROVENANCE);
    console.log(`   ${k.padEnd(22)} n=${String(rs.length).padStart(4)} mean ${m.toFixed(1)}  >=75 ${pct(rs.filter((r) => r.confidence >= 75).length, rs.length).padStart(6)}  >=80 ${pct(rs.filter((r) => r.confidence >= 80).length, rs.length).padStart(6)} | vip-route n=${vr.length} >=75 ${vr.filter((r) => r.confidence >= 75).length}`);
  }

  // ── E. Daily paid feed counts, and the focus day ─────────────────────────
  console.log("\nE1. Per Lagos kickoff day: published singles / VIP-route conf>=75 / VIP (dedicated+ordinary) / PREMIUM, last 21 days");
  const byDay = group(rows, (r) => lagosDateKey(r.kickoff));
  for (const day of [...byDay.keys()].sort().slice(-24)) {
    const rs = byDay.get(day)!;
    const v = rs.filter((r) => r.categories.includes("VIP"));
    const vd = v.filter((r) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "")).length;
    const prem = rs.filter((r) => r.categories.includes("PREMIUM")).length;
    const eligible = rs.filter((r) => r.provenance === VIP_ROUTE_PROVENANCE && r.confidence >= VIP_CONFIDENCE_FLOOR).length;
    const vOdds = v.map((r) => r.price?.median).filter((x): x is number => x != null);
    console.log(`   ${day}  singles ${String(rs.length).padStart(3)}  vip-route>=75 ${String(eligible).padStart(3)}  VIP ${v.length} (${vd}+${v.length - vd})  PREMIUM ${prem}  VIP median price ${f2(median(vOdds))}`);
  }

  console.log(`\nE2. Focus day ${focusDay}: every published single, in kickoff order`);
  const day = (byDay.get(focusDay) ?? []).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  for (const r of day) {
    const tags = r.categories.join(",");
    const why = r.categories.includes("VIP") ? "IN VIP"
      : isPaidOnlyProvenance(r.provenance) ? "paid-only, not tagged"
      : r.provenance !== VIP_ROUTE_PROVENANCE && !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "") ? `route ${r.provenance}`
      : r.confidence < VIP_CONFIDENCE_FLOOR ? `conf ${r.confidence}<75`
      : "eligible, not curated";
    console.log(`   ${r.kickoff.toISOString().slice(11, 16)}Z ${(r.leagueName ?? "").slice(0, 18).padEnd(18)} ${`${r.homeTeam} v ${r.awayTeam}`.slice(0, 34).padEnd(34)} ${r.marketType.padEnd(13)} ${r.pick.slice(0, 22).padEnd(22)} c${r.confidence} ${r.price ? `@${f2(r.price.median)} fair ${r.price.fair?.toFixed(0) ?? "—"}%` : "@—"} ${r.outcome.padEnd(7)} [${tags}] ${why}`);
  }

  // Fixtures in the ledger that day and how far they got.
  const { start, end } = (() => {
    const s = new Date(`${focusDay}T00:00:00+01:00`);
    return { start: s, end: new Date(s.getTime() + DAY) };
  })();
  const ledger = await prisma.generationAttempt.findMany({ where: { kickoff: { gte: start, lt: end } }, select: { status: true, leagueApiId: true, leagueName: true, lastError: true } });
  const byStatus = group(ledger as any, (l: any) => l.status);
  console.log(`\nE3. Ledger for ${focusDay}: ${ledger.length} fixtures discovered — ${[...byStatus.entries()].map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
  const errs = group((ledger as any[]).filter((l) => l.status !== "SUCCEEDED" && l.lastError), (l: any) => String(l.lastError).slice(0, 70));
  for (const [e, ls] of [...errs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) console.log(`   ${String(ls.length).padStart(3)} × ${e}`);

  // Dedicated pass jobs created that day and their outcome.
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: new Date(start.getTime() - DAY), lt: end }, prompt: { contains: '"intent":"VIP_PREMIUM"' } },
    select: { createdAt: true, prompt: true, predictions: { select: { status: true, provenance: true, marketType: true, pick: true, confidence: true, kickoff: true, homeTeam: true, awayTeam: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\nE4. Dedicated VIP/PREMIUM attempts created ${lagosDateKey(new Date(start.getTime() - DAY))}..${focusDay}: ${jobs.length}`);
  for (const j of jobs) {
    const p = j.predictions[0];
    const outcome = j.predictions.map((x) => `${x.marketType}:${x.pick.slice(0, 18)} c${x.confidence} ${x.status}/${x.provenance}`).join(" | ");
    console.log(`   ${j.createdAt.toISOString().slice(0, 16)} ${p ? `${p.homeTeam} v ${p.awayTeam} ko ${p.kickoff?.toISOString().slice(0, 16)}` : "(no rows)"} :: ${outcome}`);
  }

  // Dedicated pass JobRun funnel on those days.
  const runs = await prisma.jobRun.findMany({ where: { job: "generate-vip-premium", ranAt: { gte: new Date(start.getTime() - DAY), lt: end } }, select: { ranAt: true, ok: true, summary: true, detail: true }, orderBy: { ranAt: "asc" } }).catch(() => []);
  const skip: Record<string, number> = {}; const rej: Record<string, number> = {};
  let withTargets = 0, quotaSpent = 0;
  for (const r of runs) {
    const d = (r.detail as any) ?? {}; const v = d.vipPremium ?? d;
    if (typeof v?.skipped === "object") for (const [k, n] of Object.entries(v.skipped)) skip[k] = (skip[k] ?? 0) + Number(n);
    if (typeof v?.rejectedReasons === "object") for (const [k, n] of Object.entries(v.rejectedReasons)) rej[k] = (rej[k] ?? 0) + Number(n);
    if (Array.isArray(v?.targets) && v.targets.length) withTargets++;
    if (String(r.summary ?? "").includes("quota")) quotaSpent++;
  }
  console.log(`\nE5. Dedicated pass runs over those two days: ${runs.length}; with a target: ${withTargets}; quota-spent stand-downs: ${quotaSpent}`);
  console.log(`   skip reasons (fixture-run counts): ${JSON.stringify(skip)}`);
  console.log(`   gate rejections: ${JSON.stringify(rej)}`);
  for (const r of runs.filter((x) => !String(x.summary ?? "").includes("quota")).slice(-12)) console.log(`   ${r.ranAt.toISOString().slice(0, 16)} ${r.ok ? "ok " : "ERR"} ${String(r.summary ?? "").slice(0, 150)}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
