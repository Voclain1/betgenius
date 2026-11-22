/**
 * Admin-only historical evidence review. Read-mostly: the list is computed on
 * read; the two actions write ONLY private audit revisions and, for an
 * explicit "open private review", the admin-only reassessment row.
 *
 * Guarantees (asserted in scripts/check-evidence-review-postgres.ts):
 *  - No prediction field is written by anything here: selection, confidence,
 *    reasoning, status, publication time and categories are untouched.
 *  - Every revision is publiclyVisible=false; an opened review keeps
 *    publicHold=false, so no public page changes.
 *  - No API-Football request: only Prisma reads of saved snapshots, captured
 *    kickoffs and current team caches.
 * Rewrites and withdrawals stay in their existing guarded workflows
 * (/admin/reassessment for published picks; the prediction page for drafts).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStoredContext, parseStoredProvenance } from "@/lib/ai/context";
import { confirmFromTeamCaches, latestObservedMatch, type KnownKickoff } from "@/lib/ai/evidenceFreshness";
import type { TeamDigest } from "@/lib/ai/digest";
import {
  classifyHistoricalEvidence, playedBefore, CLASS_LABEL, CLASS_WARNING, FLAGGED_CLASSES,
  type HistoricalEvidence, type HistoricalEvidenceClass,
} from "@/lib/ai/historicalEvidence";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";

export const EVIDENCE_REVIEW_KINDS = ["EVIDENCE_REVIEW_RETAINED", "EVIDENCE_REVIEW_OPENED"] as const;
const MAX_ROWS = 500;

export const EVIDENCE_REVIEW_SELECT = {
  id: true, status: true, category: true, provenance: true, market: true, pick: true, marketType: true,
  confidence: true, reasoning: true, matchPreview: true, kickoff: true, publishedAt: true, createdAt: true,
  homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, leagueApiId: true, leagueName: true,
  contextComplete: true, aiJobId: true,
  categories: { select: { category: true } },
  aiJob: { select: { context: true, createdAt: true } },
  reassessment: { select: { status: true, publicHold: true } },
  revisions: {
    where: { kind: { in: [...EVIDENCE_REVIEW_KINDS] } },
    orderBy: { recordedAt: "desc" as const }, take: 1,
    select: { kind: true, reason: true, recordedAt: true },
  },
} satisfies Prisma.PredictionSelect;
const SELECT = EVIDENCE_REVIEW_SELECT;
export type EvidenceReviewRow = Prisma.PredictionGetPayload<{ select: typeof EVIDENCE_REVIEW_SELECT }>;
type Row = EvidenceReviewRow;

/** Kickoffs we captured for these teams in the window where a match could have been missed, resolved against current team caches. */
export async function loadKnownKickoffs(rows: Row[]): Promise<KnownKickoff[]> {
  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamApiId, r.awayTeamApiId]).filter((x): x is number => x != null))];
  const asOfs: number[] = [];
  const gens: number[] = [];
  for (const r of rows) {
    const d = parseStoredContext(r.aiJob?.context);
    if (!d || !r.aiJob) continue;
    for (const t of [d.teams.home, d.teams.away]) { const at = latestObservedMatch(t); if (at) asOfs.push(at.getTime()); }
    gens.push(r.aiJob.createdAt.getTime());
  }
  if (!teamIds.length || !asOfs.length || !gens.length) return [];
  const from = new Date(Math.min(...asOfs));
  const until = playedBefore(new Date(Math.max(...gens)));
  if (until <= from) return [];
  const fixtures = await prisma.upcomingFixture.findMany({
    where: { kickoff: { gt: from, lte: until }, OR: [{ homeTeamApiId: { in: teamIds } }, { awayTeamApiId: { in: teamIds } }] },
    select: { homeTeamApiId: true, awayTeamApiId: true, kickoff: true, status: true },
  });
  const known: KnownKickoff[] = fixtures.flatMap((f) => [
    { teamApiId: f.homeTeamApiId, opponentApiId: f.awayTeamApiId, kickoff: f.kickoff, status: f.status },
    { teamApiId: f.awayTeamApiId, opponentApiId: f.homeTeamApiId, kickoff: f.kickoff, status: f.status },
  ]).filter((k) => teamIds.includes(k.teamApiId));
  if (!known.length) return known;
  const sides = [...new Set(known.flatMap((k) => [k.teamApiId, k.opponentApiId!]))];
  const caches = await prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: sides } }, select: { teamApiId: true, teamDigestJson: true } });
  return confirmFromTeamCaches(known, new Map(caches.map((c) => [c.teamApiId,
    ((c.teamDigestJson as unknown as TeamDigest | null)?.last5 ?? []).map((m) => ({ date: m.date, opponentApiId: m.opponentApiId ?? null }))])));
}

export function classifyRow(row: Pick<Row, "aiJobId" | "aiJob" | "contextComplete">, known: readonly KnownKickoff[]): HistoricalEvidence {
  return classifyHistoricalEvidence({
    hasAiJob: !!row.aiJobId && !!row.aiJob,
    digest: parseStoredContext(row.aiJob?.context),
    provenance: parseStoredProvenance(row.aiJob?.context),
    contextComplete: row.contextComplete,
    generatedAt: row.aiJob?.createdAt ?? null,
    known,
  });
}

export type ReviewFilters = {
  classes?: HistoricalEvidenceClass[];
  statuses?: string[];
  paid?: "paid" | "free" | "all";
  from?: Date; to?: Date;
  reviewed?: "unreviewed" | "reviewed" | "all";
  timing?: "upcoming" | "past" | "all";
};

export type ReviewItem = {
  id: string; fixture: string; league: string | null; status: string; categories: string[]; paid: boolean;
  market: string; pick: string; confidence: number; reasoning: string; matchPreview: string | null;
  kickoff: string | null; publishedAt: string | null; upcoming: boolean;
  classification: HistoricalEvidenceClass; label: string; warning: string | null;
  evidence: HistoricalEvidence;
  review: { kind: string; reason: string; at: string } | null;
  reassessment: { status: string; publicHold: boolean } | null;
  actions: { retain: boolean; openPrivateReview: boolean; rewriteDraft: boolean; reviewPage: boolean };
};

export async function listEvidenceReview(filters: ReviewFilters = {}, now: Date = new Date()): Promise<{ items: ReviewItem[]; counts: Record<string, number>; scanned: number; truncated: boolean }> {
  const kickoff: Prisma.DateTimeNullableFilter = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lt: filters.to } : {}),
    ...(filters.timing === "upcoming" ? { gt: now } : filters.timing === "past" ? { lte: now } : {}),
  };
  const where: Prisma.PredictionWhereInput = {
    aiJobId: { not: null },
    ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}),
    ...(Object.keys(kickoff).length ? { kickoff } : {}),
  };
  const rows = await prisma.prediction.findMany({ where, select: SELECT, orderBy: [{ kickoff: "desc" }, { id: "asc" }], take: MAX_ROWS + 1 });
  const truncated = rows.length > MAX_ROWS;
  const page = rows.slice(0, MAX_ROWS);
  const known = await loadKnownKickoffs(page);
  const counts: Record<string, number> = {};
  const items: ReviewItem[] = [];
  for (const r of page) {
    const evidence = classifyRow(r, known);
    counts[evidence.classification] = (counts[evidence.classification] ?? 0) + 1;
    const categories = r.categories.map((c) => c.category);
    const paid = isPaidOnlyProvenance(r.provenance) || categories.some((c) => c === "VIP" || c === "PREMIUM");
    const review = r.revisions[0] ? { kind: r.revisions[0].kind, reason: r.revisions[0].reason, at: r.revisions[0].recordedAt.toISOString() } : null;
    if (filters.classes?.length && !filters.classes.includes(evidence.classification)) continue;
    if (!filters.classes?.length && !FLAGGED_CLASSES.includes(evidence.classification)) continue;
    if (filters.paid === "paid" && !paid) continue;
    if (filters.paid === "free" && paid) continue;
    if (filters.reviewed === "unreviewed" && review) continue;
    if (filters.reviewed === "reviewed" && !review) continue;
    const upcoming = !!r.kickoff && r.kickoff > now;
    const published = r.status === "PUBLISHED" && !!r.publishedAt;
    items.push({
      id: r.id, fixture: [r.homeTeam, r.awayTeam].filter(Boolean).join(" vs ") || "Unknown fixture",
      league: r.leagueName, status: r.status, categories, paid,
      market: r.market, pick: r.pick, confidence: r.confidence, reasoning: r.reasoning, matchPreview: r.matchPreview,
      kickoff: r.kickoff?.toISOString() ?? null, publishedAt: r.publishedAt?.toISOString() ?? null, upcoming,
      classification: evidence.classification, label: CLASS_LABEL[evidence.classification], warning: CLASS_WARNING[evidence.classification],
      evidence, review,
      reassessment: r.reassessment ? { status: r.reassessment.status, publicHold: r.reassessment.publicHold } : null,
      actions: {
        retain: true,
        // Published picks before kickoff only: settled picks are never rewritten or withdrawn after the fact.
        openPrivateReview: published && upcoming && r.reassessment?.status !== "REVIEW_REQUIRED",
        rewriteDraft: r.status === "PENDING_REVIEW",
        reviewPage: published && r.reassessment?.status === "REVIEW_REQUIRED",
      },
    });
  }
  return { items, counts, scanned: page.length, truncated };
}

/** One prediction's classification, for the admin detail page. Null when the prediction does not exist. */
export async function historicalEvidenceFor(predictionId: string): Promise<(HistoricalEvidence & { label: string; warning: string | null; review: ReviewItem["review"] }) | null> {
  const row = await prisma.prediction.findUnique({ where: { id: predictionId }, select: SELECT });
  if (!row) return null;
  const evidence = classifyRow(row, await loadKnownKickoffs([row]));
  const r = row.revisions[0];
  return { ...evidence, label: CLASS_LABEL[evidence.classification], warning: CLASS_WARNING[evidence.classification],
    review: r ? { kind: r.kind, reason: r.reason, at: r.recordedAt.toISOString() } : null };
}

export class EvidenceReviewError extends Error {
  constructor(public code: string) { super(code); this.name = "EvidenceReviewError"; }
}

/**
 * RETAIN: record that an administrator reviewed the flag and kept the
 * prediction exactly as it is. OPEN_PRIVATE_REVIEW: hand a published,
 * not-yet-started pick to the existing reassessment workflow (rewrite
 * preview/approval, keep, withdraw), privately (publicHold stays false).
 */
export async function applyEvidenceReviewAction(input: {
  predictionId: string; action: "RETAIN" | "OPEN_PRIVATE_REVIEW"; note: string; now?: Date;
}): Promise<{ ok: true; revisionId: string; classification: HistoricalEvidenceClass }> {
  const now = input.now ?? new Date();
  const row = await prisma.prediction.findUnique({ where: { id: input.predictionId }, select: SELECT });
  if (!row) throw new EvidenceReviewError("NOT_FOUND");
  const evidence = classifyRow(row, await loadKnownKickoffs([row]));
  if (evidence.classification === "NOT_GENERATED") throw new EvidenceReviewError("NOT_GENERATED");
  const snapshot = {
    status: row.status, market: row.market, pick: row.pick, confidence: row.confidence,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    classification: evidence.classification, reasons: evidence.reasons.map((r) => r.code),
  };

  if (input.action === "RETAIN") {
    const rev = await prisma.predictionRevision.create({
      data: { predictionId: row.id, kind: "EVIDENCE_REVIEW_RETAINED", publiclyVisible: false,
        reason: input.note.slice(0, 400), beforeJson: snapshot as Prisma.InputJsonValue },
    });
    return { ok: true, revisionId: rev.id, classification: evidence.classification };
  }

  if (row.status !== "PUBLISHED" || !row.publishedAt) throw new EvidenceReviewError("NOT_PUBLISHED");
  if (!row.kickoff || row.kickoff <= now) throw new EvidenceReviewError("KICKOFF_PASSED");
  if (row.reassessment?.status === "REVIEW_REQUIRED") throw new EvidenceReviewError("REVIEW_ALREADY_OPEN");
  const digest = parseStoredContext(row.aiJob?.context);
  // The rewrite workflow drafts from reassessment.lastEvidence. Seed it with
  // the saved generation snapshot only when that snapshot is credible and no
  // monitoring snapshot exists; the reassessment worker replaces it with a
  // newer one (and invalidates any draft) as soon as it next checks.
  const credible = !!digest && digest.coverage.stats && digest.coverage.form && !!digest.teams.home.overall && !!digest.teams.away.overall;
  const rev = await prisma.$transaction(async (tx) => {
    const current = await tx.predictionReassessment.findUnique({ where: { predictionId: row.id } });
    if (current?.status === "REVIEW_REQUIRED") throw new EvidenceReviewError("REVIEW_ALREADY_OPEN");
    const summary = ("Evidence review (" + CLASS_LABEL[evidence.classification] + "): " + input.note).slice(0, 500);
    const seed = !current?.lastEvidence && credible
      ? { lastEvidence: row.aiJob!.context as Prisma.InputJsonValue, lastEvidenceAt: row.aiJob!.createdAt, lastChangeHash: "evidence-review:" + row.aiJobId }
      : {};
    await tx.predictionReassessment.upsert({
      where: { predictionId: row.id },
      create: { predictionId: row.id, status: "REVIEW_REQUIRED", publicHold: false, checkedAt: now, summary, ...seed },
      update: { status: "REVIEW_REQUIRED", publicHold: false, checkedAt: now, summary, ...seed },
    });
    return tx.predictionRevision.create({
      data: { predictionId: row.id, kind: "EVIDENCE_REVIEW_OPENED", publiclyVisible: false,
        reason: input.note.slice(0, 400), beforeJson: snapshot as Prisma.InputJsonValue,
        afterJson: { reassessment: "REVIEW_REQUIRED", publicHold: false, seededFromGeneration: "lastEvidence" in seed } as Prisma.InputJsonValue },
    });
  });
  return { ok: true, revisionId: rev.id, classification: evidence.classification };
}
