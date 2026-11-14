import { planRecovery } from "../src/lib/operationsRecovery";
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { loadOperations } from "../src/lib/operationsData";
import { recordJobRun } from "../src/lib/jobRuns";
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable database required");
  const prefix = `ops-investigation-${Date.now()}`,
    user = await prisma.user.create({
      data: { email: `${prefix}@example.invalid` },
    });
  const now = new Date(),
    historical = new Date(+now - 2 * 86400000),
    competition = 1900000000 + Math.floor(Math.random() * 10000000),
    future = new Date(+now + 3600000);
  const ids: string[] = [];
  try {
    const base = {
      authorId: user.id,
      category: "FEATURED",
      market: "Match Winner",
      pick: "Home",
      marketType: "MATCH_WINNER",
      selection: { value: "HOME" },
      confidence: 80,
      reasoning: "Synthetic regression fixture",
      homeTeam: "Synthetic Home",
      awayTeam: "Synthetic Away",
      homeTeamApiId: 123451,
      awayTeamApiId: 123452,
      leagueApiId: competition,
      createdAt: new Date(+now - 4 * 86400000),
    };
    const archived = Array.from({ length: 510 }, (_, i) => ({
      ...base,
      id: `${prefix}-archived-${i}`,
      status: "ARCHIVED",
      kickoff: new Date(+historical - i * 1000),
      manualSettlementOnly: false,
    }));
    await prisma.prediction.createMany({ data: archived });
    ids.push(...archived.map((r) => r.id));
    async function create(suffix: string, extra: Record<string, unknown> = {}) {
      const id = `${prefix}-${suffix}`;
      ids.push(id);
      return prisma.prediction.create({
        data: {
          ...base,
          id,
          status: "PUBLISHED",
          kickoff: future,
          publishedAt: new Date(+now - 60000),
          manualSettlementOnly: false,
          categories: { create: { category: "FEATURED" } },
          ...extra,
        } as any,
      });
    }
    const upcoming = await create("upcoming");
    await create("manual-history", {
      kickoff: new Date(+now - 36 * 3600000),
      publishedAt: new Date(+now - 37 * 3600000),
      manualSettlementOnly: true,
    });
    const compound = await create("compound-history", {
      kickoff: new Date(+now - 30 * 3600000),
      publishedAt: new Date(+now - 31 * 3600000),
      marketType: "SAME_GAME_DOUBLE",
      selection: { legIds: ["missing-a", "missing-b"] },
    });
    await create("unknown-history", {
      kickoff: new Date(+now - 28 * 3600000),
      publishedAt: new Date(+now - 29 * 3600000),
    });
    await create("expired-review", {
      status: "PENDING_REVIEW",
      kickoff: new Date(+now - 30 * 3600000),
      publishedAt: null,
    });
    await create("upcoming-review", {
      status: "PENDING_REVIEW",
      publishedAt: null,
    });
    await recordJobRun({
      job: "refresh-odds",
      summary: prefix,
      detail: { processed: 11, okCount: 7, failedCount: 4, results: [] },
    });
    const job = await prisma.jobRun.findFirstOrThrow({
      where: { summary: prefix },
    });
    assert.equal(
      (job.detail as any).operationalCompletion.status,
      "PARTIAL_FAILURE",
    );
    assert.equal(
      job.ok,
      true,
      "reported completion flag is preserved independently of classified result",
    );
    const compoundPlan = await planRecovery("RETRY_SETTLEMENT", compound.id);
    assert.equal(compoundPlan.eligible, false);
    assert.ok(
      compoundPlan.reasons.includes("COMPOUND_REQUIRES_LEG_SETTLEMENT"),
    );
    const missing = await create("missing-metadata", {
      leagueApiId: null,
      kickoff: new Date(+now - 8 * 3600000),
    });
    const missingPlan = await planRecovery("RETRY_SETTLEMENT", missing.id);
    assert.equal(missingPlan.eligible, false);
    assert.ok(missingPlan.reasons.includes("MISSING_SETTLEMENT_METADATA"));
    await prisma.jobRun.create({
      data: {
        id: `${prefix}-first-collection`,
        job: "prediction-reliability-s06",
        summary: prefix,
        ranAt: new Date(+now - 2 * 3600000),
        detail: { version: "reliability-s06-v1" },
      },
    });
    const first = await prisma.jobRun.findFirstOrThrow({
      where: { job: "prediction-reliability-s06", ranAt: { lte: now } },
      orderBy: { ranAt: "asc" },
    });
    const legacyPaid = await create("legacy-paid", {
      category: "VIP",
      categories: { create: { category: "VIP" } },
      createdAt: new Date(+first.ranAt - 86400000),
      provenance: "VIP_ROUTE_CONFIRMED",
    });
    const eligiblePaid = await create("eligible-paid", {
      category: "VIP",
      categories: { create: { category: "VIP" } },
      createdAt: new Date(+now - 60000),
      provenance: "VIP_ROUTE_CONFIRMED",
    });
    const dedicatedPaid = await create("dedicated-paid", {
      category: "VIP",
      categories: { create: { category: "VIP" } },
      createdAt: new Date(+now - 60000),
      provenance: "VIP_GENERATED",
    });
    const before = await prisma.prediction.findMany({
        where: { authorId: user.id },
        orderBy: { id: "asc" },
        select: { id: true, status: true, outcome: true, updatedAt: true },
      }),
      logCount = await prisma.jobRun.count();
    const s = await loadOperations({ days: 7, competition });
    assert.equal(s.universe, 500);
    assert.equal(s.total, 519); // missing-metadata row has null league and is outside this competition filter
    assert.equal(s.truncated, true);
    assert.ok(
      s.freshness.some((r) => r.id === upcoming.id),
      "current/upcoming data cannot be evicted by 510 historical records",
    );
    assert.ok(s.sampling.current >= 1);
    assert.ok(
      !s.findings.some(
        (f) =>
          f.predictionId === legacyPaid.id &&
          f.code === "MISSING_RELIABILITY_OBSERVATION",
      ),
    );
    assert.ok(
      !s.findings.some(
        (f) =>
          f.predictionId === dedicatedPaid.id &&
          f.code === "MISSING_RELIABILITY_OBSERVATION",
      ),
    );
    assert.ok(
      s.findings.some(
        (f) =>
          f.predictionId === eligiblePaid.id &&
          f.code === "MISSING_RELIABILITY_OBSERVATION" &&
          f.severity === "INFO",
      ),
    );
    assert.ok(
      !s.findings.some(
        (f) =>
          f.predictionId === legacyPaid.id &&
          f.code === "MISSING_PAID_EVIDENCE",
      ),
    );
    assert.ok(
      s.findings.some(
        (f) =>
          f.predictionId === dedicatedPaid.id &&
          f.code === "MISSING_PAID_EVIDENCE",
      ),
    );

    assert.ok(
      !s.findings.some(
        (f) =>
          f.predictionId?.includes("archived") &&
          [
            "SETTLEMENT_DELAY",
            "FINISHED_UNSETTLED",
            "SETTLEMENT_STATUS_UNVERIFIED",
          ].includes(f.code),
      ),
    );
    for (const code of [
      "MANUAL_SETTLEMENT_QUEUE",
      "COMPOUND_SETTLEMENT_QUEUE",
      "SETTLEMENT_STATUS_UNVERIFIED",
      "EXPIRED_REVIEW_HISTORY",
    ])
      assert.ok(
        s.findings.some((f) => f.code === code),
        code,
      );
    assert.equal(s.reviewQueue.upcoming, 1);
    assert.equal(s.reviewQueue.expiredHistorical, 1);
    assert.ok(s.findingGroups.every((g) => g.samples.length <= 10));
    const history = await loadOperations({
      days: 7,
      competition,
      period: "HISTORICAL",
    });
    assert.ok(history.findings.every((f) => f.period === "HISTORICAL"));
    const current = await loadOperations({
      days: 7,
      competition,
      period: "CURRENT",
    });
    assert.ok(
      current.findings.every((f) => (f.period ?? "CURRENT") === "CURRENT"),
    );
    assert.equal(
      await prisma.jobRun.count(),
      logCount,
      "diagnostics do not write audit or settlement records",
    );
    assert.deepEqual(
      await prisma.prediction.findMany({
        where: { authorId: user.id },
        orderBy: { id: "asc" },
        select: { id: true, status: true, outcome: true, updatedAt: true },
      }),
      before,
    );
    console.log(
      "Operations investigation PostgreSQL: archived warning exclusion, historical/manual/compound taxonomy, priority sampling, exact totals, incident filters, review queues, job instrumentation and no diagnostic writes PASS",
    );
  } finally {
    await prisma.jobRun.deleteMany({ where: { summary: prefix } });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
