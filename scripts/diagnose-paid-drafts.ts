/**
 * READ-ONLY: why do dedicated paid drafts fail the market-confirmation gate?
 * Every VIP_PREMIUM model job in the window, each draft judged by the same
 * evaluateMarketConfirmed the gate uses, against the cached quote (latest
 * cached price: a near-close PROXY, not the quote at generation; judged with
 * now = the quote's fetch time so staleness does not mask the real reason).
 * Aggregates only (the repository is public). No provider or model calls.
 *
 *   REQUIRE_READ_ONLY=1 npx tsx scripts/diagnose-paid-drafts.ts [days]
 */
import { PrismaClient } from "@prisma/client";
import { evaluateMarketConfirmed, MC_MIN_MODEL_CONFIDENCE, MC_MAX_GAP_PP } from "../src/lib/marketConfirmed";
import { toBookmakerSelection, type FixtureOdds } from "../src/lib/odds";
import { matchKey } from "../src/lib/slug";
import { tooShortForPaid, PAID_MAX_MARKET_PROBABILITY } from "../src/lib/vipPremiumOverlay";
import { resolveMarket, type MarketType, type Selection } from "../src/lib/markets";

const db = new PrismaClient();
const days = Number(process.argv[2] ?? 30);
const out = (section: string, data: unknown) => console.log(JSON.stringify({ section, ...(data as object) }));
const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const pctl = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const label = (m: string, sel: unknown) => `${m}:${JSON.stringify(sel)}`;

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [r] = await db.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (r?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  }
  const since = new Date(Date.now() - days * 86_400_000);
  const jobs = await db.aIJob.findMany({ where: { createdAt: { gte: since }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { id: true, prompt: true, rawOutput: true, status: true, createdAt: true } });
  // The targeted (lopsided) market per fixture, from the pass's own run records.
  const runs = await db.jobRun.findMany({ where: { job: "generate-vip-premium", ranAt: { gte: since } }, select: { detail: true } });
  const targetOf = new Map<string, { market: string; selection: string; marketProbability: number }>();
  for (const r of runs) for (const t of (((r.detail as any)?.vipPremium?.targets ?? []) as Array<{ fixture: string; kickoff: string; market: string; selection: string; marketProbability: number }>))
    targetOf.set(`${t.fixture}|${t.kickoff}`, t);

  const reasons: Record<string, number> = {}, firstReasons: Record<string, number> = {};
  const draftMarkets: Record<string, number> = {}, confirmedMarkets: Record<string, number> = {};
  const gapsAll: number[] = [], gapsEligible: number[] = [], confAll: number[] = [], confFirst: number[] = [];
  let drafts = 0, jobsN = 0, jobsWithConfirmed = 0, jobsRejectedAtModel = 0, noQuote = 0;
  let avoidHasTarget = 0, withTarget = 0, draftIsTarget = 0, targetDraftConfirmed = 0;
  const targetDraftConf: number[] = [], targetMarketProb: number[] = [];
  let modelLowMarketOk = 0, marketOkModelOk = 0;
  const confBands: Record<string, number> = {};
  const byAvoid: Record<string, { jobs: number; confirmed: number }> = {};
  // Outcomes, graded from any settled row on the same fixture (final score).
  type G = { n: number; won: number; ret: number; priced: number };
  const graded: Record<string, G> = {};
  const grade = (k: string, won: boolean, price: number | null) => { const g = (graded[k] ??= { n: 0, won: 0, ret: 0, priced: 0 }); g.n++; if (won) g.won++; if (price) { g.priced++; g.ret += won ? price - 1 : -1; } };
  for (const j of jobs) {
    let p: any, o: any;
    try { p = JSON.parse(j.prompt); o = JSON.parse(j.rawOutput); } catch { continue; }
    const preds: Array<{ marketType: string; selection: unknown; confidence: number }> = Array.isArray(o?.predictions) ? o.predictions : [];
    if (!preds.length) continue;
    jobsN++;
    const key = matchKey({ homeTeamApiId: p.homeTeamApiId, awayTeamApiId: p.awayTeamApiId, kickoff: p.kickoff });
    const cache = key ? await db.fixtureOddsCache.findUnique({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true } }) : null;
    const odds = (cache?.oddsJson as unknown as FixtureOdds | null) ?? null;
    const avoid: string[] = Array.isArray(p.avoidPicks) ? p.avoidPicks : [];
    const settled = p.fixtureApiId != null ? await db.prediction.findFirst({ where: { fixtureApiId: p.fixtureApiId, finalHomeScore: { not: null }, finalAwayScore: { not: null } }, select: { finalHomeScore: true, finalAwayScore: true } }) : null;
    const avoidKey = avoid.length === 0 ? "none" : avoid.length <= 2 ? "1-2" : "3+";
    const ab = (byAvoid[avoidKey] ??= { jobs: 0, confirmed: 0 }); ab.jobs++;
    const target = targetOf.get(`${p.home} vs ${p.away}|${new Date(p.kickoff).toISOString()}`);
    if (target) {
      withTarget++;
      if (avoid.some((a) => a.toLowerCase().includes(String(target.selection).toLowerCase().replace("/", " or ")) || a.toLowerCase().includes(String(target.selection).toLowerCase()))) avoidHasTarget++;
    }
    let anyConfirmed = false, first = true, allModelLow = true;
    for (const d of preds) {
      drafts++;
      const conf = Number(d.confidence);
      confAll.push(conf); if (first) confFirst.push(conf);
      inc(confBands, conf >= 80 ? "80+" : conf >= 75 ? "75-79" : conf >= 70 ? "70-74" : conf >= 65 ? "65-69" : "<65");
      inc(draftMarkets, d.marketType);
      if (!odds || !cache?.fetchedAt) { noQuote++; inc(reasons, "NO_CACHED_QUOTE"); first = false; continue; }
      const v = evaluateMarketConfirmed({ marketType: d.marketType as MarketType, selection: d.selection as Selection, confidence: conf, odds, fetchedAt: cache.fetchedAt, now: cache.fetchedAt });
      // Market probability even when the model floor stopped the check first.
      const probe = conf < MC_MIN_MODEL_CONFIDENCE ? evaluateMarketConfirmed({ marketType: d.marketType as MarketType, selection: d.selection as Selection, confidence: 100, odds, fetchedAt: cache.fetchedAt, now: cache.fetchedAt }) : v;
      const mp = probe.marketProbability;
      const reason = v.confirmed ? (tooShortForPaid(v.marketProbability) ? "TOO_SHORT_TO_SELL" : "CONFIRMED") : String(v.reason);
      inc(reasons, reason); if (first) inc(firstReasons, reason);
      if (reason === "CONFIRMED") { anyConfirmed = true; inc(confirmedMarkets, d.marketType); }
      if (conf >= MC_MIN_MODEL_CONFIDENCE) allModelLow = false;
      if (mp != null && settled && mp >= 75 && mp <= PAID_MAX_MARKET_PROBABILITY) {
        const res = resolveMarket(d.marketType as MarketType, d.selection as Selection, settled.finalHomeScore!, settled.finalAwayScore!);
        if (res === "WON" || res === "LOST") {
          const price = mp ? 100 / mp : null; // fair price; bookmaker price is lower by the margin
          const band = conf >= 80 ? "model80+" : conf >= 75 ? "model75-79" : conf >= 70 ? "model70-74" : conf >= 65 ? "model65-69" : "model<65";
          grade(band, res === "WON", price);
          grade(Math.abs(conf - mp) <= MC_MAX_GAP_PP ? "gapWithin10" : "gapOver10", res === "WON", price);
          grade(reason === "CONFIRMED" ? "gate:confirmed" : `gate:${reason}`, res === "WON", price);
        }
      }
      if (mp != null) {
        gapsAll.push(conf - mp);
        if (mp >= 75 && mp <= PAID_MAX_MARKET_PROBABILITY) { gapsEligible.push(conf - mp); if (conf < MC_MIN_MODEL_CONFIDENCE) modelLowMarketOk++; else marketOkModelOk++; }
      }
      if (target) {
        const mapped = toBookmakerSelection(d.marketType as MarketType, d.selection);
        if (mapped && mapped.market === target.market && mapped.value === target.selection) {
          draftIsTarget++; targetDraftConf.push(conf); targetMarketProb.push(target.marketProbability);
          if (reason === "CONFIRMED") targetDraftConfirmed++;
        }
      }
      first = false;
    }
    if (anyConfirmed) { jobsWithConfirmed++; ab.confirmed++; }
    if (allModelLow) jobsRejectedAtModel++;
  }
  out("paidDrafts", { days, jobs: jobsN, drafts, draftsPerJob: jobsN ? Math.round((drafts / jobsN) * 10) / 10 : null, jobsWithAConfirmedDraft: jobsWithConfirmed, jobsWhereEveryDraftIsBelowModelFloor: jobsRejectedAtModel, noCachedQuote: noQuote,
    priceSource: "latest cached quote (near-close proxy), judged at its own fetch time" });
  out("verdicts", { allDrafts: reasons, firstDraftOnly: firstReasons });
  out("modelConfidence", { bands: confBands, meanAll: mean(confAll), meanFirst: mean(confFirst), p50: pctl(confAll, 0.5), p90: pctl(confAll, 0.9), floor: MC_MIN_MODEL_CONFIDENCE });
  out("modelMinusMarket", { allDraftsMean: mean(gapsAll), allP10: pctl(gapsAll, 0.1), allP50: pctl(gapsAll, 0.5), allP90: pctl(gapsAll, 0.9),
    whereMarketIsPaidRange: { n: gapsEligible.length, mean: mean(gapsEligible), p50: pctl(gapsEligible, 0.5), modelBelowFloor: modelLowMarketOk, modelAtOrAboveFloor: marketOkModelOk }, maxGapAllowed: MC_MAX_GAP_PP, paidMarketRange: [75, Math.round(PAID_MAX_MARKET_PROBABILITY * 10) / 10] });
  out("marketsChosen", { drafts: draftMarkets, confirmed: confirmedMarkets });
  out("targetSelection", { jobsWithRecordedTarget: withTarget, targetAlreadyInAvoidList: avoidHasTarget, draftsOnTargetSelection: draftIsTarget, ofWhichConfirmed: targetDraftConfirmed,
    targetDraftModelMean: mean(targetDraftConf), targetMarketMean: mean(targetMarketProb) });
  out("byAvoidList", { byAvoid });
  out("outcomesWhereMarketInPaidRange", { note: "drafts with market 75-87% on a settled fixture; return at FAIR price (no margin), so real returns are a few points lower",
    bands: Object.fromEntries(Object.entries(graded).map(([k, g]) => [k, { n: g.n, strike: Math.round((1000 * g.won) / g.n) / 10, fairReturn: g.priced ? Math.round((1000 * g.ret) / g.priced) / 10 : null }])) });
}
main().catch((e) => { console.error(String(e?.message ?? e).slice(0, 500)); process.exit(1); }).finally(() => db.$disconnect());
