/** Admin-requested rewrite: private draft first; explicit approval edits prose only.
 * Published market, selection, price, confidence, dates and status are immutable.
 * A different selection requires the separately guarded admin REPLACE workflow.
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
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { isValidSelection, type MarketType } from "@/lib/markets";
import { latestSignals } from "@/lib/predictionUpdates";
import { DECISION_CONFIDENCE_DROP } from "@/lib/reassessment/evidenceDiff";

export const dynamic = "force-dynamic";

const Request = z.object({
  predictionId: z.string().min(1).max(128),
  action: z.enum(["GENERATE", "APPLY"]),
  note: z.string().trim().min(10).max(500),
  revisionId: z.string().optional(),
});
type RewriteDraft = {
  marketType: string; selection: unknown; confidence: number;
  reasoning: string; matchPreview: string;
  sameSelection: boolean; evidenceHash: string | null;
};
function unchangedSelection(a: { marketType: string; selection: unknown }, b: { marketType: string; selection: unknown }) {
  return a.marketType === b.marketType && JSON.stringify(a.selection) === JSON.stringify(b.selection);
}
function snapshot(row: { market: string; pick: string; confidence: number; reasoning: string;
  matchPreview: string | null; publishedAt: Date | null; odds: number | null }) {
  return { market: row.market, pick: row.pick, confidence: row.confidence,
    reasoning: row.reasoning, matchPreview: row.matchPreview,
    publishedAt: row.publishedAt?.toISOString() ?? null, odds: row.odds };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role) || !session?.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasValidMutationOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = Request.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { predictionId, action, note, revisionId } = body.data;

  try {
    if (action === "GENERATE") {
      const row = await prisma.prediction.findUnique({
        where: { id: predictionId },
        include: { reassessment: true, categories: true, aiJob: { select: { context: true } } },
      });
      if (!row || row.status !== "PUBLISHED" || !row.publishedAt ||
        row.reassessment?.status !== "REVIEW_REQUIRED") throw new Error("NO_ACTIVE_ADMIN_REVIEW");
      if (row.kickoff && row.kickoff <= new Date()) throw new Error("KICKOFF_PASSED");
      // A human-written pick is never re-worded by the model (issue #232).
      if (!row.aiJobId) throw new Error("ADMIN_AUTHORED_PICK");
      // Evidence that undermines the pick (postponement, key player out,
      // critical price move) is a decision, not prose: no draft is generated.
      if ((await latestSignals(predictionId)).some(sig => sig.severity === "CRITICAL")) throw new Error("DECISION_REQUIRED");
      // Use the latest monitoring snapshot only: no new football API calls.
      const digest = parseStoredContext(row.reassessment.lastEvidence);
      if (!digest || !digest.coverage.stats || !digest.coverage.form)
        throw new Error("NO_CREDIBLE_REASSESSMENT_EVIDENCE");
      const risk = resolveGenerationRisk(row.categories.map(c => c.category), row.leagueApiId);
      const paid = isPaidOnlyProvenance(row.provenance) ||
        row.categories.some(c => c.category === "VIP" || c.category === "PREMIUM");
      const output = await generatePredictionForFixture({
        digest, tiers: risk.promptTiers, riskCalibration: risk.calibration !== "legacy",
        marketBreadth: "single", paidRoute: paid,
        previousDraft: {
          pick: row.pick, confidence: row.confidence,
          reasoning: row.reasoning, matchPreview: row.matchPreview,
        },
        reviewerNote: note + " Rewrite the analysis of the ORIGINAL published pick. " +
          "Do not change the originally published selection, confidence or price. " +
          "If the evidence instead supports a different pick, provide that as a separate draft, not as an edit.",
      });
      const candidate = output.output.predictions?.[0];
      if (!candidate || !Number.isFinite(candidate.confidence) ||
        !isValidSelection(candidate.marketType as MarketType, candidate.selection) ||
        typeof candidate.reasoning !== "string" || candidate.reasoning.trim().length < 20)
        throw new Error("REWRITE_NO_VALID_DRAFT");
      const draft: RewriteDraft = {
        marketType: candidate.marketType, selection: candidate.selection,
        confidence: candidate.confidence,
        reasoning: candidate.reasoning.trim(),
        matchPreview: output.output.matchPreview?.trim() ?? "",
        sameSelection: unchangedSelection(row, candidate),
        evidenceHash: row.reassessment.lastChangeHash,
      };
      const saved = await prisma.$transaction(async tx => {
        const current = await tx.prediction.findUnique({
          where: { id: predictionId }, include: { reassessment: true },
        });
        if (!current || current.status !== "PUBLISHED" ||
          current.reassessment?.status !== "REVIEW_REQUIRED" ||
          current.reassessment.lastChangeHash !== draft.evidenceHash)
          throw new Error("REVIEW_CHANGED_DURING_REWRITE");
        return tx.predictionRevision.create({
          data: { predictionId, kind: "ADMIN_REWRITE_DRAFT",
            publiclyVisible: false, reason: note,
            beforeJson: snapshot(current) as Prisma.InputJsonValue,
            afterJson: draft as unknown as Prisma.InputJsonValue },
        });
      });
      return NextResponse.json({ ok: true, revisionId: saved.id, draft,
        message: draft.sameSelection
          ? "Private rewrite ready for administrator approval. No published content changed."
          : "The model proposed another selection. Original remains untouched; this prose rewrite cannot be applied." });
    }

    if (!revisionId) throw new Error("REWRITE_REVISION_REQUIRED");
    await prisma.$transaction(async tx => {
      const current = await tx.prediction.findUnique({
        where: { id: predictionId }, include: { reassessment: true },
      });
      if (!current || current.status !== "PUBLISHED" || !current.publishedAt ||
        current.reassessment?.status !== "REVIEW_REQUIRED") throw new Error("NO_ACTIVE_ADMIN_REVIEW");
      if (current.kickoff && current.kickoff <= new Date()) throw new Error("KICKOFF_PASSED");
      if (!current.aiJobId) throw new Error("ADMIN_AUTHORED_PICK");
      if ((await latestSignals(predictionId, tx)).some(sig => sig.severity === "CRITICAL")) throw new Error("DECISION_REQUIRED");
      const latest = await tx.predictionRevision.findFirst({
        where: { predictionId, kind: "ADMIN_REWRITE_DRAFT" },
        orderBy: { recordedAt: "desc" },
      });
      if (!latest || latest.id !== revisionId) throw new Error("REWRITE_DRAFT_STALE");
      const draft = latest.afterJson as RewriteDraft | null;
      if (!draft || !draft.sameSelection ||
        !unchangedSelection(current, draft) ||
        draft.evidenceHash !== current.reassessment.lastChangeHash ||
        typeof draft.reasoning !== "string" || draft.reasoning.trim().length < 20)
        throw new Error("REWRITE_SELECTION_OR_EVIDENCE_CHANGED");
      // Prose cannot carry a weaker case under the original confidence.
      if (Number(draft.confidence) < current.confidence - DECISION_CONFIDENCE_DROP) throw new Error("DECISION_REQUIRED");
      const old = snapshot(current);
      const claim = await tx.prediction.updateMany({
        where: { id: predictionId, status: "PUBLISHED",
          reasoning: current.reasoning, matchPreview: current.matchPreview },
        data: { reasoning: draft.reasoning, matchPreview: draft.matchPreview },
      });
      if (claim.count !== 1) throw new Error("REWRITE_CONCURRENT_CHANGE");
      await tx.predictionRevision.create({
        data: { predictionId, kind: "ADMIN_REWRITE_APPLIED", publiclyVisible: false,
          reason: note, beforeJson: old as Prisma.InputJsonValue,
          afterJson: { reasoning: draft.reasoning, matchPreview: draft.matchPreview,
            draftId: revisionId } as Prisma.InputJsonValue },
      });
      await tx.predictionReassessment.update({
        where: { predictionId }, data: {
          status: "CURRENT", publicHold: false,
          summary: "Administrator approved prose rewrite: " + note,
          proposedMarket: null, proposedSelection: Prisma.DbNull, proposedConfidence: null,
          checkedAt: new Date(), nextCheckAt: new Date(Date.now() + 3_600_000),
        },
      });
    });
    return NextResponse.json({ ok: true,
      message: "Approved rewrite published in the original record; selection, confidence and publication date preserved." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expected = new Set(["NO_ACTIVE_ADMIN_REVIEW", "KICKOFF_PASSED",
      "NO_CREDIBLE_REASSESSMENT_EVIDENCE", "REWRITE_NO_VALID_DRAFT",
      "REVIEW_CHANGED_DURING_REWRITE", "REWRITE_REVISION_REQUIRED",
      "REWRITE_DRAFT_STALE", "REWRITE_SELECTION_OR_EVIDENCE_CHANGED", "REWRITE_CONCURRENT_CHANGE",
      "ADMIN_AUTHORED_PICK", "DECISION_REQUIRED"]);
    if (expected.has(message))
      return NextResponse.json({ error: message }, { status: 409 });
    console.error("[admin-reassessment-rewrite]", error);
    return NextResponse.json({ error: "Unable to process admin rewrite" }, { status: 500 });
  }
}
