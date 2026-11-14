/** Real unique-key races and unavailable storage, exclusively disposable PostgreSQL. */
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { recordReliability } from "../src/lib/reliabilityStore";
import { snapshotId, RELIABILITY_JOB } from "../src/lib/reliabilitySnapshot";
import type { PaidCandidateAssessment } from "../src/lib/paidValue";
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable local CI database required");
  const id = `s06-ci-${Date.now()}`,
    now = new Date(),
    kickoff = new Date(+now + 86400000);
  const a: PaidCandidateAssessment = {
    id,
    fixtureKey: id,
    provider: null,
    marketType: "BTTS",
    leagueApiId: 1,
    rawConfidence: 80,
    rule: { eligible: true, tag: "test" },
    quoteAgeMinutes: null,
    value: {
      calibrationVersion: null,
      rawConfidence: 80,
      marketProbability: null,
      estimatedProbability: null,
      estimatedProbabilityLower: null,
      odds: null,
      bookmakers: null,
      breakEven: null,
      expectedValue: null,
      expectedValueLower: null,
      eligible: false,
      reasons: ["NO_CALIBRATION", "NO_EXECUTABLE_PRICE"],
    },
  };
  const input = {
    tier: "VIP",
    assessments: [a],
    rows: [{ id, kickoff, selection: "YES" }],
    selectedIds: [id],
    now,
  };
  try {
    await Promise.all(
      Array.from({ length: 4 }, () => recordReliability(input)),
    );
    const key = snapshotId("VIP", id);
    assert.equal(
      await prisma.jobRun.count({ where: { id: key, job: RELIABILITY_JOB } }),
      1,
    );
    const original = await prisma.jobRun.findUniqueOrThrow({
      where: { id: key },
    });
    await recordReliability({
      ...input,
      selectedIds: [],
      now: new Date(+now + 60000),
    });
    assert.deepEqual(
      (await prisma.jobRun.findUniqueOrThrow({ where: { id: key } })).detail,
      original.detail,
    );
    process.env.RELIABILITY_DIAGNOSTICS = "off";
    await recordReliability({ ...input, tier: "PREMIUM" });
    assert.equal(
      await prisma.jobRun.count({ where: { id: snapshotId("PREMIUM", id) } }),
      0,
    );
    delete process.env.RELIABILITY_DIAGNOSTICS;
    // A failed database call is caught and cannot escape to publication.
    const old = prisma.$transaction;
    try {
      (prisma as any).$transaction = async () => {
        throw new Error("deliberate CI storage outage");
      };
      await recordReliability(input);
    } finally {
      (prisma as any).$transaction = old;
    }
    console.log(
      "Sprint 06 PostgreSQL: concurrent idempotency, frozen decisions, off switch and outage isolation PASS",
    );
  } finally {
    delete process.env.RELIABILITY_DIAGNOSTICS;
    await prisma.jobRun.deleteMany({
      where: { id: { in: [snapshotId("VIP", id), snapshotId("PREMIUM", id)] } },
    });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
