/**
 * Pre-publication duplicate-fixture review (issue #237, workstream D).
 *
 * A fixture normally shows one FEATURED single. Publishing a second one used
 * to succeed and only then warn with a raw database id. Now the server
 * describes the clash BEFORE publishing and refuses to publish it without an
 * explicit, recorded administrator decision. Nothing here ever deletes,
 * overwrites or unpublishes an existing published selection.
 */
import type { Prisma } from "@prisma/client";

export type SelectionSummary = {
  market: string; pick: string; marketType: string; selection: unknown;
  confidence: number; odds: number | null; categories: string[];
};

export type DuplicateRelation = "SAME_SELECTION" | "CONFLICTING_SELECTION" | "DISTINCT_MARKET";

const stable = (value: unknown): string => JSON.stringify(value, (_k, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b))) : v);

/** Same market + same selection = duplicate; same market, other selection = conflict; other market = distinct. */
export function classifyDuplicate(existing: Pick<SelectionSummary, "marketType" | "selection">, proposed: Pick<SelectionSummary, "marketType" | "selection">): DuplicateRelation {
  if (existing.marketType !== proposed.marketType) return "DISTINCT_MARKET";
  return stable(existing.selection) === stable(proposed.selection) ? "SAME_SELECTION" : "CONFLICTING_SELECTION";
}

export function explainRelation(relation: DuplicateRelation): string {
  return relation === "SAME_SELECTION"
    ? "This is the same selection that is already published for this match."
    : relation === "CONFLICTING_SELECTION"
      ? "This backs a different outcome in the same market as the published selection, so the two selections contradict each other."
      : "This is a different market from the published selection, so both can be supported independently.";
}

export type DuplicateReview = {
  predictionId: string;
  match: { homeTeam: string | null; awayTeam: string | null; kickoff: string | null; league: string | null };
  existing: SelectionSummary[];
  proposed: SelectionSummary;
  relation: DuplicateRelation;
  explanation: string;
};

type Db = Pick<typeof import("@/lib/prisma").prisma, "prediction">;
type RowIdentity = { id: string; fixtureApiId?: number | null; homeTeamApiId?: number | null; awayTeamApiId?: number | null; kickoff?: Date | null };

const SUMMARY_SELECT = {
  market: true, pick: true, marketType: true, selection: true, confidence: true, odds: true,
  categories: { select: { category: true } },
} as const;

function summarize(r: { market: string; pick: string; marketType: string; selection: unknown; confidence: number; odds: number | null; categories: { category: string }[] }): SelectionSummary {
  return { market: r.market, pick: r.pick, marketType: r.marketType, selection: r.selection, confidence: r.confidence, odds: r.odds, categories: r.categories.map((c) => c.category) };
}

/** Same fixture identity rule as publishedFeaturedSingleFor (provider id, or both team ids + kickoff). */
export function sameFixtureClauses(row: RowIdentity): Prisma.PredictionWhereInput[] {
  const byTeams = row.homeTeamApiId != null && row.awayTeamApiId != null && row.kickoff
    ? [{ homeTeamApiId: row.homeTeamApiId, awayTeamApiId: row.awayTeamApiId, kickoff: row.kickoff }] : [];
  return row.fixtureApiId != null ? [{ fixtureApiId: row.fixtureApiId }, ...byTeams] : byTeams;
}

/**
 * The review for one row about to be published, or null when the match shows no
 * other published FEATURED single. Called both before publishing (dry run) and
 * again inside the publish transaction, so a pick published in between is seen.
 */
export async function reviewFeaturedDuplicate(db: Db, row: RowIdentity & { homeTeam: string | null; awayTeam: string | null; leagueName: string | null; market: string; pick: string; marketType: string; selection: unknown; confidence: number; odds: number | null; categories: { category: string }[] }): Promise<DuplicateReview | null> {
  if (row.marketType === "SAME_GAME_DOUBLE" || !row.categories.some((c) => c.category === "FEATURED")) return null;
  const clauses = sameFixtureClauses(row);
  if (!clauses.length) return null;
  const others = await db.prediction.findMany({
    where: { id: { not: row.id }, status: "PUBLISHED", marketType: { not: "SAME_GAME_DOUBLE" }, categories: { some: { category: "FEATURED" } }, OR: clauses },
    orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    select: SUMMARY_SELECT,
  });
  if (!others.length) return null;
  const proposed = summarize(row);
  const existing = others.map(summarize);
  // Strongest relation wins: a contradiction outranks a repeat outranks a distinct market.
  const relations = existing.map((e) => classifyDuplicate(e, proposed));
  const relation = relations.includes("CONFLICTING_SELECTION") ? "CONFLICTING_SELECTION" : relations.includes("SAME_SELECTION") ? "SAME_SELECTION" : "DISTINCT_MARKET";
  return {
    predictionId: row.id,
    match: { homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff ? row.kickoff.toISOString() : null, league: row.leagueName },
    existing, proposed, relation, explanation: explainRelation(relation),
  };
}

export class DuplicateReviewRequired extends Error {
  constructor(public review: DuplicateReview) { super("DUPLICATE_REVIEW_REQUIRED"); }
}

export const DUPLICATE_OVERRIDE_JOB = "duplicate-publication-override";
export const MIN_OVERRIDE_REASON = 8;

/**
 * Serialises concurrent publishes for ONE fixture. A transaction-scoped
 * advisory lock is taken before the duplicate check, so two selections for the
 * same match published at the same moment cannot both pass it: the second
 * waits for the first to commit, then sees it. Released automatically at
 * commit/rollback. No-op key when the row has no usable fixture identity.
 */
export async function lockFixtureForPublication(tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> }, row: RowIdentity): Promise<void> {
  const key = row.fixtureApiId != null ? `fixture:${row.fixtureApiId}`
    : row.homeTeamApiId != null && row.awayTeamApiId != null && row.kickoff ? `teams:${row.homeTeamApiId}-${row.awayTeamApiId}-${row.kickoff.toISOString().slice(0, 10)}` : null;
  if (key) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * The guard handed to applyReviewAction for a PUBLISH. Runs inside the publish
 * transaction: lock the fixture, re-run the review against committed state,
 * and either let a clean row through, fail closed (DuplicateReviewRequired),
 * or — only with an explicit administrator decision — record the override for
 * audit and allow it. It never deletes, unpublishes or rewrites anything.
 */
export function duplicatePublishGuard(opts: { actorId: string; predictionId: string; decision?: { reason: string }; onOverride?: () => void }) {
  return async (tx: Pick<typeof import("@/lib/prisma").prisma, "prediction" | "jobRun" | "$executeRaw">, locked: any): Promise<void> => {
    await lockFixtureForPublication(tx, locked);
    const review = await reviewFeaturedDuplicate(tx, locked);
    if (!review) return;
    if (!opts.decision) throw new DuplicateReviewRequired(review);
    opts.onOverride?.();
    const brief = (e: SelectionSummary) => ({ market: e.market, pick: e.pick, categories: e.categories, confidence: e.confidence, odds: e.odds });
    await tx.jobRun.create({ data: { job: DUPLICATE_OVERRIDE_JOB, summary: "Administrator published an additional selection on a match that already shows one", detail: {
      actorId: opts.actorId, predictionId: opts.predictionId, reason: opts.decision.reason, relation: review.relation,
      existing: review.existing.map(brief), proposed: brief(review.proposed),
    } } });
  };
}
