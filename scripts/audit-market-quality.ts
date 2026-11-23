/**
 * READ-ONLY production audit of market selection quality (prediction quality
 * investigation, 23 Nov 2026).
 *
 *   REQUIRE_READ_ONLY=1 npx tsx scripts/audit-market-quality.ts [days=30]
 *
 * Run in CI by .github/workflows/market-quality-audit.yml on a session that
 * Postgres keeps read-only (default_transaction_read_only=on); with
 * REQUIRE_READ_ONLY=1 it refuses to start unless it can confirm that.
 *
 * The repository is PUBLIC, so the output is restricted to aggregates plus the
 * named homepage fixtures, whose picks and prices are already public on the
 * site. It prints no reasoning text, no user data, no ids of people.
 *
 * Makes NO provider calls (no football API, no model).
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "../src/lib/odds";
import { devigProbability } from "../src/lib/marketConfirmed";
import { selectHomepageFeatured } from "../src/lib/homepageFeatured";
import { lagosDateKey } from "../src/lib/lagosDate";

const H = 3_600_000, D = 24 * H;
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const r2 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const inc = (o: Record<string, number>, k: string, by = 1) => { o[k] = (o[k] ?? 0) + by; };
function bootstrapCI(values: number[], iters = 2000): [number, number] | null {
  if (values.length < 20) return null;
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) { let s = 0; for (let j = 0; j < values.length; j++) s += values[Math.floor(rnd() * values.length)]; means.push(s / values.length); }
  means.sort((a, b) => a - b);
  return [r3(means[Math.floor(iters * 0.05)])!, r3(means[Math.floor(iters * 0.95)])!];
}

type Intent = string;
function jobMeta(prompt: string | null | undefined): { intent: Intent; categories: string[] } {
  try { const p = JSON.parse(prompt ?? "{}"); return { intent: typeof p.intent === "string" ? p.intent : "ORDINARY", categories: Array.isArray(p.categories) ? p.categories : [] }; }
  catch { return { intent: "UNKNOWN", categories: [] }; }
}
/** Generation route, so incompatible populations are never pooled. */
function routeOf(p: { provenance: string; aiJobId: string | null }, intent: Intent): string {
  if (!p.aiJobId) return "MANUAL";
  if (intent === "EARLY_FREE_GENERATION") return "EARLY";
  if (p.provenance === "GOALS_GENERATED") return "GOALS";
  if (p.provenance === "VIP_GENERATED" || p.provenance === "PREMIUM_GENERATED") return "PAID_PASS";
  if (p.provenance === "VIP_ROUTE_CONFIRMED") return "VIP_ROUTE";
  if (p.provenance === "BANKER_GENERATED") return "BANKER";
  if (p.provenance === "MARKET_CONFIRMED") return "MARKET_CONFIRMED";
  if (intent === "EUROPEAN_CLUB") return "EUROPEAN";
  return "ORDINARY";
}

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.max(7, Math.min(120, Number(process.argv[2]) || 30));
  const now = new Date();
  const from = new Date(now.getTime() - days * D);

  const rows = await prisma.prediction.findMany({
    where: { OR: [{ createdAt: { gte: from } }, { kickoff: { gte: from } }], marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { id: true, status: true, marketType: true, selection: true, confidence: true, odds: true, outcome: true, provenance: true,
      kickoff: true, createdAt: true, publishedAt: true, approvedById: true, aiJobId: true, homeTeam: true, awayTeam: true,
      homeTeamApiId: true, awayTeamApiId: true, leagueApiId: true, fixtureApiId: true, ouLine: true, ouDirection: true, pick: true, market: true,
      categories: { select: { category: true } }, aiJob: { select: { prompt: true, rawOutput: true, model: true } } },
  });
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const caches = new Map<string, { odds: FixtureOdds | null; fetchedAt: Date | null; books: number | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    const batch = await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true, bookmakerCount: true } });
    for (const c of batch) caches.set(c.matchKey, { odds: (c.oddsJson as FixtureOdds | null) ?? null, fetchedAt: c.fetchedAt, books: c.bookmakerCount });
  }
  const enriched = rows.map((r) => {
    const meta = jobMeta(r.aiJob?.prompt);
    const route = routeOf(r, meta.intent);
    const cache = caches.get(matchKey(r) ?? "") ?? null;
    const mapped = toBookmakerSelection(r.marketType, r.selection);
    const sel = mapped && cache?.odds ? findSelection(cache.odds, mapped.market, mapped.value) : null;
    const fair = mapped && cache?.odds ? devigProbability(cache.odds, mapped.market, mapped.value) : null;
    const quoteLeadH = cache?.fetchedAt && r.kickoff ? (r.kickoff.getTime() - cache.fetchedAt.getTime()) / H : null;
    return { ...r, route, intent: meta.intent, jobCategories: meta.categories, mapped: !!mapped, median: sel?.median ?? null, books: sel?.bookmakers ?? null,
      fair: fair?.probability ?? null, quoteLeadH, hasCache: !!cache?.odds };
  });

  const windows = [7, 14, days].filter((v, i, a) => a.indexOf(v) === i);
  for (const w of windows) {
    const since = new Date(now.getTime() - w * D);
    const gen = enriched.filter((r) => r.createdAt >= since && r.aiJobId);
    const out: Record<string, unknown> = { window: `${w}d`, generatedRows: gen.length };

    // A. market distribution by route (all statuses) and by status
    const byRoute: Record<string, Record<string, number>> = {};
    for (const r of gen) { byRoute[r.route] ??= {}; inc(byRoute[r.route], r.marketType); }
    out.marketsByRoute = Object.fromEntries(Object.entries(byRoute).map(([k, v]) => [k, { n: Object.values(v).reduce((a, b) => a + b, 0), ...v }]));
    const byStatus: Record<string, Record<string, number>> = {};
    for (const r of gen) { byStatus[r.status] ??= {}; inc(byStatus[r.status], r.route); }
    out.statusByRoute = byStatus;

    // B. published by category x market (pending + settled), kickoff in window
    const pub = enriched.filter((r) => r.status === "PUBLISHED" && r.kickoff && r.kickoff >= since);
    const byCat: Record<string, Record<string, number>> = {};
    for (const r of pub) for (const c of r.categories.map((x) => x.category)) { byCat[c] ??= {}; inc(byCat[c], r.marketType); }
    out.publishedByCategory = Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, { n: Object.values(v).reduce((a, b) => a + b, 0), dcShare: pct(v.DOUBLE_CHANCE ?? 0, Object.values(v).reduce((a, b) => a + b, 0)), ...v }]));
    out.publishedManualVsAuto = { manualAuthored: pub.filter((r) => !r.aiJobId).length, generatedAdminApproved: pub.filter((r) => r.aiJobId && r.approvedById).length, generatedAutoPublished: pub.filter((r) => r.aiJobId && !r.approvedById).length };

    // C. price coverage on published picks
    const cov: Record<string, { n: number; mappable: number; priced: number; books5: number; medians: number[]; staleQuote: number }> = {};
    for (const r of pub) {
      const c = (cov[r.marketType] ??= { n: 0, mappable: 0, priced: 0, books5: 0, medians: [], staleQuote: 0 });
      c.n++; if (r.mapped) c.mappable++; if (r.median != null) { c.priced++; c.medians.push(r.median); if ((r.books ?? 0) >= 5) c.books5++; }
      if (r.quoteLeadH != null && r.quoteLeadH > 24) c.staleQuote++;
    }
    out.priceCoverage = Object.fromEntries(Object.entries(cov).map(([k, c]) => [k, { n: c.n, mappablePct: pct(c.mappable, c.n), pricedPct: pct(c.priced, c.n), fiveBooksPct: pct(c.books5, c.n),
      medianPrice: r2(median(c.medians)), p25: r2(c.medians.sort((a, b) => a - b)[Math.floor(c.medians.length * 0.25)]), under120Pct: pct(c.medians.filter((m) => m < 1.2).length, c.medians.length),
      quoteOlderThan24hBeforeKickoffPct: pct(c.staleQuote, c.n) }]));
    const allPub = pub.length;
    out.publishedWithVerifiedPricePct = pct(pub.filter((r) => r.median != null && (r.books ?? 0) >= 3).length, allPub);
    console.log(JSON.stringify(out));
  }

  // D. rejected and held (window = days)
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: from } }, select: { status: true, rawOutput: true, prompt: true } });
  const rej: Record<string, number> = {}; const jobsByIntent: Record<string, { jobs: number; rejected: number; multiPick: number }> = {};
  for (const j of jobs) {
    const intent = jobMeta(j.prompt).intent;
    const s = (jobsByIntent[intent] ??= { jobs: 0, rejected: 0, multiPick: 0 });
    s.jobs++;
    if (j.status === "REJECTED") { s.rejected++; inc(rej, (j.rawOutput.match(/^([A-Za-z]+Error)/)?.[1]) ?? "rejected-after-output"); }
    try { const o = JSON.parse(j.rawOutput); if (Array.isArray(o?.predictions) && o.predictions.length > 1) s.multiPick++; } catch { /* error text */ }
  }
  console.log(JSON.stringify({ section: "jobs", days, byIntent: jobsByIntent, rejectionReasons: rej }));
  const held = enriched.filter((r) => ["PENDING_REVIEW", "DRAFT", "APPROVED"].includes(r.status) && r.createdAt >= from);
  const heldBy: Record<string, number> = {}; for (const r of held) inc(heldBy, `${r.route}:${r.status}`);
  console.log(JSON.stringify({ section: "held", days, byRouteStatus: heldBy }));

  // E. calibration and realised return on settled published singles (kickoff in window)
  const settled = enriched.filter((r) => r.status === "PUBLISHED" && (r.outcome === "WON" || r.outcome === "LOST") && r.kickoff && r.kickoff >= from && r.kickoff < now);
  const bands = [[0, 60], [60, 70], [70, 75], [75, 80], [80, 85], [85, 101]];
  const cal: Record<string, unknown> = {};
  for (const m of [...new Set(settled.map((r) => r.marketType))]) {
    const rs = settled.filter((r) => r.marketType === m);
    const byBand = bands.map(([lo, hi]) => {
      const b = rs.filter((r) => r.confidence >= lo && r.confidence < hi);
      return b.length ? { band: `${lo}-${hi - 1}`, n: b.length, meanConf: r2(b.reduce((s, r) => s + r.confidence, 0) / b.length), strike: pct(b.filter((r) => r.outcome === "WON").length, b.length) } : null;
    }).filter(Boolean);
    const brierModel = rs.reduce((s, r) => s + (r.confidence / 100 - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / rs.length;
    const priced = rs.filter((r) => r.median != null && r.fair != null);
    const brierMkt = priced.length ? priced.reduce((s, r) => s + (r.fair! / 100 - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / priced.length : null;
    const brierModelPriced = priced.length ? priced.reduce((s, r) => s + (r.confidence / 100 - (r.outcome === "WON" ? 1 : 0)) ** 2, 0) / priced.length : null;
    const returns = rs.filter((r) => r.median != null).map((r) => (r.outcome === "WON" ? r.median! - 1 : -1));
    const ev = rs.filter((r) => r.median != null).map((r) => (r.confidence / 100) * r.median! - 1);
    cal[m] = { n: rs.length, strike: pct(rs.filter((r) => r.outcome === "WON").length, rs.length), meanConf: r2(rs.reduce((s, r) => s + r.confidence, 0) / rs.length), brierModel: r3(brierModel),
      pricedN: priced.length, brierModelOnPriced: r3(brierModelPriced), brierMarketOnPriced: r3(brierMkt),
      roiAtMedian: returns.length ? r3(returns.reduce((a, b) => a + b, 0) / returns.length) : null, roi90: bootstrapCI(returns),
      meanStatedEV: ev.length ? r3(ev.reduce((a, b) => a + b, 0) / ev.length) : null, medianPrice: r2(median(rs.filter((r) => r.median != null).map((r) => r.median!))), byBand };
  }
  console.log(JSON.stringify({ section: "calibration", days, settledPublishedSingles: settled.length, byMarket: cal }));
  const byRouteSettled: Record<string, unknown> = {};
  for (const route of [...new Set(settled.map((r) => r.route))]) {
    const rs = settled.filter((r) => r.route === route);
    const returns = rs.filter((r) => r.median != null).map((r) => (r.outcome === "WON" ? r.median! - 1 : -1));
    byRouteSettled[route] = { n: rs.length, strike: pct(rs.filter((r) => r.outcome === "WON").length, rs.length), dcShare: pct(rs.filter((r) => r.marketType === "DOUBLE_CHANCE").length, rs.length), roiAtMedian: returns.length ? r3(returns.reduce((a, b) => a + b, 0) / returns.length) : null, pricedN: returns.length };
  }
  console.log(JSON.stringify({ section: "settledByRoute", days, byRoute: byRouteSettled }));

  // F. price bands across markets (settled, priced)
  const pb = [[1, 1.12], [1.12, 1.2], [1.2, 1.3], [1.3, 1.45], [1.45, 1.7], [1.7, 2.2], [2.2, 99]];
  const priceBands = pb.map(([lo, hi]) => {
    const b = settled.filter((r) => r.median != null && r.median >= lo && r.median < hi);
    const ret = b.map((r) => (r.outcome === "WON" ? r.median! - 1 : -1));
    return { band: `${lo}-${hi}`, n: b.length, strike: pct(b.filter((r) => r.outcome === "WON").length, b.length), meanConf: b.length ? r2(b.reduce((s, r) => s + r.confidence, 0) / b.length) : null,
      meanFair: b.length && b.every((r) => r.fair != null) ? r2(b.reduce((s, r) => s + r.fair!, 0) / b.length) : null, roi: ret.length ? r3(ret.reduce((a, c) => a + c, 0) / ret.length) : null, roi90: bootstrapCI(ret),
      markets: b.reduce<Record<string, number>>((o, r) => { inc(o, r.marketType); return o; }, {}) };
  });
  console.log(JSON.stringify({ section: "priceBands", days, priceBands }));

  // G. stated confidence vs market fair probability, by market (is confidence comparable across markets?)
  const conf: Record<string, unknown> = {};
  for (const m of [...new Set(enriched.filter((r) => r.status === "PUBLISHED").map((r) => r.marketType))]) {
    const rs = enriched.filter((r) => r.status === "PUBLISHED" && r.marketType === m && r.fair != null && r.createdAt >= from);
    if (!rs.length) continue;
    conf[m] = { n: rs.length, meanConf: r2(rs.reduce((s, r) => s + r.confidence, 0) / rs.length), meanMarketFair: r2(rs.reduce((s, r) => s + r.fair!, 0) / rs.length),
      meanGapConfMinusFair: r2(rs.reduce((s, r) => s + r.confidence - r.fair!, 0) / rs.length) };
  }
  console.log(JSON.stringify({ section: "confidenceVsMarket", days, byMarket: conf }));

  // H. homepage FEATURED simulation per Lagos day (current ranking), last 14 days + next 3
  const featured = enriched.filter((r) => r.status === "PUBLISHED" && r.categories.some((c) => c.category === "FEATURED") && r.kickoff);
  const dayKeys = [...new Set(featured.map((r) => lagosDateKey(r.kickoff!)))].sort().slice(-17);
  const homepage = dayKeys.map((day) => {
    const dayRows = featured.filter((r) => lagosDateKey(r.kickoff!) === day);
    const six = selectHomepageFeatured(dayRows as never[], new Map()) as typeof dayRows;
    const mix: Record<string, number> = {}; for (const r of six) inc(mix, r.marketType);
    const pool: Record<string, number> = {}; for (const r of dayRows) inc(pool, r.marketType);
    return { day, featuredPool: dayRows.length, poolDcPct: pct(pool.DOUBLE_CHANCE ?? 0, dayRows.length), homepageSix: mix,
      homepageMedianPrice: r2(median(six.filter((r) => r.median != null).map((r) => r.median!))), homepagePriced: six.filter((r) => r.median != null).length };
  });
  console.log(JSON.stringify({ section: "homepageFeatured", byDay: homepage }));

  // I. the named homepage fixtures (public picks; no reasoning text)
  const named: Array<[string, string]> = [["Leipzig", "Lens"], ["Feyenoord", "Porto"], ["Ajax", "Thun"], ["Brighton", "Craiova"]];
  for (const [a, b] of named) {
    const hits = await prisma.prediction.findMany({
      where: { kickoff: { gte: new Date("2026-11-20T00:00:00Z"), lte: new Date("2026-11-30T00:00:00Z") },
        OR: [{ homeTeam: { contains: a, mode: "insensitive" }, awayTeam: { contains: b, mode: "insensitive" } }, { homeTeam: { contains: b, mode: "insensitive" }, awayTeam: { contains: a, mode: "insensitive" } }] },
      select: { status: true, marketType: true, selection: true, pick: true, market: true, confidence: true, odds: true, overUnder: true, provenance: true, kickoff: true, createdAt: true, publishedAt: true, approvedById: true,
        homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, leagueName: true, categories: { select: { category: true } }, aiJob: { select: { prompt: true, rawOutput: true, model: true, contextComplete: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!hits.length) { console.log(JSON.stringify({ section: "namedFixture", fixture: `${a} v ${b}`, found: 0 })); continue; }
    const key = matchKey(hits[0]);
    const c = key ? await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true, bookmakerCount: true } }) : null;
    const odds = (c?.oddsJson as FixtureOdds | null) ?? null;
    const q = (market: "Match Winner" | "Double Chance" | "Goals Over/Under" | "Both Teams Score", v: string) => {
      if (!odds) return null; const s = findSelection(odds, market, v); const f = devigProbability(odds, market, v);
      return s ? { median: r2(s.median), books: s.bookmakers, fair: r2(f?.probability ?? null) } : null;
    };
    const market = odds ? {
      fetchedAt: c?.fetchedAt, books: c?.bookmakerCount,
      home: q("Match Winner", "Home"), draw: q("Match Winner", "Draw"), away: q("Match Winner", "Away"),
      dc1X: q("Double Chance", "Home/Draw"), dcX2: q("Double Chance", "Draw/Away"), dc12: q("Double Chance", "Home/Away"),
      over15: q("Goals Over/Under", "Over 1.5"), over25: q("Goals Over/Under", "Over 2.5"), under25: q("Goals Over/Under", "Under 2.5"), over35: q("Goals Over/Under", "Over 3.5"),
      bttsYes: q("Both Teams Score", "Yes"), bttsNo: q("Both Teams Score", "No"),
    } : null;
    console.log(JSON.stringify({ section: "namedFixture", fixture: `${hits[0].homeTeam} v ${hits[0].awayTeam}`, league: hits[0].leagueName, kickoff: hits[0].kickoff, market,
      rows: hits.map((h) => {
        let drafts: unknown = null;
        try { const o = JSON.parse(h.aiJob?.rawOutput ?? "{}"); drafts = Array.isArray(o.predictions) ? o.predictions.map((p: { marketType: string; selection: unknown; confidence: number; overUnderLine?: number; overUnderDirection?: string }) => ({ marketType: p.marketType, selection: p.selection, confidence: p.confidence, ou: `${p.overUnderDirection ?? ""} ${p.overUnderLine ?? ""}`.trim() })) : null; } catch { drafts = "non-json"; }
        const meta = jobMeta(h.aiJob?.prompt);
        const mapped = toBookmakerSelection(h.marketType, h.selection);
        return { status: h.status, categories: h.categories.map((x) => x.category), market: h.market, pick: h.pick, marketType: h.marketType, confidence: h.confidence, storedOdds: h.odds,
          pickMedian: mapped && odds ? r2(findSelection(odds, mapped.market, mapped.value)?.median ?? null) : null, pickFair: mapped && odds ? r2(devigProbability(odds, mapped.market, mapped.value)?.probability ?? null) : null,
          overUnderColumn: h.overUnder, provenance: h.provenance, intent: meta.intent, jobCategories: meta.categories, model: h.aiJob?.model?.split(":")[0] ?? null,
          contextComplete: h.aiJob?.contextComplete ?? null, autoPublished: h.status === "PUBLISHED" && !h.approvedById, createdAt: h.createdAt, publishedAt: h.publishedAt, modelDrafts: drafts };
      }) }));
  }

  // J. API-Football usage per UTC day (real calls only, not telemetry rows)
  const usage = await prisma.apiUsage.findMany({ where: { day: { gte: new Date(now.getTime() - 14 * D).toISOString().slice(0, 10), lt: "a" } }, select: { day: true, count: true } });
  const perDay: Record<string, number> = {}; for (const u of usage) if (/^\d{4}-\d{2}-\d{2}$/.test(u.day)) inc(perDay, u.day, u.count);
  console.log(JSON.stringify({ section: "apiUsagePerDay", perDay }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
