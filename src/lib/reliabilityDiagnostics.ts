import { prisma } from "./prisma";
import { CALIBRATION_ARTIFACT } from "./calibrationArtifact";
import { reliabilityMetrics } from "./predictionReliability";
import { RELIABILITY_JOB } from "./reliabilitySnapshot";

/** Admin caller only. Bounded deterministic cohort; settlement is joined, never copied back into frozen features. */
export async function loadReliabilityDiagnostics() {
  const since = new Date(Date.now() - 90 * 86400000);
  const records = await prisma.jobRun.findMany({
    where: { job: RELIABILITY_JOB, ranAt: { gte: since } },
    take: 1001,
    orderBy: [{ ranAt: "desc" }, { id: "asc" }],
    select: { detail: true },
  });
  const snapshots = records
    .slice(0, 1000)
    .map((r) => r.detail as any)
    .filter(
      (d) =>
        d?.version === "reliability-s06-v1" &&
        typeof d.predictionId === "string",
    );
  const ids = [...new Set<string>(snapshots.map((d) => d.predictionId))];
  const outcomes = ids.length
    ? await prisma.prediction.findMany({
        where: { id: { in: ids } },
        select: { id: true, outcome: true, settledAt: true },
      })
    : [];
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  const count = (key: (d: any) => string) =>
    snapshots.reduce<Record<string, number>>((s, d) => {
      const k = key(d);
      s[k] = (s[k] ?? 0) + 1;
      return s;
    }, {});
  const pooledOutcomes = outcomes.filter(
    (o) => o.outcome === "WON" || o.outcome === "LOST",
  );
  const pooledRate = pooledOutcomes.length
    ? pooledOutcomes.filter((o) => o.outcome === "WON").length /
      pooledOutcomes.length
    : null;
  const segmented = (
    dimension:
      | "market"
      | "competition"
      | "confidenceBand"
      | "tier"
      | "horizon"
      | "priceStatus",
  ) => {
    const groups = new Map<string, any[]>();
    for (const d of snapshots) {
      const key =
        dimension === "confidenceBand"
          ? String(Math.floor(d.rawConfidence / 10) * 10)
          : dimension === "horizon"
            ? String(
                Math.floor(
                  (Date.parse(d.kickoff) - Date.parse(d.decisionAt)) /
                    3600000 /
                    12,
                ) * 12,
              )
            : dimension === "priceStatus"
              ? String(d.price?.status)
              : String(d[dimension] ?? "unknown");
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups]
      .map(([key, rs]) => {
        // Tiers and repeated observations must not duplicate outcomes inside a segment.
        const unique = [
          ...new Map(rs.map((d) => [d.predictionId, d])).values(),
        ];
        const settled = unique.filter((d) => {
          const o = byId.get(d.predictionId);
          return (
            o?.settledAt &&
            +o.settledAt > Date.parse(d.decisionAt) &&
            (o.outcome === "WON" || o.outcome === "LOST")
          );
        });
        // DNB calibration is not an unconditional binary probability; omit until push modelling exists.
        const binary = settled.filter((d) =>
          ["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"].includes(
            d.market,
          ),
        );
        return {
          key,
          ...reliabilityMetrics(
            binary.map((d) => ({
              raw: d.rawConfidence / 100,
              outcome:
                byId.get(d.predictionId)!.outcome === "WON"
                  ? (1 as const)
                  : (0 as const),
            })),
          ),
          // Descriptive shrinkage (50 pooled pseudo-observations), never a ranking/admission score.
          shrunkWinRate:
            pooledRate != null
              ? (binary.filter(
                  (d) => byId.get(d.predictionId)?.outcome === "WON",
                ).length +
                  50 * pooledRate) /
                (binary.length + 50)
              : null,
          candidates: unique.length,
          settled: settled.length,
          priceCoverage: unique.length
            ? unique.filter((d) => d.price?.status === "VALID").length /
              unique.length
            : 0,
          omittedNonBinary: settled.length - binary.length,
        };
      })
      .sort((a, b) => b.candidates - a.candidates || a.key.localeCompare(b.key))
      .slice(0, 80);
  };
  const policy = (name: string) => {
    const rows = snapshots.filter((d) => d.policies?.[name] === true);
    return {
      name,
      candidates: rows.length,
      baselineOverlap: rows.filter((d) => d.baselineSelected).length,
      settled: rows.filter((d) =>
        ["WON", "LOST"].includes(byId.get(d.predictionId)?.outcome ?? ""),
      ).length,
    };
  };
  return {
    records: snapshots.length,
    truncated: records.length > 1000,
    price: count((d) => d.price?.status ?? "UNKNOWN"),
    value: count((d) => d.value?.status ?? "UNKNOWN"),
    risk: count((d) =>
      d.risk?.warnings?.length
        ? "STRUCTURAL_WARNINGS"
        : "NO_RECORDED_PAIR_WARNING",
    ),
    calibration: {
      version: CALIBRATION_ARTIFACT?.version ?? null,
      active: CALIBRATION_ARTIFACT?.active ?? false,
      stale: CALIBRATION_ARTIFACT
        ? Date.now() - Date.parse(CALIBRATION_ARTIFACT.fittedAt) > 30 * 86400000
        : false,
    },
    dimensions: (
      [
        "market",
        "competition",
        "confidenceBand",
        "tier",
        "horizon",
        "priceStatus",
      ] as const
    ).map((d) => ({ dimension: d, rows: segmented(d) })),
    evidenceCoverage: {
      namedQuotes: snapshots.filter((d) => d.price?.quotes?.length > 0).length,
      overround: snapshots.filter(
        (d) => d.priceProvenance?.overrounds?.length > 0,
      ).length,
      publication: snapshots.filter(
        (d) => d.priceRoles?.publicationReference != null,
      ).length,
      closing: snapshots.filter((d) => d.priceRoles?.closing != null).length,
      subscriberEntry: snapshots.filter(
        (d) => d.priceRoles?.subscriberEntry != null,
      ).length,
    },
    policies: [
      policy("calibrated"),
      policy("lowerBoundValue"),
      policy("diversified"),
    ],
    activationAllowed: false,
  };
}
