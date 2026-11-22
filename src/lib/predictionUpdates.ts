/**
 * Admin Prediction Updates workspace (issue #232): one queue for new evidence
 * on existing predictions, with what changed, the prediction as readers see
 * it, any private draft, and the decision state.
 *
 * Read-only. Cards are built from saved snapshots (the generation snapshot a
 * pick was written from, the latest monitoring snapshot) and the append-only
 * revision trail. No provider request; no prediction write. Decisions go
 * through the existing guarded routes:
 *   /api/admin/reassessment/rewrite (private draft, then explicit approval),
 *   /api/admin/reassessment/resolve (keep / withdraw / qualified replacement).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStoredContext } from "@/lib/ai/context";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { evidenceSnapshotHash } from "@/lib/reassessment/snapshotHash";
import {
  adminStatus, decisionRequired, diffEvidence, friendlyReason, possiblyStaleStatements, suggestedAuditNote,
  type AdminStatus, type EvidenceDiff, type Signal,
} from "@/lib/reassessment/evidenceDiff";

export type UpdatesTab = "new" | "needs" | "reviewed";
/**
 * Completed decisions only. Opening a private review (EVIDENCE_REVIEW_OPENED)
 * is activity on a case that is still open, not a decision, so it never
 * appears under Reviewed.
 */
export const DECISION_KINDS = ["CONFIRMED", "ADMIN_REWRITE_APPLIED", "WITHDRAWN", "ADMIN_RESTORED", "EVIDENCE_REVIEW_RETAINED"] as const;

export type UpdatesFilters = { tier?: "paid" | "free" | "all"; statuses?: string[]; kickoffFrom?: Date; kickoffTo?: Date };

const paidOf = (p: { provenance: string; categories: Array<{ category: string }> }) =>
  isPaidOnlyProvenance(p.provenance) || p.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM");

/** Sort key: upcoming first; then published paid, unpublished, published free; then soonest kickoff; then id. */
export function priorityKey(p: { id: string; status: string; kickoff: Date | null; provenance: string; categories: Array<{ category: string }> }, now: Date): [number, number, number, string] {
  const upcoming = !!p.kickoff && p.kickoff > now;
  const published = p.status === "PUBLISHED";
  const group = published && paidOf(p) ? 0 : !published ? 1 : 2;
  // Upcoming: soonest first. Started: most recent first.
  const t = p.kickoff ? (upcoming ? p.kickoff.getTime() : -p.kickoff.getTime()) : Number.MAX_SAFE_INTEGER;
  return [upcoming ? 0 : 1, group, t, p.id];
}
export function compareKeys(a: [number, number, number, string], b: [number, number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);
}
const encode = (k: unknown) => Buffer.from(JSON.stringify(k)).toString("base64url");
function decodeKey(raw: string | null | undefined): [number, number, number, string] | null {
  if (!raw) return null;
  try {
    const k = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(k) && k.length === 4 && k.slice(0, 3).every((n) => typeof n === "number") && typeof k[3] === "string" ? k as [number, number, number, string] : null;
  } catch { return null; }
}

const CARD_SELECT = {
  id: true, status: true, provenance: true, market: true, pick: true, marketType: true, selection: true, confidence: true, odds: true,
  reasoning: true, matchPreview: true, kickoff: true, publishedAt: true, createdAt: true, homeTeam: true, awayTeam: true,
  leagueName: true, aiJobId: true,
  categories: { select: { category: true } },
  aiJob: { select: { context: true, createdAt: true } },
  reassessment: { select: { status: true, summary: true, checkedAt: true, lastEvidence: true, lastEvidenceAt: true, lastChangeHash: true, lastError: true } },
  revisions: {
    where: { kind: { in: ["REVIEW_REQUIRED", "ADMIN_REWRITE_DRAFT", ...DECISION_KINDS] } },
    orderBy: [{ recordedAt: "desc" as const }, { id: "desc" as const }], take: 20,
    select: { id: true, kind: true, reason: true, recordedAt: true, afterJson: true, evidenceJson: true },
  },
} satisfies Prisma.PredictionSelect;
type CardRow = Prisma.PredictionGetPayload<{ select: typeof CARD_SELECT }>;

export type UpdateCard = {
  id: string; fixture: string; league: string | null; kickoff: string | null; status: string; categories: string[]; paid: boolean;
  adminAuthored: boolean; upcoming: boolean;
  current: { market: string; pick: string; confidence: number; odds: number | null; publishedAt: string | null; provenance: string; reasoning: string; matchPreview: string | null };
  adminStatus: AdminStatus;
  reasons: string[];
  signals: Signal[];
  summary: string | null;
  lastChecked: string | null;
  snapshot: { originalAt: string | null; latestAt: string | null; source: "monitoring snapshot" | "none" };
  /** The latest monitoring check could not load current evidence (refresh failed); the open case is kept. */
  latestEvidenceUnavailable: boolean;
  diff: EvidenceDiff | null;
  possiblyStale: string[];
  draft: { revisionId: string; reasoning: string; matchPreview: string; confidence: number; sameSelection: boolean; stale: boolean; at: string } | null;
  decision: { required: boolean; reasons: string[] };
  latestDecision: { kind: string; reason: string; at: string } | null;
  suggestedNotes: { update: string; keep: string };
  actions: { reviewUpdate: boolean; approve: boolean; keep: boolean; withdraw: boolean; replace: boolean; editDraft: boolean };
};

function signalsOf(row: CardRow): Signal[] {
  const rev = row.revisions.find((r) => r.kind === "REVIEW_REQUIRED");
  const raw = rev?.evidenceJson;
  if (Array.isArray(raw)) return (raw as Signal[]).filter((s) => s && typeof s.code === "string");
  return row.reassessment?.summary && row.reassessment.status === "REVIEW_REQUIRED"
    ? [{ code: "evidence-changed", severity: "MODERATE", source: "monitoring", message: row.reassessment.summary }] : [];
}

export function buildCard(row: CardRow, now: Date): UpdateCard {
  const signals = signalsOf(row);
  const upcoming = !!row.kickoff && row.kickoff > now;
  const reviewRev = row.revisions.find((r) => r.kind === "REVIEW_REQUIRED");
  const draftRev = row.revisions.find((r) => r.kind === "ADMIN_REWRITE_DRAFT");
  // A draft only counts for the CURRENT review case: newer than the latest flag.
  const draftJson = draftRev && (!reviewRev || draftRev.recordedAt >= reviewRev.recordedAt)
    ? draftRev.afterJson as { reasoning?: string; matchPreview?: string; confidence?: number; sameSelection?: boolean; evidenceHash?: string | null; evidenceSnapshotHash?: string | null } | null : null;
  const draft = draftRev && draftJson && typeof draftJson.reasoning === "string" ? {
    revisionId: draftRev.id, reasoning: draftJson.reasoning, matchPreview: draftJson.matchPreview ?? "",
    confidence: Number(draftJson.confidence), sameSelection: !!draftJson.sameSelection,
    // Stale when the alert signature OR the exact saved snapshot moved on
    // (the same rule the apply route enforces).
    stale: (draftJson.evidenceHash ?? null) !== (row.reassessment?.lastChangeHash ?? null)
      || !draftJson.evidenceSnapshotHash || draftJson.evidenceSnapshotHash !== evidenceSnapshotHash(row.reassessment?.lastEvidence),
    at: draftRev.recordedAt.toISOString(),
  } : null;
  const decision = decisionRequired({ signals, originalConfidence: row.confidence, draft: draft && !draft.stale ? draft : null });
  const decisionRev = row.revisions.find((r) => (DECISION_KINDS as readonly string[]).includes(r.kind));
  const latestDecision = decisionRev ? { kind: decisionRev.kind, reason: decisionRev.reason, at: decisionRev.recordedAt.toISOString() } : null;
  const original = parseStoredContext(row.aiJob?.context);
  const latest = parseStoredContext(row.reassessment?.lastEvidence);
  const diff = diffEvidence(original, latest);
  const published = row.status === "PUBLISHED" && !!row.publishedAt;
  const open = row.reassessment?.status === "REVIEW_REQUIRED";
  const adminAuthored = !row.aiJobId;
  const status = adminStatus({ kickoffPassed: !upcoming, reassessmentStatus: row.reassessment?.status ?? null,
    latestDecisionKind: latestDecision?.kind ?? null, draftReady: !!draft && !draft.stale, decisionRequired: decision.required });
  const categories = row.categories.map((c) => c.category);
  const paid = paidOf(row);
  return {
    id: row.id, fixture: [row.homeTeam, row.awayTeam].filter(Boolean).join(" vs ") || "Unknown fixture",
    league: row.leagueName, kickoff: row.kickoff?.toISOString() ?? null, status: row.status, categories, paid, adminAuthored, upcoming,
    current: { market: row.market, pick: row.pick, confidence: row.confidence, odds: row.odds, publishedAt: row.publishedAt?.toISOString() ?? null,
      provenance: row.provenance, reasoning: row.reasoning, matchPreview: row.matchPreview },
    adminStatus: status,
    reasons: [...new Set(signals.map((s) => friendlyReason(s.code)))],
    signals, summary: row.reassessment?.summary ?? null,
    lastChecked: row.reassessment?.checkedAt?.toISOString() ?? null,
    snapshot: { originalAt: row.aiJob?.createdAt.toISOString() ?? null, latestAt: row.reassessment?.lastEvidenceAt?.toISOString() ?? null,
      source: latest ? "monitoring snapshot" : "none" },
    // The latest check could not load current team evidence or confirm the fixture state.
    latestEvidenceUnavailable: row.reassessment?.lastError === "LATEST_EVIDENCE_UNAVAILABLE" || row.reassessment?.lastError === "FIXTURE_STATE_UNAVAILABLE",
    diff, possiblyStale: possiblyStaleStatements([row.matchPreview, row.reasoning].filter(Boolean).join("\n"), diff, signals),
    draft, decision, latestDecision,
    suggestedNotes: { update: suggestedAuditNote(signals, "update"), keep: suggestedAuditNote(signals, "keep") },
    actions: {
      // Explanation-only updates: published, before kickoff, open case, a
      // generated (not admin-authored) pick, and nothing undermining it.
      reviewUpdate: published && upcoming && open && !adminAuthored && !signals.some((s) => s.severity === "CRITICAL"),
      approve: published && upcoming && open && !adminAuthored && !!draft && !draft.stale && !decision.required,
      keep: published && upcoming && open,
      withdraw: published && upcoming && open,
      // Existing qualified replacement: free picks only (paid replacement stays behind the paid gate).
      replace: published && upcoming && open && !paid && decision.required,
      editDraft: !published && upcoming && row.status === "PENDING_REVIEW",
    },
  };
}

type Light = { id: string; status: string; kickoff: Date | null; provenance: string; categories: Array<{ category: string }> };
function passes(p: Light, f: UpdatesFilters): boolean {
  const paid = paidOf(p);
  if (f.tier === "paid" && !paid) return false;
  if (f.tier === "free" && paid) return false;
  if (f.statuses?.length && !f.statuses.includes(p.status)) return false;
  if (f.kickoffFrom && (!p.kickoff || p.kickoff < f.kickoffFrom)) return false;
  if (f.kickoffTo && (!p.kickoff || p.kickoff >= f.kickoffTo)) return false;
  return true;
}

/**
 * One page of a monitoring-based tab ("new" = REVIEW_REQUIRED, "needs" =
 * UNKNOWN), across the WHOLE population, in priority order. A light query
 * orders every case; full cards load for the page only. The cursor is the
 * last card's sort key, so a new flag arriving between pages never causes a
 * skip or a repeat.
 */
export async function listCasePage(tab: "new" | "needs", filters: UpdatesFilters = {}, opts: { cursor?: string | null; pageSize?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize ?? 20)));
  const status = tab === "new" ? "REVIEW_REQUIRED" : "UNKNOWN";
  const cases = await prisma.predictionReassessment.findMany({
    where: { status, ...(tab === "needs" ? { prediction: { kickoff: { gt: now } } } : {}) },
    select: { prediction: { select: { id: true, status: true, kickoff: true, provenance: true, categories: { select: { category: true } } } } },
  });
  const keyed = cases.map((c) => c.prediction).filter((p) => passes(p, filters))
    .map((p) => ({ p, key: priorityKey(p, now) })).sort((a, b) => compareKeys(a.key, b.key));
  const after = decodeKey(opts.cursor);
  const rest = after ? keyed.filter((k) => compareKeys(k.key, after) > 0) : keyed;
  const page = rest.slice(0, pageSize);
  const rows = page.length ? await prisma.prediction.findMany({ where: { id: { in: page.map((k) => k.p.id) } }, select: CARD_SELECT }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cards = page.map((k) => byId.get(k.p.id)).filter((r): r is CardRow => !!r).map((r) => buildCard(r, now));
  return { cards, total: keyed.length, nextCursor: rest.length > pageSize ? encode(page[page.length - 1].key) : null };
}

/** The decision trail, newest first, with a (recordedAt, id) keyset cursor. */
export async function listReviewedPage(opts: { cursor?: string | null; pageSize?: number } = {}) {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize ?? 20)));
  let after: { at: string; id: string } | null = null;
  try { after = opts.cursor ? JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8")) : null; } catch { after = null; }
  const rows = await prisma.predictionRevision.findMany({
    where: { kind: { in: [...DECISION_KINDS] },
      ...(after && typeof after.at === "string" ? { OR: [{ recordedAt: { lt: new Date(after.at) } }, { recordedAt: new Date(after.at), id: { lt: after.id } }] } : {}) },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: pageSize + 1,
    select: { id: true, kind: true, reason: true, recordedAt: true,
      prediction: { select: { id: true, homeTeam: true, awayTeam: true, kickoff: true, status: true, market: true, pick: true, confidence: true } } },
  });
  const page = rows.slice(0, pageSize);
  return {
    items: page.map((r) => ({ revisionId: r.id, kind: r.kind, reason: r.reason, at: r.recordedAt.toISOString(),
      predictionId: r.prediction.id, fixture: [r.prediction.homeTeam, r.prediction.awayTeam].filter(Boolean).join(" vs "),
      kickoff: r.prediction.kickoff?.toISOString() ?? null, status: r.prediction.status,
      pick: `${r.prediction.market}: ${r.prediction.pick}`, confidence: r.prediction.confidence })),
    nextCursor: rows.length > pageSize ? encode({ at: page[page.length - 1].recordedAt.toISOString(), id: page[page.length - 1].id }) : null,
  };
}

/** Header counts: exact, over the whole population. */
export async function updatesCounts(now: Date = new Date()) {
  const open = await prisma.predictionReassessment.findMany({
    where: { status: "REVIEW_REQUIRED" },
    select: { prediction: { select: { kickoff: true, revisions: { where: { kind: "REVIEW_REQUIRED" }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1, select: { evidenceJson: true } } } } },
  });
  const upcomingOpen = open.filter((o) => o.prediction.kickoff && o.prediction.kickoff > now);
  const awaitingDecision = upcomingOpen.filter((o) => {
    const ev = o.prediction.revisions[0]?.evidenceJson;
    return Array.isArray(ev) && (ev as Signal[]).some((s) => s?.severity === "CRITICAL");
  }).length;
  const needsMoreEvidence = await prisma.predictionReassessment.count({ where: { status: "UNKNOWN", prediction: { kickoff: { gt: now } } } });
  return { newEvidence: open.length, needingApproval: upcomingOpen.length, awaitingDecision, needsMoreEvidence };
}

/** Latest monitoring signals for a prediction (for server-side decision guards). */
export async function latestSignals(predictionId: string, tx: Pick<typeof prisma, "predictionRevision"> = prisma): Promise<Signal[]> {
  const rev = await tx.predictionRevision.findFirst({
    where: { predictionId, kind: "REVIEW_REQUIRED" }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { evidenceJson: true },
  });
  return Array.isArray(rev?.evidenceJson) ? (rev!.evidenceJson as Signal[]).filter((s) => s && typeof s.code === "string") : [];
}
