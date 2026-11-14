/**
 * Pure extraction logic: no database, no network, no clock.
 *
 * The extractor CLI (extract.ts) reads rows inside a read-only snapshot and
 * hands them here; everything that decides what is included, which context is
 * used, and what counts as an observation lives in this file so it can be
 * tested against synthetic rows (check-extract-core.ts) without a database.
 *
 * Point-in-time posture. A stored context's timestamp is necessary but not
 * sufficient: it proves the context was assembled before kickoff, not that each
 * number in it was historically valid. So this module:
 *   - selects the earliest context created strictly before kickoff;
 *   - exports only RAW match observations (with the moment they were recorded),
 *     never the context's season aggregates, standings or availability, which
 *     are recorded in the audit and nowhere else;
 *   - leaves the decision of which observations a fixture may see to the
 *     modelling side's ledger, which applies one rule to every source.
 */

import { parseStoredContext } from "../../../src/lib/ai/context";
import type { MatchDigest } from "../../../src/lib/ai/digest";
import { resolveMarket, MARKET_TYPES, type MarketType, type Selection } from "../../../src/lib/markets";
import type {
  CandidateJob, ContextAudit, EnginePrediction, FixtureExclusion, FixtureRecord, JobVerdict, Observation,
} from "./schema";

/** Two stored kickoffs for one fixture further apart than this are a conflict, not clock noise. Same tolerance as src/lib/generation/kickoffAssert.ts. */
export const KICKOFF_TOLERANCE_MS = 60_000;
/** A context whose own kickoff is this far from the fixture's was built for a different date (a reschedule) and is not used. */
export const CONTEXT_KICKOFF_TOLERANCE_MS = 36 * 3_600_000;
/** Markets whose recorded outcome is cross-checked against the final score. */
const CROSS_CHECK_MARKETS: ReadonlySet<string> = new Set(["MATCH_WINNER", "DOUBLE_CHANCE", "OVER_UNDER", "BTTS"]);

export type PredictionRow = {
  id: string;
  fixtureApiId: number;
  leagueApiId: number | null;
  leagueName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  outcome: string;
  settledAt: Date | null;
  marketType: string;
  selection: unknown;
  confidence: number;
  createdAt: Date;
  aiJobId: string | null;
};

/** A job after its context has been parsed. The raw context is dropped immediately: v1 payloads run to ~150KB each. */
export type ParsedJob = {
  id: string;
  createdAt: Date;
  model: string | null;
  hasContext: boolean;
  version: number | null;
  digest: MatchDigest | null;
};

const iso = (d: Date) => d.toISOString();
/** Code-unit string order: locale-independent, so output is byte-identical on every machine. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export function parseJob(row: { id: string; createdAt: Date; model: string | null; context: unknown }): ParsedJob {
  const raw = row.context;
  const hasContext = raw !== null && raw !== undefined;
  const v = hasContext && typeof raw === "object" ? (raw as { v?: unknown }).v : null;
  let digest: MatchDigest | null = null;
  try {
    digest = hasContext ? parseStoredContext(raw) : null;
  } catch {
    // A malformed v1 payload can throw inside buildMatchDigest. Unparseable, not fatal.
    digest = null;
  }
  return { id: row.id, createdAt: row.createdAt, model: row.model, hasContext, version: typeof v === "number" ? v : null, digest };
}

function distinct<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((v): v is T => v !== null && v !== undefined))];
}

export function auditContext(digest: MatchDigest, createdAt: Date): ContextAudit {
  const day = utcDay(createdAt);
  const { home, away } = digest.teams;
  let sameDay = 0, future = 0, missing = 0;
  for (const t of [home, away]) {
    for (const e of t.last5 ?? []) {
      if (e.goalsFor == null || e.goalsAgainst == null || e.result === "?") missing++;
      if (e.date === day) sameDay++;
      else if (e.date > day) future++;
    }
  }
  const futureAvailability = [home.availabilityAsOf, away.availabilityAsOf].some((d) => typeof d === "string" && d > day);
  return {
    both_season_records: !!home.overall && !!away.overall,
    both_recent_matches: (home.last5?.length ?? 0) > 0 && (away.last5?.length ?? 0) > 0,
    standings: digest.standings !== null && digest.standings !== undefined,
    h2h: digest.h2h !== null && digest.h2h !== undefined,
    availability: home.availabilityAsOf !== null || away.availabilityAsOf !== null,
    availability_future_dated: futureAvailability,
    last5_same_day: sameDay,
    last5_future_dated: future,
    last5_missing_score: missing,
  };
}

/** Why a job cannot serve as this fixture's pre-kickoff context, or null if it can. */
export function judgeJob(
  job: ParsedJob | undefined,
  fixture: { kickoff: Date; homeId: number; awayId: number },
): Exclude<JobVerdict, "selected" | "valid_not_earliest"> | null {
  if (!job) return "job_not_found";
  if (!job.hasContext) return "context_missing";
  if (!job.digest) return "context_unparseable";
  if (job.createdAt.getTime() >= fixture.kickoff.getTime()) return "context_at_or_after_kickoff";
  const h = job.digest.teams.home.apiId, a = job.digest.teams.away.apiId;
  // A null id (an unrecoverable v1 name match) is not a contradiction; it only
  // means that side contributes no oriented observations. A DIFFERENT id is.
  if ((h != null && h !== fixture.homeId) || (a != null && a !== fixture.awayId)) return "context_team_mismatch";
  const ck = Date.parse(job.digest.fixture?.kickoff ?? "");
  if (Number.isFinite(ck) && Math.abs(ck - fixture.kickoff.getTime()) > CONTEXT_KICKOFF_TOLERANCE_MS) return "context_kickoff_mismatch";
  return null;
}

/**
 * Consolidate every prediction row for one provider fixture id into a single
 * record, validating identity, kickoff, score and outcome consistency, and
 * selecting the earliest valid pre-kickoff context.
 */
export function consolidateFixture(fixtureId: number, rows: PredictionRow[], jobs: ReadonlyMap<string, ParsedJob>): FixtureRecord {
  const reasons: FixtureExclusion[] = [];
  const warnings: string[] = [];

  const homeIds = distinct(rows.map((r) => r.homeTeamApiId));
  const awayIds = distinct(rows.map((r) => r.awayTeamApiId));
  const leagueIds = distinct(rows.map((r) => r.leagueApiId));
  if (!homeIds.length || !awayIds.length) reasons.push("team_id_missing");
  else if (homeIds.length > 1 || awayIds.length > 1) reasons.push("team_identity_conflict");
  else if (homeIds[0] === awayIds[0]) reasons.push("team_identity_invalid");
  if (!leagueIds.length) reasons.push("league_id_missing");
  else if (leagueIds.length > 1) reasons.push("league_identity_conflict");

  const kickoffs = rows.map((r) => r.kickoff).filter((k): k is Date => k instanceof Date);
  let kickoff: Date | null = null;
  if (!kickoffs.length) reasons.push("kickoff_missing");
  else {
    const ts = kickoffs.map((k) => k.getTime());
    if (Math.max(...ts) - Math.min(...ts) > KICKOFF_TOLERANCE_MS) reasons.push("kickoff_conflict");
    else kickoff = new Date(Math.min(...ts));
  }

  const scored = rows.filter((r) => r.finalHomeScore != null && r.finalAwayScore != null);
  const partial = rows.some((r) => (r.finalHomeScore == null) !== (r.finalAwayScore == null));
  const pairs = distinct(scored.map((r) => `${r.finalHomeScore}-${r.finalAwayScore}`));
  let homeGoals: number | null = null, awayGoals: number | null = null, settledAt: Date | null = null;
  if (pairs.length > 1) reasons.push("final_score_conflict");
  else if (!pairs.length) reasons.push(partial ? "final_score_partial" : "final_score_missing");
  else {
    homeGoals = scored[0].finalHomeScore!;
    awayGoals = scored[0].finalAwayScore!;
    if (partial) warnings.push("some_rows_partial_score");
    const settled = scored.map((r) => r.settledAt).filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
    if (!settled.length) reasons.push("settlement_time_missing");
    else {
      settledAt = new Date(Math.min(...settled));
      if (kickoff && settledAt.getTime() <= kickoff.getTime()) reasons.push("settled_before_kickoff");
    }
    // Every row's recorded outcome must agree with the agreed score, through
    // the same resolver settlement itself uses.
    for (const r of rows) {
      if (!CROSS_CHECK_MARKETS.has(r.marketType) || !["WON", "LOST", "VOID"].includes(r.outcome)) continue;
      if (!(MARKET_TYPES as readonly string[]).includes(r.marketType)) continue;
      const expected = resolveMarket(r.marketType as MarketType, r.selection as Selection, homeGoals, awayGoals);
      if (expected !== null && expected !== r.outcome) { reasons.push("outcome_score_inconsistent"); break; }
    }
  }

  const homeId = homeIds.length === 1 ? homeIds[0] : null;
  const awayId = awayIds.length === 1 ? awayIds[0] : null;
  const leagueId = leagueIds.length === 1 ? leagueIds[0] : null;

  // Context selection — only meaningful once identity and kickoff are settled.
  const jobIds = distinct(rows.map((r) => r.aiJobId)).sort();
  const candidates: CandidateJob[] = [];
  let selected: ParsedJob | null = null;
  if (!jobIds.length) reasons.push("no_linked_generation_job");
  else if (kickoff && homeId != null && awayId != null) {
    const valid: ParsedJob[] = [];
    for (const id of jobIds) {
      const job = jobs.get(id);
      const verdict = judgeJob(job, { kickoff, homeId, awayId });
      candidates.push({ job_id: id, created_at: job ? iso(job.createdAt) : null, context_version: job?.version ?? null, verdict: verdict ?? "valid_not_earliest" });
      if (!verdict && job) valid.push(job);
    }
    valid.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || cmp(a.id, b.id));
    selected = valid[0] ?? null;
    if (selected) candidates.find((c) => c.job_id === selected!.id)!.verdict = "selected";
    else reasons.push("no_valid_pre_kickoff_context");
  }

  let generation: FixtureRecord["generation"] = null;
  if (selected && selected.digest) {
    const d = selected.digest;
    if (d.teams.home.apiId == null) warnings.push("context_home_team_id_unrecovered");
    if (d.teams.away.apiId == null) warnings.push("context_away_team_id_unrecovered");
    generation = {
      job_id: selected.id,
      created_at: iso(selected.createdAt),
      context_version: selected.version ?? 0,
      provider: selected.model,
      digest_kickoff: d.fixture?.kickoff ?? null,
      audit: auditContext(d, selected.createdAt),
    };
  }

  const engine: EnginePrediction[] = selected && kickoff
    ? rows
        .filter((r) => r.aiJobId === selected!.id && r.createdAt.getTime() < kickoff!.getTime())
        .sort((a, b) => cmp(a.id, b.id))
        .map((r) => ({
          prediction_id: r.id, market_type: r.marketType, selection: r.selection ?? null, confidence: r.confidence,
          created_at: iso(r.createdAt), provider: selected!.model, outcome: r.outcome,
        }))
    : [];

  const first = <K extends keyof PredictionRow>(k: K) => (rows.find((r) => r[k] != null)?.[k] ?? null) as PredictionRow[K] | null;
  const unique = [...new Set(reasons)];
  return {
    fixture_id: fixtureId,
    status: unique.length ? "excluded" : "included",
    exclusion_reasons: unique,
    warnings,
    league_id: leagueId,
    league_name: first("leagueName"),
    home_id: homeId,
    away_id: awayId,
    home_name: first("homeTeam"),
    away_name: first("awayTeam"),
    kickoff: kickoff ? iso(kickoff) : null,
    home_goals: homeGoals,
    away_goals: awayGoals,
    settled_at: settledAt ? iso(settledAt) : null,
    generation,
    candidate_jobs: candidates,
    prediction_rows: rows.length,
    engine_predictions: engine,
  };
}

/**
 * Every match a parsed context sighted: both teams' last-5 lists (oriented to
 * home/away by the team's own id) and the stored head-to-head meetings.
 *
 * Incomplete entries are EMITTED with null goals rather than dropped here, so
 * the ledger can count them as excluded instead of their simply vanishing.
 */
export function observationsFromJob(job: ParsedJob): Observation[] {
  const d = job.digest;
  if (!d) return [];
  const observedAt = iso(job.createdAt);
  const out: Observation[] = [];
  for (const team of [d.teams.home, d.teams.away]) {
    if (team.apiId == null) continue;
    for (const e of team.last5 ?? []) {
      if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
      const opp = e.opponentApiId ?? null;
      const complete = e.result !== "?" && e.goalsFor != null && e.goalsAgainst != null;
      const isHome = e.venue === "home";
      out.push({
        source: "context_last5",
        source_ref: job.id,
        observed_at: observedAt,
        fixture_id: null,
        date: e.date,
        kickoff: null,
        home_id: isHome ? team.apiId : opp,
        away_id: isHome ? opp : team.apiId,
        home_goals: complete ? (isHome ? e.goalsFor : e.goalsAgainst) : null,
        away_goals: complete ? (isHome ? e.goalsAgainst : e.goalsFor) : null,
        competition_id: e.competitionApiId ?? null,
      });
    }
  }
  for (const m of d.h2h?.meetings ?? []) {
    const t = Date.parse(m.date);
    if (!Number.isFinite(t)) continue;
    const k = new Date(t);
    out.push({
      source: "context_h2h",
      source_ref: job.id,
      observed_at: observedAt,
      fixture_id: m.fixtureApiId ?? null,
      date: utcDay(k),
      kickoff: iso(k),
      home_id: m.homeTeamApiId,
      away_id: m.awayTeamApiId,
      home_goals: m.homeGoals,
      away_goals: m.awayGoals,
      competition_id: m.leagueApiId ?? null,
    });
  }
  return out;
}

/**
 * The settled result of a fixture as an observation, available from the moment
 * it was settled. Emitted for any fixture whose identity, kickoff and score
 * checks passed — context validity is irrelevant to whether its RESULT is a
 * fact other fixtures may later see.
 */
export function settlementObservation(r: FixtureRecord): Observation | null {
  const identityOk = !r.exclusion_reasons.some((x) =>
    ["team_id_missing", "team_identity_conflict", "team_identity_invalid", "kickoff_missing", "kickoff_conflict",
     "final_score_missing", "final_score_partial", "final_score_conflict", "settlement_time_missing",
     "settled_before_kickoff", "outcome_score_inconsistent"].includes(x));
  if (!identityOk || !r.kickoff || !r.settled_at || r.home_goals == null || r.away_goals == null) return null;
  return {
    source: "settlement",
    source_ref: String(r.fixture_id),
    observed_at: r.settled_at,
    fixture_id: r.fixture_id,
    date: r.kickoff.slice(0, 10),
    kickoff: r.kickoff,
    home_id: r.home_id,
    away_id: r.away_id,
    home_goals: r.home_goals,
    away_goals: r.away_goals,
    competition_id: r.league_id,
  };
}

/** Deterministic observation order, so two extractions of the same snapshot are byte-identical. */
export function compareObservations(a: Observation, b: Observation): number {
  return cmp(a.date, b.date)
    || cmp(a.source, b.source)
    || cmp(a.source_ref, b.source_ref)
    || (a.home_id ?? -1) - (b.home_id ?? -1)
    || (a.away_id ?? -1) - (b.away_id ?? -1)
    || cmp(a.observed_at, b.observed_at);
}

/** Serialise with a fixed key order (insertion order of the literal types above). */
export function stableLine(o: unknown): string {
  return JSON.stringify(o);
}
