/**
 * Calibration fitting, chronological validation, value-strategy comparison and
 * market assessment for paid selection. READ-ONLY. No provider calls, no writes.
 *
 * DESIGN — fixed before the first run, and not tuned against the test period.
 *
 *   Split. Kickoff days in order. The last TEST_DAYS days are the held-out test
 *   period. Everything before is validated WALK-FORWARD: weekly folds from the
 *   fifth week on, each fitted only on rows that kicked off before the fold
 *   began. The test period is fitted on everything before it. No row is ever
 *   predicted by a fit that saw its outcome.
 *
 *   Calibrators (model-only: provider, market and raw confidence; no price):
 *     RAW   confidence / 100
 *     C1    pooled Platt on logit(raw)
 *     C2    Platt per provider, unshrunk
 *     C3    hierarchical: per provider shrunk toward pooled (k=150), plus a
 *           per-market intercept shrunk toward zero (k=150)
 *     C4    isotonic per provider (min block 30), pooled fallback
 *   With the market (only rows with a pre-kickoff quote):
 *     M0    the de-vigged market probability alone
 *     M1    logistic on [logit(C3), logit(market)]
 *
 *   PRICE LEAKAGE, STATED. FixtureOddsCache keeps one quote per fixture: the
 *   last one taken before kickoff. Anything using a price here (M0, M1, EV,
 *   ROI, every value strategy) therefore sees a near-closing price, which is
 *   later than the moment a pick would have been selected. Model-only
 *   calibration (C1–C4) uses no price and is leakage-free. Value strategies are
 *   reported as a near-close replay, not as a valid point-in-time test; the
 *   point-in-time record starts with the shadow log (PAID_SELECTION_MODE=shadow).
 *
 *   Activation rules (pre-registered):
 *     - Model-only calibration C3 is marked active iff its Brier beats RAW on
 *       validation AND test, and the paired-bootstrap 90% interval of the
 *       validation difference lies wholly below zero.
 *     - Value-based LIVE selection is never activated by this script. It is
 *       recommended only if a value strategy's ROI 90% interval lies wholly
 *       above zero on validation and on test; otherwise it stays in shadow.
 *
 * Run: npx tsx --env-file=.env scripts/fit-calibration.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import type { FixtureOdds } from "../src/lib/odds";
import { matchKey } from "../src/lib/slug";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { devigProbability } from "../src/lib/marketConfirmed";
import { compareByEditorialRank } from "../src/lib/predictionOrdering";
import { CURATION_MAX, DEDICATED_PAID_PROVENANCES, VIP_CONFIDENCE_FLOOR, VIP_ROUTE_PROVENANCE } from "../src/lib/geniusCuration";
import { PAID_MAX_MARKET_PROBABILITY, PAID_WIDENED_LEAGUE_IDS, VIP_MARKET_FLOOR, paidCurationWidened } from "../src/lib/vipPremiumOverlay";
import { assessPaidCuration, pickPrice, type PricedPick } from "../src/lib/paidSelection";
import {
  applyCalibration, brier, expectedCalibrationError, fitIsotonic, fitLogistic, fitModelOnly, fitWithMarket, logLoss, logit,
  predictIsotonic, predictLogistic, providerOf, type CalibrationArtifact, type CalibrationRow, type Outcome01,
} from "../src/lib/calibration";
import { assessValue, rankByValue, type ValueAssessment } from "../src/lib/paidValue";

const DAY = 86_400_000;
const TEST_DAYS = 7;
const MIN_TRAIN_DAYS = 28;
const FOLD_DAYS = 7;

type Row = {
  id: string; day: string; kickoff: Date; leagueApiId: number | null; leagueName: string | null; provider: string | null;
  marketType: string; selection: unknown; confidence: number; outcome: string; provenance: string | null; categories: string[];
  fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null;
  price: PricedPick | null; pDraw: number | null;
  pred?: Record<string, number | null>;
  seM1?: number | null;
};

const y = (r: Row): Outcome01 => (r.outcome === "WON" ? 1 : 0);
const decided = (r: Row) => r.outcome === "WON" || r.outcome === "LOST";
const settled = (r: Row) => decided(r) || r.outcome === "VOID";
const toCal = (r: Row): CalibrationRow => ({ provider: r.provider, marketType: r.marketType, rawConfidence: r.confidence, marketProbability: r.price && !r.price.derived ? r.price.fair : null, y: y(r) });
const fmtPct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(d)}%`);
const f3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(3));
const f2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

function lcg(seed: number) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }

/** Paired bootstrap 90% interval of mean(a − b). */
function pairedCI(a: number[], b: number[], B = 2000): [number, number] {
  const d = a.map((v, i) => v - b[i]);
  const rnd = lcg(11);
  const sims: number[] = [];
  for (let k = 0; k < B; k++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]; sims.push(s / d.length); }
  sims.sort((x, z) => x - z);
  return [sims[Math.floor(B * 0.05)], sims[Math.floor(B * 0.95)]];
}

/** Flat-stake P/L per pick at the median price times `factor` (odds deterioration), voids returned. */
const pnl = (r: Row, factor = 1) => (r.outcome === "WON" ? r.price!.median * factor - 1 : r.outcome === "LOST" ? -1 : 0);

function roiStats(rows: Row[], factor = 1) {
  const priced = rows.filter((r) => settled(r) && r.price && !r.price.derived);
  if (!priced.length) return { n: 0, roi: null as number | null, lo: null as number | null, hi: null as number | null };
  const xs = priced.map((r) => pnl(r, factor));
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const rnd = lcg(7);
  const sims: number[] = [];
  for (let b = 0; b < 2000; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)]; sims.push(s / xs.length); }
  sims.sort((a, b) => a - b);
  return { n: xs.length, roi: mean, lo: sims[100], hi: sims[1899] };
}

function streaks(rows: Row[]) {
  const o = [...rows].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id));
  let bank = 0, peak = 0, dd = 0, run = 0, lr = 0;
  for (const r of o) {
    if (r.outcome === "LOST") lr = Math.max(lr, ++run); else if (r.outcome === "WON") run = 0;
    if (!r.price || r.price.derived || !settled(r)) continue;
    bank += pnl(r); peak = Math.max(peak, bank); dd = Math.max(dd, peak - bank);
  }
  return { dd, lr };
}

function calTable(label: string, rows: Row[], keys: string[]) {
  const dec = rows.filter(decided);
  const out: string[] = [];
  for (const k of keys) {
    const rs = dec.filter((r) => r.pred?.[k] != null);
    if (!rs.length) continue;
    const ps = rs.map((r) => r.pred![k]!), ys = rs.map(y);
    out.push(`    ${k.padEnd(4)} n=${String(rs.length).padStart(5)}  brier ${f3(brier(ps, ys))}  logloss ${f3(logLoss(ps, ys))}  ECE ${f3(expectedCalibrationError(ps, ys))}  mean p ${fmtPct(ps.reduce((s, v) => s + v, 0) / ps.length)} vs realised ${fmtPct(ys.reduce((s: number, v) => s + v, 0) / ys.length)}`);
  }
  console.log(`  ${label}\n${out.join("\n")}`);
}

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const now = new Date();
  const raw = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date(now.getTime() - 3 * 3_600_000) }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, kickoff: true, leagueApiId: true, leagueName: true, marketType: true, selection: true, confidence: true, outcome: true, provenance: true,
      fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } }, aiJob: { select: { model: true } },
    },
  });
  const visible = raw.filter((r) => r.kickoff && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));
  const keys = [...new Set(visible.map((r) => matchKey(r)).filter((k): k is string => !!k))];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }
  const rows: Row[] = visible.map((r) => {
    const q = quotes.get(matchKey(r) ?? "");
    const pre = !!q?.fetchedAt && q.fetchedAt.getTime() < r.kickoff!.getTime();
    const odds = pre ? q!.oddsJson : null;
    return {
      id: r.id, day: lagosDateKey(r.kickoff!), kickoff: r.kickoff!, leagueApiId: r.leagueApiId, leagueName: r.leagueName,
      provider: providerOf(r.aiJob?.model), marketType: r.marketType, selection: r.selection, confidence: r.confidence, outcome: r.outcome,
      provenance: r.provenance, categories: r.categories.map((c) => c.category),
      fixtureApiId: r.fixtureApiId, homeTeamApiId: r.homeTeamApiId, awayTeamApiId: r.awayTeamApiId,
      price: odds ? pickPrice(odds, r.marketType, r.selection) : null,
      pDraw: odds ? (devigProbability(odds, "Match Winner", "Draw")?.probability ?? null) : null,
    };
  });
  const usable = rows.filter(settled);
  const days = [...new Set(usable.map((r) => r.day))].sort();
  const testStart = days[days.length - TEST_DAYS];
  console.log(`\nRows: ${usable.length} settled published singles, ${days[0]} .. ${days[days.length - 1]}. Priced (pre-kickoff, executable): ${usable.filter((r) => r.price && !r.price.derived).length}. Derived-price (draw no bet) rows excluded from every price figure: ${usable.filter((r) => r.price?.derived).length}.`);
  console.log(`Held-out test: ${testStart} .. ${days[days.length - 1]} (${TEST_DAYS} days). Validation: weekly walk-forward folds after ${MIN_TRAIN_DAYS} training days.`);
  const byProv: Record<string, number> = {};
  for (const r of usable.filter(decided)) byProv[r.provider ?? "none"] = (byProv[r.provider ?? "none"] ?? 0) + 1;
  console.log(`Decided rows by provider: ${JSON.stringify(byProv)}`);

  // ── Walk-forward predictions ────────────────────────────────────────────
  const fit = (train: Row[]) => {
    const dec = train.filter(decided);
    const cal = dec.map(toCal);
    const c1 = fitLogistic(cal.map((r) => [logit(r.rawConfidence / 100)]), cal.map((r) => r.y)).coef;
    const c2: Record<string, number[]> = {};
    for (const p of [...new Set(cal.map((r) => r.provider ?? "unknown"))]) {
      const rs = cal.filter((r) => (r.provider ?? "unknown") === p);
      c2[p] = fitLogistic(rs.map((r) => [logit(r.rawConfidence / 100)]), rs.map((r) => r.y)).coef;
    }
    const modelOnly = fitModelOnly(cal);
    const withMarket = fitWithMarket(cal, modelOnly);
    const iso: Record<string, ReturnType<typeof fitIsotonic>> = {};
    for (const p of [...new Set(cal.map((r) => r.provider ?? "unknown"))]) {
      const rs = cal.filter((r) => (r.provider ?? "unknown") === p);
      if (rs.length >= 150) iso[p] = fitIsotonic(rs.map((r) => r.rawConfidence), rs.map((r) => r.y));
    }
    const isoPooled = fitIsotonic(cal.map((r) => r.rawConfidence), cal.map((r) => r.y));
    const art: CalibrationArtifact = {
      version: "walk-forward", fittedAt: "", trainedOn: { from: dec[0]?.day ?? "", to: dec[dec.length - 1]?.day ?? "", n: dec.length },
      evidence: {}, active: false, modelOnly, withMarket,
    };
    return { c1, c2, art, iso, isoPooled };
  };
  const predict = (r: Row, m: ReturnType<typeof fit>) => {
    const fair = r.price && !r.price.derived ? r.price.fair : null;
    const cal = applyCalibration(m.art, { provider: r.provider, marketType: r.marketType, rawConfidence: r.confidence, marketProbability: fair });
    const prov = r.provider ?? "unknown";
    r.pred = {
      RAW: r.confidence / 100,
      C1: predictLogistic(m.c1, [logit(r.confidence / 100)]),
      C2: predictLogistic(m.c2[prov] ?? m.c1, [logit(r.confidence / 100)]),
      C3: cal.modelOnly,
      C4: predictIsotonic(m.iso[prov] ?? m.isoPooled, r.confidence),
      M0: fair != null ? fair / 100 : null,
      M1: cal.withMarket,
    };
    r.seM1 = cal.withMarketSE;
  };
  const sorted = [...usable].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const validation: Row[] = [];
  let foldStart = days[Math.min(days.length - 1, MIN_TRAIN_DAYS)];
  let folds = 0;
  while (foldStart < testStart) {
    const foldEndIdx = Math.min(days.indexOf(foldStart) + FOLD_DAYS, days.indexOf(testStart));
    const foldEnd = days[foldEndIdx];
    const m = fit(sorted.filter((r) => r.day < foldStart));
    for (const r of sorted.filter((x) => x.day >= foldStart && x.day < foldEnd)) { predict(r, m); validation.push(r); }
    folds++;
    foldStart = foldEnd;
  }
  const testFit = fit(sorted.filter((r) => r.day < testStart));
  const test = sorted.filter((r) => r.day >= testStart);
  for (const r of test) predict(r, testFit);
  console.log(`Folds: ${folds}. Validation rows ${validation.length}, test rows ${test.length}.`);

  // ── Calibration metrics ─────────────────────────────────────────────────
  console.log("\n1. Calibration, decided rows (lower Brier / log loss / ECE is better)");
  for (const [label, set] of [["VALIDATION", validation], ["TEST (held out)", test]] as const) {
    calTable(`${label} — all rows, model-only`, set, ["RAW", "C1", "C2", "C3", "C4"]);
    calTable(`${label} — priced rows only (same subset)`, set.filter((r) => r.pred?.M0 != null), ["RAW", "C3", "M0", "M1"]);
  }
  const pair = (set: Row[], a: string, b: string) => {
    const rs = set.filter(decided).filter((r) => r.pred?.[a] != null && r.pred?.[b] != null);
    const sa = rs.map((r) => (r.pred![a]! - y(r)) ** 2), sb = rs.map((r) => (r.pred![b]! - y(r)) ** 2);
    const [lo, hi] = pairedCI(sa, sb);
    return { n: rs.length, diff: sa.reduce((s, v) => s + v, 0) / rs.length - sb.reduce((s, v) => s + v, 0) / rs.length, lo, hi };
  };
  const show = (p: ReturnType<typeof pair>) => `n=${p.n} ΔBrier ${p.diff.toFixed(4)} [90% ${p.lo.toFixed(4)}, ${p.hi.toFixed(4)}]`;
  const vC3 = pair(validation, "C3", "RAW"), tC3 = pair(test, "C3", "RAW");
  const vM1 = pair(validation, "M1", "M0"), tM1 = pair(test, "M1", "M0");
  console.log(`\n  C3 vs RAW   validation ${show(vC3)}   test ${show(tC3)}`);
  console.log(`  M1 vs M0    validation ${show(vM1)}   test ${show(tM1)}   (does the model add anything to the market?)`);
  const c3Active = vC3.diff < 0 && tC3.diff < 0 && vC3.hi < 0;
  console.log(`  Pre-registered rule → model-only calibration C3 ${c3Active ? "ACTIVE" : "NOT active"}.`);

  console.log("\n2. Calibration by provider (validation + test, decided): raw vs C3 vs realised, by raw-confidence band");
  const both = [...validation, ...test].filter(decided);
  for (const prov of [...new Set(both.map((r) => r.provider ?? "none"))]) {
    const rs = both.filter((r) => (r.provider ?? "none") === prov);
    console.log(`  ${prov} (n=${rs.length}) brier raw ${f3(brier(rs.map((r) => r.pred!.RAW!), rs.map(y)))} C3 ${f3(brier(rs.map((r) => r.pred!.C3!), rs.map(y)))}`);
    for (const [lo, hi] of [[0, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, 101]]) {
      const b = rs.filter((r) => r.confidence >= lo && r.confidence < hi);
      if (b.length < 15) continue;
      const mean = (k: string) => b.reduce((s, r) => s + r.pred![k]!, 0) / b.length;
      console.log(`     raw ${String(lo).padStart(2)}–${hi > 100 ? "100" : hi - 1}  n=${String(b.length).padStart(4)}  stated ${fmtPct(mean("RAW"))}  C3 ${fmtPct(mean("C3"))}  realised ${fmtPct(b.filter((r) => r.outcome === "WON").length / b.length)}`);
    }
  }
  console.log("\n3. Calibration by market and by odds band (validation + test, decided)");
  for (const [label, key] of [["market", (r: Row) => r.marketType], ["odds band", (r: Row) => {
    const o = r.price && !r.price.derived ? r.price.median : null;
    return o == null ? null : o < 1.2 ? "<1.20" : o < 1.35 ? "1.20–1.34" : o < 1.5 ? "1.35–1.49" : o < 1.7 ? "1.50–1.69" : o < 2 ? "1.70–1.99" : "2.00+";
  }]] as const) {
    const groups = new Map<string, Row[]>();
    for (const r of both) { const k = key(r); if (k) (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    for (const [k, rs] of [...groups.entries()].sort()) {
      if (rs.length < 30) continue;
      const m = (f: (r: Row) => number | null) => { const v = rs.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      console.log(`  ${label} ${k.padEnd(14)} n=${String(rs.length).padStart(4)} realised ${fmtPct(rs.filter((r) => r.outcome === "WON").length / rs.length)}  raw ${fmtPct(m((r) => r.pred!.RAW))}  C3 ${fmtPct(m((r) => r.pred!.C3))}  market ${fmtPct(m((r) => r.pred!.M0))}  M1 ${fmtPct(m((r) => r.pred!.M1))}`);
    }
  }

  // ── Value ───────────────────────────────────────────────────────────────
  const valueOf = (r: Row, minEvLower: number): ValueAssessment => assessValue({
    marketType: r.marketType, rawConfidence: r.confidence, price: r.price, pDraw: r.pDraw != null ? r.pDraw / 100 : null,
    estimate: r.pred?.M1 != null ? { p: r.pred.M1, se: r.seM1 ?? 0, version: "walk-forward" } : null, minEvLower,
  });

  console.log("\n4. Market-level assessment (validation + test, settled singles with an executable pre-kickoff price; NEAR-CLOSE prices)");
  console.log("   market          n   strike  medOdds  realised ROI [90%]          mean EV(M1)  EV_lower>=0: n  ROI");
  const settledBoth = [...validation, ...test];
  for (const m of [...new Set(settledBoth.map((r) => r.marketType))].sort()) {
    const rs = settledBoth.filter((r) => r.marketType === m && r.price && !r.price.derived);
    const derived = settledBoth.filter((r) => r.marketType === m && r.price?.derived).length;
    const unpriced = settledBoth.filter((r) => r.marketType === m && !r.price).length;
    if (!rs.length) { console.log(`   ${m.padEnd(14)} no executable price (${derived} derived, ${unpriced} unpriced) — cannot be valued`); continue; }
    const st = roiStats(rs);
    const vals = rs.map((r) => valueOf(r, 0));
    const evs = vals.map((v) => v.expectedValue).filter((x): x is number => x != null);
    const pos = rs.filter((_, i) => vals[i].expectedValueLower != null && vals[i].expectedValueLower! >= 0);
    const ps = roiStats(pos);
    const med = [...rs.map((r) => r.price!.median)].sort((a, b) => a - b)[Math.floor(rs.length / 2)];
    console.log(`   ${m.padEnd(14)} ${String(rs.length).padStart(4)}  ${fmtPct(rs.filter((r) => r.outcome === "WON").length / rs.filter(decided).length).padStart(6)}  ${f2(med).padStart(5)}  ${fmtPct(st.roi).padStart(7)} [${fmtPct(st.lo)}, ${fmtPct(st.hi)}]  ${fmtPct(evs.length ? evs.reduce((s, v) => s + v, 0) / evs.length : null).padStart(7)}  ${String(pos.length).padStart(4)}  ${fmtPct(ps.roi)}${derived ? `  (+${derived} derived-price rows not valued)` : ""}`);
  }

  // ── Strategies ──────────────────────────────────────────────────────────
  type Strategy = (dayRows: Row[]) => Row[];
  const key = (r: Row) => matchKey(r) ?? `row:${r.id}`;
  const isDed = (r: Row) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(r.provenance ?? "");
  const p175Eligible = (dayRows: Row[], r: Row, floorOK: (r: Row) => boolean) => {
    if (isDed(r)) return r.categories.includes("VIP");
    if (isPaidOnlyProvenance(r.provenance) || !floorOK(r)) return false;
    return assessPaidCuration({
      confidence: r.confidence, vipRoute: r.provenance === VIP_ROUTE_PROVENANCE,
      widenedScope: paidCurationWidened(dayRows) && PAID_WIDENED_LEAGUE_IDS.includes(r.leagueApiId ?? -1),
      price: r.price, marketFloor: VIP_MARKET_FLOOR, maxMarketProbability: PAID_MAX_MARKET_PROBABILITY,
    }).eligible;
  };
  const onePerFixture = (rs: Row[], max = CURATION_MAX) => {
    const taken = new Set<string>(); const out: Row[] = [];
    for (const r of rs) { if (out.length >= max) break; if (taken.has(key(r))) continue; taken.add(key(r)); out.push(r); }
    return out;
  };
  const rawFloor = (r: Row) => r.confidence >= VIP_CONFIDENCE_FLOOR;
  const editorial = (rs: Row[]) => [...rs.filter(isDed), ...rs.filter((r) => !isDed(r)).sort(compareByEditorialRank as any)];
  const withValue = (rs: Row[], minEvLower: number) => rs.map((r) => ({ ...r, value: valueOf(r, minEvLower) }));
  const strategies: Record<string, Strategy> = {
    "P175 production (#175)": (d) => onePerFixture(editorial(d.filter((r) => p175Eligible(d, r, rawFloor)))),
    "V0 P175 ∩ EV ≥ 0": (d) => onePerFixture(editorial(d.filter((r) => p175Eligible(d, r, rawFloor) && (valueOf(r, -Infinity).expectedValue ?? -1) >= 0))),
    "V1 P175 ∩ EV_lower ≥ 0": (d) => onePerFixture(editorial(d.filter((r) => p175Eligible(d, r, rawFloor) && valueOf(r, 0).eligible))),
    "V2 P175 ranked by EV, EV ≥ −3%": (d) => {
      const c = withValue(d.filter((r) => p175Eligible(d, r, rawFloor)), -Infinity).filter((r) => (r.value.expectedValue ?? -1) >= -0.03 && r.value.reasons.every((x) => x === "EV_NOT_CREDIBLE"));
      return onePerFixture(rankByValue(c, 999));
    },
    "CF calibrated floor C3 ≥ 0.75": (d) => onePerFixture(editorial(d.filter((r) => p175Eligible(d, r, (x) => (x.pred?.C3 ?? 0) >= 0.75)))),
    "U1 any single, EV_lower ≥ 0": (d) => onePerFixture(rankByValue(withValue(d.filter((r) => !isPaidOnlyProvenance(r.provenance) || isDed(r)), 0).filter((r) => r.value.eligible), 999)),
  };
  const summarise = (picks: Row[], activeDays: string[], perDay: Map<string, number>) => {
    const st = roiStats(picks), d97 = roiStats(picks, 0.97), d95 = roiStats(picks, 0.95);
    const deep = roiStats(picks.filter((r) => (r.price?.bookmakers ?? 0) >= 8));
    const { dd, lr } = streaks(picks);
    const dec = picks.filter(decided);
    const odds = picks.filter((r) => r.price && !r.price.derived).map((r) => r.price!.median).sort((a, b) => a - b);
    const probs = dec.map((r) => r.pred?.M1 ?? r.pred?.C3 ?? r.confidence / 100);
    return [
      `n=${String(picks.length).padStart(4)} (${(picks.length / Math.max(1, perDay.size)).toFixed(2)}/day, active days <2: ${activeDays.filter((d) => (perDay.get(d) ?? 0) < 2).length}/${activeDays.length})`,
      `strike ${fmtPct(dec.filter((r) => r.outcome === "WON").length / Math.max(1, dec.length))}`,
      `odds mean ${f2(odds.reduce((s, v) => s + v, 0) / Math.max(1, odds.length))} med ${f2(odds[Math.floor(odds.length / 2)])}`,
      `ROI ${fmtPct(st.roi)} [${fmtPct(st.lo)}, ${fmtPct(st.hi)}] (priced ${st.n})`,
      `@-3% ${fmtPct(d97.roi)} @-5% ${fmtPct(d95.roi)} 8+books ${fmtPct(deep.roi)} (n=${deep.n})`,
      `maxDD ${dd.toFixed(1)}u LR ${lr}`,
      `brier ${f3(brier(probs, dec.map(y)))} ECE ${f3(expectedCalibrationError(probs, dec.map(y)))}`,
    ].join("  ");
  };
  console.log("\n5. VIP strategies, replayed per Lagos day on the same published population (NEAR-CLOSE prices for every EV-based arm)");
  const verdict: Record<string, { v: ReturnType<typeof roiStats>; t: ReturnType<typeof roiStats> }> = {};
  for (const [label, set] of [["VALIDATION", validation], ["TEST (held out)", test]] as const) {
    console.log(`  ${label}`);
    const byDay = new Map<string, Row[]>();
    for (const r of set) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
    const activeDays = [...byDay.entries()].filter(([, rs]) => rs.length >= 20).map(([d]) => d);
    for (const [name, s] of Object.entries(strategies)) {
      const picks: Row[] = []; const perDay = new Map<string, number>();
      for (const [d, rs] of byDay) { const p = s(rs); picks.push(...p); perDay.set(d, p.length); }
      console.log(`    ${name.padEnd(32)} ${summarise(picks, activeDays, perDay)}`);
      const by = (verdict[name] ??= { v: null as any, t: null as any });
      if (label === "VALIDATION") by.v = roiStats(picks); else by.t = roiStats(picks);
      if (name.startsWith("P175") || name.startsWith("U1")) {
        const prov = new Map<string, Row[]>();
        for (const r of picks) (prov.get(r.provider ?? "none") ?? prov.set(r.provider ?? "none", []).get(r.provider ?? "none")!).push(r);
        console.log(`        by provider: ${[...prov.entries()].map(([k, rs]) => `${k} n=${rs.length} ROI ${fmtPct(roiStats(rs).roi)}`).join(" | ")}`);
        const mk = new Map<string, Row[]>();
        for (const r of picks) (mk.get(r.marketType) ?? mk.set(r.marketType, []).get(r.marketType)!).push(r);
        console.log(`        by market:   ${[...mk.entries()].map(([k, rs]) => `${k} n=${rs.length} ROI ${fmtPct(roiStats(rs).roi)}`).join(" | ")}`);
      }
    }
  }
  const recommended = Object.entries(verdict).filter(([n, x]) => !n.startsWith("P175") && x.v?.lo != null && x.v.lo > 0 && x.t?.lo != null && x.t.lo > 0).map(([n]) => n);
  console.log(`  Pre-registered rule → value-based live selection recommended: ${recommended.length ? recommended.join(", ") : "NONE (no strategy's ROI interval is wholly above zero on both periods)"}`);

  // ── Cost ────────────────────────────────────────────────────────────────
  const since = new Date(now.getTime() - 30 * DAY);
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: since }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { promptTokens: true, outputTokens: true, model: true } });
  const promoted = await prisma.prediction.count({ where: { createdAt: { gte: since }, provenance: { in: ["VIP_GENERATED", "PREMIUM_GENERATED"] }, status: "PUBLISHED" } });
  const tok = jobs.reduce((s, j) => s + (j.promptTokens ?? 0) + (j.outputTokens ?? 0), 0);
  console.log(`\n6. Dedicated-pass cost, last 30 days: ${jobs.length} model calls, ${tok.toLocaleString()} tokens, ${promoted} published picks → ${(jobs.length / Math.max(1, promoted)).toFixed(1)} calls per published pick. By provider: ${JSON.stringify(jobs.reduce((m: Record<string, number>, j) => ((m[providerOf(j.model) ?? "none"] = (m[providerOf(j.model) ?? "none"] ?? 0) + 1), m), {}))}`);

  // ── Artifact ────────────────────────────────────────────────────────────
  const all = sorted.filter(decided);
  const cal = all.map(toCal);
  const modelOnly = fitModelOnly(cal);
  const artifact: CalibrationArtifact = {
    version: `cal-${lagosDateKey(now).replace(/-/g, "")}-1`,
    fittedAt: now.toISOString(),
    trainedOn: { from: all[0].day, to: all[all.length - 1].day, n: all.length },
    evidence: {
      validationC3vsRaw: vC3, testC3vsRaw: tC3, validationM1vsM0: vM1, testM1vsM0: tM1,
      valueRecommended: recommended, priceSource: "last pre-kickoff FixtureOddsCache quote (near-close)",
    },
    active: c3Active,
    modelOnly,
    withMarket: fitWithMarket(cal, modelOnly),
  };
  console.log(`\nARTIFACT_JSON ${JSON.stringify(artifact)}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
