/**
 * Conservative early publication of FREE singles only. Paid publication,
 * Goals publication, editorial manual picks and combo legs remain untouched.
 * The scheduled publication route does not create tips and never fills quotas
 * with lower-confidence selections.
 */
import { prisma } from "@/lib/prisma";
import type { MatchDigest } from "@/lib/ai/digest";
import { parseStoredContext } from "@/lib/ai/context";
import { publishEarlyFreePredictionAtomically } from "@/lib/predictions";
import { matchKey } from "@/lib/slug";
import { earlyQuotedSelection } from "@/lib/generation/earlyOddsPolicy";
import type { FixtureOdds } from "@/lib/odds";
import { isValidSelection, type MarketType } from "@/lib/markets";
import { DEDICATED_PAID_PROVENANCES, GENIUS_CONFIDENCE_FLOOR } from "@/lib/geniusCuration";
import { GOALS_GENERATED_PROVENANCE } from "@/lib/goalsGeneration";
import { EARLY_FIXTURE_POLICY, earlyFixtureMode, inEarlyGenerationWindow } from "@/lib/generation/earlyFixturePolicy";
import { classifyEarlyDisposition, EARLY_HOLD_UNTIL_HOURS, earlyPriceUnsafeFromPrompt } from "@/lib/generation/earlyTriage";
import { EARLY_FREE_GENERATION_INTENT } from "@/lib/ai/generationRisk";
import { savedEvidenceSupersession, latestObservedMatch, type KnownKickoff } from "@/lib/ai/evidenceFreshness";
import { knownRecentKickoffs } from "@/lib/ai/generationContext";

export type EarlyPublicationMode = "off" | "shadow" | "on";
export function earlyPublicationMode(value: string | undefined = process.env.EARLY_FREE_PUBLICATION_MODE): EarlyPublicationMode {
  return value === "shadow" || value === "on" ? value : "off";
}

/**
 * The early lane is FREE, using the same 70% bar as regular Genius and the
 * free Goals generator. 75% is VIP's separate tier floor and 80% belongs to
 * Premium; applying Premium's floor to free early tips made nearly every
 * genuine candidate permanently ineligible (20 Nov production audit).
 *
 * This is only ONE of multiple gates. A 70 score does not mean a validated
 * 70% success probability. The dedicated-free-job identity, 48–168h window,
 * fixture freshness, evidence, market structure, and paid exclusions remain
 * mandatory. The paid generation/capacity/value routes are unchanged.
 */
export const EARLY_PUBLICATION_CONFIDENCE_FLOOR = GENIUS_CONFIDENCE_FLOOR;
export const EARLY_PUBLISH_MAX_PER_RUN = 16;
const TRIAGE_RUN_BUDGET_MS = 45_000;
const TRIAGE_PAGE_SIZE = 80;

/** Trust the immutable saved input of the dedicated job, not only shared
 * fixture cache membership. An admin or paid draft for the same fixture must
 * never inherit this publication authority.
 */
export function isDedicatedEarlyFreeJob(prompt: string | null | undefined, fixtureApiId: number | null): boolean {
  if (!prompt || fixtureApiId == null) return false;
  try {
    const job: unknown = JSON.parse(prompt);
    if (!job || typeof job !== "object") return false;
    const recorded = job as Record<string, unknown>;
    return recorded.intent === EARLY_FREE_GENERATION_INTENT
      && recorded.fixtureApiId === fixtureApiId
      && Array.isArray(recorded.categories)
      && recorded.categories.length === 1
      && recorded.categories[0] === "FEATURED";
  } catch {
    return false;
  }
}

export type EarlyPublicationCandidate = {
  id: string; status: string; provenance: string | null; fixtureApiId: number | null;
  leagueApiId?: number | null;
  kickoff: Date | null; contextComplete: boolean; confidence: number;
  marketType: string; selection: unknown; manualSettlementOnly: boolean;
  categories: string[];
  earlyJobVerified: boolean;
  earlyPriceUnsafe?: boolean;
};
export function earlyPublicationBlock(
  row: EarlyPublicationCandidate,
  digest: MatchDigest | null,
  now: Date,
  /**
   * Kickoffs we already hold for the two teams. When either side has played a
   * match since the saved evidence was assembled, the reasoning describes form
   * that is no longer current, so the pick may not go live automatically. It
   * goes to admin review (or stays held) instead. Omitted = not checked.
   */
  knownKickoffs?: readonly KnownKickoff[],
): string | null {
  if (row.status !== "PENDING_REVIEW") return "not-awaiting-review";
  if (row.fixtureApiId == null) return "no-provider-fixture";
  if (!row.kickoff || !inEarlyGenerationWindow(row.kickoff, now, row.leagueApiId)) return "outside-early-window";
  if (!row.contextComplete || !digest) return "no-reliable-evidence";
  if (knownKickoffs) {
    const superseded = savedEvidenceSupersession(digest, knownKickoffs, now);
    if (superseded.home || superseded.away) return "evidence-superseded";
  }
  if (row.manualSettlementOnly || row.marketType === "OTHER" || !isValidSelection(row.marketType as MarketType, row.selection)) return "invalid-market";
  if (row.marketType === "SAME_GAME_DOUBLE" || row.categories.includes("SAME_GAME_DOUBLE")) return "combo-source-or-double";
  if (row.categories.some((category) => ["VIP", "PREMIUM", "BET_OF_THE_DAY"].includes(category))) return "reserved-category";
  if ([...DEDICATED_PAID_PROVENANCES, GOALS_GENERATED_PROVENANCE, "VIP_ROUTE_CONFIRMED"].includes(row.provenance as never)) return "protected-provenance";
  if (!row.earlyJobVerified) return "not-dedicated-early-free-job";
  if (row.earlyPriceUnsafe) return "generation-price-safety-review";
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
  ok: boolean;
  mode: EarlyPublicationMode;
  considered: number;
  qualifying: number;
  published: number;
  reviewReady: number;
  held: number;
  restored: number;
  blocked: Record<string, number>;
  failures: string[];
  summary: string;
};

/**
 * Optimistically claim an untouched early row, leaving its saved model result
 * and original evidence intact. Neither held nor review-ready predictions are
 * deleted. Audit revisions make the transition traceable.
 */
async function transitionEarlyStatus(
  row: { id: string; status: string; updatedAt: Date },
  desired: "DRAFT" | "PENDING_REVIEW",
  reason: string,
): Promise<Date | null> {
  if (row.status === desired) return row.updatedAt;
  return prisma.$transaction(async tx => {
    const claimed = await tx.prediction.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { status: desired },
    });
    if (claimed.count !== 1) return null;
    await tx.predictionRevision.create({
      data: {
        predictionId: row.id,
        kind: desired === "DRAFT" ? "EARLY_HOLD" : "EARLY_REVIEW_READY",
        publiclyVisible: false,
        reason: reason.slice(0, 400),
        beforeJson: { status: row.status },
        afterJson: { status: desired },
      },
    });
    const updated = await tx.prediction.findUnique({
      where: { id: row.id }, select: { updatedAt: true },
    });
    return updated?.updatedAt ?? null;
  });
}

export async function runEarlyFreePublication(input: { now?: Date; limit?: number; actorId: string }): Promise<EarlyPublicationReport> {
  const now = input.now ?? new Date();
  const startedAt = Date.now();
  const mode = earlyPublicationMode();
  const report: EarlyPublicationReport = {
    ok: true, mode, considered: 0, qualifying: 0, published: 0,
    reviewReady: 0, held: 0, restored: 0, blocked: {}, failures: [], summary: "",
  };
  const finish = () => {
    report.ok = report.failures.length === 0;
    report.summary = "Early free publication " + mode + ": " + report.considered +
      " triaged, " + report.qualifying + " eligible, " + report.published + " published, " +
      report.reviewReady + " review-ready, " + report.held + " held, " +
      report.restored + " restored, " + report.failures.length + " errors";
    return report;
  };
  if (mode === "off" || earlyFixtureMode() !== "on") return finish();

  // Publishing verified, already-cached quotes makes NO provider calls. Low
  // API quota is therefore not a reason to block a qualified publication.
  const limit = Math.max(1, Math.min(EARLY_PUBLISH_MAX_PER_RUN, Math.trunc(input.limit ?? EARLY_PUBLISH_MAX_PER_RUN)));
  const from = new Date(now.getTime() + 48 * 3_600_000);
  const until = new Date(now.getTime() + EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS * 3_600_000);
  const previouslyQueued = await prisma.upcomingFixture.findMany({
    where: { earlyQueuedAt: { not: null }, kickoff: { gt: now, lte: until }, status: "NS" },
    select: { fixtureApiId: true, kickoff: true, leagueApiId: true },
  });
  if (!previouslyQueued.length) return finish();
  const verifiedKickoffs = new Map(previouslyQueued.map(row => [row.fixtureApiId, row]));
  const fixtureIds = previouslyQueued.map(row => row.fixtureApiId);

  // Stream all relevant predictions in stable order. A fixed top-500 slice
  // would make older held rows invisible forever as coverage scales.
  let cursor: string | undefined;
  scan: while (Date.now() - startedAt < TRIAGE_RUN_BUDGET_MS) {
    const rows = await prisma.prediction.findMany({
      where: {
        fixtureApiId: { in: fixtureIds },
        OR: [
          { status: "PENDING_REVIEW", kickoff: { gt: from, lte: until } },
          // A held prediction must be handed to normal review as it enters the
          // ordinary 48h window. It can NEVER auto-publish there via this lane.
          { status: "DRAFT", kickoff: { gt: now, lte: until } },
        ],
      },
      include: {
        categories: true,
        aiJob: { select: { context: true, prompt: true } },
        revisions: { where: { kind: "EARLY_HOLD" }, take: 1, select: { id: true } },
      },
      orderBy: [{ kickoff: "asc" }, { id: "asc" }],
      take: TRIAGE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    const keys = rows.map(row => matchKey(row)).filter((key): key is string => key !== null);
    const quotes = keys.length ? await prisma.fixtureOddsCache.findMany({
      where: { matchKey: { in: keys } },
      select: { matchKey: true, oddsJson: true, fetchedAt: true },
    }) : [];
    const byKey = new Map(quotes.map(q => [q.matchKey, q]));
    // One indexed read per page: kickoffs of every team on the page since the
    // oldest saved evidence, so supersession is checked without provider calls.
    const pageDigests = new Map(rows.map(r => [r.id, parseStoredContext(r.aiJob?.context)]));
    const asOfs = [...pageDigests.values()].flatMap(d => d ? [latestObservedMatch(d.teams.home), latestObservedMatch(d.teams.away)] : [])
      .filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    let known: KnownKickoff[] | undefined;
    try {
      known = asOfs.length ? await knownRecentKickoffs(rows.flatMap(r => [r.homeTeamApiId, r.awayTeamApiId]), asOfs[0], now) : [];
    } catch (error) {
      // Fail CLOSED for automatic publication: an unknown is not "current".
      report.failures.push("supersession lookup: " + (error instanceof Error ? error.message : String(error)));
      known = undefined;
    }

    for (const row of rows) {
      if (Date.now() - startedAt >= TRIAGE_RUN_BUDGET_MS) break;
      if (report.published >= limit) break scan;
      // DRAFT is a holding state ONLY if this engine placed the hold. Never
      // hijack an admin-created or manually archived draft.
      if (row.status === "DRAFT" && row.revisions.length === 0) continue;
      const captured = row.fixtureApiId != null ? verifiedKickoffs.get(row.fixtureApiId) : null;
      if (!captured || !row.kickoff || captured.leagueApiId !== row.leagueApiId ||
          Math.abs(captured.kickoff.getTime() - row.kickoff.getTime()) > 15 * 60_000) {
        report.blocked["kickoff-changed"] = (report.blocked["kickoff-changed"] ?? 0) + 1;
        continue;
      }
      const categories = row.categories.map(c => c.category);
      const earlyJobVerified = isDedicatedEarlyFreeJob(row.aiJob?.prompt, row.fixtureApiId);
      if (!earlyJobVerified || categories.some(c => ["VIP", "PREMIUM", "BET_OF_THE_DAY", "SAME_GAME_DOUBLE"].includes(c)) ||
          [...DEDICATED_PAID_PROVENANCES, GOALS_GENERATED_PROVENANCE, "VIP_ROUTE_CONFIRMED"].includes(row.provenance as never))
        continue;

      report.considered++;
      const digest = pageDigests.get(row.id) ?? null;
      const leadHours = (row.kickoff.getTime() - now.getTime()) / 3_600_000;
      // The ordinary 48-hour pipeline never inherits early auto-publication
      // authority, although held drafts can join ordinary admin review.
      const reason = earlyPublicationBlock({
        ...row, status: "PENDING_REVIEW", categories, earlyJobVerified,
        earlyPriceUnsafe: earlyPriceUnsafeFromPrompt(row.aiJob?.prompt),
      }, digest, now, known);
      const superseded = reason === "evidence-superseded";
      // Lookup failed: never auto-publish on an unchecked assumption.
      const supersessionUnchecked = known === undefined;
      const key = matchKey(row);
      const cache = key ? byKey.get(key) : null;
      const price = earlyQuotedSelection({
        odds: (cache?.oddsJson as FixtureOdds | null) ?? null,
        fetchedAt: cache?.fetchedAt ?? null,
        kickoff: row.kickoff, now, marketType: row.marketType, selection: row.selection,
      });

      const validMarket = !row.manualSettlementOnly &&
        row.marketType !== "OTHER" && row.marketType !== "SAME_GAME_DOUBLE" &&
        isValidSelection(row.marketType as MarketType, row.selection);
      const credibleEvidence = !!(row.contextComplete && !superseded && digest?.coverage.form && digest.coverage.stats &&
        digest.teams.home.overall && digest.teams.away.overall &&
        digest.teams.home.last5.length >= 2 && digest.teams.away.last5.length >= 2 && validMarket);
      const disposition = classifyEarlyDisposition({
        confidence: row.confidence, leadHours, evidenceCredible: credibleEvidence,
        autoEligible: reason === null && !supersessionUnchecked, pricedExactSelection: price.ok,
      });
      if (reason || !price.ok) {
        const block = reason ?? (price.ok ? "early-quote-unavailable" : "odds-" + price.reason);
        report.blocked[block] = (report.blocked[block] ?? 0) + 1;
      }
      const explanation = [
        "Early prediction awaiting stronger evidence or bookmaker confirmation",
        reason ?? "opening price not yet qualified",
        price.ok ? "verified-price-available" : "odds-" + price.reason,
        leadHours > EARLY_HOLD_UNTIL_HOURS ? "more than 72h before kickoff" : "within 72h of kickoff",
      ].join("; ");

      if (disposition === "hold") {
        if (mode === "on" && row.status !== "DRAFT") {
          try {
            if (await transitionEarlyStatus(row, "DRAFT", explanation)) report.held++;
          } catch (error) {
            report.failures.push(row.id + ": hold: " + (error instanceof Error ? error.message : String(error)));
          }
        }
        continue;
      }

      // REVIEW is deliberately the SAME PENDING_REVIEW queue used by ordinary
      // generation; price gaps and marginal scores never disappear.
      let publishRow = row;
      if (row.status === "DRAFT") {
        if (mode !== "on") continue;
        try {
          const updatedAt = await transitionEarlyStatus(row, "PENDING_REVIEW", explanation);
          if (!updatedAt) continue;
          publishRow = { ...row, status: "PENDING_REVIEW", updatedAt };
          report.restored++;
        } catch (error) {
          report.failures.push(row.id + ": restore: " + (error instanceof Error ? error.message : String(error)));
          continue;
        }
      }
      if (disposition === "review") {
        report.reviewReady++;
        continue;
      }

      report.qualifying++;
      if (mode !== "on") continue;
      try {
        // The atomic publisher independently revalidates status, fixture,
        // exact market/selection, freshness, books and unchanged draft.
        if (await publishEarlyFreePredictionAtomically(publishRow, input.actorId)) report.published++;
        else report.blocked["concurrent-publication"] =
          (report.blocked["concurrent-publication"] ?? 0) + 1;
      } catch (error) {
        report.failures.push(row.id + ": publish: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (rows.length < TRIAGE_PAGE_SIZE) break;
  }

  if (mode === "on" && report.published) {
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
