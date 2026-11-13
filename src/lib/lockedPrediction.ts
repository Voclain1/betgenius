import { isPaidOnlyProvenance } from "@/lib/paidOnly";

/**
 * What a reader who cannot view a prediction's category may receive about it:
 * the fixture, never the pick.
 *
 * An ALLOWLIST, not a blocklist. /api/predictions used to spread the whole row
 * and blank four fields (pick, reasoning, confidence, odds), so a locked VIP or
 * Premium row still carried its `selection`, `market`, `marketType`, goal line,
 * `analysisJson`, `marketConfirmation` and earlier drafts — the pick, in all
 * but name, to anyone calling the endpoint. Any column added later is withheld
 * by default.
 */
const FIXTURE_FIELDS = [
  "id", "category", "categories", "leagueApiId", "leagueName", "homeTeam", "awayTeam", "homeTeamApiId", "awayTeamApiId",
  "kickoff", "status", "outcome", "finalHomeScore", "finalAwayScore", "fixture", "fixtureId", "fixtureApiId", "publishedAt",
  "leagueSlugKey", "homeSlugKey", "awaySlugKey", "matchSlugKey", "h2hSlugKey",
] as const;

export function lockedPredictionView<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIXTURE_FIELDS) if (k in row) out[k] = row[k];
  return { ...out, pick: "LOCKED", reasoning: "Subscribe to unlock this prediction.", matchPreview: null, confidence: null, odds: null, locked: true };
}

/**
 * May this viewer see this row unlocked? Decided by the ROW, not only by the
 * feed that was asked for.
 *
 * WHY. /api/predictions?category=TODAY gated every row on TODAY, which is
 * public, and its query did not exclude paid-only rows. So today's dedicated
 * VIP and Premium picks were served unlocked, reasoning and all, to anyone who
 * asked for the Today feed (found by scripts/verify-paid-production.ts on
 * 13 Nov 2026). A paid-only pick is viewable only by a reader who can view one
 * of the paid categories it carries, whatever feed it was requested through.
 */
export function rowViewable(
  row: { provenance: string | null; categories: ReadonlyArray<{ category: string }> },
  feedViewable: boolean,
  canView: (category: string) => boolean,
): boolean {
  if (isPaidOnlyProvenance(row.provenance)) {
    const paid = row.categories.map((c) => c.category).filter((c) => c === "VIP" || c === "PREMIUM");
    // A paid-only row with no paid tag left is shown to nobody but staff.
    return paid.length > 0 ? paid.some(canView) : canView("__STAFF_ONLY__");
  }
  return feedViewable;
}
