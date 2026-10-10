/**
 * Hidden combo legs: the rows a Combo Bet (SAME_GAME_DOUBLE) is built from.
 *
 * A leg is an ordinary single-market row filed under SAME_GAME_DOUBLE and
 * nothing else. It exists to be referenced by its double's selection.legIds
 * and settled; it is never a pick in its own right. The double is the
 * publishable prediction. Every part of the combo machinery relies on the
 * SAME_GAME_DOUBLE tag alone to recognise a leg: curation's exclusion, the
 * Today, Combo Bets and Goals feeds, and the editor's "no editorial category"
 * allowance.
 *
 * THE INVARIANT. A hidden leg's categories are exactly ["SAME_GAME_DOUBLE"].
 * Nothing wrote editorial tags onto legs by design, and nothing stopped it
 * either: audited 27 Sep 2026, 199 legs carried GENIUS (188), BANKER (50),
 * VIP (18), PREMIUM (8), FEATURED (5) or BET_OF_THE_DAY (1) and surfaced as
 * loose picks in those feeds. The writers were the admin category tools (bulk
 * and single-row) and Bet of the Day auto-selection. Curation was not one — its
 * candidate query has excluded legs since 26 Aug, and its recorded additions
 * include none.
 *
 * STICKY. A row is a hidden leg if it is not itself a double and carries
 * SAME_GAME_DOUBLE — in the categories being written OR in the links it already
 * has. So removing the tag cannot turn a leg into a public single.
 *
 * LEGACY LIVE EXCEPTION. Legs that already carried leaked tags when this rule
 * arrived, and are still live (PUBLISHED and unsettled), keep them untouched
 * until they settle, so no live pick disappears from a feed mid-flight. That is
 * time-based rather than an id allowlist: created before HIDDEN_LEG_CUTOVER,
 * PUBLISHED, outcome PENDING. The moment such a leg settles it stops
 * qualifying and becomes a cleanup candidate
 * (scripts/backfill-hidden-leg-categories.ts).
 */

export const SAME_GAME_DOUBLE = "SAME_GAME_DOUBLE" as const;

/** The one category a hidden leg may carry. */
export const HIDDEN_LEG_CATEGORIES = [SAME_GAME_DOUBLE] as const;

/**
 * The deployment safety boundary: 1 Oct 2026 00:00 Africa/Lagos
 * (30 Sep 2026 23:00 UTC).
 *
 * Deliberately a whole hour safely AFTER the expected production deployment of
 * this rule, not a guess at the deploy instant. The new code stops leakage the
 * moment it deploys, whenever that is; the boundary only decides which rows are
 * treated as legacy. Before it: a leg the OLD code tagged while still deployed
 * stays a legacy row — visible while live, cleaned once settled. From it on:
 * every newly created leg must be exactly ["SAME_GAME_DOUBLE"], and the drift
 * check is strict for them.
 *
 * Production deployment MUST complete before this instant. If it cannot, move
 * the boundary later (a whole hour) before deploying; never earlier than the
 * deploy, or a leg the old code tagged in the gap would count as post-cutover:
 * hidden from its feed while still live, and a drift-check failure.
 */
export const HIDDEN_LEG_CUTOVER = new Date("2026-09-30T23:00:00.000Z");

/** Shown in the admin editor and returned by refused category edits. */
export const HIDDEN_LEG_MESSAGE = "Part of a Combo Bet — not independently categorised";

/** Is this row a hidden combo leg? Not a double itself, and filed under SAME_GAME_DOUBLE. */
export function isHiddenComboLeg(marketType: string | null | undefined, categories: readonly string[]): boolean {
  return marketType !== SAME_GAME_DOUBLE && categories.includes(SAME_GAME_DOUBLE);
}

export type PersistedLegState = {
  categories: readonly string[];
  createdAt: Date;
  status: string;
  outcome: string;
};

/**
 * A pre-cutover leg that is still live. Its category links — leaked or not — are
 * frozen until it settles: nothing adds to them and nothing removes them.
 */
export function isLegacyLiveHiddenLeg(marketType: string | null | undefined, row: PersistedLegState): boolean {
  return (
    isHiddenComboLeg(marketType, row.categories) &&
    row.createdAt.getTime() < HIDDEN_LEG_CUTOVER.getTime() &&
    row.status === "PUBLISHED" &&
    row.outcome === "PENDING"
  );
}

/**
 * The categories to write, with the invariant applied.
 *
 * A hidden leg — by the categories being written or by the links it already
 * holds — resolves to exactly ["SAME_GAME_DOUBLE"], whatever was asked for.
 * Anything else passes through unchanged: ordinary rows and doubles keep every
 * editorial tag they are given. Callers apply withGoalsCategory first; a leg
 * never qualifies for GOALS, and this would remove it if it did.
 *
 * The legacy live exception is NOT handled here: those rows must not be
 * written at all (see setPredictionCategories), because rewriting even the
 * same set could reorder them and change the primary category.
 */
export function withHiddenLegCategories(
  categories: readonly string[],
  marketType: string | null | undefined,
  held: readonly string[] = [],
): string[] {
  const hidden = marketType !== SAME_GAME_DOUBLE && (categories.includes(SAME_GAME_DOUBLE) || held.includes(SAME_GAME_DOUBLE));
  return hidden ? [...HIDDEN_LEG_CATEGORIES] : [...new Set(categories)];
}

/**
 * Why an admin category edit on this row is refused, or null if it is allowed.
 * A hidden leg accepts no category change beyond its SAME_GAME_DOUBLE tag.
 */
export function hiddenLegCategoryEditError(
  marketType: string | null | undefined,
  held: readonly string[],
  requested: readonly string[],
): string | null {
  if (!isHiddenComboLeg(marketType, held)) return null;
  return requested.some((c) => c !== SAME_GAME_DOUBLE) ? HIDDEN_LEG_MESSAGE : null;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Prisma filter keeping hidden legs out of a tag-based category feed, except a
 * legacy live leg until it settles. For getCategoryPredictions; BotD uses the
 * stricter HIDDEN_LEG_EXCLUSION, with no exception.
 */
export function tagFeedHiddenLegExclusion() {
  return {
    NOT: {
      marketType: { not: SAME_GAME_DOUBLE },
      categories: { some: { category: SAME_GAME_DOUBLE } },
      NOT: { createdAt: { lt: HIDDEN_LEG_CUTOVER }, status: "PUBLISHED", outcome: "PENDING" },
    },
  };
}

/** Prisma filter excluding every hidden leg, with no exception. */
export const HIDDEN_LEG_EXCLUSION = {
  NOT: { marketType: { not: SAME_GAME_DOUBLE }, categories: { some: { category: SAME_GAME_DOUBLE } } },
} as const;

/** The same rule as tagFeedHiddenLegExclusion, as a predicate — what tests and reports reason with. */
export function visibleInTagFeed(row: { marketType: string } & PersistedLegState): boolean {
  return !isHiddenComboLeg(row.marketType, row.categories) || isLegacyLiveHiddenLeg(row.marketType, row);
}

// ── Cleanup and drift ──────────────────────────────────────────────────────

export type LegCategoryRow = {
  id: string;
  marketType: string;
  category: string;
  categories: string[];
  createdAt: Date;
  status: string;
  outcome: string;
};

export type LegCleanupPlan = {
  /** Hidden legs carrying anything but SAME_GAME_DOUBLE, or a non-SGD primary. */
  affected: LegCategoryRow[];
  /** Non-live: settled, unpublished or archived. These are cleaned. */
  eligible: Array<{ row: LegCategoryRow; removeCategories: string[]; resetPrimary: boolean }>;
  /** PUBLISHED and unsettled — every one, regardless of creation date. Never touched. */
  skippedLive: LegCategoryRow[];
};

const extraCategories = (row: LegCategoryRow) => row.categories.filter((c) => c !== SAME_GAME_DOUBLE);

/**
 * What the one-time cleanup may change. Only hidden legs that are not live; a
 * PUBLISHED, unsettled leg is skipped whatever it carries, so no live pick
 * leaves a feed. Only non-SGD links and the primary column; never a leg, never
 * its SAME_GAME_DOUBLE link, never status, outcome, market or selection.
 */
export function planHiddenLegCleanup(rows: readonly LegCategoryRow[]): LegCleanupPlan {
  const affected = rows.filter(
    (r) => isHiddenComboLeg(r.marketType, r.categories) && (extraCategories(r).length > 0 || r.category !== SAME_GAME_DOUBLE),
  );
  const plan: LegCleanupPlan = { affected, eligible: [], skippedLive: [] };
  for (const row of affected) {
    if (row.status === "PUBLISHED" && row.outcome === "PENDING") plan.skippedLive.push(row);
    else plan.eligible.push({ row, removeCategories: extraCategories(row), resetPrimary: row.category !== SAME_GAME_DOUBLE });
  }
  return plan;
}

export type LegDrift = "CLEAN" | "LEGACY_LIVE_EXCEPTION" | "LEGACY_PENDING_CLEANUP" | "VIOLATION";

/**
 * Drift classification for the read-only preflight check.
 *
 *   VIOLATION              — created on or after the cutover and not exactly
 *                            ["SAME_GAME_DOUBLE"] (or a non-SGD primary). The
 *                            invariant failed: the check fails.
 *   LEGACY_LIVE_EXCEPTION  — pre-cutover, live, carrying old tags. Allowed.
 *   LEGACY_PENDING_CLEANUP — pre-cutover, no longer live, still carrying old
 *                            tags. Reported until the backfill cleans it; not a
 *                            failure, because settling is what moves a row here.
 */
export function classifyLegDrift(row: LegCategoryRow): LegDrift {
  if (!isHiddenComboLeg(row.marketType, row.categories)) return "CLEAN";
  const dirty = extraCategories(row).length > 0 || row.category !== SAME_GAME_DOUBLE;
  if (!dirty) return "CLEAN";
  if (row.createdAt.getTime() >= HIDDEN_LEG_CUTOVER.getTime()) return "VIOLATION";
  return isLegacyLiveHiddenLeg(row.marketType, row) ? "LEGACY_LIVE_EXCEPTION" : "LEGACY_PENDING_CLEANUP";
}

/** Thrown when a hidden leg is offered where only a standalone pick belongs (Bet of the Day). */
export class HiddenComboLegError extends Error {
  constructor(message = `${HIDDEN_LEG_MESSAGE} — it cannot be Bet of the Day`) {
    super(message);
    this.name = "HiddenComboLegError";
  }
}
