/**
 * Explicit admin decisions on a material published-pick change.
 *
 * A replacement is a NEW published row; the original is archived with an
 * append-only revision receipt. Dedicated VIP/Premium, Bet of the Day and
 * combo records cannot be replaced by this route.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { prisma } from "@/lib/prisma";
import { parseStoredContext } from "@/lib/ai/context";
import { deriveMarketAndPick, isValidSelection, type MarketType, type Selection } from "@/lib/markets";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { assertPublicationFixture } from "@/lib/predictions";
import { proseViolations } from "@/lib/ai/proseGate";

export const dynamic = "force-dynamic";
const Action = z.object({
  predictionId: z.string().min(1).max(128),
  action: z.enum(["KEEP", "WITHDRAW", "REPLACE", "RESTORE"]),
  note: z.string().trim().min(10).max(500),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role) || !session?.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = Action.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { predictionId, action, note } = body.data;
  try {
    const result = await prisma.$transaction(async tx => {
      const before = await tx.prediction.findUnique({
        where: { id: predictionId },
        include: { categories: true, reassessment: true, revisions: { orderBy: { recordedAt: "desc" }, take: 1 } },
      });
      if (action === "RESTORE") {
        if (!before || before.status !== "ARCHIVED" || !before.publishedAt || !before.reassessment)
          throw new Error("NOT_AUTO_WITHDRAWN");
        // This operation exists solely for the old monitoring worker's
        // automatic fixture withdrawals, never administrator withdrawals.
        const withdrawn = before.revisions.find(r => r.kind === "WITHDRAWN" &&
          Array.isArray(r.evidenceJson) && r.evidenceJson.some(signal =>
            !!signal && typeof signal === "object" &&
            (signal as { source?: string }).source === "fixture"));
        if (!withdrawn) throw new Error("NOT_AUTO_WITHDRAWN");
        const claim = await tx.prediction.updateMany({
          where: { id: predictionId, status: "ARCHIVED" },
          data: { status: "PUBLISHED" },
        });
        if (claim.count !== 1) throw new Error("REVIEW_STATE_CHANGED");
        await tx.predictionReassessment.update({
          where: { predictionId },
          data: { status: "CURRENT", publicHold: false,
            summary: "Administrator restored previously auto-withdrawn original: " + note,
            checkedAt: new Date(), nextCheckAt: null },
        });
        await tx.predictionRevision.create({
          data: { predictionId, kind: "ADMIN_RESTORED", publiclyVisible: false,
            reason: note, beforeJson: {
              market: before.market, pick: before.pick, confidence: before.confidence,
              publishedAt: before.publishedAt.toISOString(), status: before.status,
            } as Prisma.InputJsonValue },
        });
        return { action, predictionId, replacementId: null };
      }
      if (!before || before.status !== "PUBLISHED" || !before.publishedAt || !before.kickoff)
        throw new Error("PREDICTION_NOT_PUBLISHED_OR_STARTED");
      if (before.reassessment?.status !== "REVIEW_REQUIRED") throw new Error("NO_OPEN_REASSESSMENT");
      // Settled or live picks are never withdrawn after the fact (issue #232).
      // (A null kickoff was already refused above: fail closed.)
      if (action === "WITHDRAW" && before.kickoff <= new Date()) throw new Error("KICKOFF_PASSED");
      const paid = isPaidOnlyProvenance(before.provenance)
        || before.categories.some(c => c.category === "VIP" || c.category === "PREMIUM");
      if (paid && action === "REPLACE") throw new Error("PAID_REPLACEMENT_REQUIRES_PAID_GATE");

      const previous = {
        market: before.market, pick: before.pick, selection: before.selection,
        confidence: before.confidence, publishedAt: before.publishedAt.toISOString(),
        provenance: before.provenance, status: before.status,
      };
      if (action === "KEEP") {
        await tx.predictionReassessment.update({
          where: { predictionId }, data: { status: "CURRENT", publicHold: false, summary: "Reviewed and retained: " + note,
            proposedMarket: null, proposedSelection: Prisma.DbNull, proposedConfidence: null,
            checkedAt: new Date(), nextCheckAt: new Date(Date.now() + 60 * 60_000) },
        });
        await tx.predictionRevision.create({
          data: { predictionId, kind: "CONFIRMED", publiclyVisible: false, reason: note, beforeJson: previous as Prisma.InputJsonValue },
        });
        return { action, predictionId, replacementId: null };
      }

      let replacementId: string | null = null;
      if (action === "REPLACE") {
        if (before.kickoff <= new Date()) throw new Error("KICKOFF_PASSED");
        if (before.categories.some(c => ["BET_OF_THE_DAY", "SAME_GAME_DOUBLE"].includes(c.category)))
          throw new Error("PROTECTED_CATEGORY_REPLACEMENT");
        const revision = before.revisions[0];
        const proposal = revision?.afterJson as { marketType?: string; selection?: unknown; confidence?: number; reasoning?: string } | null;
        const nextMarket = before.reassessment.proposedMarket;
        const nextSelection = before.reassessment.proposedSelection;
        const nextConfidence = before.reassessment.proposedConfidence;
        const source = parseStoredContext(before.reassessment.lastEvidence);
        if (!proposal || !nextMarket || !nextSelection || !nextConfidence || nextConfidence < 80
          || !source || !source.coverage.stats || !source.coverage.form
          || !source.teams.home.overall || !source.teams.away.overall
          || !isValidSelection(nextMarket as MarketType, nextSelection)
          || nextMarket === "SAME_GAME_DOUBLE" || nextMarket === "OTHER"
          || proposal.marketType !== nextMarket || proposal.confidence !== nextConfidence
          || typeof proposal.reasoning !== "string" || proposal.reasoning.length < 20) {
          throw new Error("REPLACEMENT_EVIDENCE_OR_SELECTION_NOT_QUALIFIED");
        }
        // Published prose passes the same gate as every generated draft.
        if (proseViolations({ reasoning: proposal.reasoning }).length) throw new Error("REPLACEMENT_PROSE_REJECTED");
        // Publication verifies fixture identity, status and selected market
        // against live stored state, not an earlier approval snapshot.
        await assertPublicationFixture({ kickoff: before.kickoff, fixtureApiId: before.fixtureApiId,
          marketType: nextMarket, selection: nextSelection }, tx);
        const { market, pick } = deriveMarketAndPick(nextMarket as MarketType, nextSelection as Selection,
          before.homeTeam ?? undefined, before.awayTeam ?? undefined, { market: "Other", pick: "" });
        const stamped = new Date();
        const job = await tx.aIJob.create({
          data: {
            userId: session.user.id, status: "COMPLETED", model: "reassessment-review",
            prompt: JSON.stringify({ revisionOf: predictionId, reason: note }),
            rawOutput: JSON.stringify({ predictions: [proposal] }), contextComplete: true,
            context: before.reassessment.lastEvidence as Prisma.InputJsonValue,
            reviewerNote: note,
          },
        });
        const replacement = await tx.prediction.create({
          data: {
            fixtureApiId: before.fixtureApiId, leagueApiId: before.leagueApiId, leagueName: before.leagueName,
            homeTeam: before.homeTeam, awayTeam: before.awayTeam,
            homeTeamApiId: before.homeTeamApiId, awayTeamApiId: before.awayTeamApiId,
            kickoff: before.kickoff, category: "FEATURED",
            status: "PUBLISHED", marketType: nextMarket, selection: nextSelection as Prisma.InputJsonValue,
            manualSettlementOnly: false, market, pick, odds: null,
            confidence: nextConfidence, reasoning: proposal.reasoning,
            // No preview rather than an administrative line ("Updated
            // assessment based on newer match information") in public copy.
            matchPreview: null,
            contextComplete: true, provenance: "REASSESSED_FREE",
            authorId: session.user.id, approvedById: session.user.id,
            approvedAt: stamped, publishedAt: stamped, aiJobId: job.id,
            categories: { create: [{ category: "FEATURED", manual: false }] },
          },
          include: { categories: true },
        });
        replacementId = replacement.id;
      }

      // Always archive the original when withdrawing or replacing. Its
      // selection, odds snapshot, publishedAt and settlement trail are intact.
      const claim = await tx.prediction.updateMany({
        where: { id: predictionId, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
      if (claim.count !== 1) throw new Error("REVIEW_STATE_CHANGED");
      const after = await tx.prediction.findUniqueOrThrow({
        where: { id: predictionId }, include: { categories: true },
      });
      await tx.predictionReassessment.update({
        where: { predictionId }, data: { status: "WITHDRAWN", publicHold: false, summary: note,
          checkedAt: new Date(), nextCheckAt: null },
      });
      await tx.predictionRevision.create({
        data: {
          predictionId, kind: action === "REPLACE" ? "REPLACED" : "WITHDRAWN", publiclyVisible: false,
          reason: note, beforeJson: previous as Prisma.InputJsonValue,
          afterJson: replacementId ? ({ replacementId } as Prisma.InputJsonValue) : undefined,
        },
      });
      return { action, predictionId, replacementId };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (["PREDICTION_NOT_PUBLISHED_OR_STARTED", "KICKOFF_PASSED", "NO_OPEN_REASSESSMENT", "REPLACEMENT_PROSE_REJECTED",
      "PAID_REPLACEMENT_REQUIRES_PAID_GATE", "PROTECTED_CATEGORY_REPLACEMENT",
      "REPLACEMENT_EVIDENCE_OR_SELECTION_NOT_QUALIFIED", "FIXTURE_NOT_SCHEDULED",
      "REVIEW_STATE_CHANGED", "NOT_AUTO_WITHDRAWN"].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[reassessment-resolve]", error);
    return NextResponse.json({ error: "Reassessment resolution failed" }, { status: 500 });
  }
}
