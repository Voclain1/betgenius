/**
 * VIP/Premium Sprint 11: pure helpers for the production validation audit
 * (scripts/audit-sprint11.ts). No I/O, no provider calls. Tested by
 * scripts/check-sprint11-audit.ts.
 */
import type { FixtureOdds } from "@/lib/odds";
import { lopsidednessSignal } from "@/lib/marketConfirmed";

/** Deployment of the Sprint 10 Double Chance label fix (deploy-vps run 81, master 74fb44a). */
export const DC_FIX_DEPLOYED_AT = new Date("2026-11-15T00:04:49.000Z");
/** Deployment of Sprint 08-09 (deploy-vps run 80, master 630349b): PAID_SPARE_QUOTA_WIDENING code went live. */
export const SPARE_QUOTA_DEPLOYED_AT = new Date("2026-11-15T00:02:35.000Z");

type Signal = ReturnType<typeof lopsidednessSignal>;

/**
 * The targeting signal exactly as it was BEFORE the Sprint 10 fix.
 *
 * The old coverage lookup required the Double Chance label to equal the
 * wanted label character for character ("away/draw"), so the feed's
 * "Draw/Away" never matched. Removing every Double Chance selection whose
 * label is not literally one of the two targeted labels reproduces that
 * behaviour on the current code: what is left can only match exactly, as it
 * did then. The probability itself still comes from the Match Winner market,
 * as it always has.
 */
export function legacyLopsidednessSignal(odds: FixtureOdds | null): Signal {
  if (!odds?.markets) return null;
  const exact = new Set(["home/draw", "away/draw"]);
  const stripped: FixtureOdds = {
    ...odds,
    markets: odds.markets.map((m) =>
      m.market === "Double Chance" ? { ...m, selections: m.selections.filter((s) => exact.has(s.value.trim().toLowerCase())) } : m,
    ),
  };
  return lopsidednessSignal(stripped);
}

export type DcComparison =
  | "BOTH_NONE"
  | "UNCHANGED" // same market, value and probability under both: home side, Match Winner, or an exact "Away/Draw" label
  | "NEWLY_TARGETABLE" // fixed signal reaches 75+, legacy did not: the fixtures the defect excluded
  | "AWAY_DC_STRONGER_BELOW_BAR" // fixed signal picks away DC but neither crosses 75: no targeting change
  | "AWAY_DC_STRONGER_ABOVE_BAR"; // both reach 75, away DC now the headline: same targeting outcome, different stated market

export const TARGET_BAR = 75;

/** How the fix changes one fixture's targeting signal. Pure. */
export function compareDcSignals(odds: FixtureOdds | null): { kind: DcComparison; fixed: Signal; legacy: Signal } {
  const fixed = lopsidednessSignal(odds);
  const legacy = legacyLopsidednessSignal(odds);
  if (!fixed && !legacy) return { kind: "BOTH_NONE", fixed, legacy };
  const same = !!fixed && !!legacy && fixed.market === legacy.market && fixed.value === legacy.value && fixed.probability === legacy.probability;
  if (same) return { kind: "UNCHANGED", fixed, legacy };
  const fixedHits = (fixed?.probability ?? 0) >= TARGET_BAR;
  const legacyHits = (legacy?.probability ?? 0) >= TARGET_BAR;
  if (fixedHits && !legacyHits) return { kind: "NEWLY_TARGETABLE", fixed, legacy };
  if (fixedHits && legacyHits) return { kind: "AWAY_DC_STRONGER_ABOVE_BAR", fixed, legacy };
  return { kind: "AWAY_DC_STRONGER_BELOW_BAR", fixed, legacy };
}

// ── Dry days ────────────────────────────────────────────────────────────────

export type DryDayReason =
  | "NO_ELIGIBLE_FIXTURES" // nothing was covered (generated) for the Lagos day
  | "OUTSIDE_PAID_SCOPE" // covered fixtures, none in a paid-eligible competition
  | "NO_VALID_BOOKMAKER_EVIDENCE" // in scope, but no pre-kickoff quote with >= 5 books on a targetable market
  | "TARGETING_EXCLUDED" // priced, but none at 75%+ (or widened-only on a day the pass never widened)
  | "PROVIDER_OR_QUOTA_LIMITATION" // targetable, not attempted, and the pass stood down for budget/quota
  | "GENERATION_FAILURE" // targetable, attempts failed before any draft
  | "MODEL_CONFIDENCE_BELOW_FLOOR" // drafted, every draft under 75
  | "MARKET_QUALIFICATION_FAILURE" // a draft at 75+ failed the market gate (gap, band, books, repeat)
  | "PUBLISHING_FAILURE" // promoted, never published
  | "OTHER_VERIFIED"; // targetable, never attempted, no recorded stand-down

export type DryDayInput = {
  covered: number;
  inPaidScope: number;
  pricedInScope: number;
  /** In-scope fixtures the pass could target at the closing reference (75%+, scope allowed that day). */
  targetable: number;
  attempted: number;
  draftsAt75: number;
  drafts: number;
  promoted: number;
  published: number;
  generationFailures: number;
  standDowns: number;
};

/** First failing stage of a day with no VIP or PREMIUM publication, in pipeline order. Pure. */
export function classifyDryDay(d: DryDayInput): DryDayReason {
  if (d.covered === 0) return "NO_ELIGIBLE_FIXTURES";
  if (d.inPaidScope === 0) return "OUTSIDE_PAID_SCOPE";
  if (d.pricedInScope === 0) return "NO_VALID_BOOKMAKER_EVIDENCE";
  if (d.targetable === 0 && d.attempted === 0) return "TARGETING_EXCLUDED";
  if (d.attempted === 0) return d.standDowns > 0 ? "PROVIDER_OR_QUOTA_LIMITATION" : "OTHER_VERIFIED";
  if (d.drafts === 0) return d.generationFailures > 0 ? "GENERATION_FAILURE" : "OTHER_VERIFIED";
  if (d.draftsAt75 === 0) return "MODEL_CONFIDENCE_BELOW_FLOOR";
  if (d.promoted === 0) return "MARKET_QUALIFICATION_FAILURE";
  if (d.published === 0) return "PUBLISHING_FAILURE";
  return "OTHER_VERIFIED";
}

/** Reasons that can be addressed without weakening any quality requirement. */
export const ADDRESSABLE_WITHOUT_LOWERING_BARS: ReadonlySet<DryDayReason> = new Set([
  "NO_VALID_BOOKMAKER_EVIDENCE", // odds warming / coverage, not thresholds
  "PROVIDER_OR_QUOTA_LIMITATION", // scheduling and budget headroom
  "GENERATION_FAILURE", // reliability
  "PUBLISHING_FAILURE", // reliability
  "OTHER_VERIFIED", // needs investigation; nothing to loosen
]);

// ── Spare quota ─────────────────────────────────────────────────────────────

export type SpareQuotaRunDetail = {
  mode?: string;
  slots?: Record<string, number>;
  eligible?: number;
  qualifiedFromCache?: number;
  wouldTarget?: Array<{ fixture: string; kickoff: string; leagueApiId: number | null; marketProbability: number }>;
};

/**
 * Summarise the dedicated pass's recorded spare-quota block across runs.
 * Would-be targets are deduplicated by fixture and kickoff: each run lists
 * the same fixture again while it stays in the window. Pure.
 */
export function summariseSpareQuotaRuns(runs: Array<{ ranAt: Date; spare: SpareQuotaRunDetail | null | undefined }>) {
  const modes: Record<string, number> = {};
  const slotsByDay: Record<string, number> = {};
  const would = new Map<string, { fixture: string; kickoff: string; leagueApiId: number | null; maxMarket: number; runs: number }>();
  let withBlock = 0, eligibleRunSum = 0, qualifiedRunSum = 0;
  for (const r of runs) {
    const s = r.spare;
    const mode = s?.mode ?? "absent";
    modes[mode] = (modes[mode] ?? 0) + 1;
    if (!s) continue;
    withBlock++;
    eligibleRunSum += s.eligible ?? 0;
    qualifiedRunSum += s.qualifiedFromCache ?? 0;
    for (const [day, n] of Object.entries(s.slots ?? {})) slotsByDay[day] = Math.max(slotsByDay[day] ?? 0, n);
    for (const t of s.wouldTarget ?? []) {
      const k = `${t.fixture}|${t.kickoff}`;
      const x = would.get(k) ?? { fixture: t.fixture, kickoff: t.kickoff, leagueApiId: t.leagueApiId, maxMarket: 0, runs: 0 };
      x.maxMarket = Math.max(x.maxMarket, t.marketProbability);
      x.runs++;
      would.set(k, x);
    }
  }
  return { runs: runs.length, withBlock, modes, slotsByDay, eligibleRunSum, qualifiedRunSum, wouldTarget: [...would.values()] };
}

/** Wilson 95% interval as whole percentages, or null for an empty sample. */
export function wilsonPct(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = k / n, den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.round(100 * (c - h)), Math.round(100 * (c + h))];
}

/** Minimum decided picks before a strike rate or ROI is read as more than anecdote. */
export const MIN_DECIDED_FOR_READING = 30;

// ── Publication-price evidence ──────────────────────────────────────────────

/** First reason a stored confirmation fails verifiedEntryPrice, in that function's own order. Pure. */
export type EntryEvidenceStatus =
  | "VERIFIED"
  | "NO_CONFIRMATION"
  | "NO_ENTRY_PRICE_FIELD" // written before entryValueRecord existed (#176)
  | "ENTRY_PRICE_UNAVAILABLE" // field present but null/<=1: no direct bookmaker line for the exact selection
  | "MISSING_QUOTE_TIMESTAMP"
  | "MISSING_CONFIRMED_AT"
  | "QUOTE_AFTER_CONFIRMATION"
  | "QUOTE_OLDER_THAN_6H"
  | "CONFIRMED_AT_OR_AFTER_KICKOFF"
  | "INVALID_KICKOFF";

export function entryEvidenceStatus(confirmation: unknown, kickoff: Date): EntryEvidenceStatus {
  if (!Number.isFinite(kickoff.getTime())) return "INVALID_KICKOFF";
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) return "NO_CONFIRMATION";
  const c = confirmation as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(c, "entryPrice")) return "NO_ENTRY_PRICE_FIELD";
  if (typeof c.entryPrice !== "number" || !Number.isFinite(c.entryPrice) || c.entryPrice <= 1) return "ENTRY_PRICE_UNAVAILABLE";
  const quoted = typeof c.quoteFetchedAt === "string" ? Date.parse(c.quoteFetchedAt) : NaN;
  const confirmed = typeof c.confirmedAt === "string" ? Date.parse(c.confirmedAt) : NaN;
  if (!Number.isFinite(quoted)) return "MISSING_QUOTE_TIMESTAMP";
  if (!Number.isFinite(confirmed)) return "MISSING_CONFIRMED_AT";
  if (quoted > confirmed) return "QUOTE_AFTER_CONFIRMATION";
  if (confirmed - quoted > 6 * 60 * 60 * 1000) return "QUOTE_OLDER_THAN_6H";
  if (confirmed >= kickoff.getTime()) return "CONFIRMED_AT_OR_AFTER_KICKOFF";
  return "VERIFIED";
}

/** Code that writes publication-price evidence, in deployment order. */
export const ENTRY_EVIDENCE_ERAS = [
  { name: "before #176 (no entry price written)", until: new Date("2026-11-13T14:48:51.000Z") },
  { name: "#176-#178 (promotion record only)", until: new Date("2026-11-13T21:02:29.000Z") },
  { name: "after #178 (promotion + publication snapshot)", until: new Date("2100-01-01T00:00:00.000Z") },
] as const;
export function entryEvidenceEra(promotedAt: Date): string {
  return ENTRY_EVIDENCE_ERAS.find((e) => promotedAt < e.until)!.name;
}
