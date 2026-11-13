/**
 * Calibration, value arithmetic and value-based selection, proved without a
 * database or network.
 *
 *   1. Scoring: Brier, log loss, ECE on known inputs.
 *   2. Logistic fit recovers known coefficients; its standard errors shrink with n.
 *   3. Isotonic fit is monotone, honours its minimum block, shrinks to the pool.
 *   4. Hierarchical fit: a provider with a different scale is corrected; a tiny
 *      group is pulled toward the pooled fit; market shifts are shrunk.
 *   5. Artifact: versioned, applies deterministically, falls back to pooled for
 *      an unknown provider; raw confidence is an input, never overwritten.
 *   6. Expected value with win/void/loss, break-even, uncertainty lower bound.
 *   7. Value assessment: no executable price (missing, derived), thin book,
 *      price disagreement, no calibration, EV bar.
 *   8. Ranking: lower-bound EV first, diversification cap, stable order.
 *   9. Chronological separation and reproducibility in the fit script.
 *
 * Run: npx tsx scripts/check-calibration-value.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cal from "../src/lib/calibration";
import * as val from "../src/lib/paidValue";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)?.slice(0, 400)}`}`);
};
const near = (label: string, got: number | null | undefined, want: number, tol: number) => check(label, got != null && Math.abs(got - want) <= tol, got);

// Deterministic generator.
function lcg(seed: number) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }
const rnd = lcg(42);
const draw = (p: number): 0 | 1 => (rnd() < p ? 1 : 0);

// ── 1. Scoring ──────────────────────────────────────────────────────────────
near("brier: perfect forecasts score 0", cal.brier([1, 0], [1, 0]), 0, 1e-12);
near("brier: always 0.5 scores 0.25", cal.brier([0.5, 0.5, 0.5], [1, 0, 1]), 0.25, 1e-12);
near("logloss: 0.5 everywhere is ln 2", cal.logLoss([0.5, 0.5], [1, 0]), Math.log(2), 1e-9);
near("ECE: calibrated bins score 0", cal.expectedCalibrationError([0.75, 0.75, 0.75, 0.75], [1, 1, 1, 0]), 0, 1e-12);
near("ECE: 80% stated, 50% realised scores 0.3", cal.expectedCalibrationError([0.8, 0.8], [1, 0]), 0.3, 1e-12);

// ── 2. Logistic ─────────────────────────────────────────────────────────────
{
  const xs: number[][] = [], ys: (0 | 1)[] = [];
  for (let i = 0; i < 4000; i++) { const x = -2 + 4 * rnd(); xs.push([x]); ys.push(draw(cal.sigmoid(0.5 + 1.5 * x))); }
  const fit = cal.fitLogistic(xs, ys);
  near("logistic: recovers the intercept", fit.coef[0], 0.5, 0.15);
  near("logistic: recovers the slope", fit.coef[1], 1.5, 0.15);
  check("logistic: converges", fit.converged);
  const small = cal.fitLogistic(xs.slice(0, 200), ys.slice(0, 200));
  check("logistic: the standard error of a prediction shrinks with n", cal.logisticPredictionSE(fit, [0]) < cal.logisticPredictionSE(small, [0]), [cal.logisticPredictionSE(fit, [0]), cal.logisticPredictionSE(small, [0])]);
  const sep = cal.fitLogistic([[0], [1]], [0, 1]);
  check("logistic: a separable two-row sample stays finite (ridge)", sep.coef.every(Number.isFinite) && Math.abs(sep.coef[1]) < 100, sep.coef);
}

// ── 3. Isotonic ─────────────────────────────────────────────────────────────
{
  const x: number[] = [], ys: (0 | 1)[] = [];
  for (let i = 0; i < 1000; i++) { const c = 50 + Math.floor(rnd() * 40); x.push(c); ys.push(draw(c / 100)); }
  const fit = cal.fitIsotonic(x, ys, 30, 10);
  check("isotonic: steps are non-decreasing", fit.ps.every((p, i) => i === 0 || p >= fit.ps[i - 1] - 1e-12), fit.ps);
  check("isotonic: monotone predictions", cal.predictIsotonic(fit, 55) <= cal.predictIsotonic(fit, 85));
  const tiny = cal.fitIsotonic([60, 61, 62], [1, 1, 1], 30, 10);
  check("isotonic: under the minimum block, one block shrunk toward the pool", tiny.ps.length === 1 && tiny.ps[0] === 1, tiny);
  const shrunk = cal.fitIsotonic([...Array(40)].map((_, i) => 60 + (i % 5)), [...Array(40)].map((_, i) => (i < 30 ? 1 : 0) as 0 | 1), 30, 40);
  check("isotonic: prior pseudo-counts pull a block toward the pooled rate", shrunk.ps.every((p) => p <= 0.75 + 1e-9));
}

// ── 4. Hierarchical ────────────────────────────────────────────────────────
const synth = (provider: string, n: number, shift: number, market = "DOUBLE_CHANCE"): cal.CalibrationRow[] =>
  [...Array(n)].map(() => { const raw = 55 + Math.floor(rnd() * 30); return { provider, marketType: market, rawConfidence: raw, marketProbability: null, y: draw(Math.min(0.97, raw / 100 + shift)) }; });
{
  // Provider "low" states confidence 8 points under what it achieves; "honest" is calibrated.
  const rows = [...synth("honest", 3000, 0), ...synth("low", 1500, 0.08), ...synth("tiny", 20, 0.3)];
  const m = cal.fitModelOnly(rows);
  const art: cal.CalibrationArtifact = { version: "t", fittedAt: "", trainedOn: { from: "", to: "", n: rows.length }, evidence: {}, active: false, modelOnly: m, withMarket: null };
  const p = (provider: string, raw: number) => cal.applyCalibration(art, { provider, marketType: "DOUBLE_CHANCE", rawConfidence: raw }).modelOnly;
  near("hierarchical: an honest provider's 70 stays near 70%", p("honest", 70), 0.70, 0.04);
  near("hierarchical: a provider stating 8 points low has its 67 lifted toward 75%", p("low", 67), 0.75, 0.04);
  check("hierarchical: a 20-row provider is pulled toward the pooled fit, not its own 30-point shift", p("tiny", 70) < 0.80, p("tiny", 70));
  near("hierarchical: an unknown provider uses the pooled fit (plus the market shift)", p("never-seen", 70), cal.sigmoid(m.pooled[0] + (m.markets.DOUBLE_CHANCE ?? 0) + m.pooled[1] * cal.logit(0.7)), 1e-12);
  const shift = cal.fitModelOnly([...synth("honest", 2000, 0), ...synth("honest", 60, -0.2, "BTTS")]).markets.BTTS;
  check("hierarchical: a small market's shift is shrunk (k=150) but keeps its sign", shift < 0 && shift > -1, shift);
  check("artifact: shrinkage constants are 150", cal.CALIBRATION_K_PROVIDER === 150 && cal.CALIBRATION_K_MARKET === 150);
  const priced = rows.map((r) => ({ ...r, marketProbability: Math.min(95, r.rawConfidence + 3) }));
  const wm = cal.fitWithMarket(priced, m);
  check("artifact: the market term is fitted with a covariance", !!wm && wm.coef.length === 3 && !!wm.cov, wm);
  check("artifact: fewer than 100 priced rows → no market term", cal.fitWithMarket(priced.slice(0, 50), m) === null);
  const withM = cal.applyCalibration({ ...art, withMarket: wm }, { provider: "honest", marketType: "DOUBLE_CHANCE", rawConfidence: 70, marketProbability: 73 });
  check("artifact: applies with the market and reports a standard error", withM.withMarket != null && withM.withMarketSE != null && withM.withMarketSE > 0 && withM.withMarketSE < 0.1, withM);
  check("artifact: no market probability → no market estimate", cal.applyCalibration({ ...art, withMarket: wm }, { provider: "honest", marketType: "DOUBLE_CHANCE", rawConfidence: 70 }).withMarket === null);
  check("artifact: carries its version on every output", withM.version === "t");
  check("artifact: provider is read from AIJob.model", cal.providerOf("anthropic:claude-haiku-5-5") === "anthropic" && cal.providerOf("gemini-flash-latest") === "legacy" && cal.providerOf(null) === null);
}

// ── 6. EV arithmetic ────────────────────────────────────────────────────────
near("ev: a fair coin at 2.00 is zero", val.expectedReturn({ win: 0.5, void: 0, loss: 0.5 }, 2), 0, 1e-12);
near("ev: 80% at 1.20 is -4%", val.expectedReturn({ win: 0.8, void: 0, loss: 0.2 }, 1.2), -0.04, 1e-12);
near("ev: a void returns the stake — 60% win, 25% void at 1.50 is +15%", val.expectedReturn({ win: 0.6, void: 0.25, loss: 0.15 }, 1.5), 0.15, 1e-12);
near("ev: break-even at 1.25 is 80%", val.breakEvenProbability(1.25), 0.8, 1e-12);
near("ev: break-even with a 25% void chance at 1.50 is 50%", val.breakEvenProbability(1.5, 0.25), 0.5, 1e-12);
{
  const dnb = val.outcomeProbabilities("DRAW_NO_BET", 0.6, 0.25);
  check("ev: draw no bet splits into win / void / loss", Math.abs(dnb.win + dnb.void + dnb.loss - 1) < 1e-12 && dnb.void === 0.25, dnb);
  const capped = val.outcomeProbabilities("DRAW_NO_BET", 0.9, 0.3);
  check("ev: a void probability never exceeds what the win leaves", capped.void <= 0.1 + 1e-12 && capped.loss >= 0, capped);
  check("ev: other markets never void", val.outcomeProbabilities("OVER_UNDER", 0.7).void === 0);
}
near("uncertainty: lower bound uses the floor when se is tiny", val.uncertaintyLower(0.8, 0.001), 0.8 - 1.28 * 0.02, 1e-12);
near("uncertainty: and the se when larger", val.uncertaintyLower(0.8, 0.05), 0.8 - 1.28 * 0.05, 1e-12);
check("uncertainty: never below zero", val.uncertaintyLower(0.01, 0.5) === 0);

// ── 7. Value assessment ────────────────────────────────────────────────────
{
  const price = (median: number, o: Partial<{ best: number; bookmakers: number; derived: boolean; fair: number }> = {}) => ({ median, best: o.best ?? median, bookmakers: o.bookmakers ?? 8, fair: o.fair ?? 100 / median / 1.05, derived: o.derived ?? false });
  const est = (p: number, se = 0.01) => ({ p, se, version: "v" });
  const a = (o: Partial<Parameters<typeof val.assessValue>[0]>) => val.assessValue({ marketType: "MATCH_WINNER", rawConfidence: 78, price: price(1.4), estimate: est(0.78), minEvLower: 0, ...o });
  const ok = a({});
  check("value: 78% at 1.40 with a tight estimate is credible value", ok.eligible && ok.expectedValue! > 0 && ok.expectedValueLower! > 0, ok);
  check("value: keeps raw confidence, market probability and estimate apart", ok.rawConfidence === 78 && ok.marketProbability != null && ok.estimatedProbability === 0.78);
  check("value: no price → NO_EXECUTABLE_PRICE", a({ price: null }).reasons.includes("NO_EXECUTABLE_PRICE"));
  check("value: a derived draw-no-bet price is not executable", a({ marketType: "DRAW_NO_BET", price: price(1.3, { derived: true }) }).reasons.includes("NO_EXECUTABLE_PRICE"));
  check("value: fewer than 5 books → THIN_BOOK", a({ price: price(1.4, { bookmakers: 4 }) }).reasons.includes("THIN_BOOK"));
  check("value: best 20% above the median → PRICE_DISAGREEMENT", a({ price: price(1.4, { best: 1.7 }) }).reasons.includes("PRICE_DISAGREEMENT"));
  check("value: no active calibration → NO_CALIBRATION, never valued from raw confidence", a({ estimate: null }).reasons.includes("NO_CALIBRATION") && a({ estimate: null }).expectedValue === null);
  const thin = a({ estimate: est(0.73, 0.04) });
  check("value: positive point EV but a wide estimate fails the lower-bound bar", thin.expectedValue! > 0 && thin.expectedValueLower! < 0 && thin.reasons.includes("EV_NOT_CREDIBLE"), thin);
  check("value: the median is used, never the best", a({ price: price(1.4, { best: 1.5 }) }).odds === 1.4);
  const dnb = a({ marketType: "DRAW_NO_BET", price: price(1.5), estimate: est(0.6, 0.0), pDraw: 0.25 });
  near("value: draw no bet EV counts the void as a refund", dnb.expectedValue, 0.6 * 1.5 + 0.25 - 1, 1e-9);
  near("value: draw no bet break-even accounts for the void", dnb.breakEven, 0.75 / 1.5, 1e-9);
}

// ── 8. Ranking ──────────────────────────────────────────────────────────────
{
  const mk = (id: string, marketType: string, evl: number, p = 0.8) => ({ id, marketType, value: { expectedValueLower: evl, estimatedProbability: p } as val.ValueAssessment });
  const rows = [mk("a", "DOUBLE_CHANCE", 0.01), mk("b", "DOUBLE_CHANCE", 0.03), mk("c", "DOUBLE_CHANCE", 0.02), mk("d", "OVER_UNDER", -0.01), mk("e", "DOUBLE_CHANCE", 0.04)];
  const top = val.rankByValue(rows, 4);
  check("rank: strongest lower-bound EV first", top[0].id === "e", top.map((r) => r.id));
  check("rank: no market type takes more than half the slots", top.filter((r) => r.marketType === "DOUBLE_CHANCE").length === 2 && top.some((r) => r.marketType === "OVER_UNDER"), top.map((r) => r.id));
  check("rank: stable on ties", val.rankByValue([mk("z", "BTTS", 0), mk("y", "BTTS", 0)], 2).map((r) => r.id).join() === "y,z");
}

// ── 9. Fit-script integrity ─────────────────────────────────────────────────
{
  const src = readFileSync(join(__dirname, "fit-calibration.ts"), "utf8");
  check("fit: each fold is fitted only on rows that kicked off before it", /fit\(sorted\.filter\(\(r\) => r\.day < foldStart\)\)/.test(src));
  check("fit: the test period is fitted only on rows before it", /fit\(sorted\.filter\(\(r\) => r\.day < testStart\)\)/.test(src));
  check("fit: the held-out period is the last days and is never a fold", /days\[days\.length - TEST_DAYS\]/.test(src) && /while \(foldStart < testStart\)/.test(src));
  check("fit: refuses a session that is not read-only", /REQUIRE_READ_ONLY/.test(src) && /transaction_read_only/.test(src));
  check("fit: prices only from a quote taken before kickoff", /fetchedAt\.getTime\(\) < r\.kickoff!\.getTime\(\)/.test(src));
  check("fit: activation rules are fixed in code, not chosen after the run", /const c3Active = vC3\.diff < 0 && tC3\.diff < 0 && vC3\.hi < 0/.test(src));
  check("fit: bootstrap seeds are fixed (reproducible)", /lcg\(7\)/.test(src) && /lcg\(11\)/.test(src) && !/Math\.random/.test(src));
  check("fit: writes nothing", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(src));
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) process.exit(1);
console.log("Calibration and value checks passed");
