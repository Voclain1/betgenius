/**
 * Post-publication evidence monitoring. Never edits an already-published
 * selection or confidence, and NEVER auto-replaces paid picks.
 *
 * Shadow writes monitoring/audit only. Live mode can withdraw a fixture that
 * the provider has explicitly cancelled/postponed; footballing changes create
 * a review case and a proposed analysis, never an unreviewed public replacement.
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUsageSnapshot } from "@/lib/football/usage";
import { getFixturesByIds, getFixtureLineups } from "@/lib/football/api-football";
import { trimConfirmedLineups } from "@/lib/lineups";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { buildStoredContext, parseStoredContext } from "@/lib/ai/context";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import { isValidSelection, type MarketType } from "@/lib/markets";
import { recordPredictionEvents, createNotificationEvent } from "@/lib/notifications";
import { isPaidOnlyProvenance } from "@/lib/paidOnly";
import { matchKey } from "@/lib/slug";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";
import { matchOddsState } from "@/lib/matchOdds";
import {
  compareFootballEvidence, confirmedLineupSignals, fixtureSignals, reassessmentIntervalMinutes, oddsMovementSignal,
  type EvidenceSignal, type FixtureEvidence,
} from "@/lib/reassessment/evidence";

export type ReassessmentMode = "off" | "shadow" | "on";

/** SHADOW receipts are internal only. When the same unresolved material signal
 * is freshly confirmed for the first time in LIVE, create a public receipt and
 * notify once. Do not reopen an already reviewed/retained CURRENT case, and
 * do not duplicate notices for an existing live hold.
 */
export function shouldRecordReassessmentReceipt(input: {
  mode: ReassessmentMode; sameSignature: boolean;
  existingStatus: string | null | undefined;
  publicHold: boolean | null | undefined;
}): boolean {
  return !input.sameSignature ||
    (input.mode === "on" && input.existingStatus === "REVIEW_REQUIRED" && input.publicHold !== true);
}
export function reassessmentMode(value: string | undefined = process.env.PREDICTION_REASSESSMENT_MODE): ReassessmentMode {
  return value === "shadow" || value === "on" ? value : "off";
}

export const MAX_REASSESSMENTS_PER_RUN = 5;
const LEASE_KEY = "published-prediction-reassessment";
const MIN_QUOTA_REMAINING = 1_500;

type SelectionSnapshot = {
  marketType: string; selection: unknown; confidence: number; market: string; pick: string;
  publishedAt: string | null; status: string; odds: number | null;
};
export function publishedSelectionSnapshot(p: {
  marketType: string; selection: unknown; confidence: number; market: string; pick: string;
  publishedAt: Date | null; status: string; odds: number | null;
}): SelectionSnapshot {
  return { marketType: p.marketType, selection: p.selection, confidence: p.confidence,
    market: p.market, pick: p.pick, publishedAt: p.publishedAt?.toISOString() ?? null,
    status: p.status, odds: p.odds };
}
function digestSignature(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function claimRun(now: Date): Promise<string | null> {
  const holder = randomUUID();
  const expiry = new Date(now.getTime() + 10 * 60_000);
  const inserted = await prisma.appLock.createMany({
    data: [{ key: LEASE_KEY, holder, acquiredAt: now, expiresAt: expiry }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return holder;
  const stolen = await prisma.appLock.updateMany({
    where: { key: LEASE_KEY, expiresAt: { lt: now } },
    data: { holder, acquiredAt: now, expiresAt: expiry },
  });
  return stolen.count === 1 ? holder : null;
}

export type ReassessmentReport = {
  ok: boolean; mode: ReassessmentMode; checked: number; current: number;
  flagged: number; withdrawn: number; skipped: number; failures: string[];
  summary: string;
};

export async function runPublishedReassessment(input: { now?: Date; limit?: number } = {}): Promise<ReassessmentReport> {
  const now = input.now ?? new Date();
  const mode = reassessmentMode();
  const report: ReassessmentReport = {
    ok: true, mode, checked: 0, current: 0, flagged: 0, withdrawn: 0, skipped: 0, failures: [], summary: "",
  };
  const finish = () => {
    report.ok = report.failures.length === 0;
    report.summary = "Prediction monitoring " + mode + ": checked " + report.checked
      + ", current " + report.current + ", review " + report.flagged + ", withdrawn "
      + report.withdrawn + ", errors " + report.failures.length;
    return report;
  };
  if (mode === "off") return finish();
  const budget = await getUsageSnapshot();
  if (budget.remaining < MIN_QUOTA_REMAINING) {
    report.skipped++;
    return finish();
  }
  const holder = await claimRun(now);
  if (!holder) { report.skipped++; return finish(); }
  try {
    const limit = Math.max(1, Math.min(MAX_REASSESSMENTS_PER_RUN, Math.trunc(input.limit ?? MAX_REASSESSMENTS_PER_RUN)));
    const rows = await prisma.prediction.findMany({
      where: { status: "PUBLISHED", kickoff: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
        fixtureApiId: { not: null } },
      include: {
        aiJob: { select: { context: true } },
        categories: true, reassessment: true,
      },
      orderBy: [{ kickoff: "asc" }, { publishedAt: "asc" }],
      take: 500,
    });
    const candidates = rows.filter(row => !row.reassessment?.nextCheckAt || row.reassessment.nextCheckAt <= now).slice(0, limit);
    const ids = [...new Set(candidates.map(r => r.fixtureApiId).filter((v): v is number => v != null))];
    // One provider call per 20 fixture IDs. Failure means unknown, not cancellation.
    const freshFixtures = ids.length ? await getFixturesByIds(ids) : [];
    const byId = new Map((freshFixtures ?? []).map(f => [f.fixture.id, f]));

    for (const row of candidates) {
      report.checked++;
      try {
        if (!row.kickoff || row.fixtureApiId == null || !row.homeTeamApiId || !row.awayTeamApiId || !row.leagueName) {
          report.skipped++;
          continue;
        }
        const old = row.reassessment?.lastEvidence
          ? parseStoredContext(row.reassessment.lastEvidence)
          : parseStoredContext(row.aiJob?.context);
        const freshFixture = byId.get(row.fixtureApiId);
        // A provider omission/error is UNKNOWN, never proof that the fixture
        // and its original prediction remain current. Preserve any existing
        // review hold until a human resolves it.
        if (!freshFixture) {
          const keepReview = row.reassessment?.status === "REVIEW_REQUIRED";
          await prisma.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: keepReview ? "REVIEW_REQUIRED" : "UNKNOWN",
              checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: keepReview ? row.reassessment?.summary ?? "Material change still requires review."
                : "Latest fixture status could not be verified; no unchanged-state inference.",
              lastError: "FIXTURE_STATE_UNAVAILABLE" },
            update: { status: keepReview ? "REVIEW_REQUIRED" : "UNKNOWN",
              checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: keepReview ? row.reassessment?.summary ?? "Material change still requires review."
                : "Latest fixture status could not be verified; no unchanged-state inference.",
              lastError: "FIXTURE_STATE_UNAVAILABLE" },
          });
          report.skipped++;
          continue;
        }
        let fixture: FixtureEvidence | null = null;
        if (freshFixture) {
          fixture = { fixtureApiId: row.fixtureApiId, status: freshFixture.fixture.status.short,
            kickoff: new Date(freshFixture.fixture.date), seenAt: now };
          // Keep existing future-fixture cache current, but never invent a new
          // fixture as a side effect of the review run.
          await prisma.upcomingFixture.updateMany({
            where: { fixtureApiId: row.fixtureApiId },
            data: { status: fixture.status, kickoff: fixture.kickoff, lastSeenAt: now },
          });
        }

        const signals: EvidenceSignal[] = fixtureSignals(row.kickoff, fixture, now);
        // Without the published baseline there is nothing verifiable to compare.
        // A confirmed cancellation/fixture shift can still be acted on safely.
        if (!old && !signals.some(s => s.source === "fixture" && s.severity === "CRITICAL")) {
          const keepReview = row.reassessment?.status === "REVIEW_REQUIRED";
          await prisma.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: keepReview ? "REVIEW_REQUIRED" : "UNKNOWN",
              checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: keepReview ? row.reassessment?.summary ?? "Material change still requires review."
                : "Original publication context missing; no unchanged-state inference.",
              lastError: "PUBLISHED_BASELINE_UNAVAILABLE" },
            update: { status: keepReview ? "REVIEW_REQUIRED" : "UNKNOWN",
              checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: keepReview ? row.reassessment?.summary ?? "Material change still requires review."
                : "Original publication context missing; no unchanged-state inference.",
              lastError: "PUBLISHED_BASELINE_UNAVAILABLE" },
          });
          report.skipped++;
          continue;
        }
        const { digest, sources } = await buildGenerationDigest({
          home: row.homeTeam ?? "", away: row.awayTeam ?? "", league: row.leagueName,
          kickoff: row.kickoff.toISOString(), homeApiId: row.homeTeamApiId,
          awayApiId: row.awayTeamApiId, leagueApiId: row.leagueApiId, round: null,
        });
        // Provider-verified cancellation overrides missing statistical feeds:
        // a postponed fixture must not stay recommended because its teams'
        // enrichment requests failed. Other changes still fail closed.
        const criticalFixtureAlreadyKnown = signals.some(s => s.source === "fixture" && s.severity === "CRITICAL");
        if ((sources.homeTeam === "missing" || sources.awayTeam === "missing") && !criticalFixtureAlreadyKnown) {
          await prisma.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: "UNKNOWN", checkedAt: now,
              nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: "One or both teams lack current evidence; no assumption of unchanged conditions." },
            update: { status: "UNKNOWN", checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000),
              summary: "One or both teams lack current evidence; no assumption of unchanged conditions." },
          });
          report.skipped++;
          continue;
        }

        signals.push(...compareFootballEvidence(old, digest, now));
        // Cache-only, verified consensus for the exact ORIGINAL selection.
        // No quote is an unknown state, not a false confirmation.
        const key = matchKey({ homeTeamApiId: row.homeTeamApiId, awayTeamApiId: row.awayTeamApiId, kickoff: row.kickoff });
        const quoteCache = key ? await prisma.fixtureOddsCache.findUnique({
          where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true },
        }) : null;
        const odds = (quoteCache?.oddsJson as FixtureOdds | null) ?? null;
        const oddsState = quoteCache?.fetchedAt && odds ? matchOddsState({
          odds, fetchedAt: quoteCache.fetchedAt, kickoff: row.kickoff, now,
        }) : null;
        const mapped = toBookmakerSelection(row.marketType, row.selection);
        const quote = oddsState?.state === "current" && mapped ? findSelection(odds, mapped.market, mapped.value) : null;
        const latestOdds = quote && oddsState?.asOf && quote.bookmakers >= 5
          && Number.isFinite(quote.median) && quote.median > 1
          ? { median: quote.median, bookmakers: quote.bookmakers, at: oddsState.asOf } : null;
        const previousOdds = row.reassessment?.lastOddsMedian && row.reassessment.lastOddsAt
          ? { median: row.reassessment.lastOddsMedian, at: row.reassessment.lastOddsAt, bookmakers: 5 } : null;
        signals.push(...oddsMovementSignal(previousOdds, latestOdds, now));
        const oddsColumns = latestOdds ? { lastOddsMedian: latestOdds.median, lastOddsAt: latestOdds.at } : {};
        // Only official starting XI data, close to kickoff, can trigger this.
        if (row.kickoff.getTime() - now.getTime() <= 90 * 60_000) {
          const lineups = await getFixtureLineups(row.fixtureApiId).catch(() => null);
          const trimmed = trimConfirmedLineups(lineups, row.homeTeamApiId, row.awayTeamApiId);
          if (trimmed) signals.push(...confirmedLineupSignals(trimmed, old));
        }
        const unique = [...new Map(signals.map(s => [s.code, s])).values()];
        const next = reassessmentIntervalMinutes(now, row.kickoff);
        const nextCheckAt = new Date(now.getTime() + Math.max(15, next) * 60_000);
        const evidence = buildStoredContext(digest) as unknown as Prisma.InputJsonValue;
        if (!unique.length) {
          // A prior material change is NOT resolved just because it hasn't
          // changed again. Only a recorded review decision can clear the hold.
          const unresolved = row.reassessment?.status === "REVIEW_REQUIRED";
          const preservedStatus = unresolved ? "REVIEW_REQUIRED" : "CURRENT";
          const preservedSummary = unresolved
            ? row.reassessment?.summary ?? "A material change still requires review."
            : "No verified material changes detected.";
          await prisma.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: preservedStatus, checkedAt: now,
              nextCheckAt, lastEvidence: evidence, lastEvidenceAt: now, ...oddsColumns, summary: preservedSummary },
            update: { status: preservedStatus, checkedAt: now, nextCheckAt,
              lastEvidence: evidence, lastEvidenceAt: now, ...oddsColumns, summary: preservedSummary, lastError: null },
          });
          if (unresolved) report.flagged++;
          else report.current++;
          continue;
        }

        const newSignature = digestSignature(unique.map(s => s.code).sort());
        const alreadyRecorded = newSignature === row.reassessment?.lastChangeHash;
        const recordReceipt = shouldRecordReassessmentReceipt({
          mode, sameSignature: alreadyRecorded,
          existingStatus: row.reassessment?.status,
          publicHold: row.reassessment?.publicHold,
        });
        const criticalStatus = unique.find(s => s.source === "fixture" && s.severity === "CRITICAL");
        const isPaid = isPaidOnlyProvenance(row.provenance) || row.categories.some(c => c.category === "VIP" || c.category === "PREMIUM");
        const summary = unique.map(s => s.message).join(" ").slice(0, 1000);
        let proposed: { marketType: string; selection: unknown; confidence: number; reasoning: string } | null = null;

        // New evidence prompts a fresh assessment (NOT the editorial rewrite
        // path, which reuses stale evidence). Paid selections are assessed
        // read-only; their market evidence cannot be overwritten.
        if (mode === "on" && !criticalStatus && recordReceipt) {
          try {
            const risk = resolveGenerationRisk(row.categories.map(c => c.category), row.leagueApiId);
            const result = await generatePredictionForFixture({
              digest, tiers: risk.promptTiers, riskCalibration: risk.calibration !== "legacy",
              marketBreadth: "single",
            });
            const draft = result.output.predictions?.[0];
            if (draft && Number.isFinite(draft.confidence)
              && isValidSelection(draft.marketType as MarketType, draft.selection)) {
              proposed = {
                marketType: draft.marketType, selection: draft.selection,
                confidence: Math.min(90, Math.max(0, Math.round(draft.confidence))),
                reasoning: draft.reasoning,
              };
            }
          } catch (error) {
            report.failures.push(row.id + ": new evidence analysis: "
              + (error instanceof Error ? error.message : String(error)));
          }
        }

        const before = publishedSelectionSnapshot(row);
        const proposedJson = proposed as unknown as Prisma.InputJsonValue | undefined;
        const archived = mode === "on" && !!criticalStatus && !isPaid;
        const signalPayload = unique.map(s => ({ code: s.code, severity: s.severity, source: s.source, message: s.message }));
        const assessmentStatus = archived ? "WITHDRAWN" : "REVIEW_REQUIRED";
        const publicHold = mode === "on" && !archived;
        await prisma.$transaction(async tx => {
          if (archived) {
            // Strict conditional claim: simultaneous runners cannot archive
            // twice or create two withdrawal events.
            const claimed = await tx.prediction.updateMany({
              where: { id: row.id, status: "PUBLISHED" },
              data: { status: "ARCHIVED" },
            });
            if (claimed.count !== 1) return;
            const after = await tx.prediction.findUniqueOrThrow({ where: { id: row.id }, include: { categories: true } });
            await recordPredictionEvents(tx, row, after, "ARCHIVE");
          }
          await tx.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: assessmentStatus, publicHold, checkedAt: now,
              nextCheckAt, lastEvidence: evidence, lastEvidenceAt: now, ...oddsColumns,
              lastChangeHash: newSignature, summary,
              proposedMarket: proposed?.marketType ?? null,
              proposedSelection: proposedJson, proposedConfidence: proposed?.confidence ?? null },
            update: { status: assessmentStatus, publicHold, checkedAt: now, nextCheckAt,
              lastEvidence: evidence, lastEvidenceAt: now, ...oddsColumns,
              lastChangeHash: newSignature, summary, lastError: null,
              proposedMarket: proposed?.marketType ?? null,
              ...(proposedJson ? { proposedSelection: proposedJson } : {}),
              proposedConfidence: proposed?.confidence ?? null },
          });

          if (recordReceipt) {
            await tx.predictionRevision.create({
              data: { predictionId: row.id, kind: archived ? "WITHDRAWN" : "REVIEW_REQUIRED",
                publiclyVisible: mode === "on",
                reason: summary, beforeJson: before as unknown as Prisma.InputJsonValue,
                ...(proposedJson ? { afterJson: proposedJson } : {}),
                evidenceJson: signalPayload as unknown as Prisma.InputJsonValue },
            });
            if (mode === "on") {
              const event = await createNotificationEvent({
                eventKey: "prediction:" + row.id + ":reassessed:" + newSignature,
                type: archived ? "WITHDRAWN" : "TIP_CHANGED",
                title: archived ? "Prediction withdrawn" : "Prediction requires reassessment",
                body: summary.slice(0, 250), predictionId: row.id,
                fixtureApiId: row.fixtureApiId, leagueApiId: row.leagueApiId,
                teamApiIds: [row.homeTeamApiId, row.awayTeamApiId].filter((v): v is number => v != null),
                link: "/predictions/updates/" + row.id,
                data: { evidence: signalPayload, original: before },
              }, tx);
              // Saved selections retain their original snapshot; directly
              // notify those users in-app even if they do not follow a team.
              const saved = await tx.savedPrediction.findMany({
                where: { predictionId: row.id }, select: { userId: true },
              });
              if (saved.length) await tx.userNotification.createMany({
                data: saved.map(s => ({ userId: s.userId, eventId: event.id })),
                skipDuplicates: true,
              });
            }
          }
        });
        if (archived) report.withdrawn++;
        else report.flagged++;
      } catch (error) {
        report.failures.push(row.id + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    return finish();
  } finally {
    await prisma.appLock.deleteMany({ where: { key: LEASE_KEY, holder } });
  }
}
