import { publicationStatusProblem } from "./predictionOperations";
import { Prisma } from "@prisma/client";
import { matchKey } from "@/lib/slug";
import { earlyQuotedSelection } from "@/lib/generation/earlyOddsPolicy";
import { inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { reassessmentIntervalMinutes } from "@/lib/reassessment/evidence";
import { isValidSelection, type MarketType } from "./markets";
import { prisma } from "@/lib/prisma";
import { appendPublicationQuoteEvidence, auditPublicationQuoteEvidence } from "@/lib/paidEntryEvidence";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { presentedCategory } from "@/lib/access";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";
import { withGoalsCategory, type GoalsMarket } from "@/lib/goalsCategory";
import { isLegacyLiveHiddenLeg, withHiddenLegCategories } from "@/lib/comboLegs";
import { recordPredictionEvents } from "@/lib/notifications";

export const CATEGORY_VALUES = PREDICTION_CATEGORIES;

export function applyCategoryChanges(
  current: readonly string[],
  add: readonly PredictionCategory[],
  remove: readonly PredictionCategory[],
): PredictionCategory[] {
  const valid = new Set<string>(CATEGORY_VALUES);
  const next = new Set(current.filter((c): c is PredictionCategory => valid.has(c)));
  for (const category of remove) next.delete(category);
  for (const category of add) next.add(category);
  if (next.size === 0) throw new Error("At least one category is required");
  return [...next];
}

/**
 * Replaces a prediction's category assignments with `categories`, and keeps
 * the legacy `category` column in sync as the first entry (primary category)
 * for display/back-compat. `categories` must be non-empty.
 *
 * Every writer of category tags goes through this function, so it is the one
 * place two derived rules are enforced:
 *
 *   - GOALS is recomputed from the row's market, whatever `categories` says
 *     (src/lib/goalsCategory.ts);
 *   - a hidden combo leg resolves to exactly ["SAME_GAME_DOUBLE"]
 *     (src/lib/comboLegs.ts). Leg status is read from the links the row
 *     ALREADY has as well as from `categories`, so dropping SAME_GAME_DOUBLE
 *     cannot turn a leg into a public single.
 *
 * A pre-cutover leg that is still live is left exactly as it is — no link and
 * no primary-category change — until it settles (isLegacyLiveHiddenLeg).
 *
 * Pass `market` when the caller holds the row's market already, or is about to
 * change it and has not written it yet; otherwise the stored market is used.
 */
type CategoryDb = Pick<typeof prisma, "prediction" | "predictionCategoryLink">;
export async function setPredictionCategories(
  predictionId: string,
  categories: string[],
  market?: GoalsMarket,
  db?: CategoryDb,
  /** `manual`: an admin is saving these; tags they ADD are recorded as hand-assigned and survive curation. */
  opts: { manual?: boolean } = {},
) {
  const client = db ?? prisma;
  const persisted = await client.prediction.findUnique({
    where: { id: predictionId },
    select: { marketType: true, selection: true, createdAt: true, status: true, outcome: true, provenance: true, categories: { select: { category: true, manual: true } } },
  });
  const resolvedMarket = market ?? persisted ?? { marketType: null, selection: null };
  const held = persisted?.categories.map((c) => c.category) ?? [];
  if (persisted && isLegacyLiveHiddenLeg(resolvedMarket.marketType, { ...persisted, categories: held })) return;

  // A paid-only pick belongs to VIP/PREMIUM alone, so its market never files
  // it into the free Goals feed as well (see PAID_ONLY_PROVENANCES).
  const derived = isPaidOnlyProvenance(persisted?.provenance) ? [...new Set(categories)] : withGoalsCategory(categories, resolvedMarket);
  const unique = withHiddenLegCategories(derived, resolvedMarket.marketType, held);
  if (unique.length === 0) throw new Error("At least one category is required");
  // Hand-assigned tags: ones already marked stay marked while they remain, and an
  // admin save marks the tags it adds. Tags curation placed and the admin left
  // alone stay automatic, so saving an unrelated field freezes nothing.
  const heldManual = new Set(persisted?.categories.filter((c) => c.manual).map((c) => c.category) ?? []);
  const heldAll = new Set(held);
  const isManual = (category: string) => heldManual.has(category) || (!!opts.manual && categories.includes(category) && !heldAll.has(category));

  const writes = [
    client.predictionCategoryLink.deleteMany({ where: { predictionId } }),
    client.predictionCategoryLink.createMany({
      data: unique.map((category) => ({ predictionId, category, manual: isManual(category) })),
    }),
    // A row in any free category is primarily that free category, so no
    // surface that labels or locks by the primary shows it as VIP/PREMIUM.
    client.prediction.update({ where: { id: predictionId }, data: { category: presentedCategory(unique[0], unique) } }),
  ];
  if (db) await Promise.all(writes);
  else await prisma.$transaction(writes);
}

/** Review actions that only move a prediction's status. SETTLE and EDIT carry extra payload and stay on the single-row route. */
export type ReviewAction = "APPROVE" | "PUBLISH" | "ARCHIVE";

/**
 * The fields a review action writes.
 *
 * Extracted so the single-row PATCH and the bulk endpoint apply byte-identical
 * transitions. Publishing without a prior approval records the publisher as the
 * approver, which is what keeps the audit trail complete when a reviewer goes
 * straight from PENDING_REVIEW to PUBLISHED — the common path.
 */
export function reviewTransition(
  action: ReviewAction,
  adminId: string,
  current: { approvedById: string | null },
): Record<string, unknown> {
  if (action === "APPROVE") {
    return { status: "APPROVED", approvedById: adminId, approvedAt: new Date() };
  }
  if (action === "PUBLISH") {
    return {
      status: "PUBLISHED",
      publishedAt: new Date(),
      ...(current.approvedById ? {} : { approvedById: adminId, approvedAt: new Date() }),
    };
  }
  return { status: "ARCHIVED" };
}

/**
 * Apply a status-only review action to one row, with its notification events,
 * in one transaction.
 *
 * The one shared path for a review transition that carries no field edits: the
 * bulk endpoint uses it for every row, and the Goals pass uses it to publish a
 * pick that cleared its gate (src/lib/goalsPipeline.ts) — so an automatic
 * publish writes the same approval/publish audit fields and fires the same
 * NEW_PREDICTION event as a human one, attributed to `actorId`. The single-row
 * PATCH keeps its own transaction only because it merges field edits into the
 * same update.
 */
/**
 * A pick whose match has started can no longer be approved or published.
 *
 * On 4 Oct 2026 eight picks were published after their own kickoff: they were
 * generated hours late and reviewed later still, and once a match is under way
 * a "prediction" is a guess with the answer half-visible. Archiving stays
 * allowed. Null kickoff (a manual row with no date) is not blocked: there is
 * no kickoff to be past.
 */
export const KICKOFF_PASSED_MESSAGE = "This match has already kicked off, so the pick can no longer be approved or published. Archive it instead.";

export function reviewBlockedByKickoff(action: string, kickoff: Date | null | undefined, now: Date = new Date()): string | null {
  if (action !== "APPROVE" && action !== "PUBLISH") return null;
  return kickoff && kickoff.getTime() <= now.getTime() ? KICKOFF_PASSED_MESSAGE : null;
}

export class KickoffPassedError extends Error {
  constructor() {
    super(KICKOFF_PASSED_MESSAGE);
    this.name = "KickoffPassedError";
  }
}

export class PaidPublicationEvidenceError extends Error {
  constructor(readonly reason: string) {
    super(`Paid publication evidence rejected: ${reason}`);
    this.name = "PaidPublicationEvidenceError";
  }
}

/** Cached authoritative fixture data is a veto, never an invented pre-match confirmation. */
export async function assertPublicationFixture(row: { kickoff: Date | null; fixtureApiId?: number | null; marketType?: string; selection?: unknown }, db: Pick<typeof prisma, "fixture"> = prisma) {
  const fixture = row.fixtureApiId != null ? await db.fixture.findUnique({where:{apiId:row.fixtureApiId}}) : null;
  const problem = publicationStatusProblem(fixture, row.kickoff, new Date());
  if (problem) throw new Error(problem);
  if (row.marketType && row.marketType !== "OTHER" && !isValidSelection(row.marketType as MarketType, row.selection)) throw new Error("INVALID_PUBLICATION_SELECTION");
}

export async function applyReviewAction(
  row: Parameters<typeof recordPredictionEvents>[1] & { approvedById: string | null; updatedAt?: Date },
  action: ReviewAction,
  actorId: string,
) {
  // Every review path goes through here or the single-row route, which makes
  // the same check. The kickoff is re-read, never trusted from the caller.
  const current = await prisma.prediction.findUnique({ where: { id: row.id }, select: { kickoff: true } });
  if (reviewBlockedByKickoff(action, current?.kickoff)) throw new KickoffPassedError();
  return prisma.$transaction(async (tx) => {
    if (action === "APPROVE" || action === "PUBLISH") {
      const claimed = await tx.prediction.updateMany({where:{id:row.id,status:row.status,...(row.updatedAt ? {updatedAt:row.updatedAt} : {}),OR:[{kickoff:null},{kickoff:{gt:new Date()}}]},data:{updatedAt:new Date()}});
      if (claimed.count !== 1) throw new Error("REVIEW_STATE_CHANGED");
      const locked = await tx.prediction.findUniqueOrThrow({where:{id:row.id},include:{categories:true}});
      if (action === "PUBLISH" && locked.status === "PUBLISHED") return locked;
      await assertPublicationFixture(locked, tx);
      if (action === "APPROVE" && locked.status === "PUBLISHED") throw new Error("CANNOT_UNPUBLISH_BY_APPROVAL");
      row = locked;
    }
    const updated = await tx.prediction.update({
      where: { id: row.id },
      data: reviewTransition(action, actorId, row),
      include: { categories: true },
    });
    await recordPredictionEvents(tx, row, updated, action);
    return updated;
  });
}

/**
 * Dedicated paid-auto-publisher: no change to human review or Goals publishing.
 * Row lock via conditional updateMany serializes competing workers. Publication,
 * immutable quote snapshot, and notification event commit in one transaction.
 * A failed write rolls everything back; retries return false without events.
 */
export async function publishPaidPredictionAtomically(
  row: Parameters<typeof recordPredictionEvents>[1] & { approvedById: string | null; marketConfirmation: unknown },
  actorId: string,
  publicationEvidence: Record<string, unknown>,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.prediction.updateMany({
      where: {
        id: row.id,
        status: row.status,
        OR: [{ kickoff: null }, { kickoff: { gt: new Date() } }],
      },
      data: { updatedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    const before = await tx.prediction.findUnique({
      where: { id: row.id }, include: { categories: true },
    });
    if (!before || before.status === "PUBLISHED") return false;
    if (reviewBlockedByKickoff("PUBLISH", before.kickoff)) throw new KickoffPassedError();
    await assertPublicationFixture(before, tx);
    const snapshot = appendPublicationQuoteEvidence(before.marketConfirmation, publicationEvidence);
    if (!snapshot) throw new Error("Paid publication requires an unrecorded confirmation snapshot");
    // Validate the exact publication snapshot against the locked row, never
    // substitute promotion evidence. Throw so the claim also rolls back.
    if (!before.kickoff) throw new PaidPublicationEvidenceError("MISSING_KICKOFF");
    const evidence = auditPublicationQuoteEvidence(snapshot, before.kickoff);
    if (!evidence.usable) throw new PaidPublicationEvidenceError(evidence.reason);
    const updated = await tx.prediction.update({
      where: { id: row.id },
      data: {
        ...reviewTransition("PUBLISH", actorId, before),
        marketConfirmation: snapshot as any,
      },
      include: { categories: true },
    });
    await recordPredictionEvents(tx, before, updated, "PUBLISH");
    return true;
  });
}


/**
 * Dedicated EARLY FREE auto-publisher, separate from paid and manual review.
 * The single transaction claims the unchanged draft, validates the exact
 * live cache quote, writes the initial median as the displayed odds, retains
 * an append-only original-price receipt and seeds reassessment's baseline.
 * A failure rolls back publication and notification together.
 */
export async function publishEarlyFreePredictionAtomically(
  row: Parameters<typeof recordPredictionEvents>[1] & {
    approvedById: string | null; updatedAt: Date; fixtureApiId: number | null;
    kickoff: Date | null; marketType: string; selection: unknown;
  },
  actorId: string,
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const now = new Date();
    const claimed = await tx.prediction.updateMany({
      where: { id: row.id, status: "PENDING_REVIEW", updatedAt: row.updatedAt,
        kickoff: { gt: now } },
      data: { updatedAt: now },
    });
    if (claimed.count !== 1) return false;
    const locked = await tx.prediction.findUniqueOrThrow({
      where: { id: row.id }, include: { categories: true },
    });
    if (locked.status !== "PENDING_REVIEW" || locked.fixtureApiId == null || !locked.kickoff ||
      locked.fixtureApiId !== row.fixtureApiId || locked.marketType !== row.marketType ||
      JSON.stringify(locked.selection) !== JSON.stringify(row.selection) ||
      !inEarlyGenerationWindow(locked.kickoff, now, locked.leagueApiId))
      throw new Error("EARLY_PUBLICATION_STATE_CHANGED");
    if (isPaidOnlyProvenance(locked.provenance) ||
      locked.categories.some(c => ["VIP", "PREMIUM", "BET_OF_THE_DAY", "SAME_GAME_DOUBLE"].includes(c.category)) ||
      locked.manualSettlementOnly || locked.marketType === "OTHER")
      throw new Error("EARLY_PUBLICATION_PROTECTED_CATEGORY");
    await assertPublicationFixture(locked, tx);
    const key = matchKey(locked);
    if (!key) throw new Error("EARLY_PUBLICATION_MISSING_FIXTURE_IDENTITY");
    const cache = await tx.fixtureOddsCache.findUnique({
      where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true },
    });
    const priced = earlyQuotedSelection({
      odds: (cache?.oddsJson as any) ?? null,
      fetchedAt: cache?.fetchedAt ?? null,
      kickoff: locked.kickoff,
      now,
      marketType: locked.marketType,
      selection: locked.selection,
    });
    if (!priced.ok) throw new Error("EARLY_PUBLICATION_ODDS_" + priced.reason);
    const quote = priced.quote;
    const nextCheckAt = new Date(now.getTime() +
      reassessmentIntervalMinutes(now, locked.kickoff) * 60_000);
    const receipt = {
      kind: "EARLY_FREE_ORIGINAL_BOOKMAKER_PRICE",
      fixtureApiId: locked.fixtureApiId,
      marketType: locked.marketType,
      selection: locked.selection,
      market: quote.market,
      quotedOutcome: quote.value,
      median: quote.median,
      best: quote.best,
      bestBookmaker: quote.bestBookmaker,
      bookmakers: quote.bookmakers,
      providerUpdatedAt: quote.providerAt.toISOString(),
      cacheFetchedAt: quote.fetchedAt.toISOString(),
      publishedAt: now.toISOString(),
    };
    const updated = await tx.prediction.update({
      where: { id: locked.id },
      data: {
        ...reviewTransition("PUBLISH", actorId, locked),
        odds: quote.median,
      },
      include: { categories: true },
    });
    await tx.predictionRevision.create({
      data: {
        predictionId: locked.id, kind: "EARLY_PUBLICATION_PRICE",
        publiclyVisible: false, reason: "Verified opening quote at early free publication",
        beforeJson: {
          status: locked.status, marketType: locked.marketType,
          selection: locked.selection, confidence: locked.confidence,
        } as Prisma.InputJsonValue,
        afterJson: {
          status: "PUBLISHED", originalMedian: quote.median,
          publishedAt: now.toISOString(),
        },
        evidenceJson: receipt as Prisma.InputJsonValue,
      },
    });
    await tx.predictionReassessment.upsert({
      where: { predictionId: locked.id },
      create: {
        predictionId: locked.id, status: "UNASSESSED",
        lastOddsMedian: quote.median, lastOddsAt: quote.providerAt,
        nextCheckAt,
      },
      update: {
        lastOddsMedian: quote.median, lastOddsAt: quote.providerAt,
        nextCheckAt,
      },
    });
    await recordPredictionEvents(tx, locked, updated, "PUBLISH");
    return true;
  });
}
