/**
 * Probability calibration for paid selection. Pure: no database, no network.
 *
 * WHY. Providers state confidence on different scales. Over Aug–Nov 2026 Gemini's
 * ordinary picks averaged 74.2 and Claude's 66.6 on comparable fixtures, while
 * their error against the market was about the same (scripts/measure-paid-
 * performance.ts, section F). A raw "75" therefore means different things
 * depending on who wrote it. A calibrator maps (provider, market, raw confidence)
 * — and optionally the market's own de-vigged probability — to an evidence-based
 * win probability, fitted on settled history in chronological order.
 *
 * WHAT IS HERE.
 *   - Scoring: Brier, log loss, expected calibration error.
 *   - Fitting: logistic (Platt-style) regression by Newton's method, isotonic
 *     regression by pool-adjacent-violators, and a hierarchical fit that shrinks
 *     provider and market adjustments toward the pooled fit by sample size.
 *   - A versioned, serialisable CalibrationArtifact and applyCalibration.
 *
 * Raw confidence is never overwritten anywhere: a calibrated probability is a
 * separate number, computed alongside it, tagged with the artifact's version.
 */

export type Outcome01 = 0 | 1;

// ── Scoring ─────────────────────────────────────────────────────────────────

const clamp = (p: number, lo = 1e-4, hi = 1 - 1e-4) => Math.min(hi, Math.max(lo, p));
export const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function brier(ps: readonly number[], ys: readonly Outcome01[]): number {
  if (!ps.length) return NaN;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i] - ys[i]) ** 2;
  return s / ps.length;
}

export function logLoss(ps: readonly number[], ys: readonly Outcome01[]): number {
  if (!ps.length) return NaN;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s -= ys[i] ? Math.log(clamp(ps[i])) : Math.log(1 - clamp(ps[i]));
  return s / ps.length;
}

/** Expected calibration error over equal-width probability bins (default 10), weighted by bin size. */
export function expectedCalibrationError(ps: readonly number[], ys: readonly Outcome01[], bins = 10): number {
  if (!ps.length) return NaN;
  const n = new Array(bins).fill(0), sp = new Array(bins).fill(0), sy = new Array(bins).fill(0);
  for (let i = 0; i < ps.length; i++) {
    const b = Math.min(bins - 1, Math.floor(ps[i] * bins));
    n[b]++; sp[b] += ps[i]; sy[b] += ys[i];
  }
  let e = 0;
  for (let b = 0; b < bins; b++) if (n[b]) e += (n[b] / ps.length) * Math.abs(sp[b] / n[b] - sy[b] / n[b]);
  return e;
}

// ── Logistic regression (Platt scaling and its multi-feature form) ─────────

/** `cov` is the inverse of the negative Hessian at the solution: the coefficients' approximate covariance. */
export type LogisticFit = { coef: number[]; n: number; converged: boolean; cov: number[][] | null };

/**
 * Logistic regression with an intercept, by Newton–Raphson with a small ridge
 * penalty (lambda) on the non-intercept terms so a tiny or separable sample
 * cannot produce runaway coefficients. `xs[i]` excludes the intercept.
 */
export function fitLogistic(xs: readonly number[][], ys: readonly Outcome01[], lambda = 1e-3, iters = 50): LogisticFit {
  const k = (xs[0]?.length ?? 0) + 1;
  const beta = new Array(k).fill(0);
  if (!xs.length) return { coef: beta, n: 0, converged: false, cov: null };
  const mean = ys.reduce((s: number, y) => s + y, 0) / ys.length;
  beta[0] = logit(mean);
  let converged = false;
  let negH: number[][] | null = null;
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < xs.length; i++) {
      const row = [1, ...xs[i]];
      const p = sigmoid(row.reduce((s, v, j) => s + v * beta[j], 0));
      const w = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a] += (ys[i] - p) * row[a];
        for (let b = 0; b < k; b++) H[a][b] -= w * row[a] * row[b];
      }
    }
    for (let a = 1; a < k; a++) { g[a] -= lambda * xs.length * beta[a]; H[a][a] -= lambda * xs.length; }
    negH = H.map((r) => r.map((v) => -v));
    const step = solve(negH, g);
    if (!step) break;
    let max = 0;
    for (let a = 0; a < k; a++) { beta[a] += step[a]; max = Math.max(max, Math.abs(step[a])); }
    if (max < 1e-8) { converged = true; break; }
  }
  return { coef: beta, n: xs.length, converged, cov: negH ? invert(negH) : null };
}

function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0); e[j] = 1;
    const c = solve(A, e);
    if (!c) return null;
    cols.push(c);
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

/**
 * Standard error of a fitted probability at `x` by the delta method:
 * se(p) = p(1 − p) · sqrt(xᵀ Σ x) with x including the intercept. It covers
 * only the fit's own sampling error, so callers keep a floor under it.
 */
export function logisticPredictionSE(fit: LogisticFit, x: readonly number[]): number {
  if (!fit.cov) return NaN;
  const row = [1, ...x];
  let v = 0;
  for (let a = 0; a < row.length; a++) for (let b = 0; b < row.length; b++) v += row[a] * fit.cov[a][b] * row[b];
  const p = predictLogistic(fit.coef, x);
  return p * (1 - p) * Math.sqrt(Math.max(0, v));
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export const predictLogistic = (coef: readonly number[], x: readonly number[]) => sigmoid(coef[0] + x.reduce((s, v, j) => s + v * coef[j + 1], 0));

// ── Isotonic regression ─────────────────────────────────────────────────────

/** A monotone step function: breakpoints on the input, a value per step. */
export type IsotonicFit = { xs: number[]; ps: number[]; n: number };

/**
 * Isotonic (monotone non-decreasing) regression by pool-adjacent-violators,
 * with every final block holding at least `minBlock` observations so a step is
 * never fitted to a handful of results, and each block's rate shrunk toward
 * the pooled rate by `prior` pseudo-observations.
 */
export function fitIsotonic(x: readonly number[], ys: readonly Outcome01[], minBlock = 30, prior = 10): IsotonicFit {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const pooled = ys.reduce((s: number, y) => s + y, 0) / Math.max(1, ys.length);
  type Block = { lo: number; hi: number; sum: number; n: number };
  let blocks: Block[] = [];
  for (const i of idx) {
    blocks.push({ lo: x[i], hi: x[i], sum: ys[i], n: 1 });
    while (blocks.length > 1) {
      const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      if (a.sum / a.n > b.sum / b.n || a.lo === b.lo) {
        blocks.splice(blocks.length - 2, 2, { lo: a.lo, hi: b.hi, sum: a.sum + b.sum, n: a.n + b.n });
      } else break;
    }
  }
  // Enforce the minimum block size by merging small blocks into a neighbour, then re-pool violators.
  const merge = (bs: Block[]) => {
    let changed = true;
    while (changed && bs.length > 1) {
      changed = false;
      for (let i = 0; i < bs.length; i++) {
        const tooSmall = bs[i].n < minBlock;
        const violates = i > 0 && bs[i - 1].sum / bs[i - 1].n > bs[i].sum / bs[i].n;
        if (tooSmall || violates) {
          const j = i === 0 ? 1 : i - 1;
          const [a, b] = j < i ? [bs[j], bs[i]] : [bs[i], bs[j]];
          bs.splice(Math.min(i, j), 2, { lo: a.lo, hi: b.hi, sum: a.sum + b.sum, n: a.n + b.n });
          changed = true;
          break;
        }
      }
    }
    return bs;
  };
  blocks = merge(blocks);
  // Shrinking blocks of different sizes by the same prior can reorder them, so
  // monotonicity is re-imposed afterwards with a running maximum.
  const ps: number[] = [];
  for (const b of blocks) ps.push(Math.max(ps[ps.length - 1] ?? 0, (b.sum + prior * pooled) / (b.n + prior)));
  return { xs: blocks.map((b) => b.lo), ps, n: ys.length };
}

export function predictIsotonic(fit: IsotonicFit, x: number): number {
  if (!fit.xs.length) return NaN;
  let k = 0;
  for (let i = 0; i < fit.xs.length; i++) if (x >= fit.xs[i]) k = i;
  return fit.ps[k];
}

// ── Hierarchical shrinkage ──────────────────────────────────────────────────

/**
 * Blend a group's coefficients with the pooled ones by sample size:
 * w = n / (n + k). A group with n = k gets half its own fit and half the pooled
 * one; a group with ten rows is almost entirely the pooled fit.
 */
export function shrinkCoef(group: readonly number[], pooled: readonly number[], n: number, k: number): number[] {
  const w = n / (n + k);
  return pooled.map((p, i) => w * (group[i] ?? p) + (1 - w) * p);
}

// ── Artifact ────────────────────────────────────────────────────────────────

/** The market groups a calibration adjusts separately. Anything else falls back to the pooled fit. */
export const CALIBRATION_MARKET_GROUPS = ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS", "DRAW_NO_BET"] as const;

/**
 * A fitted calibration, versioned and serialisable, so a selection can record
 * exactly which mapping produced its probability.
 *
 * `modelOnly` maps (provider, market, raw confidence) → probability with no
 * price input. `withMarket` adds the de-vigged market probability as a second
 * feature; it is only valid where a usable pre-kickoff quote exists at the
 * moment of selection.
 */
export type CalibrationArtifact = {
  version: string;
  fittedAt: string;
  /** Kickoff range of the rows it was fitted on (chronological training period). */
  trainedOn: { from: string; to: string; n: number };
  /** Out-of-sample evidence the activation decision was based on. */
  evidence: Record<string, unknown>;
  /** True only when the out-of-sample evidence justified it. Selection treats an inactive artifact as absent. */
  active: boolean;
  modelOnly: {
    /** Pooled coefficients [intercept, slope on logit(raw/100)]. */
    pooled: number[];
    /** Shrunk coefficients per provider ("anthropic", "gemini", "groq", ...). */
    providers: Record<string, number[]>;
    /** Shrunk intercept shift per market group. */
    markets: Record<string, number>;
  };
  withMarket: {
    /** [intercept, coef on logit(model-only probability), coef on logit(market fair probability)]. */
    coef: number[];
    /** The coefficients' covariance, for the delta-method standard error. */
    cov: number[][] | null;
  } | null;
};

export type CalibrationInput = {
  provider: string | null;
  marketType: string;
  /** Raw stated confidence, 0-100. */
  rawConfidence: number;
  /** De-vigged market probability, 0-100, from a usable pre-kickoff quote; null when none. */
  marketProbability?: number | null;
};

export type CalibratedProbability = {
  version: string;
  /** Model-only calibrated probability, 0-1. */
  modelOnly: number;
  /** With the market as a second input, 0-1; null without a usable quote or a fitted market term. */
  withMarket: number | null;
  /** Delta-method standard error of `withMarket` (fit sampling error only); null with it. */
  withMarketSE: number | null;
};

/** Provider key as AIJob.model records it: the prefix before ":" ("anthropic:claude-…" → "anthropic"). */
export function providerOf(model: string | null | undefined): string | null {
  if (!model) return null;
  return model.includes(":") ? model.split(":")[0] : "legacy";
}

export function applyCalibration(a: CalibrationArtifact, input: CalibrationInput): CalibratedProbability {
  const coef = (input.provider && a.modelOnly.providers[input.provider]) || a.modelOnly.pooled;
  const shift = a.modelOnly.markets[input.marketType] ?? 0;
  const z = coef[0] + shift + coef[1] * logit(input.rawConfidence / 100);
  const modelOnly = sigmoid(z);
  const x = input.marketProbability != null ? [logit(modelOnly), logit(input.marketProbability / 100)] : null;
  const withMarket = a.withMarket && x ? predictLogistic(a.withMarket.coef, x) : null;
  const withMarketSE = a.withMarket && x && a.withMarket.cov
    ? logisticPredictionSE({ coef: a.withMarket.coef, cov: a.withMarket.cov, n: 0, converged: true }, x)
    : null;
  return { version: a.version, modelOnly, withMarket, withMarketSE };
}

// ── Fitting an artifact ─────────────────────────────────────────────────────

export type CalibrationRow = {
  provider: string | null;
  marketType: string;
  rawConfidence: number;
  /** De-vigged market probability 0-100 from a pre-kickoff quote, or null. */
  marketProbability: number | null;
  y: Outcome01;
};

/** Shrinkage strengths: pseudo-observations pulling a group toward the pooled fit. */
export const CALIBRATION_K_PROVIDER = 150;
export const CALIBRATION_K_MARKET = 150;

/** Maximum-likelihood intercept shift `s` for logit(p_i) = z_i + s, by 1-D Newton. */
function interceptShift(zs: readonly number[], ys: readonly Outcome01[]): number {
  let s = 0;
  for (let it = 0; it < 50; it++) {
    let g = 0, h = 0;
    for (let i = 0; i < zs.length; i++) {
      const p = sigmoid(zs[i] + s);
      g += ys[i] - p;
      h += p * (1 - p);
    }
    if (h < 1e-9) break;
    const step = g / h;
    s += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return s;
}

/**
 * Fit the model-only hierarchical calibration: a pooled Platt fit on
 * logit(raw/100), per-provider fits shrunk toward it by CALIBRATION_K_PROVIDER,
 * then a per-market intercept shift shrunk toward zero by CALIBRATION_K_MARKET.
 */
export function fitModelOnly(rows: readonly CalibrationRow[], kProvider = CALIBRATION_K_PROVIDER, kMarket = CALIBRATION_K_MARKET): CalibrationArtifact["modelOnly"] {
  const x = (r: CalibrationRow) => [logit(r.rawConfidence / 100)];
  const pooled = fitLogistic(rows.map(x), rows.map((r) => r.y)).coef;
  const providers: Record<string, number[]> = {};
  for (const p of [...new Set(rows.map((r) => r.provider ?? "unknown"))]) {
    const rs = rows.filter((r) => (r.provider ?? "unknown") === p);
    providers[p] = shrinkCoef(fitLogistic(rs.map(x), rs.map((r) => r.y)).coef, pooled, rs.length, kProvider);
  }
  const zOf = (r: CalibrationRow) => {
    const c = providers[r.provider ?? "unknown"] ?? pooled;
    return c[0] + c[1] * x(r)[0];
  };
  const markets: Record<string, number> = {};
  for (const m of CALIBRATION_MARKET_GROUPS) {
    const rs = rows.filter((r) => r.marketType === m);
    if (!rs.length) continue;
    const s = interceptShift(rs.map(zOf), rs.map((r) => r.y));
    markets[m] = (s * rs.length) / (rs.length + kMarket);
  }
  return { pooled, providers, markets };
}

/** Fit the market term on rows that carry a market probability, given a fitted model-only part. */
export function fitWithMarket(rows: readonly CalibrationRow[], modelOnly: CalibrationArtifact["modelOnly"]): CalibrationArtifact["withMarket"] {
  const priced = rows.filter((r) => r.marketProbability != null);
  if (priced.length < 100) return null;
  const tmp: CalibrationArtifact = { version: "", fittedAt: "", trainedOn: { from: "", to: "", n: 0 }, evidence: {}, active: false, modelOnly, withMarket: null };
  const xs = priced.map((r) => [logit(applyCalibration(tmp, r).modelOnly), logit(r.marketProbability! / 100)]);
  const fit = fitLogistic(xs, priced.map((r) => r.y));
  return { coef: fit.coef, cov: fit.cov };
}
