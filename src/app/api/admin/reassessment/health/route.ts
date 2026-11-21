import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Read-only operational overview. Does not trigger generation or API calls. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 86_400_000);
  const [fixtures, pending, publicationCases, flagged, withdrawn, scheduled, historicalWithdrawals] = await Promise.all([
    prisma.upcomingFixture.count({ where: { kickoff: { gt: now, lte: horizon }, status: "NS" } }),
    prisma.generationAttempt.count({ where: { kickoff: { gt: now, lte: horizon }, status: "PENDING" } }),
    prisma.prediction.count({ where: { status: "PENDING_REVIEW", kickoff: { gt: now, lte: horizon } } }),
    prisma.predictionReassessment.findMany({
      where: { status: "REVIEW_REQUIRED", prediction: { status: "PUBLISHED" } },
      include: { prediction: { select: { id: true, homeTeam: true, awayTeam: true, pick: true,
        kickoff: true, confidence: true, provenance: true, status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.predictionReassessment.count({ where: { status: "WITHDRAWN", checkedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    prisma.predictionReassessment.count({ where: { nextCheckAt: { lte: now }, prediction: { status: "PUBLISHED", kickoff: { gt: now } } } }),
    // Historical automatic withdrawals from the previous worker remain
    // recoverable; never auto-restore records manually removed by an admin.
    prisma.predictionRevision.findMany({
      where: { kind: "WITHDRAWN", prediction: { status: "ARCHIVED", publishedAt: { not: null } } },
      orderBy: { recordedAt: "desc" }, take: 50,
      include: { prediction: { select: { id: true, homeTeam: true, awayTeam: true,
        pick: true, confidence: true, kickoff: true, publishedAt: true } } },
    }),
  ]);
  return NextResponse.json({
    now: now.toISOString(), fixtures, queuedGeneration: pending, awaitingPublication: publicationCases,
    reviewRequired: flagged.length, recentlyWithdrawn: withdrawn, monitoringDue: scheduled,
    // Only worker-created fixture-withdrawal receipts carry evidenceJson
    // signals. Admin withdrawals deliberately have no evidence payload.
    autoWithdrawn: historicalWithdrawals.filter(r =>
      Array.isArray(r.evidenceJson) &&
      r.evidenceJson.some(signal => !!signal && typeof signal === "object" &&
        (signal as { source?: string }).source === "fixture"))
      .map(r => ({
        id: r.prediction.id,
        fixture: [r.prediction.homeTeam, r.prediction.awayTeam].join(" vs "),
        pick: r.prediction.pick, confidence: r.prediction.confidence,
        kickoff: r.prediction.kickoff, publishedAt: r.prediction.publishedAt,
        archivedAt: r.recordedAt,
      })),
    flagged: flagged.map(({ prediction, ...r }) => ({
      id: prediction.id, fixture: [prediction.homeTeam, prediction.awayTeam].join(" vs "),
      kickoff: prediction.kickoff, pick: prediction.pick, confidence: prediction.confidence,
      provenance: prediction.provenance, predictionStatus: prediction.status,
      reason: r.summary, checkedAt: r.checkedAt, proposedMarket: r.proposedMarket,
      proposedConfidence: r.proposedConfidence,
    })),
  });
}
