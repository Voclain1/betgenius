/** Isolated PostgreSQL only. CI supplies a disposable service DB. */
import { prisma } from "../src/lib/prisma";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { publishPaidPredictionAtomically } from "../src/lib/predictions";
import { auditPublicationQuoteEvidence } from "../src/lib/paidEntryEvidence";
import { findSelection, trimOdds, trustedSelection } from "../src/lib/odds";

async function main() {
  if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
      !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")) {
    throw new Error("Refusing publication integration test outside disposable local CI PostgreSQL");
  }
  const user = await prisma.user.create({ data: { email: "paid-ci-" + Date.now() + "@example.invalid" } });
  const kickoff = new Date(Date.now() + 3 * 3600000);
  const quote = new Date(Date.now() - 60000).toISOString();
  const evidence = {
    entryPrice: 1.91, entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
    entryQuoteSelection: { market: "MATCH_WINNER", value: "HOME" },
    entryBookmakers: 1, entryQuoteSources: [{ bookmaker: "CI test bookmaker", odd: 1.91 }],
    quoteFetchedAt: quote, confirmedAt: new Date().toISOString(),
    evidenceKind: "PUBLICATION_INDICATIVE",
  };
  const create = (confirmation: unknown, rowKickoff: Date | null = kickoff) => prisma.prediction.create({
    data: {
      category: "VIP", market: "Match Winner", pick: "Home",
      confidence: 81, reasoning: "Disposable integration fixture", authorId: user.id,
      homeTeam: "CI Home", awayTeam: "CI Away", kickoff: rowKickoff, status: "PENDING_REVIEW",
      marketConfirmation: confirmation === null ? Prisma.DbNull : confirmation as any,
      categories: { create: [{ category: "VIP" }] },
    }, include: { categories: true },
  });
  try {
    // PR #206's valid outlier filtering must stay in place. Both a legacy
    // cache and fresh trimming can leave no retained named quote.
    const legacy = trustedSelection({ value: "Home", median: 1.27, best: 3.5,
      bookmakers: 7, bestBookmaker: "Outlier", quotes: [{ bookmaker: "Outlier", odd: 3.5 }] });
    const fresh = trimOdds({ bookmakers: Array.from({ length: 11 }, (_, i) => ({
      name: `CI book ${i}`, bets: [{ name: "Match Winner", values: [
        { value: "Home", odd: i < 6 ? "1.27" : "3.50" },
        { value: "Draw", odd: "7.00" }, { value: "Away", odd: "11.00" },
      ] }],
    })) } as any)!;
    const trimmed = findSelection(fresh, "Match Winner", "Home")!;
    for (const selection of [legacy, trimmed]) {
      assert.equal(selection.best, 1.27);
      assert.equal(selection.quotes?.length, 0);
    }
    const fromSelection = (selection: typeof legacy) => ({ ...evidence,
      entryPrice: selection.median, entryBookmakers: selection.bookmakers,
      entryBestPrice: selection.best, entryBestBookmaker: selection.bestBookmaker,
      entryQuoteSources: selection.quotes,
    });
    const invalid = [
      { name: "legacy all-outlier cache", quote: fromSelection(legacy), reason: "MISSING_NAMED_BOOKMAKER" },
      { name: "fresh all-outlier retained sample", quote: fromSelection(trimmed), reason: "MISSING_NAMED_BOOKMAKER" },
      { name: "invalid named offers", quote: { ...evidence, entryQuoteSources: [
        { bookmaker: " ", odd: 1.91 }, { bookmaker: "CI book", odd: 1 },
      ] }, reason: "MISSING_NAMED_BOOKMAKER" },
      { name: "derived price", quote: { ...evidence, entryPriceBasis: "DERIVED" }, reason: "NO_DIRECT_BOOKMAKER_QUOTE" },
      { name: "wrong snapshot kind", quote: { ...evidence, evidenceKind: "PROMOTION_INDICATIVE" }, reason: "INVALID_PUBLICATION_KIND" },
      { name: "expired evidence", quote: { ...evidence, quoteFetchedAt: new Date(Date.now() - 7 * 3600000).toISOString() }, reason: "INVALID_PRICE_OR_TIMESTAMPS" },
    ];
    for (const sample of invalid) {
      // Valid promotion evidence must not substitute for invalid publication evidence.
      const pending = await create({ ...evidence, promotion: "original" });
      await assert.rejects(publishPaidPredictionAtomically(pending, user.id, sample.quote),
        (error: any) => error?.name === "PaidPublicationEvidenceError" && error.reason === sample.reason,
        sample.name);
      const unchanged = await prisma.prediction.findUniqueOrThrow({ where: { id: pending.id } });
      const { categories: _categories, ...original } = pending;
      assert.deepEqual(unchanged, original, sample.name + ": entire publication claim must roll back");
      assert.equal(await prisma.notificationEvent.count({ where: { predictionId: pending.id } }), 0);
    }
    const undated = await create({ promotion: "ci" }, null);
    await assert.rejects(publishPaidPredictionAtomically(undated, user.id, evidence),
      (error: any) => error?.name === "PaidPublicationEvidenceError" && error.reason === "MISSING_KICKOFF");
    assert.equal((await prisma.prediction.findUniqueOrThrow({ where: { id: undated.id } })).status, "PENDING_REVIEW");
    assert.equal(await prisma.notificationEvent.count({ where: { predictionId: undated.id } }), 0);

    const base = await create({ promotion: "ci" });
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () =>
      publishPaidPredictionAtomically(base, user.id, evidence)));
    const successes = attempts.filter(r => r.status === "fulfilled" && r.value === true).length;
    if (successes !== 1) throw new Error("Concurrent publish succeeded " + successes + " times: " + JSON.stringify(attempts));
    const after = await prisma.prediction.findUniqueOrThrow({ where: { id: base.id } });
    if (after.status !== "PUBLISHED" || !auditPublicationQuoteEvidence(after.marketConfirmation, kickoff).usable)
      throw new Error("Publication and quote were not committed together");
    const events = await prisma.notificationEvent.count({ where: { predictionId: base.id, type: "NEW_PREDICTION" } });
    if (events !== 1) throw new Error("Expected exactly one publication event, got " + events);
    const retry = await publishPaidPredictionAtomically(base, user.id, evidence);
    if (retry) throw new Error("Published row was published again");

    const broken = await create(null);
    let rejected = false;
    try { await publishPaidPredictionAtomically(broken, user.id, evidence); }
    catch { rejected = true; }
    if (!rejected) throw new Error("Missing confirmation unexpectedly published");
    const rollback = await prisma.prediction.findUniqueOrThrow({ where: { id: broken.id } });
    if (rollback.status !== "PENDING_REVIEW" || rollback.publishedAt !== null)
      throw new Error("Failed transaction did not roll back");
    if (await prisma.notificationEvent.count({ where: { predictionId: broken.id } }))
      throw new Error("Rolled back publication left a notification");
    console.log("Disposable PostgreSQL named-evidence rejection, concurrency, idempotency, atomic quote and rollback: PASS");
  } finally {
    const owned = await prisma.prediction.findMany({ where: { authorId: user.id }, select: { id: true } });
    await prisma.notificationEvent.deleteMany({ where: { predictionId: { in: owned.map(r => r.id) } } });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
