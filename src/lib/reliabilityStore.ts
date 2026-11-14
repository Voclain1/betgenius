import { RELIABILITY_MODEL } from "./reliabilityModelArtifact";
import { prisma } from "./prisma";
import {
  buildReliabilitySnapshots,
  reliabilityControls,
  RELIABILITY_JOB,
  snapshotRisk,
} from "./reliabilitySnapshot";

/** Existing JobRun persistence: immutable deterministic primary keys, zero schema dependency. */
export async function recordReliability(
  input: Parameters<typeof buildReliabilitySnapshots>[0],
) {
  if (!reliabilityControls().diagnostics) return;
  try {
    const records = buildReliabilitySnapshots({
      ...input,
      model: RELIABILITY_MODEL,
    });
    const risk = snapshotRisk(input.assessments, input.rows);
    await prisma.$transaction(
      async (tx) => {
        if (records.length)
          await tx.jobRun.createMany({
            data: records.map((r) => ({
              ...r,
              detail: JSON.parse(
                JSON.stringify({
                  ...r.detail,
                  // Store only this candidate's relationships, not N copies of the whole pairwise graph.
                  risk: {
                    ...risk,
                    warnings: risk.warnings
                      .filter(
                        (w) =>
                          w.id === r.detail.predictionId ||
                          w.relatedId === r.detail.predictionId,
                      )
                      .slice(0, 48),
                    warningsCapped:
                      risk.warnings.filter(
                        (w) =>
                          w.id === r.detail.predictionId ||
                          w.relatedId === r.detail.predictionId,
                      ).length > 48,
                  },
                }),
              ),
            })),
            skipDuplicates: true,
          });
        // Bounded retention work; never deletes another job's records. No production migration or cron change.
        const expired = await tx.jobRun.findMany({
          where: {
            job: RELIABILITY_JOB,
            ranAt: { lt: new Date(+input.now - 180 * 86400000) },
          },
          select: { id: true },
          take: 500,
          orderBy: { ranAt: "asc" },
        });
        if (expired.length)
          await tx.jobRun.deleteMany({
            where: {
              job: RELIABILITY_JOB,
              id: { in: expired.map((r) => r.id) },
            },
          });
      },
      { timeout: 2000, maxWait: 500 },
    );
  } catch (error) {
    console.error("[reliability] observation unavailable", error);
  }
}
