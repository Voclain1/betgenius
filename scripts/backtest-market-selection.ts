/**
 * READ-ONLY chronological backtest of the market-selection remediation.
 *
 *   REQUIRE_READ_ONLY=1 npx tsx scripts/backtest-market-selection.ts [days=45]
 *
 * Runs in .github/workflows/market-quality-audit.yml on a read-only session.
 * Public-repository safe: aggregates only. No provider calls.
 *
 * Leakage controls: only pre-kickoff inputs are used (stated confidence, the
 * last pre-kickoff cached quote, the model's own drafts); outcomes are read
 * only to grade. The blend weight is fitted on the EARLIER 60% of kickoffs and
 * judged on the LATER 40%. Price caveat: the cache holds the LAST pre-kickoff
 * quote (near-close), not necessarily the quote at generation time.
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { matchKey } from "../src/lib/slug";
import { type FixtureOdds } from "../src/lib/odds";
import { resolveMarket, type MarketType, type Selection } from "../src/lib/markets";
import { evaluateCandidate, selectPrimary, SELECTION_POLICY, type CandidateInput } from "../src/lib/marketSelection";
import { selectHomepageFeatured } from "../src/lib/homepageFeatured";
import { lagosDateKey } from "../src/lib/lagosDate";

const D = 86_400_000;
const r3 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function rng(seed = 7) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
/** 90% bootstrap interval of the mean. */
function ci(values: number[], iters = 2000): [number, number] | null {
  if (values.length < 20) return null;
  const r = rng(); const ms: number[] = [];
  for (let i = 0; i < iters; i++) { let s = 0; for (let j = 0; j < values.length; j++) s += values[Math.floor(r() * values.length)]; ms.push(s / values.length); }
  ms.sort((a, b) => a - b);
  return [r3(ms[Math.floor(iters * 0.05)])!, r3(ms[Math.floor(iters * 0.95)])!];
}
const intentOf = (prompt: string | null | undefined) => { try { const p = JSON.parse(prompt ?? "{}"); return typeof p.intent === "string" ? p.intent : "ORDINARY"; } catch { return "UNKNOWN"; } };

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("backtest: session verified read-only");
  }
  const days = Math.max(14, Math.min(120, Number(process.argv[2]) || 45));
  const now = new Date();
  const from = new Date(now.getTime() - days * D);

  const rows = await prisma.prediction.findMany({
    where: { kickoff: { gte: from }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { id: true, status: true, marketType: true, selection: true, confidence: true, outcome: true, kickoff: true, publishedAt: true, leagueApiId: true, analysisJson: true,
      homeTeamApiId: true, awayTeamApiId: true, finalHomeScore: true, finalAwayScore: true, overUnder: true, ouLine: true, ouDirection: true, contextComplete: true,
      fixtureApiId: true, homeTeam: true, awayTeam: true, categories: { select: { category: true } }, aiJob: { select: { prompt: true } } },
  });
  const keys = [...new Set(rows.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const odds = new Map<string, FixtureOdds | null>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const c of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true } }))
      odds.set(c.matchKey, (c.oddsJson as FixtureOdds | null) ?? null);
  }
  const score = new Map<string, [number, number]>();
  for (const r of rows) { const k = matchKey(r); if (k && r.finalHomeScore != null && r.finalAwayScore != null) score.set(k, [r.finalHomeScore, r.finalAwayScore]); }
  const ret = (won: boolean, price: number) => (won ? price - 1 : -1);

  // ------------------------------------------------------------------ 1. blend weight, chronological
  const settled = rows.filter((r) => r.status === "PUBLISHED" && (r.outcome === "WON" || r.outcome === "LOST") && r.kickoff! < now)
    .map((r) => ({ r, ev: evaluateCandidate({ marketType: r.marketType, selection: r.selection, confidence: r.confidence, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, r.kickoff ?? undefined) }))
    .filter((x) => x.ev.fair != null).sort((a, b) => a.r.kickoff!.getTime() - b.r.kickoff!.getTime());
  const cut = Math.floor(settled.length * 0.6);
  const train = settled.slice(0, cut), test = settled.slice(cut);
  const y = (x: (typeof settled)[number]) => (x.r.outcome === "WON" ? 1 : 0);
  const brier = (xs: typeof settled, w: number) => mean(xs.map((x) => ((w * x.r.confidence + (1 - w) * x.ev.fair!) / 100 - y(x)) ** 2))!;
  let bestW = 0, bestB = Infinity;
  for (let w = 0; w <= 1.0001; w += 0.05) { const b = brier(train, w); if (b < bestB) { bestB = b; bestW = Math.round(w * 100) / 100; } }
  const paired = (xs: typeof settled, w: number) => xs.map((x) => ((w * x.r.confidence + (1 - w) * x.ev.fair!) / 100 - y(x)) ** 2 - (x.r.confidence / 100 - y(x)) ** 2);
  const byMarket: Record<string, unknown> = {};
  for (const m of [...new Set(test.map((x) => x.r.marketType))]) {
    const t = test.filter((x) => x.r.marketType === m);
    byMarket[m] = { n: t.length, model: r3(brier(t, 1)), market: r3(brier(t, 0)), blendFitted: r3(brier(t, bestW)), blendPolicy: r3(brier(t, SELECTION_POLICY.MODEL_WEIGHT)) };
  }
  console.log(JSON.stringify({ section: "blendWeight", note: "policy weight 0.3 is an unproven shadow parameter; the chronological fit is fittedModelWeight", trainN: train.length, testN: test.length, trainPeriod: [train[0]?.r.kickoff, train.at(-1)?.r.kickoff], testPeriod: [test[0]?.r.kickoff, test.at(-1)?.r.kickoff],
    fittedModelWeight: bestW, policyModelWeight: SELECTION_POLICY.MODEL_WEIGHT,
    testBrier: { model: r3(brier(test, 1)), market: r3(brier(test, 0)), blendFitted: r3(brier(test, bestW)), blendPolicy: r3(brier(test, SELECTION_POLICY.MODEL_WEIGHT)) },
    testBrierDiffPolicyMinusModel90: ci(paired(test, SELECTION_POLICY.MODEL_WEIGHT)), byMarketTest: byMarket }));

  // ------------------------------------------------------------------ 2. price bands, early vs late half (stability)
  const priced = settled.filter((x) => x.ev.median != null);
  const halves = [priced.slice(0, priced.length >> 1), priced.slice(priced.length >> 1)];
  const bands = [[1.12, 1.2], [1.2, 1.3], [1.3, 1.45], [1.45, 1.7], [1.7, 99]];
  console.log(JSON.stringify({ section: "priceBandsByHalf", bands: bands.map(([lo, hi]) => ({ band: `${lo}-${hi}`, halves: halves.map((h) => {
    const b = h.filter((x) => x.ev.median! >= lo && x.ev.median! < hi); const rs = b.map((x) => ret(x.r.outcome === "WON", x.ev.median!));
    return { n: b.length, strike: pct(b.filter((x) => x.r.outcome === "WON").length, b.length), roi: r3(mean(rs)), roi90: ci(rs) }; }) })) }));

  // ------------------------------------------------------------------ 3. counterfactual selection on the model's real alternatives
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(from.getTime() - 14 * D) }, status: "COMPLETED" }, select: { prompt: true, rawOutput: true, contextComplete: true } });
  for (const objective of ["guard", "repair", "ev"] as const) {
  type Arm = { won: boolean; price: number | null; market: string };
  const old: Arm[] = [], neu: Arm[] = [], pairDiff: number[] = [];
  const decisions: Record<string, number> = {}; const oldMix: Record<string, number> = {}; const newMix: Record<string, number> = {}; const byIntent: Record<string, number> = {};
  for (const j of jobs) {
    let p: { homeTeamApiId?: number; awayTeamApiId?: number; kickoff?: string } = {}; let out: { predictions?: Array<{ marketType: string; selection: unknown; confidence: number }> } = {};
    try { p = JSON.parse(j.prompt); out = JSON.parse(j.rawOutput); } catch { continue; }
    const drafts = Array.isArray(out.predictions) ? out.predictions.filter((d) => d && typeof d.marketType === "string" && d.marketType !== "SAME_GAME_DOUBLE") : [];
    if (drafts.length < 2 || new Set(drafts.map((d) => d.marketType)).size < 2) continue;
    const k = matchKey({ homeTeamApiId: p.homeTeamApiId, awayTeamApiId: p.awayTeamApiId, kickoff: p.kickoff });
    const s = k ? score.get(k) : undefined; const o = k ? odds.get(k) ?? null : null;
    if (!k || !s || !o) continue;
    const intent = intentOf(j.prompt); byIntent[intent] = (byIntent[intent] ?? 0) + 1;
    const cands: CandidateInput[] = drafts.map((d, i) => ({ marketType: d.marketType, selection: d.selection, confidence: Number(d.confidence), source: i === 0 ? "primary" : "alternative" }));
    const at = p.kickoff ? new Date(p.kickoff) : undefined;
    const res = selectPrimary(cands, o, { evidenceComplete: j.contextComplete, policy: { ...SELECTION_POLICY, OBJECTIVE: objective }, now: at });
    decisions[res.decision] = (decisions[res.decision] ?? 0) + 1;
    if (res.decision === "HOLD" || !res.chosen) continue;
    const grade = (c: { marketType: string; selection: unknown }) => resolveMarket(c.marketType as MarketType, c.selection as Selection, s[0], s[1]);
    const prim = evaluateCandidate(cands[0], o, SELECTION_POLICY, at);
    const go = grade(cands[0]), gn = grade(res.chosen);
    if ((go !== "WON" && go !== "LOST") || (gn !== "WON" && gn !== "LOST")) continue;
    old.push({ won: go === "WON", price: prim.median, market: cands[0].marketType });
    neu.push({ won: gn === "WON", price: res.chosen.median, market: res.chosen.marketType });
    oldMix[cands[0].marketType] = (oldMix[cands[0].marketType] ?? 0) + 1; newMix[res.chosen.marketType] = (newMix[res.chosen.marketType] ?? 0) + 1;
    if (prim.median != null && res.chosen.median != null) pairDiff.push(ret(gn === "WON", res.chosen.median) - ret(go === "WON", prim.median));
  }
  const arm = (a: Arm[]) => { const pr = a.filter((x) => x.price != null); const rs = pr.map((x) => ret(x.won, x.price!));
    return { n: a.length, strike: pct(a.filter((x) => x.won).length, a.length), pricedN: pr.length, medianPrice: median(pr.map((x) => x.price!)), roiAtMedian: r3(mean(rs)), roi90: ci(rs),
      dcShare: pct(a.filter((x) => x.market === "DOUBLE_CHANCE").length, a.length) }; };
  console.log(JSON.stringify({ section: "counterfactualSelection", objective, note: "jobs with >=2 model drafts on distinct markets; old = model's first draft, new = selectPrimary", byIntent, decisions,
    old: arm(old), new: arm(neu), pairedRoiDiffNewMinusOld: r3(mean(pairDiff)), pairedRoiDiff90: ci(pairDiff), pairedN: pairDiff.length, oldMix, newMix }));

  }
  // ------------------------------------------------------------------ 4. homepage FEATURED ranking, settled days only
  // Every arm runs the EXACT production function, selectHomepageFeatured.
  //  - current:        qualityRanking off (today's homepage).
  //  - productionStored: qualityRanking on, rows exactly as stored. Rows
  //    generated before this change carry no record, so they are "not
  //    verified" and the order equals current until records accumulate.
  //  - productionProxy: qualityRanking on, each row given the record shadow
  //    mode WOULD have written, built from the near-close cached quote
  //    (a proxy for the time-of-decision quote; see the price caveat above).
  //  - shortDemotedProxy: the rejected variant that also demotes short prices.
  // Paired per-day returns are computed separately for EACH arm against current.
  const featured = rows.filter((r) => r.status === "PUBLISHED" && r.categories.some((c) => c.category === "FEATURED") && r.kickoff && r.kickoff < new Date(now.getTime() - 3 * 3_600_000))
    .map((r) => ({ ...r, ev: evaluateCandidate({ marketType: r.marketType, selection: r.selection, confidence: r.confidence, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, r.kickoff ?? undefined) }));
  type FRow = (typeof featured)[number];
  const withRecord = (r: FRow, tier: string) => ({ ...r, analysisJson: { ...((r.analysisJson as object | null) ?? {}), selectionQuality: { tier, proxy: "near-close cache" } } });
  const arms: Record<string, (pool: FRow[]) => FRow[]> = {
    current: (pool) => selectHomepageFeatured(pool as never[], new Map()) as FRow[],
    productionStored: (pool) => selectHomepageFeatured(pool as never[], new Map(), 6, new Set(), { qualityRanking: true }) as FRow[],
    productionProxy: (pool) => {
      const byId = new Map(pool.map((r) => [r.id, r]));
      const proxied = pool.map((r) => withRecord(r, r.ev.tier));
      return (selectHomepageFeatured(proxied as never[], new Map(), 6, new Set(), { qualityRanking: true }) as FRow[]).map((r) => byId.get(r.id)!);
    },
    shortDemotedProxy: (pool) => {
      const byId = new Map(pool.map((r) => [r.id, r]));
      const proxied = pool.map((r) => withRecord(r, r.ev.tier === "SHORT" ? "UNPRICED" : r.ev.tier));
      return (selectHomepageFeatured(proxied as never[], new Map(), 6, new Set(), { qualityRanking: true }) as FRow[]).map((r) => byId.get(r.id)!);
    },
  };
  const picked: Record<string, FRow[]> = Object.fromEntries(Object.keys(arms).map((k) => [k, [] as FRow[]]));
  const dayDiffs: Record<string, number[]> = Object.fromEntries(Object.keys(arms).map((k) => [k, [] as number[]]));
  const dayRoi = (xs: FRow[]) => mean(xs.filter((x) => x.ev.median != null && (x.outcome === "WON" || x.outcome === "LOST")).map((x) => ret(x.outcome === "WON", x.ev.median!)));
  let changedDays: Record<string, number> = {};
  for (const day of [...new Set(featured.map((r) => lagosDateKey(r.kickoff!)))].sort()) {
    const pool = featured.filter((r) => lagosDateKey(r.kickoff!) === day);
    const base = arms.current(pool);
    const baseRoi = dayRoi(base);
    for (const [k, f] of Object.entries(arms)) {
      const six = k === "current" ? base : f(pool);
      picked[k].push(...six);
      if (six.map((x) => x.id).join() !== base.map((x) => x.id).join()) changedDays[k] = (changedDays[k] ?? 0) + 1;
      const r = dayRoi(six); if (k !== "current" && r != null && baseRoi != null) dayDiffs[k].push(r - baseRoi);
    }
  }
  const summarise = (xs: FRow[]) => { const s = xs.filter((x) => x.outcome === "WON" || x.outcome === "LOST"); const pr = s.filter((x) => x.ev.median != null);
    const rs = pr.map((x) => ret(x.outcome === "WON", x.ev.median!));
    return { n: xs.length, strike: pct(s.filter((x) => x.outcome === "WON").length, s.length), dcShare: pct(xs.filter((x) => x.marketType === "DOUBLE_CHANCE").length, xs.length),
      unverifiedShare: pct(xs.filter((x) => !["QUALIFIED", "SHORT"].includes(x.ev.tier)).length, xs.length), shortShare: pct(xs.filter((x) => x.ev.tier === "SHORT").length, xs.length),
      medianPrice: median(pr.map((x) => x.ev.median!)), roiAtMedian: r3(mean(rs)), roi90: ci(rs), meanConf: r3(mean(xs.map((x) => x.confidence))) }; };
  console.log(JSON.stringify({ section: "homepageRanking", priceSource: "near-close cached quote (proxy, not time-of-decision)", days: new Set(featured.map((r) => lagosDateKey(r.kickoff!))).size,
    storedRecordsInPool: featured.filter((r) => (r.analysisJson as { selectionQuality?: unknown } | null)?.selectionQuality).length,
    arms: Object.fromEntries(Object.keys(arms).map((k) => [k, { ...summarise(picked[k]), daysDifferentFromCurrent: changedDays[k] ?? 0,
      ...(k === "current" ? {} : { pairedDayRoiDiffVsCurrent: r3(mean(dayDiffs[k])), pairedDayRoiDiff90: ci(dayDiffs[k]), pairedDays: dayDiffs[k].length }) }])) }));

  // ------------------------------------------------------------------ 4b. prospective: decisions recorded at generation (shadow/on), time-of-decision quotes
  const recordedJobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: from }, rawOutput: { contains: "\"marketSelection\"" } }, select: { rawOutput: true, prompt: true } });
  const prospective = { records: 0, graded: 0, decisions: {} as Record<string, number>, primary: [] as number[], chosen: [] as number[], primaryWon: 0, chosenWon: 0 };
  for (const j of recordedJobs) {
    let rec: { decision?: string; chosen?: { marketType: string; selection: unknown; median: number | null } | null; candidates?: Array<{ source: string; marketType: string; selection: unknown; median: number | null }> } | undefined;
    let p: { homeTeamApiId?: number; awayTeamApiId?: number; kickoff?: string } = {};
    try { rec = JSON.parse(j.rawOutput).marketSelection; p = JSON.parse(j.prompt); } catch { continue; }
    if (!rec) continue;
    prospective.records++; prospective.decisions[rec.decision ?? "?"] = (prospective.decisions[rec.decision ?? "?"] ?? 0) + 1;
    const sc = score.get(matchKey({ homeTeamApiId: p.homeTeamApiId, awayTeamApiId: p.awayTeamApiId, kickoff: p.kickoff }) ?? "");
    const prim = rec.candidates?.find((c) => c.source === "primary");
    if (!sc || !prim || !rec.chosen || prim.median == null || rec.chosen.median == null) continue;
    const g = (c: { marketType: string; selection: unknown }) => resolveMarket(c.marketType as MarketType, c.selection as Selection, sc[0], sc[1]);
    const gp = g(prim), gc = g(rec.chosen);
    if ((gp !== "WON" && gp !== "LOST") || (gc !== "WON" && gc !== "LOST")) continue;
    prospective.graded++; if (gp === "WON") prospective.primaryWon++; if (gc === "WON") prospective.chosenWon++;
    prospective.primary.push(ret(gp === "WON", prim.median)); prospective.chosen.push(ret(gc === "WON", rec.chosen.median));
  }
  console.log(JSON.stringify({ section: "prospectiveRecorded", priceSource: "time-of-decision quote recorded with each decision", records: prospective.records, decisions: prospective.decisions, graded: prospective.graded,
    primaryRoi: r3(mean(prospective.primary)), chosenRoi: r3(mean(prospective.chosen)), pairedDiff90: ci(prospective.chosen.map((c, i) => c - prospective.primary[i])),
    note: prospective.records ? undefined : "no shadow records yet: MARKET_SELECTION_MODE has not been enabled; rollout metrics must be revalidated here once it is" }));

  // ------------------------------------------------------------------ 5. secondary over/under column
  const pub = rows.filter((r) => r.status === "PUBLISHED");
  const ouText: Record<string, number> = {}; for (const r of pub) ouText[r.overUnder ?? "(none)"] = (ouText[r.overUnder ?? "(none)"] ?? 0) + 1;
  const sec = pub.filter((r) => r.ouLine != null && r.ouDirection && r.finalHomeScore != null && r.finalAwayScore != null && r.marketType !== "OVER_UNDER");
  const secWon = sec.filter((r) => resolveMarket("OVER_UNDER", { line: r.ouLine!, direction: r.ouDirection as "OVER" | "UNDER" }, r.finalHomeScore!, r.finalAwayScore!) === "WON").length;
  const secFair = sec.map((r) => evaluateCandidate({ marketType: "OVER_UNDER", selection: { line: r.ouLine, direction: r.ouDirection }, confidence: 50, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, r.kickoff ?? undefined).fair).filter((f): f is number => f != null);
  console.log(JSON.stringify({ section: "secondaryOverUnder", publishedRows: pub.length, topValues: Object.entries(ouText).sort((a, b) => b[1] - a[1]).slice(0, 6),
    sameAsPrimaryMarketRows: pub.filter((r) => r.marketType === "OVER_UNDER").length, settledSecondaryN: sec.length, secondaryStrike: pct(secWon, sec.length), secondaryMeanMarketFair: r3(mean(secFair)) }));

  // ------------------------------------------------------------------ 6. integrity: duplicate fixtures, below-floor publications, incomplete evidence
  const featuredAll = rows.filter((r) => r.status === "PUBLISHED" && r.categories.some((c) => c.category === "FEATURED"));
  const perFixture = new Map<string, number>(); for (const r of featuredAll) { const k = matchKey(r); if (k) perFixture.set(k, (perFixture.get(k) ?? 0) + 1); }
  const belowFloor = pub.map((r) => ({ r, ev: evaluateCandidate({ marketType: r.marketType, selection: r.selection, confidence: r.confidence, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, r.kickoff ?? undefined) }))
    .filter((x) => x.ev.median != null && x.ev.median < SELECTION_POLICY.HARD_MIN_ODDS);
  const byIntentBelow: Record<string, number> = {}; for (const x of belowFloor) { const i = intentOf(x.r.aiJob?.prompt); byIntentBelow[i] = (byIntentBelow[i] ?? 0) + 1; }
  console.log(JSON.stringify({ section: "integrity", featuredFixtures: perFixture.size, featuredFixturesWithMultipleRows: [...perFixture.values()].filter((n) => n > 1).length,
    publishedBelowHardFloor: belowFloor.length, belowFloorByIntent: byIntentBelow,
    publishedWithIncompleteEvidencePct: pct(pub.filter((r) => !r.contextComplete).length, pub.length) }));

  // ------------------------------------------------------------------ 6b. one-row-per-fixture impact on paid supply; Draw No Bet derived-fair bypass
  const byJob = new Map<string, typeof pub>();
  const pubWithJob = await prisma.prediction.findMany({ where: { status: "PUBLISHED", kickoff: { gte: from }, marketType: { not: "SAME_GAME_DOUBLE" }, aiJobId: { not: null } },
    select: { id: true, aiJobId: true, createdAt: true, categories: { select: { category: true } }, marketType: true, selection: true, confidence: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, aiJob: { select: { prompt: true } } } });
  const groups = new Map<string, typeof pubWithJob>();
  for (const r of pubWithJob) { const g = groups.get(r.aiJobId!) ?? []; g.push(r); groups.set(r.aiJobId!, g); }
  let secondaryRows = 0, secondaryPaid = 0, paidTotal = 0; const secondaryByIntent: Record<string, number> = {};
  for (const g of groups.values()) {
    g.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const r of g) if (r.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM")) paidTotal++;
    const intent = intentOf(g[0].aiJob?.prompt);
    if (["REGULAR_COMBO", "VIP_PREMIUM", "EUROPEAN_CLUB", "MARKET_CONFIRMED"].includes(intent)) continue;
    for (const r of g.slice(1)) { secondaryRows++; secondaryByIntent[intent] = (secondaryByIntent[intent] ?? 0) + 1; if (r.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM")) secondaryPaid++; }
  }
  void byJob;
  const dnb = pub.filter((r) => r.marketType === "DRAW_NO_BET").map((r) => evaluateCandidate({ marketType: r.marketType, selection: r.selection, confidence: r.confidence, source: "primary" }, odds.get(matchKey(r) ?? "") ?? null, SELECTION_POLICY, r.kickoff ?? undefined));
  console.log(JSON.stringify({ section: "singleRowImpact", publishedRowsBeyondFirstOfSingleMarketJob: secondaryRows, byIntent: secondaryByIntent, ofWhichVipPremium: secondaryPaid, vipPremiumPublishedTotal: paidTotal,
    drawNoBet: { published: dnb.length, withDerivedFair: dnb.filter((x) => x.derivedFairOdds != null).length, derivedFairBelow112: dnb.filter((x) => x.derivedFairOdds != null && x.derivedFairOdds < 1.12).length,
      derivedFairBelow120: dnb.filter((x) => x.derivedFairOdds != null && x.derivedFairOdds < 1.2).length, medianDerivedFair: median(dnb.filter((x) => x.derivedFairOdds != null).map((x) => x.derivedFairOdds!)) } }));

  // ------------------------------------------------------------------ 7. token cost per generation intent (for the alternatives cost assessment)
  const recent = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 14 * D) }, status: "COMPLETED" }, select: { prompt: true, promptTokens: true, outputTokens: true } });
  const tok: Record<string, { n: number; prompt: number[]; output: number[] }> = {};
  for (const j of recent) { const i = intentOf(j.prompt); const t = (tok[i] ??= { n: 0, prompt: [], output: [] }); t.n++; if (j.promptTokens) t.prompt.push(j.promptTokens); if (j.outputTokens) t.output.push(j.outputTokens); }
  console.log(JSON.stringify({ section: "tokens14d", byIntent: Object.fromEntries(Object.entries(tok).map(([k, v]) => [k, { jobs: v.n, medianPrompt: median(v.prompt), medianOutput: median(v.output) }])) }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
