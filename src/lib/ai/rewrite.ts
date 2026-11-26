/**
 * Re-ask the model for a fresh draft of an existing PENDING_REVIEW prediction,
 * reusing the football context stored on its AIJob.
 *
 * Deliberately makes ZERO API-Football calls: nothing here imports the
 * football client. A rewrite answers "write this differently", not "the data
 * changed" — so it costs one model call and no daily football quota.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { parseStoredContext, buildStoredContext } from "@/lib/ai/context";
import { setPredictionCategories } from "@/lib/predictions";
import { GOALS_GENERATED_PROVENANCE, GOALS_MIN_CONFIDENCE, pickGoalsDraft } from "@/lib/goalsGeneration";
import { isValidSelection, deriveMarketAndPick, deriveOverUnderText, type MarketType, type Selection } from "@/lib/markets";
import { buildAnalysis } from "@/lib/predictionAnalysis";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import { proseViolations, describeProseViolations } from "@/lib/ai/proseGate";
import { oddsForRows } from "@/lib/reviewQueue";
import { betterMarketBlock, priceVerdict } from "@/lib/marketPricePolicy";
import { automaticOddsFailure } from "@/lib/autoOddsFloor";
import { isUnpayableDoubleChance } from "@/lib/shortPriceGuard";
import { farAboveMarket } from "@/lib/marketSanity";

/** A superseded draft, appended to Prediction.previousDrafts. */
export type ArchivedDraft = {
  matchPreview: string | null;
  reasoning: string;
  market: string;
  pick: string;
  marketType: string;
  selection: unknown;
  confidence: number;
  odds: number | null;
  ouLine: number | null;
  ouDirection: string | null;
  replacedAt: string;
  requestedById: string;
  reviewerNote: string | null;
};

export class RewriteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * "rewrite": same task as ever, new wording (the market may still move if the
 * model's evidence says so). "repick": the current pick is not good enough (too
 * short a price, weak evidence, or the admin simply does not like it), so ask for
 * 2-3 independently reasoned markets, tell the model what was ruled out and the
 * real prices on file, and keep the first one that clears the price rules.
 */
export type RewriteMode = "rewrite" | "repick";

export async function rewritePrediction(opts: { predictionId: string; reviewerNote?: string | null; requestedById: string; mode?: RewriteMode }) {
  const { predictionId, requestedById } = opts;
  const mode: RewriteMode = opts.mode ?? "rewrite";
  const reviewerNote = opts.reviewerNote?.trim() || null;

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    include: { aiJob: true, categories: true },
  });
  if (!prediction) throw new RewriteError("Prediction not found", 404);

  // Rewrites are a review-stage tool. Allowing them on an APPROVED or PUBLISHED
  // row would silently change copy readers may already have seen, with no
  // re-approval step — approve/archive stay the exits from this state.
  if (prediction.status !== "PENDING_REVIEW") {
    throw new RewriteError(`Only PENDING_REVIEW predictions can be rewritten (this one is ${prediction.status})`, 409);
  }

  // Handles both v1 (raw payloads, upgraded on read) and v2 (digest) rows —
  // see src/lib/ai/context.ts.
  const digest = parseStoredContext(prediction.aiJob?.context);
  if (!digest) {
    throw new RewriteError(
      "This prediction has no stored football context — it was created before contexts were saved. Rewriting it would need a fresh API-Football fetch, so regenerate it from the generation panel instead.",
      409,
    );
  }

  const startedAt = Date.now();
  const riskRoute = resolveGenerationRisk(
    prediction.categories.map((c) => c.category),
    prediction.leagueApiId,
  );
  // A Goals-pass row stays a Goals pick through a rewrite: same fixed market,
  // same post-parse enforcement. Otherwise a rewrite could turn a row filed
  // under GOALS alone into, say, BTTS — losing its only category.
  const goalsOnly = prediction.provenance === GOALS_GENERATED_PROVENANCE;
  // Prices on file, for a re-pick of an ordinary pick. A Goals row is one fixed
  // market and a plain rewrite keeps the task as it was.
  const repick = mode === "repick" && !goalsOnly;
  const odds = repick ? (await oddsForRows([prediction])).get(prediction.id) ?? null : null;
  const home = prediction.homeTeam ?? "Home";
  const away = prediction.awayTeam ?? "Away";
  const ruledOut = repick
    ? `\nTHE CURRENT PICK WAS RULED OUT BY THE REVIEWER: ${prediction.market}: ${prediction.pick} (${priceVerdict(odds, prediction.marketType, prediction.selection).label}). ` +
      `Do not return it again. Return 2 or 3 different markets, each supported by the evidence, strongest first.\n`
    : "";
  const { output, usage, model } = await generatePredictionForFixture({
    digest,
    tiers: riskRoute.promptTiers,
    riskCalibration: riskRoute.calibration !== "legacy",
    ...(repick ? { marketBreadth: "multi" as const, shortPriceBlock: ruledOut + betterMarketBlock(odds, home, away) } : {}),
    ...(goalsOnly ? { goalsOnly: true } : {}),
    reviewerNote,
    previousDraft: {
      matchPreview: prediction.matchPreview,
      reasoning: prediction.reasoning,
      pick: prediction.pick,
      confidence: prediction.confidence,
    },
  });

  const drafts = Array.isArray(output.predictions) ? output.predictions : [];
  // The same price rules generation applies. A re-pick takes the first draft that
  // clears them; if none does, the strongest draft is kept and flagged so the
  // reviewer sees it still needs attention rather than being told it is fixed.
  const clears = (p: (typeof drafts)[number]) =>
    !isUnpayableDoubleChance(odds, p.marketType, p.selection) && automaticOddsFailure(odds, p.marketType, p.selection) === null
    && !priceVerdict(odds, p.marketType, p.selection).blocksPublication && !farAboveMarket(odds, p);
  const draft = goalsOnly ? pickGoalsDraft(drafts).pick : repick ? (drafts.find(clears) ?? drafts[0]) : drafts[0];
  const priceCleared = !repick || (draft ? clears(draft) : false);
  if (!draft) {
    throw new RewriteError(
      goalsOnly
        ? `The rewrite returned no Over 1.5 / Over 2.5 pick at ${GOALS_MIN_CONFIDENCE}% or above; the draft is unchanged`
        : "The model returned no predictions in the rewrite",
      502,
    );
  }

  // The same prose gate first-pass generation applies (certainty language,
  // house terminology, narrated reviewer notes). Checked BEFORE anything is
  // archived or written, so a rejected rewrite leaves the draft untouched.
  const violations = proseViolations({ matchPreview: output.matchPreview, keyFactors: output.keyFactors, reasoning: draft.reasoning });
  if (violations.length) {
    throw new RewriteError(
      `The new draft used wording that cannot be published (${describeProseViolations(violations)}); the draft is unchanged. Request the rewrite again.`,
      422,
    );
  }

  // Same defensive derivation as generate.ts: a malformed marketType/selection
  // falls back to OTHER (manual settlement) rather than persisting a
  // settlement field whose shape doesn't match its type.
  const validStructured = isValidSelection(draft.marketType, draft.selection);
  const marketType: MarketType = validStructured ? draft.marketType : "OTHER";
  const selection: Selection = validStructured ? draft.selection : null;
  const { market, pick } = deriveMarketAndPick(marketType, selection, prediction.homeTeam ?? undefined, prediction.awayTeam ?? undefined, {
    market: "Other",
    pick: "",
  });
  const validOU = typeof draft.overUnderLine === "number" && (draft.overUnderDirection === "OVER" || draft.overUnderDirection === "UNDER");
  const ouLine = validOU ? draft.overUnderLine : null;
  const ouDirection = validOU ? draft.overUnderDirection : null;

  // Archive the outgoing draft before overwriting. Append-only and oldest-first,
  // so the column reads as a history rather than needing a sort on display.
  const archived: ArchivedDraft = {
    matchPreview: prediction.matchPreview,
    reasoning: prediction.reasoning,
    market: prediction.market,
    pick: prediction.pick,
    marketType: prediction.marketType,
    selection: prediction.selection ?? null,
    confidence: prediction.confidence,
    odds: prediction.odds,
    ouLine: prediction.ouLine,
    ouDirection: prediction.ouDirection,
    replacedAt: new Date().toISOString(),
    requestedById,
    reviewerNote,
  };
  const history = Array.isArray(prediction.previousDrafts) ? (prediction.previousDrafts as unknown as ArchivedDraft[]) : [];

  // A new AIJob per round, carrying the same context forward so the next
  // rewrite still has evidence to work from, and recording this round's note.
  const job = await prisma.aIJob.create({
    data: {
      userId: requestedById,
      prompt: JSON.stringify({ rewriteOf: predictionId, reviewerNote }),
      model,
      rawOutput: JSON.stringify(output),
      status: "COMPLETED",
      contextComplete: prediction.contextComplete,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - startedAt,
      // Carry the digest forward in the CURRENT format, so a v1 row that gets
      // rewritten stops being v1 rather than being re-upgraded on every round.
      context: buildStoredContext(digest) as unknown as Prisma.InputJsonValue,
      reviewerNote,
    },
  });

  const updated = await prisma.prediction.update({
    where: { id: predictionId },
    data: {
      matchPreview: output.matchPreview,
      reasoning: draft.reasoning,
      // Key factors are part of the draft being replaced, so they move with it.
      analysisJson: buildAnalysis(output) as unknown as Prisma.InputJsonValue,
      market,
      pick,
      marketType,
      selection: selection ?? undefined,
      manualSettlementOnly: marketType === "OTHER",
      confidence: Math.min(90, Math.max(0, Math.round(draft.confidence))),
      odds: null,
      ouLine,
      ouDirection,
      overUnder: deriveOverUnderText(ouLine, ouDirection),
      previousDrafts: [...history, archived] as any,
      rewriteRequestedById: requestedById,
      rewriteRequestedAt: new Date(),
      rewriteCount: { increment: 1 },
      aiJobId: job.id,
    },
    include: { categories: true },
  });

  // Editorial categories are untouched by a rewrite, but re-asserting them
  // keeps the primary `category` column in sync with categories[0] the way
  // generate.ts does, in case an earlier edit changed the set. A rewrite CAN
  // change the market, so this is also what adds or removes GOALS.
  await setPredictionCategories(predictionId, updated.categories.map((c) => c.category), updated);

  return { prediction: updated, job, archivedCount: history.length + 1, priceCleared };
}
