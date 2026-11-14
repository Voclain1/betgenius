import { createHash } from "node:crypto";
import type { PaidCandidateAssessment } from "./paidValue";
import {
  RELIABILITY_VERSION,
  auditPrices,
  estimateReliability,
  researchValue,
  structuralRisk,
  type DirectQuote,
  type ReliabilityModel,
} from "./predictionReliability";

export const RELIABILITY_JOB = "prediction-reliability-s06";
/** Independent controls; no value can activate a strategy. */
export function reliabilityControls(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    diagnostics: env.RELIABILITY_DIAGNOSTICS !== "off",
    calibration: env.RELIABILITY_CALIBRATION === "evaluate",
    shadow: env.RELIABILITY_SHADOW !== "off",
    liveActivation: false as const,
  };
}
export type ReliabilityPriceInput = {
  quotes: DirectQuote[];
  market: string | null;
  selection: string | null;
  derived: boolean;
  observedAt: string | null;
  providerUpdatedAt: string | null;
  overrounds: Array<{ bookmaker: string; overround: number }>;
};
export type ReliabilityAssessment = PaidCandidateAssessment & {
  reliabilityPrice?: ReliabilityPriceInput;
};
export const snapshotId = (tier: string, id: string) =>
  "s06_" +
  createHash("sha256")
    .update(JSON.stringify([RELIABILITY_VERSION, tier, id]))
    .digest("hex");

/** Stable first-observation identity; retries never rewrite decisions with later features. */
export function buildReliabilitySnapshots(input: {
  tier: string;
  assessments: readonly ReliabilityAssessment[];
  rows: ReadonlyArray<{
    id: string;
    kickoff: Date | null;
    selection?: unknown;
  }>;
  selectedIds: readonly string[];
  now: Date;
  model?: ReliabilityModel | null;
}) {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const selected = new Set(input.selectedIds);
  const controls = reliabilityControls();
  const diversified = new Set<string>();
  const fixtures = new Set<string>();
  const slots = new Map<string, number>();
  for (const a of [...input.assessments]
    .filter((a) => selected.has(a.id))
    .sort(
      (a, b) => b.rawConfidence - a.rawConfidence || a.id.localeCompare(b.id),
    )) {
    const row = byId.get(a.id);
    if (!row?.kickoff) continue;
    const slot = JSON.stringify([
      a.leagueApiId,
      Math.floor(+row.kickoff / (120 * 60000)),
    ]);
    if (fixtures.has(a.fixtureKey) || (slots.get(slot) ?? 0) >= 2) continue;
    fixtures.add(a.fixtureKey);
    slots.set(slot, (slots.get(slot) ?? 0) + 1);
    diversified.add(a.id);
  }
  return input.assessments.slice(0, 500).flatMap((a) => {
    const row = byId.get(a.id);
    if (
      !row?.kickoff ||
      !Number.isFinite(+row.kickoff) ||
      !Number.isFinite(+input.now) ||
      row.kickoff <= input.now
    )
      return [];
    const evidence = a.reliabilityPrice;
    const price = auditPrices(
      evidence?.derived ? [] : (evidence?.quotes ?? []),
      evidence?.market ?? "",
      evidence?.selection ?? "",
      input.now,
      row.kickoff,
    );
    const estimate = estimateReliability(
      controls.calibration ? (input.model ?? null) : null,
      a.rawConfidence / 100,
      a.marketType,
      input.now,
    );
    const value = researchValue(estimate, price, a.marketType);
    const selection =
      typeof row.selection === "string"
        ? row.selection
        : JSON.stringify(row.selection ?? null);
    return [
      {
        id: snapshotId(input.tier, a.id),
        job: RELIABILITY_JOB,
        ranAt: input.now,
        ok: true,
        summary: `${input.tier} ${price.status} ${value.status}`,
        detail: {
          version: RELIABILITY_VERSION,
          predictionId: a.id,
          tier: input.tier,
          decisionAt: input.now.toISOString(),
          kickoff: row.kickoff.toISOString(),
          fixture: a.fixtureKey,
          market: a.marketType,
          competition: a.leagueApiId,
          selection,
          rawConfidence: a.rawConfidence,
          baselineSelected: selected.has(a.id),
          baselineRule: a.rule,
          price,
          priceRoles: {
            opening: null,
            decisionReference: price.median,
            publicationReference: null,
            closing: null,
            subscriberEntry: null,
          },
          priceProvenance: evidence ?? null,
          estimate,
          value,
          policies: controls.shadow
            ? {
                calibrated:
                  estimate.status === "EVALUATION_ONLY" &&
                  estimate.lower != null &&
                  estimate.lower >= a.rawConfidence / 100,
                lowerBoundValue: value.status === "POSSIBLE_VALUE",
                diversified: diversified.has(a.id),
              }
            : null,
          activationAllowed: false,
          cohort: "prospective",
          truncatedUniverse: input.assessments.length > 500,
        },
      },
    ];
  });
}

/** Structural observations reference the complete bounded candidate universe, independent of live ordering. */
export function snapshotRisk(
  assessments: readonly ReliabilityAssessment[],
  rows: ReadonlyArray<{ id: string; selection?: unknown }>,
) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return structuralRisk(
    assessments.slice(0, 500).map((a) => ({
      id: a.id,
      fixture: a.fixtureKey,
      market: a.marketType,
      selection: canonicalRiskSelection(byId.get(a.id)?.selection),
      competition: a.leagueApiId,
      confidence: a.rawConfidence,
      odds: a.value.odds,
    })),
  );
}

/** Stable structured labels for pairwise warnings; unknown shapes retain their exact JSON. */
function canonicalRiskSelection(selection: unknown): string {
  if (typeof selection === "string") return selection.trim().toUpperCase();
  if (selection && typeof selection === "object") {
    const row = selection as Record<string, unknown>;
    if (typeof row.value === "string" && Object.keys(row).length === 1)
      return row.value.toUpperCase();
  }
  return JSON.stringify(selection ?? null);
}
