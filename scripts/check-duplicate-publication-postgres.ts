/**
 * Duplicate-fixture publication against a disposable PostgreSQL (issue #237).
 * Exercises the real transaction path: applyReviewAction + duplicatePublishGuard.
 * Refuses to run anywhere but the local CI database.
 */
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { applyReviewAction, publishEarlyFreePredictionAtomically } from "../src/lib/predictions";
import { matchKey } from "../src/lib/slug";
import { DuplicateReviewRequired, DUPLICATE_OVERRIDE_JOB, duplicatePublishGuard, reviewFeaturedDuplicate } from "../src/lib/duplicatePublication";

async function main() {
  if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes" || !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci"))
    throw new Error("Refusing duplicate-publication integration test outside disposable local CI PostgreSQL");
  const user = await prisma.user.create({ data: { email: "dup-ci-" + Date.now() + "@example.invalid", role: "ADMIN" } });
  const kickoff = new Date(Date.now() + 3 * 86_400_000);
  let fixtureApiId = 880_000 + Math.floor(Math.random() * 10_000);
  const make = (over: Record<string, unknown>, categories = ["FEATURED"]) => prisma.prediction.create({
    data: { category: categories[0], market: "Match Winner", marketType: "MATCH_WINNER", selection: { value: "HOME" } as any, pick: "Home", confidence: 72, odds: 1.9,
      reasoning: "Disposable integration fixture", authorId: user.id, homeTeam: "CI Home", awayTeam: "CI Away", homeTeamApiId: fixtureApiId * 2, awayTeamApiId: fixtureApiId * 2 + 1,
      fixtureApiId, kickoff, leagueApiId: 39, leagueName: "Premier League", status: "PENDING_REVIEW",
      categories: { create: categories.map((category) => ({ category })) }, ...over } as any,
    include: { categories: true },
  });
  const publish = (row: any, decision?: { reason: string }) => applyReviewAction(row, "PUBLISH", user.id,
    duplicatePublishGuard({ actorId: user.id, predictionId: row.id, decision }));

  try {
    // 1. First FEATURED single publishes cleanly.
    const first = await make({});
    assert.equal((await publish(first)).status, "PUBLISHED");

    // 2. Review describes the clash, with no write.
    const conflicting = await make({ pick: "Away", selection: { value: "AWAY" } });
    const review = await reviewFeaturedDuplicate(prisma, conflicting);
    assert.ok(review && review.relation === "CONFLICTING_SELECTION" && review.existing.length === 1);
    assert.equal(review!.existing[0].pick, "Home"); assert.equal(review!.proposed.pick, "Away");
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: conflicting.id } })).status, "PENDING_REVIEW");

    // 3. Without a decision the publish fails closed and nothing changes.
    await assert.rejects(() => publish(conflicting), (e) => e instanceof DuplicateReviewRequired);
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: conflicting.id } })).status, "PENDING_REVIEW");
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: first.id } })).status, "PUBLISHED", "existing published selection untouched");

    // 4. A distinct market is classified as distinct; deliberate override publishes and is audited.
    const distinct = await make({ market: "Both Teams To Score", marketType: "BTTS", selection: { value: "YES" }, pick: "Yes" });
    assert.equal((await reviewFeaturedDuplicate(prisma, distinct))!.relation, "DISTINCT_MARKET");
    const before = await prisma.jobRun.count({ where: { job: DUPLICATE_OVERRIDE_JOB } });
    assert.equal((await publish(distinct, { reason: "Distinct BTTS market is independently supported" })).status, "PUBLISHED");
    const audit = await prisma.jobRun.findMany({ where: { job: DUPLICATE_OVERRIDE_JOB }, orderBy: { ranAt: "desc" }, take: 1 });
    assert.equal(await prisma.jobRun.count({ where: { job: DUPLICATE_OVERRIDE_JOB } }), before + 1);
    assert.match(JSON.stringify(audit[0].detail), /Distinct BTTS market/);
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: first.id } })).pick, "Home", "published selection never rewritten");

    // 5. Race: two selections for a NEW fixture published at the same instant — exactly one passes the guard.
    fixtureApiId += 1;
    const [a, b] = await Promise.all([make({ pick: "Home" }), make({ pick: "Away", selection: { value: "AWAY" } })]);
    // Deterministic overlap: the first transaction holds its lock for 400ms after
    // passing the guard, so the second one's guard runs while it is uncommitted.
    const slow = (row: any) => applyReviewAction(row, "PUBLISH", user.id, async (tx, locked) => {
      await duplicatePublishGuard({ actorId: user.id, predictionId: row.id })(tx, locked);
      await new Promise((r) => setTimeout(r, 400));
    });
    const settled = await Promise.allSettled([slow(a), new Promise((r) => setTimeout(r, 100)).then(() => publish(b))]);
    assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent publish wins");
    assert.equal(settled.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof DuplicateReviewRequired).length, 1, "the loser is held for review");
    assert.equal(await prisma.prediction.count({ where: { fixtureApiId, status: "PUBLISHED" } }), 1);

    // 5b. Mixed identity: same teams + exact kickoff, but one row has NO provider fixture id and the other a different one.
    fixtureApiId += 1;
    const mixedHome = fixtureApiId * 2;
    const mixedA = await make({ pick: "Home", fixtureApiId: null, homeTeamApiId: mixedHome, awayTeamApiId: mixedHome + 1 });
    const mixedB = await make({ pick: "Away", selection: { value: "AWAY" }, fixtureApiId: fixtureApiId + 500_000, homeTeamApiId: mixedHome, awayTeamApiId: mixedHome + 1 });
    const slowMixed = (row: any) => applyReviewAction(row, "PUBLISH", user.id, async (tx, locked) => {
      await duplicatePublishGuard({ actorId: user.id, predictionId: row.id })(tx, locked);
      await new Promise((r) => setTimeout(r, 400));
    });
    const mixed = await Promise.allSettled([slowMixed(mixedA), new Promise((r) => setTimeout(r, 100)).then(() => publish(mixedB))]);
    assert.equal(mixed.filter((r) => r.status === "fulfilled").length, 1, "mixed provider-id identity: exactly one publish wins");
    assert.ok(mixed.some((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof DuplicateReviewRequired), "the loser is held for review");

    // 5c. Early automatic publisher vs admin publish of the same fixture, deliberately overlapped.
    fixtureApiId += 1;
    const earlyKey = matchKey({ homeTeamApiId: fixtureApiId * 2, awayTeamApiId: fixtureApiId * 2 + 1, kickoff })!;
    await prisma.fixtureOddsCache.upsert({ where: { matchKey: earlyKey }, update: {}, create: { matchKey: earlyKey, fixtureApiId, fetchedAt: new Date(Date.now() - 10 * 60_000),
      oddsJson: { bookmakerCount: 9, update: new Date(Date.now() - 20 * 60_000).toISOString(), markets: [{ market: "Both Teams Score", selections: [{ value: "Yes", median: 1.8, best: 1.85, bookmakers: 9, bestBookmaker: "X" }, { value: "No", median: 2.0, best: 2.05, bookmakers: 9, bestBookmaker: "X" }] }] } } as never });
    const job = await prisma.aIJob.create({ data: { userId: user.id, model: "test", prompt: "{}", rawOutput: "{}", contextComplete: true } });
    const earlyRow = await make({ market: "Both Teams Score", marketType: "BTTS", selection: { value: "YES" }, pick: "Yes", odds: 1.8, provenance: "STANDARD_CURATED", aiJobId: job.id,
      matchPreview: "Preview.", contextComplete: true, analysisJson: { v: 1, keyFactors: [] }, manualSettlementOnly: false });
    const adminRow = await make({ pick: "Home" });
    // Admin transaction holds its lock after the duplicate check; the early publisher starts while it is still open.
    const adminSlow = applyReviewAction(adminRow, "PUBLISH", user.id, async (tx, locked) => {
      await duplicatePublishGuard({ actorId: user.id, predictionId: adminRow.id })(tx, locked);
      await new Promise((r) => setTimeout(r, 500));
    });
    const earlySettled = new Promise((r) => setTimeout(r, 150)).then(async () => publishEarlyFreePredictionAtomically(
      await prisma.prediction.findUniqueOrThrow({ where: { id: earlyRow.id } }) as never, user.id)).then((v) => ({ ok: v }), (e) => ({ error: String(e?.message ?? e) }));
    const [adminOutcome, earlyOutcome] = await Promise.all([adminSlow.then(() => "published", (e) => String(e?.message ?? e)), earlySettled]);
    assert.equal(adminOutcome, "published");
    assert.ok("error" in (earlyOutcome as object) && /EARLY_PUBLICATION_DUPLICATE_FIXTURE/.test((earlyOutcome as any).error), "early publisher waits for the admin commit, then refuses the duplicate: " + JSON.stringify(earlyOutcome));
    assert.equal(await prisma.prediction.count({ where: { fixtureApiId, status: "PUBLISHED" } }), 1, "exactly one FEATURED single published across early + admin paths");
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: earlyRow.id } })).status, "PENDING_REVIEW", "early row stays in review");
    await prisma.fixtureOddsCache.deleteMany({ where: { matchKey: earlyKey } });

    // 6. Paid categories and combos are out of scope for the FEATURED duplicate rule.
    fixtureApiId += 1;
    await publish(await make({}));
    const vip = await make({ category: "VIP" }, ["VIP"]);
    assert.equal(await reviewFeaturedDuplicate(prisma, vip), null, "VIP selections keep their own rules");
    const combo = await make({ marketType: "SAME_GAME_DOUBLE" }, ["FEATURED"]);
    assert.equal(await reviewFeaturedDuplicate(prisma, combo), null, "SAME_GAME_DOUBLE keeps its own rules");
    console.log("PASS: duplicate publication review, fail-closed guard, audited override, race protection");
  } finally {
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.jobRun.deleteMany({ where: { job: DUPLICATE_OVERRIDE_JOB } });
    await prisma.aIJob.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
