import { prisma } from "@/lib/prisma";
import { getFixturesByDate, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot } from "@/lib/football/usage";
import { refreshOddsCache } from "@/lib/enrichment";
import { sweepDates, type OddsKnowledge } from "@/lib/generation/coverage";
import { matchKey } from "@/lib/slug";
import type { FixtureOdds } from "@/lib/odds";
import type { Selection } from "@/lib/markets";
import {
  EUROPEAN_CLUB_INTENT,
  EUROPEAN_LANE_BACKOFF_PREFIX,
  EUROPEAN_LANE_POLICY,
  EUROPEAN_LANE_SWEEP_KEY,
  LANE_RETRYABLE_VALUE_REASONS,
  UEFA_CLUB_COMPETITION_IDS,
  europeanClubsFromLedger,
  europeanSeasonStart,
  isLaneDomesticLeague,
  judgeLaneDrafts,
  laneValueVerdict,
  parseLaneSweep,
  planLaneSweep,
  planLaneTargets,
  readLaneAttempt,
  type Covered,
  type EuropeanClub,
  type LaneAttempt,
  type LaneCandidate,
  type LaneDraftJudgement,
  type LaneSweepRecord,
  type LaneTargets,
  type LaneValue,
  type LaneValueRejection,
} from "@/lib/europeanClubs";

/**
 * Database and provider side of the European-club lane. The rules are in
 * src/lib/europeanClubs.ts; this gathers their inputs and applies their
 * verdicts.
 *
 * Never writes the GenerationAttempt ledger. It reads it twice: for who played
 * in Europe this season, and to stay off any fixture another path already owns.
 */

/** Far enough back to cover every kickoff the 48h window can still reach. */
const ATTEMPT_LOOKBACK_MS = 4 * 24 * 3_600_000;

/** Lane-intent AIJobs in the lookback. Same narrowing as loadGoalsAttempts. */
export async function loadLaneAttempts(now: Date = new Date()): Promise<LaneAttempt[]> {
  const jobs = await prisma.aIJob.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - ATTEMPT_LOOKBACK_MS) }, prompt: { contains: `"intent":"${EUROPEAN_CLUB_INTENT}"` } },
    select: { prompt: true, createdAt: true },
  });
  return jobs.map((j) => readLaneAttempt(j.prompt, j.createdAt)).filter((a): a is LaneAttempt => a !== null);
}

/**
 * Fixtures the lane has generated for, so the adaptive slate count can leave
 * them out (src/lib/generation/queue.ts countViableSlate). Never throws: a
 * failed read must not take the scope decision down with it, and an empty set
 * is exactly the pre-lane behaviour.
 */
export async function laneFixtureIds(now: Date = new Date()): Promise<Set<number>> {
  try {
    return new Set((await loadLaneAttempts(now)).map((a) => a.fixtureApiId));
  } catch (error) {
    console.error("[european-lane] could not read lane attempts; slate counted without the exclusion", error);
    return new Set();
  }
}

/** Main-stage UEFA clubs this season, from the ledger. Zero provider calls. */
export async function loadEuropeanClubs(now: Date = new Date()): Promise<Map<number, EuropeanClub>> {
  const rows = await prisma.generationAttempt.findMany({
    where: { leagueApiId: { in: [...UEFA_CLUB_COMPETITION_IDS] }, kickoff: { gte: europeanSeasonStart(now) }, round: { not: null } },
    select: { leagueApiId: true, round: true, matchKey: true, kickoff: true, homeTeam: true, awayTeam: true },
  });
  return europeanClubsFromLedger(rows, now);
}

/**
 * Everything another path already owns: any prediction (any status, including
 * ARCHIVED, the same rule candidatesFromFixtures applies) or any ledger row.
 */
async function loadCovered(fixtures: ReadonlyArray<{ fixtureApiId: number; matchKey: string }>, now: Date): Promise<Covered> {
  if (!fixtures.length) return { fixtureIds: new Set(), matchKeys: new Set() };
  const ids = fixtures.map((f) => f.fixtureApiId);
  const keys = fixtures.map((f) => f.matchKey);
  const teamIds = [...new Set(keys.flatMap((k) => k.split("-").slice(0, 2).map(Number)).filter(Number.isFinite))];
  const [predictions, ledger] = await Promise.all([
    prisma.prediction.findMany({
      // By id, or by the matchKey's teams for rows written before ids were
      // captured. The kickoff floor only bounds the team read: every lane
      // fixture is at least 12h ahead.
      where: { OR: [{ fixtureApiId: { in: ids } }, { homeTeamApiId: { in: teamIds }, kickoff: { gte: new Date(now.getTime() - 86_400_000) } }] },
      select: { fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true },
    }),
    prisma.generationAttempt.findMany({
      where: { OR: [{ fixtureApiId: { in: ids } }, { matchKey: { in: keys } }] },
      select: { fixtureApiId: true, matchKey: true },
    }),
  ]);
  const fixtureIds = new Set<number>();
  const matchKeys = new Set<string>();
  for (const p of predictions) {
    if (p.fixtureApiId != null) fixtureIds.add(p.fixtureApiId);
    const key = matchKey(p);
    if (key) matchKeys.add(key);
  }
  for (const l of ledger) {
    if (l.fixtureApiId != null) fixtureIds.add(l.fixtureApiId);
    matchKeys.add(l.matchKey);
  }
  return { fixtureIds, matchKeys };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Claim the sweep row once its lease has expired. One statement: the INSERT
 * wins when no row exists, and ON CONFLICT ... WHERE only updates an expired
 * one, so a run that gets no row back did not win. The holder is NOT touched by
 * the claim: it carries the previous sweep's result, which is returned so a
 * failed sweep can put it back.
 */
async function claimSweep(now: Date): Promise<{ previous: LaneSweepRecord | null } | null> {
  const expiresAt = new Date(now.getTime() + EUROPEAN_LANE_POLICY.SWEEP_INTERVAL_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${EUROPEAN_LANE_SWEEP_KEY}, ${"{}"}, ${now}, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE
      SET "acquiredAt" = EXCLUDED."acquiredAt", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "AppLock"."expiresAt" <= ${now}
    RETURNING "holder"
  `;
  return rows.length ? { previous: parseLaneSweep(rows[0].holder) } : null;
}

export type LaneSweepReport = {
  ran: boolean;
  skippedReason: string | null;
  dates: string[];
  providerCalls: number;
  fixturesInPayload: number;
  clubs: number;
  considered: number;
  rejected: LaneSweepRecord["rejected"];
  candidates: Array<{ fixture: string; league: string; kickoff: string; club: string }>;
};

/**
 * Refresh the candidate list when the lease says it is due: 2–3 by-date calls,
 * every competition at once. Returns ran=false when not due, which is the
 * normal case; the caller then generates from the stored list instead.
 */
export async function sweepEuropeanLaneIfDue(now: Date = new Date()): Promise<LaneSweepReport> {
  const report: LaneSweepReport = { ran: false, skippedReason: null, dates: [], providerCalls: 0, fixturesInPayload: 0, clubs: 0, considered: 0, rejected: {}, candidates: [] };

  const usage = await getUsageSnapshot().catch(() => null);
  if (usage && usage.remaining < EUROPEAN_LANE_POLICY.MIN_QUOTA_REMAINING) {
    report.skippedReason = `api-football quota headroom too low (${usage.remaining} left, the lane needs ${EUROPEAN_LANE_POLICY.MIN_QUOTA_REMAINING})`;
    return report;
  }

  const clubs = await loadEuropeanClubs(now);
  report.clubs = clubs.size;
  if (!clubs.size) {
    // Nothing to look for, so spend nothing; the lease is left alone, so the
    // first run after the league stage starts sweeps straight away.
    report.skippedReason = "no main-stage UEFA club found in the ledger for this season yet";
    return report;
  }

  const claim = await claimSweep(now);
  if (!claim) {
    report.skippedReason = `swept within the last ${EUROPEAN_LANE_POLICY.SWEEP_INTERVAL_MINUTES} minutes`;
    return report;
  }

  report.ran = true;
  report.dates = sweepDates(now);
  const rows: FixtureRow[] = [];
  let failed = 0;
  for (const date of report.dates) {
    const day = await getFixturesByDate(date);
    report.providerCalls++;
    if (day) rows.push(...day);
    else failed++;
  }
  report.fixturesInPayload = rows.length;

  if (failed === report.dates.length) {
    // Keep what the last good sweep found, and retry sooner than the full interval.
    await prisma.appLock.update({
      where: { key: EUROPEAN_LANE_SWEEP_KEY },
      data: {
        holder: claim.previous ? JSON.stringify(claim.previous) : "{}",
        expiresAt: new Date(now.getTime() + EUROPEAN_LANE_POLICY.SWEEP_RETRY_MINUTES * 60_000),
      },
    });
    report.skippedReason = "every by-date call failed; previous candidate list kept";
    return report;
  }

  const laneRows = rows.filter((r) => isLaneDomesticLeague(r.league?.id));
  const refs = laneRows
    .map((r) => ({ fixtureApiId: r.fixture?.id, matchKey: matchKey({ homeTeamApiId: r.teams?.home?.id, awayTeamApiId: r.teams?.away?.id, kickoff: r.fixture?.date }) }))
    .filter((r): r is { fixtureApiId: number; matchKey: string } => Number.isInteger(r.fixtureApiId) && !!r.matchKey);
  const [covered, oddsRows] = await Promise.all([
    loadCovered(refs, now),
    refs.length
      ? prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: refs.map((r) => r.matchKey) } }, select: { matchKey: true, bookmakerCount: true, fetchedAt: true } })
      : Promise.resolve([]),
  ]);
  const oddsByMatchKey = new Map<string, OddsKnowledge>(oddsRows.map((o) => [o.matchKey, { bookmakerCount: o.bookmakerCount, fetchedAt: o.fetchedAt }]));

  const plan = planLaneSweep(laneRows, { clubs, covered, now, oddsByMatchKey });
  const record: LaneSweepRecord = {
    version: 1,
    token: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sweptAt: now.toISOString(),
    dates: report.dates,
    clubs: clubs.size,
    considered: plan.considered,
    rejected: plan.rejected,
    candidates: plan.candidates,
  };
  await prisma.appLock.update({ where: { key: EUROPEAN_LANE_SWEEP_KEY }, data: { holder: JSON.stringify(record) } });

  report.considered = plan.considered;
  report.rejected = plan.rejected;
  report.candidates = plan.candidates.map((c) => ({
    fixture: `${c.homeTeam} vs ${c.awayTeam}`,
    league: c.leagueName,
    kickoff: c.kickoff,
    club: c.clubSides.map((s) => (s === "home" ? c.homeTeam : c.awayTeam)).join(" & "),
  }));
  return report;
}

// ---------------------------------------------------------------------------
// Choosing the fixture
// ---------------------------------------------------------------------------

async function readOdds(key: string): Promise<{ odds: FixtureOdds | null; fetchedAt: Date | null }> {
  const row = await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true } });
  return { odds: (row?.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: row?.fetchedAt ?? null };
}

export type LaneSelection = LaneTargets & {
  sweptAt: string | null;
  storedCandidates: number;
  oddsCalls: number;
  /** Every fixture the value gate looked at this run, and what it said. */
  evaluated: Array<{ fixture: string; ok: boolean; reason?: LaneValueRejection; detail?: string; value?: LaneValue }>;
  target: (LaneCandidate & { value: LaneValue }) | null;
};

/**
 * The fixture to generate this run, or none. Walks the eligible candidates in
 * priority order through the market-first value gate, re-pricing at most
 * ODDS_WARM_PER_RUN of them when their quote is missing or stale.
 */
export async function selectLaneTarget(now: Date = new Date()): Promise<LaneSelection> {
  const [sweepRow, attempts, backoffs] = await Promise.all([
    prisma.appLock.findUnique({ where: { key: EUROPEAN_LANE_SWEEP_KEY }, select: { holder: true } }),
    loadLaneAttempts(now),
    prisma.appLock.findMany({ where: { key: { startsWith: EUROPEAN_LANE_BACKOFF_PREFIX }, expiresAt: { gt: now } }, select: { key: true } }),
  ]);
  const record = parseLaneSweep(sweepRow?.holder);
  const candidates = record?.candidates ?? [];
  const backingOff = new Set(backoffs.map((b) => Number(b.key.slice(EUROPEAN_LANE_BACKOFF_PREFIX.length))).filter(Number.isFinite));
  // Re-read at run time: the sweep can be up to three hours old, and ordinary
  // generation may have taken a fixture since (a thin day widens into it).
  const covered = await loadCovered(candidates, now);
  const plan = planLaneTargets({ candidates, attempts, backingOff, covered, now });

  const selection: LaneSelection = { ...plan, sweptAt: record?.sweptAt ?? null, storedCandidates: candidates.length, oddsCalls: 0, evaluated: [], target: null };
  if (plan.stoodDown) return selection;

  for (const c of plan.ordered) {
    const label = `${c.homeTeam} vs ${c.awayTeam}`;
    let { odds, fetchedAt } = await readOdds(c.matchKey);
    let verdict = laneValueVerdict(odds, fetchedAt, c.clubSides, now);
    if (!verdict.ok && LANE_RETRYABLE_VALUE_REASONS.includes(verdict.reason) && selection.oddsCalls < EUROPEAN_LANE_POLICY.ODDS_WARM_PER_RUN) {
      selection.oddsCalls++;
      await refreshOddsCache({ matchKey: c.matchKey, fixtureApiId: c.fixtureApiId, kickoff: new Date(c.kickoff), kind: "candidate" });
      ({ odds, fetchedAt } = await readOdds(c.matchKey));
      verdict = laneValueVerdict(odds, fetchedAt, c.clubSides, now);
    }
    if (verdict.ok) {
      selection.evaluated.push({ fixture: label, ok: true, value: verdict.value });
      selection.target = { ...c, value: verdict.value };
      break;
    }
    selection.evaluated.push({ fixture: label, ok: false, reason: verdict.reason, detail: verdict.detail });
  }
  if (!selection.target) {
    selection.stoodDown = selection.evaluated.length
      ? "no candidate cleared the market value gate this run"
      : "no eligible European-club fixture in the window";
  }
  return selection;
}

// ---------------------------------------------------------------------------
// After generating
// ---------------------------------------------------------------------------

export type LaneJudgementReport = {
  kept: { id: string; pick: string; confidence: number; market: number | null; gapPP: number | null; bookmakers: number | null } | null;
  archived: Array<{ id: string; pick: string; confidence: number; reason: string; detail?: string }>;
};

/**
 * Judge this run's drafts against the market and archive every one that is not
 * kept. The kept draft is left PENDING_REVIEW for a human, exactly like an
 * ordinary pick: the lane decides what reaches review, never what is published.
 */
export async function judgeAndArchiveLaneDrafts(predictionIds: string[], key: string, now: Date = new Date()): Promise<LaneJudgementReport> {
  const rows = await prisma.prediction.findMany({
    where: { id: { in: predictionIds } },
    select: { id: true, marketType: true, selection: true, confidence: true, pick: true },
  });
  const { odds, fetchedAt } = await readOdds(key);
  const judged: LaneDraftJudgement[] = judgeLaneDrafts(
    rows.map((r) => ({ id: r.id, marketType: r.marketType, selection: r.selection as Selection, confidence: r.confidence })),
    odds,
    fetchedAt,
    now,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const archive = judged.filter((j) => !j.kept).map((j) => j.id);
  if (archive.length) {
    await prisma.prediction.updateMany({ where: { id: { in: archive }, status: "PENDING_REVIEW" }, data: { status: "ARCHIVED" } });
  }
  const kept = judged.find((j) => j.kept) ?? null;
  return {
    kept: kept
      ? {
          id: kept.id,
          pick: byId.get(kept.id)?.pick ?? "",
          confidence: kept.verdict.modelProbability,
          market: kept.verdict.marketProbability,
          gapPP: kept.verdict.gapPP,
          bookmakers: kept.verdict.bookmakers,
        }
      : null,
    archived: judged
      .filter((j) => !j.kept)
      .map((j) => ({ id: j.id, pick: byId.get(j.id)?.pick ?? "", confidence: j.verdict.modelProbability, reason: j.reason ?? "UNKNOWN", detail: j.verdict.detail })),
  };
}

/** Hold a fixture off after its run threw before anything could be judged. */
export async function backOffLaneFixture(fixtureApiId: number, now: Date = new Date()): Promise<void> {
  const key = `${EUROPEAN_LANE_BACKOFF_PREFIX}${fixtureApiId}`;
  const expiresAt = new Date(now.getTime() + EUROPEAN_LANE_POLICY.RETRY_BACKOFF_MS);
  await prisma.appLock
    .upsert({ where: { key }, create: { key, holder: "retry", acquiredAt: now, expiresAt }, update: { acquiredAt: now, expiresAt } })
    .catch((error) => console.error("[european-lane] could not record the retry backoff", error));
}
