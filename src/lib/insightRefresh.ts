/**
 * The Match Insights worker: keeps each upcoming team's fixture history
 * current and replaces its insights whenever that history or its target
 * fixture changes.
 *
 * Targets are the teams in published, unsettled predictions kicking off within
 * TARGET_HORIZON_MS. An insight is only ever shown against that next fixture
 * and expires at its kickoff, so nothing here describes a match that has
 * already been played.
 *
 * Freshness is what makes an insight accurate, so a history is refetched when
 * it is older than HISTORY_REFETCH_MS, or sooner when a match we know the team
 * played has finished since the fetch and is missing from it. A history that
 * is past HISTORY_MAX_AGE_MS, or known to be missing a finished match, is not
 * used at all: the team's insights are removed rather than shown stale.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getTeamRecentFixtures, type FixtureRow } from "@/lib/football/api-football";
import { regulationScoreOf } from "@/lib/settlement";
import { calculateInsights, HISTORY_SIZE, INSIGHT_VERSION, isInsightFixture, type InsightEvidence, type InsightFixture, type InsightScope } from "@/lib/insights";

export const JOB_REFRESH_INSIGHTS = "refresh-insights" as const;

export const TARGET_HORIZON_MS = 7 * 24 * 60 * 60_000;
export const HISTORY_REFETCH_MS = 6 * 60 * 60_000;
export const HISTORY_MAX_AGE_MS = 12 * 60 * 60_000;
/** A failed fetch is not retried for this long, so one bad team cannot eat every run's budget. */
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
/** Kickoff-to-final-whistle allowance, extra time and penalties included. */
const MATCH_DURATION_MS = 150 * 60_000;
export const DEFAULT_FETCH_LIMIT = 30;

/** Compact, verified form of a provider fixture. Score is regulation time, or null if it did not verify. */
export function compactFixture(row: FixtureRow): InsightFixture | null {
  if (!row?.fixture || !row.teams?.home || !row.teams?.away || !row.league) return null;
  const status = row.fixture.status?.short ?? "";
  let home: number | null = null;
  let away: number | null = null;
  if (["FT", "AET", "PEN"].includes(status)) {
    const regulation = regulationScoreOf(row);
    if (regulation.ok) {
      home = regulation.home;
      away = regulation.away;
    }
  }
  const compact: InsightFixture = {
    id: row.fixture.id,
    date: row.fixture.date,
    status,
    leagueId: row.league.id,
    leagueName: row.league.name,
    homeId: row.teams.home.id,
    homeName: row.teams.home.name,
    awayId: row.teams.away.id,
    awayName: row.teams.away.name,
    home,
    away,
  };
  return isInsightFixture(compact) ? compact : null;
}

type Target = {
  teamApiId: number;
  teamName: string;
  predictionId: string;
  kickoff: Date;
  /** The team's side in the target fixture; only that venue's form is relevant to it. */
  venue: "HOME" | "AWAY";
  leagueApiId: number | null;
  leagueName: string | null;
};

/** One target per team: its soonest published fixture. */
async function loadTargets(now: Date): Promise<Target[]> {
  const predictions = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED",
      outcome: "PENDING",
      kickoff: { gt: now, lte: new Date(now.getTime() + TARGET_HORIZON_MS) },
      homeTeamApiId: { not: null },
      awayTeamApiId: { not: null },
    },
    select: { id: true, kickoff: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, leagueApiId: true, leagueName: true },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
  });
  const targets = new Map<number, Target>();
  for (const p of predictions) {
    const sides: Array<[number, string | null, "HOME" | "AWAY"]> = [[p.homeTeamApiId!, p.homeTeam, "HOME"], [p.awayTeamApiId!, p.awayTeam, "AWAY"]];
    for (const [teamApiId, name, venue] of sides) {
      if (targets.has(teamApiId)) continue;
      targets.set(teamApiId, {
        teamApiId,
        teamName: name ?? String(teamApiId),
        predictionId: p.id,
        kickoff: p.kickoff!,
        venue,
        leagueApiId: p.leagueApiId,
        leagueName: p.leagueName,
      });
    }
  }
  return [...targets.values()];
}

type History = { teamApiId: number; fixtures: InsightFixture[]; fetchedAt: Date | null; lastAttemptAt: Date | null };

/**
 * Teams with a match we know about that should have finished after their
 * history was fetched, and which that history does not contain.
 */
async function teamsMissingAFinishedMatch(histories: Map<number, History>, teamIds: number[], now: Date): Promise<Set<number>> {
  const fetched = teamIds.map((id) => histories.get(id)?.fetchedAt).filter((d): d is Date => !!d);
  if (!fetched.length) return new Set();
  const earliest = new Date(Math.min(...fetched.map((d) => d.getTime())) - MATCH_DURATION_MS);
  const finishedBy = new Date(now.getTime() - MATCH_DURATION_MS);
  if (earliest >= finishedBy) return new Set();

  const known = await prisma.prediction.findMany({
    where: {
      kickoff: { gt: earliest, lte: finishedBy },
      OR: [{ homeTeamApiId: { in: teamIds } }, { awayTeamApiId: { in: teamIds } }],
    },
    select: { kickoff: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true },
  });

  const missing = new Set<number>();
  for (const match of known) {
    for (const teamApiId of [match.homeTeamApiId, match.awayTeamApiId]) {
      if (teamApiId == null || missing.has(teamApiId)) continue;
      const history = histories.get(teamApiId);
      if (!history?.fetchedAt) continue;
      // Only matches that were still unfinished when the history was fetched.
      if (match.kickoff!.getTime() <= history.fetchedAt.getTime() - MATCH_DURATION_MS) continue;
      const covered = history.fixtures.some((f) =>
        match.fixtureApiId != null
          ? f.id === match.fixtureApiId
          : Math.abs(Date.parse(f.date) - match.kickoff!.getTime()) <= 60 * 60_000 && (f.homeId === teamApiId || f.awayId === teamApiId),
      );
      if (!covered) missing.add(teamApiId);
    }
  }
  return missing;
}

async function fetchHistory(
  teamApiId: number,
  now: Date,
  fetcher: typeof getTeamRecentFixtures,
): Promise<{ ok: true; history: History } | { ok: false }> {
  let rows: FixtureRow[] | null = null;
  let error: string | null = null;
  try {
    rows = await fetcher(teamApiId, HISTORY_SIZE);
    if (rows === null) error = "provider returned no response";
  } catch (err: any) {
    error = String(err?.message ?? err).slice(0, 500);
  }
  if (rows === null) {
    await prisma.teamFixtureHistory.upsert({
      where: { teamApiId },
      update: { lastAttemptAt: now, lastError: error },
      create: { teamApiId, lastAttemptAt: now, lastError: error },
    });
    return { ok: false };
  }
  const fixtures = rows.map(compactFixture).filter((f): f is InsightFixture => f !== null);
  await prisma.teamFixtureHistory.upsert({
    where: { teamApiId },
    update: { fixtures, fetchedAt: now, lastAttemptAt: now, lastError: null },
    create: { teamApiId, fixtures, fetchedAt: now, lastAttemptAt: now, lastError: null },
  });
  return { ok: true, history: { teamApiId, fixtures, fetchedAt: now, lastAttemptAt: now } };
}

/** Every insight for one target, with duplicates across scopes removed. */
export function insightsForTarget(target: Target, fixtures: InsightFixture[], now: Date): InsightEvidence[] {
  // The provider's own spelling, when the history has it, beats whatever a prediction row stored.
  const latest = [...fixtures].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).find((f) => f.homeId === target.teamApiId || f.awayId === target.teamApiId);
  const teamName = latest ? (latest.homeId === target.teamApiId ? latest.homeName : latest.awayName) : target.teamName;
  const leagueName = fixtures.find((f) => f.leagueId === target.leagueApiId)?.leagueName ?? target.leagueName;

  const seen = new Set<string>();
  const out: InsightEvidence[] = [];
  const scopes: InsightScope[] = ["ALL", target.venue, "COMPETITION"];
  for (const scope of scopes) {
    const cutoff = now < target.kickoff ? now : target.kickoff;
    for (const evidence of calculateInsights(fixtures, { teamApiId: target.teamApiId, teamName, scope, leagueApiId: target.leagueApiId, leagueName, cutoff })) {
      // A COMPETITION sample identical to ALL (every recent match in one league) repeats it word for word.
      const signature = `${evidence.type}:${evidence.count}:${evidence.matches.map((m) => m.id).join(",")}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push(evidence);
    }
  }
  return out;
}

export type RefreshResult = {
  targets: number;
  fetched: number;
  fetchFailed: number;
  staleTeams: number;
  teamsWritten: number;
  insights: number;
  cleared: number;
};

export async function refreshMatchInsights(options: { fetchLimit?: number; now?: Date; fetcher?: typeof getTeamRecentFixtures } = {}): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const fetchLimit = options.fetchLimit ?? DEFAULT_FETCH_LIMIT;
  const fetcher = options.fetcher ?? getTeamRecentFixtures;

  const targets = await loadTargets(now);
  const teamIds = targets.map((t) => t.teamApiId);

  const stored = await prisma.teamFixtureHistory.findMany({ where: { teamApiId: { in: teamIds } } });
  const histories = new Map<number, History>(stored.map((h) => [h.teamApiId, {
    teamApiId: h.teamApiId,
    fixtures: Array.isArray(h.fixtures) ? (h.fixtures as unknown[]).filter(isInsightFixture) : [],
    fetchedAt: h.fetchedAt,
    lastAttemptAt: h.lastAttemptAt,
  }]));

  const missingMatch = await teamsMissingAFinishedMatch(histories, teamIds, now);
  const needsFetch = targets
    .filter((t) => {
      const h = histories.get(t.teamApiId);
      const recentFailure = h?.lastAttemptAt && (!h.fetchedAt || h.lastAttemptAt > h.fetchedAt) && now.getTime() - h.lastAttemptAt.getTime() < RETRY_AFTER_FAILURE_MS;
      if (recentFailure) return false;
      return !h?.fetchedAt || now.getTime() - h.fetchedAt.getTime() >= HISTORY_REFETCH_MS || missingMatch.has(t.teamApiId);
    })
    // Soonest kickoff first: those are the insights a reader is about to need.
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());

  let fetched = 0;
  let fetchFailed = 0;
  for (const target of needsFetch.slice(0, fetchLimit)) {
    const result = await fetchHistory(target.teamApiId, now, fetcher);
    if (result.ok) {
      histories.set(target.teamApiId, result.history);
      missingMatch.delete(target.teamApiId);
      fetched++;
    } else {
      fetchFailed++;
    }
  }

  const existing = await prisma.matchInsightCache.findMany({
    where: { teamApiId: { in: teamIds } },
    select: { teamApiId: true, insightKey: true, predictionId: true, refreshedAt: true, expiresAt: true, calculationVersion: true },
  });
  const existingSignature = new Map<number, string>();
  for (const teamApiId of teamIds) {
    const rows = existing.filter((r) => r.teamApiId === teamApiId).sort((a, b) => a.insightKey.localeCompare(b.insightKey));
    existingSignature.set(teamApiId, signatureOf(rows.map((r) => [r.insightKey, r.predictionId, r.refreshedAt.toISOString(), r.expiresAt.toISOString(), r.calculationVersion])));
  }

  let staleTeams = 0;
  let teamsWritten = 0;
  let insights = 0;
  for (const target of targets) {
    const history = histories.get(target.teamApiId);
    const usable = !!history?.fetchedAt
      && now.getTime() - history.fetchedAt.getTime() < HISTORY_MAX_AGE_MS
      && !missingMatch.has(target.teamApiId);
    if (!usable) staleTeams++;

    const evidence = usable ? insightsForTarget(target, history!.fixtures, now) : [];
    const refreshedAt = history?.fetchedAt ?? now;
    const expiresAt = new Date(Math.min(target.kickoff.getTime(), refreshedAt.getTime() + HISTORY_MAX_AGE_MS));
    const rows = evidence
      .map((e) => ({
        insightKey: `${target.teamApiId}:${e.scope}:${e.type}`,
        teamApiId: target.teamApiId,
        type: e.type,
        scope: e.scope,
        leagueApiId: target.leagueApiId,
        predictionId: target.predictionId,
        kickoff: target.kickoff,
        strength: e.strength,
        calculationVersion: INSIGHT_VERSION,
        evidence: e as unknown as object,
        refreshedAt,
        expiresAt,
      }))
      .sort((a, b) => a.insightKey.localeCompare(b.insightKey));
    insights += rows.length;

    const signature = signatureOf(rows.map((r) => [r.insightKey, r.predictionId, r.refreshedAt.toISOString(), r.expiresAt.toISOString(), r.calculationVersion]));
    if (signature === existingSignature.get(target.teamApiId)) continue;

    await prisma.$transaction([
      prisma.matchInsightCache.deleteMany({ where: { teamApiId: target.teamApiId } }),
      ...(rows.length ? [prisma.matchInsightCache.createMany({ data: rows })] : []),
    ]);
    teamsWritten++;
  }

  // Teams that are no longer anyone's next fixture, and anything past its kickoff.
  const cleared = await prisma.matchInsightCache.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { teamApiId: { notIn: teamIds } }] },
  });

  return { targets: targets.length, fetched, fetchFailed, staleTeams, teamsWritten, insights, cleared: cleared.count };
}

function signatureOf(parts: string[][]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
