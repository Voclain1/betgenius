/**
 * VIP/Premium supply reliability: first loss of a covered paid-scope fixture,
 * in pipeline order, separating intentional rules and genuine scarcity from
 * losses that could be recoverable. Pure. Used by
 * scripts/measure-supply-funnel.ts; tested by scripts/check-supply-funnel.ts.
 */
import type { ScopeGroup } from "@/lib/paidOpportunity";

export type SupplyLoss =
  | "VIP"
  // Intentional rules
  | "WIDENED_NOT_IN_SCOPE" // widened competition; the pass never widened while it was in the window (healthy day)
  | "ORDINARY_RULE_REJECTED" // an ordinary >= 75 pick existed; #175 curation rule refused it (market disagreement etc.)
  // Genuine scarcity
  | "MARKET_NOT_LOPSIDED" // priced, but no MW/DC side >= 75 at the closing reference: not a target
  | "MODEL_BELOW_FLOOR" // attempted, every draft < 75
  | "GATE_REJECTED" // attempted, a draft >= 75 failed the market gate or tier floor
  // Possibly recoverable
  | "COVERED_TOO_LATE" // ordinary generation covered it inside 12h of kickoff: never in the pass window
  | "NO_ODDS_IN_SCOPE" // in scope, no pre-kickoff quote with >= 5 books on a targetable market
  | "QUOTA_SPENT" // lopsided, never attempted, and the kickoff day's attempt quota was spent
  | "NOT_ATTEMPTED_LOPSIDED" // lopsided at close, in scope, quota left, never attempted
  | "PROMOTED_NOT_PUBLISHED"; // passed the gate, never published

export const RECOVERABLE_CANDIDATES: ReadonlySet<SupplyLoss> = new Set([
  "COVERED_TOO_LATE", "NO_ODDS_IN_SCOPE", "QUOTA_SPENT", "NOT_ATTEMPTED_LOPSIDED", "PROMOTED_NOT_PUBLISHED",
]);

export function supplyFirstLoss(x: {
  vip: boolean;
  group: ScopeGroup;
  /** Core, or widened and the dedicated pass widened while the fixture was 12-48h out. */
  inScope: boolean;
  priced5: boolean;
  closing: number | null;
  attempted: boolean;
  draftMax: number | null;
  promoted: boolean;
  published: boolean;
  dayQuotaSpent: boolean;
  coveredLate: boolean;
  ordinaryAt75: boolean;
  ordinaryRule: string | null;
}): SupplyLoss {
  if (x.vip) return "VIP";
  if (x.attempted) {
    if (x.promoted) return x.published ? "VIP" : "PROMOTED_NOT_PUBLISHED";
    return (x.draftMax ?? 0) >= 75 ? "GATE_REJECTED" : "MODEL_BELOW_FLOOR";
  }
  if (!x.inScope) return x.ordinaryAt75 && x.ordinaryRule ? "ORDINARY_RULE_REJECTED" : "WIDENED_NOT_IN_SCOPE";
  if (x.coveredLate) return "COVERED_TOO_LATE";
  if (!x.priced5) return "NO_ODDS_IN_SCOPE";
  if ((x.closing ?? 0) < 75) return x.ordinaryAt75 && x.ordinaryRule ? "ORDINARY_RULE_REJECTED" : "MARKET_NOT_LOPSIDED";
  return x.dayQuotaSpent ? "QUOTA_SPENT" : "NOT_ATTEMPTED_LOPSIDED";
}

// ── Attempt yield by targeting signal ───────────────────────────────────────

export type AttemptRecord = {
  ranAt: Date;
  fixture: string;
  kickoffDay: string;
  /** The de-vigged headline (MW/DC) probability that made the fixture a target. */
  signal: number;
  market: string;
  promotedVip: number;
  promotedPremium: number;
  rejected: Record<string, number>;
  evaluated: number;
};

/** Signal bands; the last is above the price the gate will sell (PAID_MAX_MARKET_PROBABILITY). Pure. */
export function signalBand(p: number, ceiling: number): string {
  if (p > ceiling) return "above ceiling";
  if (p >= 82) return "82-ceiling";
  if (p >= 78) return "78-82";
  return "75-78";
}

/** Yield per band: attempts, promotions and the run-recorded rejection reasons. Pure. */
export function summariseAttemptYield(attempts: readonly AttemptRecord[], ceiling: number) {
  const order = ["75-78", "78-82", "82-ceiling", "above ceiling"];
  const bands = order.map((band) => {
    const xs = attempts.filter((a) => signalBand(a.signal, ceiling) === band);
    const rejected: Record<string, number> = {};
    for (const a of xs) for (const [k, n] of Object.entries(a.rejected)) rejected[k] = (rejected[k] ?? 0) + n;
    const vip = xs.reduce((s, a) => s + a.promotedVip, 0), premium = xs.reduce((s, a) => s + a.promotedPremium, 0);
    return { band, attempts: xs.length, vip, premium, promoted: vip + premium, rejected };
  });
  const above = attempts.filter((a) => signalBand(a.signal, ceiling) === "above ceiling");
  const promotedMarkets: Record<string, number> = {};
  for (const a of above.filter((x) => x.promotedVip + x.promotedPremium > 0)) promotedMarkets[a.market] = (promotedMarkets[a.market] ?? 0) + 1;
  return { bands, aboveCeiling: { attempts: above.length, promoted: above.reduce((s, a) => s + a.promotedVip + a.promotedPremium, 0), promotedMarkets } };
}
