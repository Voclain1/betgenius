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
/** Rows examined per database batch while paging or summarising. */
const BATCH = 250;
/** A page request examines at most this many rows before returning a cursor (bounded request time). */
export const PAGE_SCAN_BUDGET = 2_000;
/** A summary covers at most this many rows; beyond it the result says so (`complete: false`). */
export const SUMMARY_ROW_LIMIT = 20_000;

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

/**
 * Scope of the review. Two independent date dimensions, never conflated:
 *  - creation (Prediction.createdAt): `lookbackDays` uses EXACTLY the
 *    predicate of `npm run diagnose:missing-evidence -- --days=N`
 *    (createdAt >= now − N days, generated rows), so the two reconcile;
 *    `createdFrom/createdTo` give an explicit window.
 *  - kickoff: `kickoffFrom/kickoffTo` and `timing`.
 */
export type ReviewFilters = {
  classes?: HistoricalEvidenceClass[];
  statuses?: string[];
  paid?: "paid" | "free" | "all";
  reviewed?: "unreviewed" | "reviewed" | "all";
  timing?: "upcoming" | "past" | "all";
  kickoffFrom?: Date; kickoffTo?: Date;
  createdFrom?: Date; createdTo?: Date;
  lookbackDays?: number;
};

export type ReviewItem = {
  id: string; fixture: string; league: string | null; status: string; categories: string[]; paid: boolean;
  market: string; pick: string; confidence: number; reasoning: string; matchPreview: string | null;
  kickoff: string | null; publishedAt: string | null; createdAt: string; upcoming: boolean;
  classification: HistoricalEvidenceClass; label: string; warning: string | null;
  evidence: HistoricalEvidence;
  review: { kind: string; reason: string; at: string } | null;
  reassessment: { status: string; publicHold: boolean } | null;
  actions: { retain: boolean; openPrivateReview: boolean; rewriteDraft: boolean; reviewPage: boolean };
};

/** The database-side scope (everything except the classification, tier and review-state filters, which need the row). */
export function reviewScopeWhere(f: ReviewFilters, now: Date): Prisma.PredictionWhereInput {
  const kickoff: Prisma.DateTimeNullableFilter = {
    ...(f.kickoffFrom ? { gte: f.kickoffFrom } : {}),
    ...(f.kickoffTo ? { lt: f.kickoffTo } : {}),
    ...(f.timing === "upcoming" ? { gt: now } : f.timing === "past" ? { lte: now } : {}),
  };
  const created: Prisma.DateTimeFilter = {
    ...(f.lookbackDays && f.lookbackDays > 0 ? { gte: new Date(now.getTime() - f.lookbackDays * 24 * 3_600_000) } : {}),
    ...(f.createdFrom ? { gte: f.createdFrom } : {}),
    ...(f.createdTo ? { lt: f.createdTo } : {}),
  };
  return {
    aiJobId: { not: null },
    ...(f.statuses?.length ? { status: { in: f.statuses } } : {}),
    ...(Object.keys(kickoff).length ? { kickoff } : {}),
    ...(Object.keys(created).length ? { createdAt: created } : {}),
  };
}

/** Opaque keyset cursor: the last row examined, in (createdAt desc, id desc) order. */
type Cursor = { c: string; i: string };
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id } satisfies Cursor)).toString("base64url");
}
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    return typeof v?.c === "string" && Number.isFinite(Date.parse(v.c)) && typeof v.i === "string" && v.i.length <= 128 ? v : null;
  } catch { return null; }
}
function afterCursor(c: Cursor | null): Prisma.PredictionWhereInput {
  if (!c) return {};
  const at = new Date(c.c);
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: c.i } }] };
}

const isPaid = (r: Row) => isPaidOnlyProvenance(r.provenance) || r.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM");
const reviewOf = (r: Row) => r.revisions[0] ? { kind: r.revisions[0].kind, reason: r.revisions[0].reason, at: r.revisions[0].recordedAt.toISOString() } : null;

/** Row-level filters other than classification (tier, review state). */
function passesRowFilters(r: Row, f: ReviewFilters): boolean {
  const paid = isPaid(r);
  if (f.paid === "paid" && !paid) return false;
  if (f.paid === "free" && paid) return false;
  const reviewed = r.revisions.length > 0;
  if (f.reviewed === "unreviewed" && reviewed) return false;
  if (f.reviewed === "reviewed" && !reviewed) return false;
  return true;
}
function passesClass(cls: HistoricalEvidenceClass, f: ReviewFilters): boolean {
  return f.classes?.length ? f.classes.includes(cls) : FLAGGED_CLASSES.includes(cls);
}

function toItem(r: Row, evidence: HistoricalEvidence, now: Date): ReviewItem {
  const upcoming = !!r.kickoff && r.kickoff > now;
  const published = r.status === "PUBLISHED" && !!r.publishedAt;
  return {
    id: r.id, fixture: [r.homeTeam, r.awayTeam].filter(Boolean).join(" vs ") || "Unknown fixture",
    league: r.leagueName, status: r.status, categories: r.categories.map((c) => c.category), paid: isPaid(r),
    market: r.market, pick: r.pick, confidence: r.confidence, reasoning: r.reasoning, matchPreview: r.matchPreview,
    kickoff: r.kickoff?.toISOString() ?? null, publishedAt: r.publishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), upcoming,
    classification: evidence.classification, label: CLASS_LABEL[evidence.classification], warning: CLASS_WARNING[evidence.classification],
    evidence, review: reviewOf(r),
    reassessment: r.reassessment ? { status: r.reassessment.status, publicHold: r.reassessment.publicHold } : null,
    actions: {
      retain: true,
      // Published picks before kickoff only: settled picks are never rewritten or withdrawn after the fact.
      openPrivateReview: published && upcoming && r.reassessment?.status !== "REVIEW_REQUIRED",
      rewriteDraft: r.status === "PENDING_REVIEW",
      reviewPage: published && r.reassessment?.status === "REVIEW_REQUIRED",
    },
  };
}

/**
 * One page of matching predictions, newest generation first, across the
 * WHOLE matching population (no recency cap). Classification is computed per
 * row, so the page walks the scope in batches until it has `pageSize`
 * matches, the scope is exhausted, or PAGE_SCAN_BUDGET rows were examined.
 * `nextCursor` is the last row EXAMINED, so following it never skips or
 * repeats a row. `exhausted: true` means there is nothing after this page.
 */
export async function listEvidenceReviewPage(
  filters: ReviewFilters = {},
  opts: { cursor?: string | null; pageSize?: number; now?: Date; scanBudget?: number } = {},
): Promise<{ items: ReviewItem[]; nextCursor: string | null; exhausted: boolean; examined: number }> {
  const now = opts.now ?? new Date();
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize ?? 25)));
  const budget = Math.max(BATCH, opts.scanBudget ?? PAGE_SCAN_BUDGET);
  const scope = reviewScopeWhere(filters, now);
  let cursor = decodeCursor(opts.cursor);
  const items: ReviewItem[] = [];
  let examined = 0;
  for (;;) {
    const rows = await prisma.prediction.findMany({
      where: { AND: [scope, afterCursor(cursor)] }, select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: BATCH,
    });
    if (!rows.length) return { items, nextCursor: null, exhausted: true, examined };
    const known = await loadKnownKickoffs(rows);
    for (const r of rows) {
      examined++;
      cursor = { c: r.createdAt.toISOString(), i: r.id };
      if (passesRowFilters(r, filters)) {
        const evidence = classifyRow(r, known);
        if (passesClass(evidence.classification, filters)) items.push(toItem(r, evidence, now));
      }
      if (items.length >= pageSize || examined >= budget) {
        return { items, nextCursor: encodeCursor({ createdAt: new Date(cursor.c), id: cursor.i }), exhausted: false, examined };
      }
    }
    if (rows.length < BATCH) return { items, nextCursor: null, exhausted: true, examined };
  }
}

/**
 * Counts across the ENTIRE matching scope (same filters as the list, every
 * class), for honest totals. Bounded at SUMMARY_ROW_LIMIT rows: beyond that
 * `complete` is false and the admin is told to narrow the dates.
 */
export async function summarizeEvidenceReview(
  filters: ReviewFilters = {},
  opts: { now?: Date; rowLimit?: number } = {},
): Promise<{ byClass: Record<string, number>; matching: number; generatedInScope: number; complete: boolean }> {
  const now = opts.now ?? new Date();
  const limit = opts.rowLimit ?? SUMMARY_ROW_LIMIT;
  const scope = reviewScopeWhere(filters, now);
  const byClass: Record<string, number> = {};
  let matching = 0, generatedInScope = 0;
  let cursor: Cursor | null = null;
  for (;;) {
    const rows: Row[] = await prisma.prediction.findMany({
      where: { AND: [scope, afterCursor(cursor)] }, select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: BATCH,
    });
    if (!rows.length) return { byClass, matching, generatedInScope, complete: true };
    const known = await loadKnownKickoffs(rows);
    for (const r of rows) {
      generatedInScope++;
      cursor = { c: r.createdAt.toISOString(), i: r.id };
      if (!passesRowFilters(r, filters)) continue;
      const cls = classifyRow(r, known).classification;
      byClass[cls] = (byClass[cls] ?? 0) + 1;
      if (passesClass(cls, filters)) matching++;
      if (generatedInScope >= limit) return { byClass, matching, generatedInScope, complete: false };
    }
    if (rows.length < BATCH) return { byClass, matching, generatedInScope, complete: true };
  }
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
