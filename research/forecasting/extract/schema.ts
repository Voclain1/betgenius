/**
 * The research dataset's on-disk contract, shared by the extractor (TypeScript)
 * and the modelling package (research/forecasting/bgforecast, Python).
 *
 * Three files per dataset directory:
 *
 *   fixtures.jsonl      one row per provider fixture id, included or excluded,
 *                       with every exclusion reason recorded.
 *   observations.jsonl  raw match observations (a stored last-5 entry, a stored
 *                       head-to-head meeting, or a settlement), each stamped with
 *                       WHEN it was recorded. The modelling side builds its
 *                       point-in-time ledger from these; nothing here is
 *                       pre-aggregated, so no aggregate can smuggle in a later
 *                       observation.
 *   manifest.json       schema version, source timestamps, counts, exclusion
 *                       tallies, audit findings and a SHA-256 of each file.
 *
 * Bump SCHEMA_VERSION on any change to a record's meaning; the Python loader
 * refuses a version it does not know rather than reading it approximately.
 */

export const SCHEMA_VERSION = "bg-research-dataset/1";
export const EXTRACTOR_VERSION = "1.0.0";

/** Machine-readable fixture exclusion reasons. Order is the order checks run in. */
export const FIXTURE_EXCLUSIONS = [
  "team_id_missing",
  "team_identity_conflict",
  "team_identity_invalid",
  "league_id_missing",
  "league_identity_conflict",
  "kickoff_missing",
  "kickoff_conflict",
  "final_score_missing",
  "final_score_partial",
  "final_score_conflict",
  "settlement_time_missing",
  "settled_before_kickoff",
  "outcome_score_inconsistent",
  "no_linked_generation_job",
  "no_valid_pre_kickoff_context",
] as const;
export type FixtureExclusion = (typeof FIXTURE_EXCLUSIONS)[number];

/** Why a candidate generation job was not selected for a fixture. */
export const JOB_VERDICTS = [
  "selected",
  "valid_not_earliest",
  "job_not_found",
  "context_missing",
  "context_unparseable",
  "context_at_or_after_kickoff",
  "context_team_mismatch",
  "context_kickoff_mismatch",
] as const;
export type JobVerdict = (typeof JOB_VERDICTS)[number];

export type CandidateJob = { job_id: string; created_at: string | null; context_version: number | null; verdict: JobVerdict };

/** What the selected context held, and what in it would have been unsafe to use. */
export type ContextAudit = {
  /** Season aggregates present for both teams. NOT used as features: point-in-time validity is unproven. */
  both_season_records: boolean;
  /** Non-empty last-5 list for both teams. */
  both_recent_matches: boolean;
  standings: boolean;
  h2h: boolean;
  availability: boolean;
  /** Availability list dated after the job was created — the list described a later matchday. Availability is never a feature. */
  availability_future_dated: boolean;
  /** Last-5 entries on the job's own UTC day: completion before generation cannot be shown from a date alone. */
  last5_same_day: number;
  /** Last-5 entries dated after the job's UTC day. Should be zero; anything else is a provider or cache defect. */
  last5_future_dated: number;
  /** Last-5 entries with no score (postponed, abandoned or not yet played). Never counted as results. */
  last5_missing_score: number;
};

export type EnginePrediction = {
  prediction_id: string;
  market_type: string;
  selection: unknown;
  /** Raw stated confidence, 0–100. Uncalibrated. */
  confidence: number;
  created_at: string;
  /** AIJob.model, e.g. "gemini:…" — provider of the engine call. */
  provider: string | null;
  outcome: string;
};

export type FixtureRecord = {
  fixture_id: number;
  status: "included" | "excluded";
  exclusion_reasons: FixtureExclusion[];
  warnings: string[];
  league_id: number | null;
  league_name: string | null;
  home_id: number | null;
  away_id: number | null;
  home_name: string | null;
  away_name: string | null;
  kickoff: string | null;
  /** Regulation-time score (settlement strips extra time and shootouts). */
  home_goals: number | null;
  away_goals: number | null;
  settled_at: string | null;
  /** The earliest valid pre-kickoff generation context. Null when none qualified. */
  generation: {
    job_id: string;
    created_at: string;
    context_version: number;
    provider: string | null;
    digest_kickoff: string | null;
    audit: ContextAudit;
  } | null;
  candidate_jobs: CandidateJob[];
  prediction_rows: number;
  /** Engine output from the SELECTED job only, created before kickoff — so the comparison sees the same information moment. */
  engine_predictions: EnginePrediction[];
};

export type ObservationSource = "context_last5" | "context_h2h" | "settlement";

/**
 * One sighting of a match result. The same match is usually sighted many times
 * (every later context that lists it); the modelling side dedupes, checks the
 * sightings agree, and keeps the earliest moment the result was on record.
 */
export type Observation = {
  source: ObservationSource;
  /** AIJob id for context sources, provider fixture id (as text) for settlements. */
  source_ref: string;
  /** When this sighting was recorded: AIJob.createdAt, or Prediction.settledAt. */
  observed_at: string;
  fixture_id: number | null;
  /** UTC calendar day of the match. */
  date: string;
  /** Exact kickoff when the source carries one (h2h, settlement); null for last-5, which stores a date only. */
  kickoff: string | null;
  home_id: number | null;
  away_id: number | null;
  home_goals: number | null;
  away_goals: number | null;
  competition_id: number | null;
};

export type Manifest = {
  schema_version: string;
  extractor_version: string;
  /** "postgres" for a real extraction, "synthetic" for generated test data. Reports carry this through. */
  source: "postgres" | "synthetic";
  generated_at: string;
  /** Upper bound applied to every timestamp read; re-running with the same as_of reproduces the dataset. */
  as_of: string;
  database: { server_version: string | null; read_only_verified: boolean; isolation: string | null; snapshot_time: string | null } | null;
  source_timestamps: Record<string, string | null>;
  counts: Record<string, number>;
  fixture_exclusions: Record<string, number>;
  job_verdicts: Record<string, number>;
  context_versions: Record<string, number>;
  audit: Record<string, number>;
  files: Record<string, { sha256: string; rows: number }>;
  notes: string[];
};
