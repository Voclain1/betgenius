/**
 * Disposable Postgres smoke test for stable fixture identity, prediction
 * monitoring relations and immutable revisions. Writes are rolled back.
 *
 * BETGENIUS_DISPOSABLE_PG=yes npx tsx scripts/check-early-readiness-db.ts
 * Never run this against live/production databases.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { FREE_REASSESSMENT_VISIBLE, MIXED_REASSESSMENT_VISIBLE } from "../src/lib/reassessment/visibility";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}

const prisma = new PrismaClient();
const rollback = "ROLLBACK_EARLY_READINESS_SMOKE_TEST";
let validated = false;
async function main() {
try {
  try {
    await prisma.$transaction(async tx => {
      const name = randomUUID();
      const user = await tx.user.create({ data: { email: "early-readiness-" + name + "@example.invalid" } });
      const fixtureApiId = 980_000_000;
      const kickoff = new Date("2026-11-28T16:00:00.000Z");
      await tx.upcomingFixture.create({
        data: {
          fixtureApiId, leagueApiId: 39, leagueName: "Premier League",
          homeTeamApiId: 10, awayTeamApiId: 20,
          homeTeam: "Home", awayTeam: "Away", kickoff, status: "NS",
          lastSeenAt: new Date(), earlyQueuedAt: new Date(),
        },
      });
      await tx.upcomingFixture.update({
        where: { fixtureApiId }, data: { kickoff: new Date("2026-11-28T18:00:00.000Z") },
      });
      const stable = await tx.upcomingFixture.findUniqueOrThrow({ where: { fixtureApiId } });
      assert.equal(stable.homeTeamApiId, 10, "provider fixture identity survives rescheduling");
      assert.equal(stable.kickoff.toISOString(), "2026-11-28T18:00:00.000Z");

      const prediction = await tx.prediction.create({
        data: {
          authorId: user.id, category: "FEATURED", status: "PUBLISHED",
          fixtureApiId, homeTeam: "Home", awayTeam: "Away",
          homeTeamApiId: 10, awayTeamApiId: 20, kickoff,
          marketType: "BTTS", selection: { value: "YES" },
          manualSettlementOnly: false, market: "Both Teams Score",
          pick: "Yes", confidence: 82, reasoning: "Real-data fixture test",
          publishedAt: new Date("2026-11-20T10:00:00.000Z"),
          categories: { create: [{ category: "FEATURED", manual: false }] },
        },
      });
      await tx.predictionReassessment.upsert({
        where: { predictionId: prediction.id },
        create: {
          predictionId: prediction.id, status: "REVIEW_REQUIRED", publicHold: true, checkedAt: new Date(),
          lastChangeHash: "verified-change", summary: "New important injury",
          lastOddsMedian: 1.82, lastOddsAt: new Date("2026-11-19T08:30:00.000Z"),
          lastEvidence: { fixture: "home-v-away", source: "provider" },
        },
        update: { status: "REVIEW_REQUIRED" },
      });
      await tx.predictionRevision.create({
        data: {
          predictionId: prediction.id, kind: "REVIEW_REQUIRED", publiclyVisible: true,
          reason: "Important injury now verified",
          beforeJson: { market: "Both Teams Score", pick: "Yes", confidence: 82 },
          afterJson: { proposedPick: "No", confidence: 75 },
          evidenceJson: [{ source: "provider", status: "confirmed" }],
        },
      });
      const actual = await tx.prediction.findUniqueOrThrow({
        where: { id: prediction.id },
        include: { reassessment: true, revisions: true },
      });
      assert.equal(actual.status, "PUBLISHED", "flagging does not silently alter publication");
      assert.equal(actual.pick, "Yes", "original prediction is preserved");
      assert.equal(actual.confidence, 82);
      assert.equal(actual.reassessment?.status, "REVIEW_REQUIRED");
      assert.equal(actual.reassessment?.lastOddsMedian, 1.82);
      assert.equal(actual.revisions.length, 1);
      assert.equal(actual.revisions[0].kind, "REVIEW_REQUIRED");
      assert.equal(actual.revisions[0].recordedAt instanceof Date, true);

      // Query the actual disposable PostgreSQL relations with the same typed
      // predicates used by homepage, market, league, team and match surfaces.
      const freeHeld = await tx.prediction.count({
        where: { ...FREE_REASSESSMENT_VISIBLE, id: prediction.id, status: "PUBLISHED", marketType: "BTTS" },
      });
      const mixedHeld = await tx.prediction.count({
        where: { ...MIXED_REASSESSMENT_VISIBLE, id: prediction.id, status: "PUBLISHED" },
      });
      assert.equal(freeHeld, 1, "previously published free tip remains visible despite a legacy hold");
      assert.equal(mixedHeld, 1, "previously published tip remains visible in match and discovery feeds");

      // Adding a paid category cannot alter the historical publication or
      // bypass its existing entitlement controls.
      await tx.predictionCategoryLink.create({
        data: { predictionId: prediction.id, category: "VIP", manual: true },
      });
      const paidHeld = await tx.prediction.count({
        where: { ...MIXED_REASSESSMENT_VISIBLE, id: prediction.id, status: "PUBLISHED" },
      });
      const marketStillHidden = await tx.prediction.count({
        where: { ...FREE_REASSESSMENT_VISIBLE, id: prediction.id, status: "PUBLISHED" },
      });
      assert.equal(paidHeld, 1, "VIP-tagged selection stays in its existing paid review lane");
      assert.equal(marketStillHidden, 1, "a legacy hold never hides an originally public record");
      await tx.predictionCategoryLink.deleteMany({
        where: { predictionId: prediction.id, category: "VIP" },
      });

      await tx.predictionRevision.create({
        data: {
          predictionId: prediction.id, kind: "CONFIRMED", publiclyVisible: true,
          reason: "Admin reviewed supporting evidence and retained the tip",
          beforeJson: { pick: "Yes", confidence: 82 },
        },
      });
      await tx.predictionReassessment.update({
        where: { predictionId: prediction.id },
        data: { status: "CURRENT", publicHold: false, summary: "Admin reviewed and retained" },
      });
      const revisions = await tx.predictionRevision.findMany({
        where: { predictionId: prediction.id }, orderBy: { recordedAt: "asc" },
      });
      assert.equal(revisions.length, 2, "review decision appends without rewriting first revision");
      assert.equal(revisions[0].kind, "REVIEW_REQUIRED");
      assert.equal(revisions[1].kind, "CONFIRMED");
      assert.equal(await tx.prediction.count({
        where: { ...FREE_REASSESSMENT_VISIBLE, id: prediction.id, status: "PUBLISHED" },
      }), 1, "admin KEEP retains the original selection in its original feeds");
      validated = true;
      throw new Error(rollback);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== rollback || !validated) throw error;
  }
  console.log("PASS: disposable schema, stable fixture identity, publication preservation and append-only review history");
} finally {
  await prisma.$disconnect();
}
}

void main().catch(error => { console.error(error); process.exit(1); });
