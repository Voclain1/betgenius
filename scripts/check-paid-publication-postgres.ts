/** Isolated PostgreSQL only. CI supplies a disposable service DB. */
import { prisma } from "../src/lib/prisma";
import { publishPaidPredictionAtomically } from "../src/lib/predictions";
import { auditPublicationQuoteEvidence } from "../src/lib/paidEntryEvidence";

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
  const create = (confirmation: unknown) => prisma.prediction.create({
    data: {
      category: "VIP", market: "Match Winner", pick: "Home",
      confidence: 81, reasoning: "Disposable integration fixture", authorId: user.id,
      homeTeam: "CI Home", awayTeam: "CI Away", kickoff, status: "PENDING_REVIEW",
      marketConfirmation: confirmation as any,
      categories: { create: [{ category: "VIP" }] },
    }, include: { categories: true },
  });
  try {
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
    console.log("Disposable PostgreSQL concurrency, idempotency, atomic quote and rollback: PASS");
  } finally {
    await prisma.notificationEvent.deleteMany({ where: { prediction: { authorId: user.id } } }).catch(() => {});
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
