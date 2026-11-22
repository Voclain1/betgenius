/**
 * Post-publication evidence monitoring. Never edits an already-published
 * selection or confidence, and NEVER auto-replaces paid picks.
 *
 * All reassessment modes write private monitoring and admin-only review cases.
 * No background path may hold, archive, rewrite, replace or notify about a published tip.
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUsageSnapshot } from "@/lib/football/usage";
import { getFixturesByIds, getFixtureLineups, withFootballCallFloor } from "@/lib/football/api-football";
import { trimConfirmedLineups } from "@/lib/lineups";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { buildStoredContext, parseStoredContext } from "@/lib/ai/context";
import { matchKey } from "@/lib/slug";
import { findSelection, toBookmakerSelection, type FixtureOdds } from "@/lib/odds";
import { matchOddsState } from "@/lib/matchOdds";
import { earlyQuotedSelection } from "@/lib/generation/earlyOddsPolicy";
import { isDedicatedEarlyFreeJob } from "@/lib/generation/earlyPublication";
import {
  compareFootballEvidence, confirmedLineupSignals, fixtureSignals, reassessmentIntervalMinutes, oddsMovementSignal, earlyOddsFloorCrossing,
  type EvidenceSignal, type FixtureEvidence,
  materialSignature,
} from "@/lib/reassessment/evidence";

export type ReassessmentMode = "off" | "shadow" | "on";

/** One append-only private receipt per new signal signature, regardless of rollout mode. */
export function shouldRecordReassessmentReceipt(input: {
  mode: ReassessmentMode; sameSignature: boolean;
  existingStatus: string | null | undefined;
  publicHold: boolean | null | undefined;
}): boolean {
  return !input.sameSignature;
}
export function reassessmentMode(value: string | undefined = process.env.PREDICTION_REASSESSMENT_MODE): ReassessmentMode {
  return value === "shadow" || value === "on" ? value : "off";
}

export const MAX_REASSESSMENTS_PER_RUN = 5;
/**
 * Unpublished generated picks (PENDING_REVIEW / held DRAFT) are also checked,
 * so admins see new evidence before deciding on them. Zero extra provider
 * calls: their fixture ids join the SAME batched status call (5 + 10 = 15 ≤ 20
 * ids, still one request), their evidence is always compared cache-only, and
 * official lineups are never fetched for them. Monitoring only: nothing in
 * publication reads these review cases.
 */
export const MAX_UNPUBLISHED_REASSESSMENTS_PER_RUN = 10;
const LEASE_KEY = "published-prediction-reassessment";
/**
 * Quota gates, split by what each part of a run costs (getUsageSnapshot().remaining).
 *
 * WAS a single 1,500 gate for everything. The verified production week
 * (docs/API_FOOTBALL_7_DAY_USAGE_REPORT.md) shows every UTC day ending with
 * 6,421–7,125 used, so monitoring of PUBLISHED picks (including VIP/Premium)
 * stood down for the late part of every day while live scores kept running
 * down to 1,000 — and the stand-down was silent (no reason in the summary).
 *
 * CORE monitoring needs: one batched /fixtures?ids call per run (≤20 ids),
 * official lineups only inside 90 min of kickoff (≤ MAX_REASSESSMENTS_PER_RUN),
 * and a CACHE-ONLY evidence comparison. At most 1 + 5 = 6 calls per run,
 * 96 runs/day ⇒ ≤ 576/day worst case. It runs down to 1,000 remaining —
 * the same floor as live scores, never below it — so it can never touch the
 * budget the early lane (750), ordinary generation (500) or the paid pass
 * (30, plus the 300 paid-only reserve) rely on.
 *
 * REFRESH monitoring additionally lets buildGenerationDigest refresh stale team,
 * league and head-to-head caches (up to ~11 calls per pick). That keeps the
 * original 1,500 floor. Between 1,000 and 1,500 the run compares against the
 * cached evidence the enrichment crons keep warm for published picks.
 */
export const REASSESSMENT_CORE_MIN_REMAINING = 1_000;
/** Marker for a check that could not load current team evidence (cleared by the next complete check). */
export const LATEST_EVIDENCE_UNAVAILABLE = "LATEST_EVIDENCE_UNAVAILABLE";
export const REASSESSMENT_REFRESH_MIN_REMAINING = 1_500;

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

/**
 * Repeat-alert suppression. The signature is value-sensitive
 * (materialSignature): a retained case stays closed while the SAME change is
 * seen again, and reopens when a different change of the same kind appears
 * (another kickoff move, another coach, a different absent key player).
 */
export function materialDecision(input: {
  signals: Array<Pick<EvidenceSignal, "code" | "identity">>;
  previousHash: string | null | undefined;
  previousStatus: string | null | undefined;
}): { signature: string; alreadyRecorded: boolean; retainedUnchanged: boolean } {
  const signature = digestSignature(materialSignature(input.signals));
  const alreadyRecorded = signature === input.previousHash;
  return { signature, alreadyRecorded, retainedUnchanged: alreadyRecorded && input.previousStatus === "CURRENT" };
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
  /** Why the run made no provider calls, or ran cache-only. Was silent before. */
  stoodDown?: string;
  evidenceMode?: "refresh" | "cache-only";
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
    report.summary = (report.stoodDown ? "Prediction monitoring stood down: " + report.stoodDown + "; " : "")
      + "Prediction monitoring " + mode + (report.evidenceMode === "cache-only" ? " (cache-only evidence)" : "") + ": checked " + report.checked
      + ", current " + report.current + ", review " + report.flagged + ", withdrawn "
      + report.withdrawn + ", errors " + report.failures.length;
    return report;
  };
  if (mode === "off") return finish();
  const budget = await getUsageSnapshot();
  // Every provider call below re-checks this floor (withFootballCallFloor), so
  // the run cannot take the day below it however many calls it makes.
  if (budget.remaining <= REASSESSMENT_CORE_MIN_REMAINING) {
    report.skipped++;
    report.stoodDown = "api-football quota headroom too low (" + budget.remaining + " left, needs " + REASSESSMENT_CORE_MIN_REMAINING + ")";
    return finish();
  }
  const cacheOnlyEvidence = budget.remaining < REASSESSMENT_REFRESH_MIN_REMAINING;
  report.evidenceMode = cacheOnlyEvidence ? "cache-only" : "refresh";
  const holder = await claimRun(now);
  if (!holder) { report.skipped++; return finish(); }
  try {
    const limit = Math.max(1, Math.min(MAX_REASSESSMENTS_PER_RUN, Math.trunc(input.limit ?? MAX_REASSESSMENTS_PER_RUN)));
    // Fetch near and 8–14-day windows independently. Otherwise a busy
    // near-kickoff slate fills the 500-row cap and early posts are never read.
    const include = {
      aiJob: { select: { context: true, prompt: true } },
      categories: true, reassessment: true,
    } as const;
    const sevenDays = new Date(now.getTime() + 7 * 86_400_000);
    const fourteenDays = new Date(now.getTime() + 14 * 86_400_000);
    const [near, early] = await Promise.all([
      prisma.prediction.findMany({
        where: { status: "PUBLISHED", kickoff: { gt: now, lte: sevenDays },
          fixtureApiId: { not: null } },
        include, orderBy: [{ kickoff: "asc" }, { publishedAt: "asc" }], take: 500,
      }),
      prisma.prediction.findMany({
        where: { status: "PUBLISHED", kickoff: { gt: sevenDays, lte: fourteenDays },
          fixtureApiId: { not: null } },
        include, orderBy: [{ kickoff: "asc" }, { publishedAt: "asc" }], take: 400,
      }),
    ]);
    const unpublished = await prisma.prediction.findMany({
      where: { status: { in: ["PENDING_REVIEW", "DRAFT"] }, aiJobId: { not: null },
        kickoff: { gt: now, lte: fourteenDays }, fixtureApiId: { not: null } },
      include, orderBy: [{ kickoff: "asc" }, { id: "asc" }], take: 400,
    });
    const unpublishedDue = unpublished
      .filter(row => !row.reassessment?.nextCheckAt || row.reassessment.nextCheckAt <= now)
      .sort((a, b) => (a.reassessment?.nextCheckAt?.getTime() ?? 0) - (b.reassessment?.nextCheckAt?.getTime() ?? 0)
        || (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0))
      .slice(0, MAX_UNPUBLISHED_REASSESSMENTS_PER_RUN);
    const publishedDue = [...near, ...early]
      .filter(row => !row.reassessment?.nextCheckAt || row.reassessment.nextCheckAt <= now)
      .sort((a, b) => {
        // Within 6h of kickoff, freshness takes priority. Otherwise check the
        // oldest overdue/never-checked first so early picks aren't starved.
        const urgent = (r: typeof a) => Number(!!r.kickoff && r.kickoff.getTime() - now.getTime() <= 6 * 3_600_000);
        return urgent(b) - urgent(a) ||
          (a.reassessment?.nextCheckAt?.getTime() ?? 0) - (b.reassessment?.nextCheckAt?.getTime() ?? 0) ||
          (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0);
      }).slice(0, limit);
    // Published first: an unpublished check never displaces a published one.
    const candidates = [...publishedDue, ...unpublishedDue];
    const ids = [...new Set(candidates.map(r => r.fixtureApiId).filter((v): v is number => v != null))];
    // One provider call per 20 fixture IDs. Failure means unknown, not cancellation.
    const freshFixtures = ids.length
      ? await withFootballCallFloor(REASSESSMENT_CORE_MIN_REMAINING, () => getFixturesByIds(ids)) : [];
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
        // Re-read before each row: earlier rows (and other jobs) spend quota.
        const refreshThisRow = !cacheOnlyEvidence && row.status === "PUBLISHED"
          && (await getUsageSnapshot()).remaining > REASSESSMENT_REFRESH_MIN_REMAINING;
        const league = row.leagueName, kickoffIso = row.kickoff.toISOString();
        const { digest, sources } = await withFootballCallFloor(REASSESSMENT_REFRESH_MIN_REMAINING, () => buildGenerationDigest({
          home: row.homeTeam ?? "", away: row.awayTeam ?? "", league,
          kickoff: kickoffIso, homeApiId: row.homeTeamApiId,
          awayApiId: row.awayTeamApiId, leagueApiId: row.leagueApiId, round: null,
          // Below the refresh floor: compare against the caches the enrichment
          // crons keep warm, with no refresh calls (see the gates above).
          cacheOnly: !refreshThisRow,
        }));
        // Provider-verified cancellation overrides missing statistical feeds:
        // a postponed fixture must not stay recommended because its teams'
        // enrichment requests failed. Other changes still fail closed.
        const criticalFixtureAlreadyKnown = signals.some(s => s.source === "fixture" && s.severity === "CRITICAL");
        if ((sources.homeTeam === "missing" || sources.awayTeam === "missing") && !criticalFixtureAlreadyKnown) {
          // A failed refresh never clears an open review (like the other
          // missing-data branches): the case, its signal, summary, signature
          // and snapshot stay exactly as recorded, so the administrator can
          // still resolve it. Only the check time and an "evidence
          // unavailable" marker change; the next complete check clears it.
          const keepReview = row.reassessment?.status === "REVIEW_REQUIRED";
          const unavailable = "One or both teams lack current evidence; no assumption of unchanged conditions.";
          await prisma.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: "UNKNOWN", checkedAt: now,
              nextCheckAt: new Date(now.getTime() + 3_600_000), summary: unavailable, lastError: LATEST_EVIDENCE_UNAVAILABLE },
            update: keepReview
              ? { checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000), lastError: LATEST_EVIDENCE_UNAVAILABLE }
              : { status: "UNKNOWN", checkedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000), summary: unavailable, lastError: LATEST_EVIDENCE_UNAVAILABLE },
          });
          if (keepReview) report.flagged++;
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
        // Preserve the match-page 2h clock for ordinary picks. Only the
        // dedicated EARLY FREE lane may use a lead-time-aware quote window.
        const isEarlyFree = isDedicatedEarlyFreeJob(row.aiJob?.prompt, row.fixtureApiId);
        const earlyQuote = isEarlyFree ? earlyQuotedSelection({
          odds, fetchedAt: quoteCache?.fetchedAt ?? null, kickoff: row.kickoff,
          now, marketType: row.marketType, selection: row.selection,
          allowBelowFloor: true,
        }) : null;
        const latestOdds = earlyQuote?.ok
          ? { median: earlyQuote.quote.median, bookmakers: earlyQuote.quote.bookmakers,
              at: earlyQuote.quote.providerAt }
          : quote && oddsState?.asOf && quote.bookmakers >= 5
              && Number.isFinite(quote.median) && quote.median > 1
            ? { median: quote.median, bookmakers: quote.bookmakers, at: oddsState.asOf }
            : null;
        const previousOdds = row.reassessment?.lastOddsMedian && row.reassessment.lastOddsAt
          ? { median: row.reassessment.lastOddsMedian, at: row.reassessment.lastOddsAt,
              bookmakers: isEarlyFree ? 3 : 5 } : null;
        signals.push(...oddsMovementSignal(previousOdds, latestOdds, now, isEarlyFree ? row.kickoff : undefined));
        if (isEarlyFree) signals.push(...earlyOddsFloorCrossing(previousOdds, latestOdds, now, row.kickoff));
        const oddsColumns = latestOdds ? { lastOddsMedian: latestOdds.median, lastOddsAt: latestOdds.at } : {};
        // Only official starting XI data, close to kickoff, can trigger this.
        if (row.status === "PUBLISHED" && row.kickoff.getTime() - now.getTime() <= 90 * 60_000) {
          const lineups = await withFootballCallFloor(REASSESSMENT_CORE_MIN_REMAINING, () => getFixtureLineups(row.fixtureApiId!)).catch(() => null);
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

        const { signature: newSignature, alreadyRecorded, retainedUnchanged } = materialDecision({
          signals: unique, previousHash: row.reassessment?.lastChangeHash, previousStatus: row.reassessment?.status });
        // An administrator explicitly retained this exact evidence signature:
        // a subsequent monitoring pass must not override that human decision.
        if (retainedUnchanged) {
          await prisma.predictionReassessment.update({
            where: { predictionId: row.id },
            data: { checkedAt: now, nextCheckAt, lastEvidence: evidence,
              lastEvidenceAt: now, ...oddsColumns, publicHold: false, lastError: null },
          });
          report.current++;
          continue;
        }
        const recordReceipt = shouldRecordReassessmentReceipt({
          mode, sameSignature: alreadyRecorded,
          existingStatus: row.reassessment?.status,
          publicHold: row.reassessment?.publicHold,
        });
        const summary = unique.map(s => s.message).join(" ").slice(0, 1000);
        const before = publishedSelectionSnapshot(row);
        const signalPayload = unique.map(s => ({
          code: s.code, severity: s.severity, source: s.source, message: s.message, ...(s.identity ? { identity: s.identity } : {}),
        }));
        // Monitoring is read-only with respect to published selections.
        // Even a critical cancellation is exclusively an administrator's decision.
        await prisma.$transaction(async tx => {
          await tx.predictionReassessment.upsert({
            where: { predictionId: row.id },
            create: { predictionId: row.id, status: "REVIEW_REQUIRED", publicHold: false,
              checkedAt: now, nextCheckAt, lastEvidence: evidence, lastEvidenceAt: now,
              ...oddsColumns, lastChangeHash: newSignature, summary },
            update: { status: "REVIEW_REQUIRED", publicHold: false,
              checkedAt: now, nextCheckAt, lastEvidence: evidence, lastEvidenceAt: now,
              ...oddsColumns, lastChangeHash: newSignature, summary, lastError: null },
          });
          if (recordReceipt) {
            await tx.predictionRevision.create({
              data: { predictionId: row.id, kind: "REVIEW_REQUIRED",
                publiclyVisible: false, reason: summary,
                beforeJson: before as unknown as Prisma.InputJsonValue,
                evidenceJson: signalPayload as Prisma.InputJsonValue },
            });
          }
        });
        report.flagged++;
      } catch (error) {
        report.failures.push(row.id + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    return finish();
  } finally {
    await prisma.appLock.deleteMany({ where: { key: LEASE_KEY, holder } });
  }
}
