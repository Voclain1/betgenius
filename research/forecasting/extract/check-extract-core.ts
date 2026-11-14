/**
 * Extractor logic against SYNTHETIC rows only — no database, no credentials.
 *
 * Covers: duplicate fixture rows, earliest-valid pre-kickoff context selection,
 * contexts at/after kickoff, identity/kickoff/score conflicts, outcome
 * cross-checks, v1 + v2 context parsing, observation orientation, incomplete
 * and same-day entries, engine-row scoping, determinism, and the read-only
 * posture refusals.
 *
 * Run: npx tsx research/forecasting/extract/check-extract-core.ts
 */
export {};

import { buildStoredContext } from "../../../src/lib/ai/context";
import type { MatchDigest, TeamDigest } from "../../../src/lib/ai/digest";
import { assembleDataset } from "./assemble";
import { consolidateFixture, observationsFromJob, parseJob, settlementObservation, type ParsedJob, type PredictionRow } from "./core";
import { assertDedicatedCredential, assertReadOnlyPosture, ReadOnlyRefusal, type Posture } from "./readonlyDb";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function throws(fn: () => unknown, cls: Function = Error): boolean {
  try { fn(); return false; } catch (e) { return e instanceof cls; }
}

// ── Synthetic builders (fictional ids; nothing here is a real fixture) ──────
const KO = new Date("2026-09-12T15:00:00.000Z");
const H = 9001, A = 9002, L = 7001, FX = 5_000_001;
const hours = (h: number) => new Date(KO.getTime() + h * 3_600_000);

function team(name: string, apiId: number | null, last5: TeamDigest["last5"], extra: Partial<TeamDigest> = {}): TeamDigest {
  return {
    name, apiId, rank: null, points: null, overall: null, home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null,
    cleanSheets: null, failedToScore: null, form: null, streak: null, biggest: null, formations: [], cards: null,
    penalties: null, last5, availability: [], availabilityAsOf: null, keyPlayers: [], ...extra,
  };
}
const l5 = (date: string, venue: "home" | "away", gf: number | null, ga: number | null, opp: number | null = 9100): TeamDigest["last5"][number] => ({
  opponent: "Synthetic Opp", venue, result: gf == null || ga == null ? "?" : gf > ga ? "W" : gf < ga ? "L" : "D",
  goalsFor: gf, goalsAgainst: ga, date, competition: "Synthetic League", opponentApiId: opp, competitionApiId: L,
});
function digest(homeId: number | null = H, awayId: number | null = A, kickoff = KO.toISOString(), extra: { homeL5?: TeamDigest["last5"]; awayL5?: TeamDigest["last5"]; homeExtra?: Partial<TeamDigest> } = {}): MatchDigest {
  return {
    v: 2,
    fixture: { home: "Synthetic Home", away: "Synthetic Away", league: "Synthetic League", kickoff },
    teams: {
      home: team("Synthetic Home", homeId, extra.homeL5 ?? [l5("2026-09-05", "home", 2, 1), l5("2026-08-29", "away", 0, 0)], extra.homeExtra),
      away: team("Synthetic Away", awayId, extra.awayL5 ?? [l5("2026-09-06", "away", 1, 3)]),
    },
    h2h: {
      meetings: [{ fixtureApiId: 4_000_001, date: "2026-03-01T18:00:00+00:00", leagueName: "Synthetic League", leagueApiId: L, homeTeamApiId: A, homeTeam: "Synthetic Away", awayTeamApiId: H, awayTeam: "Synthetic Home", homeGoals: 1, awayGoals: 1 }],
      stats: { played: 1, teamAWins: 0, teamBWins: 0, draws: 1 } as any,
    },
    standings: null,
    coverage: { stats: false, form: true, availability: false, h2h: true, standings: false },
  };
}
const job = (id: string, createdAt: Date, d: MatchDigest | null | "raw-bad" = digest()): ParsedJob =>
  parseJob({ id, createdAt, model: "gemini:synthetic", context: d === null ? null : d === "raw-bad" ? { v: 9 } : buildStoredContext(d) });
function pred(id: string, over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id, fixtureApiId: FX, leagueApiId: L, leagueName: "Synthetic League", homeTeam: "Synthetic Home", awayTeam: "Synthetic Away",
    homeTeamApiId: H, awayTeamApiId: A, kickoff: KO, finalHomeScore: 2, finalAwayScore: 1, outcome: "WON", settledAt: hours(3),
    marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 64, createdAt: hours(-20), aiJobId: "job-b", ...over,
  };
}
const jobsMap = (...js: ParsedJob[]) => new Map(js.map((j) => [j.id, j]));

console.log("duplicate fixture rows collapse to one record with the earliest valid pre-kickoff context:");
{
  const jobs = jobsMap(job("job-a", hours(-30)), job("job-b", hours(-20)), job("job-c", hours(1)));
  const rows = [pred("p1", { aiJobId: "job-b" }), pred("p2", { aiJobId: "job-a", marketType: "BTTS", selection: { value: "YES" }, outcome: "WON" }), pred("p3", { aiJobId: "job-c", createdAt: hours(1) })];
  const r = consolidateFixture(FX, rows, jobs);
  check("included", r.status === "included", r.exclusion_reasons.join(","));
  check("earliest valid job selected", r.generation?.job_id === "job-a");
  check("post-kickoff job rejected", r.candidate_jobs.find((c) => c.job_id === "job-c")?.verdict === "context_at_or_after_kickoff");
  check("later valid job marked valid_not_earliest", r.candidate_jobs.find((c) => c.job_id === "job-b")?.verdict === "valid_not_earliest");
  check("prediction_rows counts all rows", r.prediction_rows === 3);
  check("engine rows only from the selected job", r.engine_predictions.length === 1 && r.engine_predictions[0].prediction_id === "p2");
}

console.log("contexts at or after kickoff never qualify:");
{
  const r = consolidateFixture(FX, [pred("p1", { aiJobId: "job-k" })], jobsMap(job("job-k", KO)));
  check("created exactly at kickoff is rejected", r.candidate_jobs[0]?.verdict === "context_at_or_after_kickoff");
  check("fixture excluded with no_valid_pre_kickoff_context", r.exclusion_reasons.includes("no_valid_pre_kickoff_context"));
}

console.log("identity, kickoff and score validation:");
{
  const jobs = jobsMap(job("job-b", hours(-20)));
  const conflictScore = consolidateFixture(FX, [pred("p1"), pred("p2", { finalHomeScore: 3 })], jobs);
  check("conflicting final scores excluded", conflictScore.exclusion_reasons.includes("final_score_conflict"));
  const partial = consolidateFixture(FX, [pred("p1", { finalAwayScore: null })], jobs);
  check("partial score excluded", partial.exclusion_reasons.includes("final_score_partial"));
  const missing = consolidateFixture(FX, [pred("p1", { finalHomeScore: null, finalAwayScore: null, settledAt: null, outcome: "PENDING" })], jobs);
  check("no final score excluded", missing.exclusion_reasons.includes("final_score_missing"));
  const ko = consolidateFixture(FX, [pred("p1"), pred("p2", { kickoff: hours(24) })], jobs);
  check("conflicting kickoffs excluded", ko.exclusion_reasons.includes("kickoff_conflict"));
  const koNoise = consolidateFixture(FX, [pred("p1"), pred("p2", { kickoff: new Date(KO.getTime() + 30_000) })], jobs);
  check("30s kickoff jitter is not a conflict", koNoise.status === "included");
  const team = consolidateFixture(FX, [pred("p1"), pred("p2", { homeTeamApiId: 1234 })], jobs);
  check("conflicting team ids excluded", team.exclusion_reasons.includes("team_identity_conflict"));
  const league = consolidateFixture(FX, [pred("p1"), pred("p2", { leagueApiId: 1 })], jobs);
  check("conflicting league ids excluded", league.exclusion_reasons.includes("league_identity_conflict"));
  const same = consolidateFixture(FX, [pred("p1", { awayTeamApiId: H })], jobs);
  check("home == away excluded", same.exclusion_reasons.includes("team_identity_invalid"));
  const unsettled = consolidateFixture(FX, [pred("p1", { settledAt: null })], jobs);
  check("score without settlement time excluded", unsettled.exclusion_reasons.includes("settlement_time_missing"));
  const early = consolidateFixture(FX, [pred("p1", { settledAt: hours(-1) })], jobs);
  check("settled before kickoff excluded", early.exclusion_reasons.includes("settled_before_kickoff"));
  const wrong = consolidateFixture(FX, [pred("p1", { outcome: "LOST" })], jobs);
  check("recorded outcome contradicting the score excluded", wrong.exclusion_reasons.includes("outcome_score_inconsistent"));
  const noJob = consolidateFixture(FX, [pred("p1", { aiJobId: null })], jobs);
  check("no linked job excluded", noJob.exclusion_reasons.includes("no_linked_generation_job"));
}

console.log("context validity:");
{
  const mismatch = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", hours(-5), digest(A, H))));
  check("swapped team ids rejected", mismatch.candidate_jobs[0].verdict === "context_team_mismatch");
  const moved = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", hours(-60), digest(H, A, hours(-48).toISOString()))));
  check("context built for a different date rejected", moved.candidate_jobs[0].verdict === "context_kickoff_mismatch");
  const missingCtx = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", hours(-5), null)));
  check("job without context rejected", missingCtx.candidate_jobs[0].verdict === "context_missing");
  const bad = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", hours(-5), "raw-bad")));
  check("unknown context version rejected", bad.candidate_jobs[0].verdict === "context_unparseable");
  const lost = consolidateFixture(FX, [pred("p1", { aiJobId: "ghost" })], jobsMap());
  check("dangling job id rejected", lost.candidate_jobs[0].verdict === "job_not_found");
}

console.log("v1 contexts upgrade through the production parser:");
{
  const fr = (id: number, date: string, hId: number, aId: number, hg: number | null, ag: number | null, short = "FT") => ({
    fixture: { id, date, status: { short } }, league: { id: L, name: "Synthetic League" },
    teams: { home: { id: hId, name: hId === H ? "Synthetic Home" : hId === A ? "Synthetic Away" : `T${hId}` }, away: { id: aId, name: aId === H ? "Synthetic Home" : aId === A ? "Synthetic Away" : `T${aId}` } },
    goals: { home: hg, away: ag },
  });
  const v1 = {
    v: 1, home: "Synthetic Home", away: "Synthetic Away", league: "Synthetic League", kickoff: KO.toISOString(),
    homeContext: { statistics: null, injuries: [], lastFixtures: [fr(1, "2026-09-05T15:00:00+00:00", H, 9100, 3, 0), fr(2, "2026-08-30T15:00:00+00:00", 9101, H, null, null, "PST")] },
    awayContext: { statistics: null, injuries: [], lastFixtures: [fr(3, "2026-09-06T15:00:00+00:00", 9102, A, 2, 2)] },
    standings: null,
    h2h: [fr(4_000_002, "2026-02-01T15:00:00+00:00", H, A, 0, 1)],
  };
  const j = parseJob({ id: "v1job", createdAt: hours(-10), model: "legacy-model", context: v1 });
  check("v1 parsed to a digest", j.digest !== null && j.version === 1);
  check("v1 team ids recovered from h2h", j.digest?.teams.home.apiId === H && j.digest?.teams.away.apiId === A);
  const obs = observationsFromJob(j);
  const home = obs.filter((o) => o.source === "context_last5" && (o.home_id === H || o.away_id === H));
  check("v1 last-5 entries emitted", home.length === 2);
  check("postponed entry emitted with null goals", home.some((o) => o.home_goals === null && o.away_goals === null));
  check("v1 h2h meeting emitted with exact kickoff", obs.some((o) => o.source === "context_h2h" && o.fixture_id === 4_000_002 && o.kickoff === "2026-02-01T15:00:00.000Z"));
  const r = consolidateFixture(FX, [pred("p1", { aiJobId: "v1job" })], jobsMap(j));
  check("fixture with a v1 context is included", r.status === "included" && r.generation?.context_version === 1, r.exclusion_reasons.join(","));
}

console.log("observations are oriented by the team's own id:");
{
  const j = job("j", hours(-20), digest(H, A, KO.toISOString(), { homeL5: [l5("2026-09-05", "away", 1, 2, 9200)], awayL5: [] }));
  const o = observationsFromJob(j).find((x) => x.source === "context_last5")!;
  check("away venue puts the team on the away side", o.home_id === 9200 && o.away_id === H);
  check("goals oriented to home/away", o.home_goals === 2 && o.away_goals === 1);
  check("observed_at is the job's creation time", o.observed_at === hours(-20).toISOString());
  check("last-5 carries no exact kickoff", o.kickoff === null);
  const noOpp = observationsFromJob(job("j2", hours(-20), digest(H, A, KO.toISOString(), { homeL5: [l5("2026-09-05", "home", 1, 0, null)], awayL5: [] })));
  check("missing opponent id kept as null, not guessed", noOpp.some((x) => x.source === "context_last5" && x.away_id === null));
  const noId = observationsFromJob(job("j3", hours(-20), digest(null, A)));
  check("a side with no team id contributes no last-5 observations", !noId.some((x) => x.source === "context_last5" && (x.home_id === null && x.away_id === 9100)));
}

console.log("audit flags same-day, future-dated and incomplete entries and future availability:");
{
  const created = hours(-6); // 2026-09-12T09:00Z
  const d = digest(H, A, KO.toISOString(), {
    homeL5: [l5("2026-09-12", "home", 1, 0), l5("2026-09-13", "away", 0, 0), l5("2026-09-01", "home", null, null)],
    homeExtra: { availabilityAsOf: "2026-09-19" },
  });
  const r = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", created, d)));
  const a = r.generation!.audit;
  check("same-day last-5 counted", a.last5_same_day === 1);
  check("future-dated last-5 counted", a.last5_future_dated === 1);
  check("missing-score last-5 counted", a.last5_missing_score === 1);
  check("future-dated availability flagged", a.availability_future_dated === true);
}

console.log("settlement observations:");
{
  const r = consolidateFixture(FX, [pred("p1", { aiJobId: "j" })], jobsMap(job("j", hours(2))));
  check("fixture without a valid context is excluded", r.status === "excluded");
  const s = settlementObservation(r);
  check("but its verified result is still an observation", s !== null && s.observed_at === hours(3).toISOString() && s.kickoff === KO.toISOString());
  const c = consolidateFixture(FX, [pred("p1"), pred("p2", { finalHomeScore: 0 })], jobsMap(job("job-b", hours(-20))));
  check("a conflicting result is never an observation", settlementObservation(c) === null);
}

console.log("assembly is deterministic and order-independent:");
{
  const jobs = [job("job-a", hours(-30)), job("job-b", hours(-20))];
  const rows = [pred("p1"), pred("p2", { aiJobId: "job-a" }), pred("p3", { fixtureApiId: FX + 1, kickoff: hours(48), settledAt: hours(51), aiJobId: "job-a" })];
  const base = { predictionsWithoutFixtureId: 1, totalPredictions: 4, asOf: "2026-11-01T00:00:00.000Z", generatedAt: "2026-11-01T00:00:00.000Z", source: "synthetic" as const, database: null };
  const a = assembleDataset({ ...base, predictions: rows, jobs });
  const b = assembleDataset({ ...base, predictions: [...rows].reverse(), jobs: [...jobs].reverse() });
  check("identical fixtures.jsonl", a.lines["fixtures.jsonl"] === b.lines["fixtures.jsonl"]);
  check("identical observations.jsonl", a.lines["observations.jsonl"] === b.lines["observations.jsonl"]);
  check("identical file hashes", JSON.stringify(a.manifest.files) === JSON.stringify(b.manifest.files));
  check("one record per fixture id", a.fixtures.length === 2);
  check("counts carried", a.manifest.counts.prediction_rows_total === 4 && a.manifest.counts.prediction_rows_without_fixture_id === 1);
  check("a context built for another fixture's date is not reused", a.fixtures[1].candidate_jobs[0]?.verdict === "context_kickoff_mismatch" && a.fixtures[1].status === "excluded");
}

console.log("read-only posture and credential refusals:");
{
  const ok: Posture = { transaction_read_only: "on", default_transaction_read_only: "on", transaction_isolation: "repeatable read", is_superuser: false, writable_tables: 0 };
  check("a verified read-only posture passes", !throws(() => assertReadOnlyPosture(ok)));
  check("read-write transaction refused", throws(() => assertReadOnlyPosture({ ...ok, transaction_read_only: "off" }), ReadOnlyRefusal));
  check("role without read-only default refused", throws(() => assertReadOnlyPosture({ ...ok, default_transaction_read_only: "off" }), ReadOnlyRefusal));
  check("superuser refused", throws(() => assertReadOnlyPosture({ ...ok, is_superuser: true }), ReadOnlyRefusal));
  check("unverifiable superuser status refused", throws(() => assertReadOnlyPosture({ ...ok, is_superuser: null }), ReadOnlyRefusal));
  check("any writable table refused", throws(() => assertReadOnlyPosture({ ...ok, writable_tables: 1 }), ReadOnlyRefusal));
  check("wrong isolation refused", throws(() => assertReadOnlyPosture({ ...ok, transaction_isolation: "read committed" }), ReadOnlyRefusal));
  check("missing research credential refused", throws(() => assertDedicatedCredential({}), ReadOnlyRefusal));
  check("app DATABASE_URL reused as research credential refused", throws(() => assertDedicatedCredential({ RESEARCH_READONLY_DATABASE_URL: "postgres://x@h/db", DATABASE_URL: "postgres://x@h/db" }), ReadOnlyRefusal));
  check("non-postgres URL refused", throws(() => assertDedicatedCredential({ RESEARCH_READONLY_DATABASE_URL: "mysql://x@h/db" }), ReadOnlyRefusal));
  let leaked = false;
  try { assertDedicatedCredential({ RESEARCH_READONLY_DATABASE_URL: "postgres://u:SECRETPW@h/db", DATABASE_URL: "postgres://u:SECRETPW@h/db" }); } catch (e) { leaked = String((e as Error).message).includes("SECRETPW"); }
  check("refusal message never echoes the credential", !leaked);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall extractor checks passed");
process.exit(failures ? 1 : 0);
