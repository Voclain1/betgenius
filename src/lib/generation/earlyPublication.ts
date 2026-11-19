/**
 * Conservative early publication of FREE singles only. Paid publication,
 * Goals publication, editorial manual picks and combo legs remain untouched.
 * The scheduled publication route does not create tips and never fills quotas
 * with lower-confidence selections.
 */
import { prisma } from "@/lib/prisma";
import type { MatchDigest } from "@/lib/ai/digest";
import { parseStoredContext } from "@/lib/ai/context";
import { applyReviewAction } from "@/lib/predictions";
import { isValidSelection, type MarketType } from "@/lib/markets";
import { DEDICATED_PAID_PROVENANCES } from "@/lib/geniusCuration";
import { GOALS_GENERATED_PROVENANCE } from "@/lib/goalsGeneration";
import { earlyFixtureMode, inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { getUsageSnapshot } from "@/lib/football/usage";

export type EarlyPublicationMode = "off" | "shadow" | "on";
export function earlyPublicationMode(value: string | undefined = process.env.EARLY_FREE_PUBLICATION_MODE): EarlyPublicationMode {
  return value === "shadow" || value === "on" ? value : "off";
}

/** This is deliberately higher than the period-feed 75% threshold. */
export const EARLY_PUBLICATION_CONFIDENCE_FLOOR = 80;
export const EARLY_PUBLISH_MAX_PER_RUN = 8;

export type EarlyPublicationCandidate = {
  id: string; status: string; provenance: string | null; fixtureApiId: number | null;
  kickoff: Date | null; contextComplete: boolean; confidence: number;
  marketType: string; selection: unknown; manualSettlementOnly: boolean;
  categories: string[];
};
export function earlyPublicationBlock(
  row: EarlyPublicationCandidate,
  digest: MatchDigest | null,
  now: Date,
): string | null {
  if (row.status !== "PENDING_REVIEW") return "not-awaiting-review";
  if (row.fixtureApiId == null) return "no-provider-fixture";
  if (!row.kickoff || !inEarlyGenerationWindow(row.kickoff, now)) return "outside-early-window";
  if (!row.contextComplete || !digest) return "no-reliable-evidence";
  if (row.manualSettlementOnly || row.marketType === "OTHER" || !isValidSelection(row.marketType as MarketType, row.selection)) return "invalid-market";
  if (row.marketType === "SAME_GAME_DOUBLE" || row.categories.includes("SAME_GAME_DOUBLE")) return "combo-source-or-double";
  if (row.categories.some((category) => ["VIP", "PREMIUM", "BET_OF_THE_DAY"].includes(category))) return "reserved-category";
  if ([...DEDICATED_PAID_PROVENANCES, GOALS_GENERATED_PROVENANCE, "VIP_ROUTE_CONFIRMED"].includes(row.provenance as never)) return "protected-provenance";
  if (row.confidence < EARLY_PUBLICATION_CONFIDENCE_FLOOR) return "below-early-confidence-floor";
  // Both teams require actual recent matches and season-level data. A model
  // confidence number without corroborating football evidence is insufficient.
  const home = digest.teams.home;
  const away = digest.teams.away;
  if (!home.overall || !away.overall || home.last5.length < 3 || away.last5.length < 3) return "insufficient-two-sided-evidence";
  // Unknown injury coverage is not presented as confirmation that squads are fit.
  if (!digest.coverage.stats || !digest.coverage.form) return "missing-stats-or-form";
  return null;
}

export type EarlyPublicationReport = {
  ok: boolean; mode: EarlyPublicationMode; considered: number; qualifying: number; published: number;
  blocked: Record<string, number>; failures: string[];
  summary: string;
};

export async function runEarlyFreePublication(input: { now?: Date; limit?: number; actorId: string }): Promise<EarlyPublicationReport> {
  const now = input.now ?? new Date();
  const mode = earlyPublicationMode();
  const report: EarlyPublicationReport = { ok: true, mode, considered: 0, qualifying: 0, published: 0, blocked: {}, failures: [], summary: "" };
  const finish = () => {
    report.ok = report.failures.length === 0;
    report.summary = "Early free publication " + mode + ": " + report.considered + " reviewed, "
      + report.qualifying + " eligible, " + report.published + " published, " + report.failures.length + " failures";
    return report;
  };
  if (mode === "off" || earlyFixtureMode() !== "on") return finish();
  const usage = await getUsageSnapshot();
  if (usage.remaining < 1_000) {
    report.blocked["low-api-quota"] = 1;
    return finish();
  }

  const limit = Math.max(1, Math.min(EARLY_PUBLISH_MAX_PER_RUN, Math.trunc(input.limit ?? EARLY_PUBLISH_MAX_PER_RUN)));
  // A row can only enter this lane after a recorded early provider capture.
  // User-entered drafts, late ordinary picks and all paid outputs remain manual.
  const from = new Date(now.getTime() + 48 * 3_600_000);
  const until = new Date(now.getTime() + 168 * 3_600_000);
  const previouslyQueued = await prisma.upcomingFixture.findMany({
    where: { earlyQueuedAt: { not: null }, kickoff: { gt: from, lte: until }, status: "NS" },
    select: { fixtureApiId: true },
    take: 200,
  });
  const fixtureIds = previouslyQueued.map((row) => row.fixtureApiId);
  if (!fixtureIds.length) return finish();

  const rows = await prisma.prediction.findMany({
    where: {
      fixtureApiId: { in: fixtureIds },
      status: "PENDING_REVIEW",
      kickoff: { gt: from, lte: until },
    },
    include: { categories: true, aiJob: { select: { context: true } } },
    orderBy: [{ confidence: "desc" }, { kickoff: "asc" }],
    take: 100,
  });

  for (const row of rows) {
    if (report.published >= limit) break;
    report.considered++;
    const categories = row.categories.map((c) => c.category);
    const digest = parseStoredContext(row.aiJob?.context);
    const reason = earlyPublicationBlock({ ...row, categories }, digest, now);
    if (reason) { report.blocked[reason] = (report.blocked[reason] ?? 0) + 1; continue; }
    report.qualifying++;
    if (mode !== "on") continue;
    try {
      // Shared transactional publisher performs the final kickoff/fixture
      // validation and writes the same notification events as manual publishing.
      await applyReviewAction(row, "PUBLISH", input.actorId);
      report.published++;
    } catch (error) {
      report.failures.push(row.id + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }

  if (mode === "on" && report.published) {
    // Curation derives GENIUS/BANKER tags only from published selections.
    // Its existing quality floors remain unchanged.
    try {
      const { curateGeniusTips, curateBankerTips } = await import("@/lib/geniusCuration");
      await curateGeniusTips(now);
      await curateBankerTips(now);
    } catch (error) {
      report.failures.push("curation: " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return finish();
}
