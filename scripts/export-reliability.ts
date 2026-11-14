/** Read-only export. Requires explicit local output; never logs credentials or subscriber data. */
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { RELIABILITY_JOB } from "../src/lib/reliabilitySnapshot";
async function main() {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: tsx --env-file=.env scripts/export-reliability.ts output.json",
    );
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const logs = await tx.jobRun.findMany({
        where: { job: RELIABILITY_JOB, ranAt: { gte: new Date("2026-12-01") } },
        take: 100001,
        orderBy: [{ ranAt: "asc" }, { id: "asc" }],
        select: { detail: true },
      });
      if (logs.length > 100000)
        throw new Error(
          "Export exceeds 100000 records; a reviewed paginated export is required",
        );
      const snapshots = logs.map((r) => r.detail as any);
      if (
        snapshots.some(
          (d) =>
            d?.version !== "reliability-s06-v1" ||
            typeof d.predictionId !== "string" ||
            d.truncatedUniverse,
        )
      )
        throw new Error("Invalid or incomplete snapshot universe");
      const ids = [...new Set<string>(snapshots.map((d) => d.predictionId))];
      const outcomes: Array<{
        id: string;
        outcome: string | null;
        settledAt: Date | null;
      }> = [];
      for (let i = 0; i < ids.length; i += 1000)
        outcomes.push(
          ...(await tx.prediction.findMany({
            where: { id: { in: ids.slice(i, i + 1000) } },
            select: { id: true, outcome: true, settledAt: true },
          })),
        );
      const byId = new Map(outcomes.map((o) => [o.id, o]));
      return snapshots.map((d) => ({
        version: d.version,
        id: d.predictionId,
        tier: d.tier,
        fixture: d.fixture,
        market: d.market,
        competition: d.competition,
        decisionAt: d.decisionAt,
        kickoff: d.kickoff,
        rawConfidence: d.rawConfidence,
        baselineSelected: d.baselineSelected,
        policies: d.policies,
        price: d.price,
        estimate: d.estimate,
        outcome: byId.get(d.predictionId)?.outcome ?? null,
        settledAt: byId.get(d.predictionId)?.settledAt?.toISOString() ?? null,
      }));
    },
    { timeout: 30000 },
  );
  writeFileSync(file, JSON.stringify(rows, null, 2), { flag: "wx" });
  console.log(
    `Exported ${rows.length} frozen decisions; export was read-only.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
