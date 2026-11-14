/**
 * Turn rows read from the snapshot into the three dataset files. Pure: the CLI
 * does the reading and writing, this decides the content, so the same function
 * is exercised by the synthetic-row tests and by a real extraction.
 */

import { createHash } from "node:crypto";
import {
  cmp, compareObservations, consolidateFixture, observationsFromJob, settlementObservation, stableLine,
  type ParsedJob, type PredictionRow,
} from "./core";
import { EXTRACTOR_VERSION, SCHEMA_VERSION, type FixtureRecord, type Manifest, type Observation } from "./schema";

export type AssembleInput = {
  predictions: PredictionRow[];
  /** Every job with createdAt <= as_of, already parsed. */
  jobs: ParsedJob[];
  /** Predictions read with no provider fixture id — counted, never grouped. */
  predictionsWithoutFixtureId: number;
  totalPredictions: number;
  asOf: string;
  generatedAt: string;
  source: Manifest["source"];
  database: Manifest["database"];
};

export type AssembledDataset = { fixtures: FixtureRecord[]; observations: Observation[]; manifest: Manifest; lines: Record<string, string> };

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const sorted = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => cmp(a, b)));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const minMax = (ds: Array<Date | string | null | undefined>) => {
  const ts = ds.filter((d): d is Date | string => d != null).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  return ts.length ? [new Date(Math.min(...ts)).toISOString(), new Date(Math.max(...ts)).toISOString()] : [null, null];
};

export function assembleDataset(input: AssembleInput): AssembledDataset {
  const jobs = new Map(input.jobs.map((j) => [j.id, j]));

  const byFixture = new Map<number, PredictionRow[]>();
  for (const r of input.predictions) {
    const list = byFixture.get(r.fixtureApiId) ?? [];
    list.push(r);
    byFixture.set(r.fixtureApiId, list);
  }
  const fixtures = [...byFixture.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, rows]) => consolidateFixture(id, rows, jobs));

  const observations: Observation[] = [];
  for (const j of [...input.jobs].sort((a, b) => cmp(a.id, b.id))) observations.push(...observationsFromJob(j));
  for (const f of fixtures) {
    const o = settlementObservation(f);
    if (o) observations.push(o);
  }
  observations.sort(compareObservations);

  const included = fixtures.filter((f) => f.status === "included");
  const audits = included.map((f) => f.generation!.audit);
  const lines = {
    "fixtures.jsonl": fixtures.map(stableLine).join("\n") + (fixtures.length ? "\n" : ""),
    "observations.jsonl": observations.map(stableLine).join("\n") + (observations.length ? "\n" : ""),
  };

  const [predMin, predMax] = minMax(input.predictions.map((p) => p.createdAt));
  const [jobMin, jobMax] = minMax(input.jobs.map((j) => j.createdAt));
  const [koMin, koMax] = minMax(included.map((f) => f.kickoff));
  const [, settledMax] = minMax(fixtures.map((f) => f.settled_at));

  const manifest: Manifest = {
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    source: input.source,
    generated_at: input.generatedAt,
    as_of: input.asOf,
    database: input.database,
    source_timestamps: {
      prediction_created_min: predMin, prediction_created_max: predMax,
      job_created_min: jobMin, job_created_max: jobMax,
      included_kickoff_min: koMin, included_kickoff_max: koMax,
      settled_max: settledMax,
    },
    counts: {
      prediction_rows_total: input.totalPredictions,
      prediction_rows_without_fixture_id: input.predictionsWithoutFixtureId,
      prediction_rows_with_fixture_id: input.predictions.length,
      distinct_fixture_ids: fixtures.length,
      fixtures_with_verified_final_score: fixtures.filter((f) => f.home_goals != null && !f.exclusion_reasons.some((r) => r.startsWith("final_score") || r === "outcome_score_inconsistent")).length,
      fixtures_included: included.length,
      fixtures_excluded: fixtures.length - included.length,
      generation_jobs: input.jobs.length,
      generation_jobs_with_context: input.jobs.filter((j) => j.hasContext).length,
      generation_jobs_parseable: input.jobs.filter((j) => j.digest).length,
      observations: observations.length,
      engine_predictions_included_fixtures: included.reduce((n, f) => n + f.engine_predictions.length, 0),
    },
    fixture_exclusions: sorted(tally(fixtures.flatMap((f) => f.exclusion_reasons))),
    job_verdicts: sorted(tally(fixtures.flatMap((f) => f.candidate_jobs.map((c) => c.verdict)))),
    context_versions: sorted(tally(included.map((f) => `v${f.generation!.context_version}`))),
    audit: {
      included_both_season_records: audits.filter((a) => a.both_season_records).length,
      included_both_recent_matches: audits.filter((a) => a.both_recent_matches).length,
      included_standings: audits.filter((a) => a.standings).length,
      included_h2h: audits.filter((a) => a.h2h).length,
      included_availability: audits.filter((a) => a.availability).length,
      included_availability_future_dated: audits.filter((a) => a.availability_future_dated).length,
      included_with_same_day_last5: audits.filter((a) => a.last5_same_day > 0).length,
      included_with_future_dated_last5: audits.filter((a) => a.last5_future_dated > 0).length,
      included_with_missing_score_last5: audits.filter((a) => a.last5_missing_score > 0).length,
    },
    files: Object.fromEntries(Object.entries(lines).map(([name, text]) => [name, { sha256: sha256(text), rows: text ? text.split("\n").length - 1 : 0 }])),
    notes: [
      "Season aggregates, standings, availability and odds are audited here but never exported as features: their point-in-time validity is not established.",
      "Final scores are regulation time (settlement excludes extra time and shootouts).",
      "Engine predictions are raw stated confidence from the selected job only; they are not calibrated probabilities.",
    ],
  };
  return { fixtures, observations, manifest, lines };
}
