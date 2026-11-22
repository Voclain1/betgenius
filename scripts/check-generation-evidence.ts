import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildTeamDigest, assembleMatchDigest, type MatchDigest } from "../src/lib/ai/digest";
import { hasSubstantiveFootballEvidence, assessSavedGenerationEvidence, FootballEvidenceUnavailableError, unavailableEvidenceReason } from "../src/lib/ai/evidenceReadiness";
import { isFootballEvidenceUnavailable, ledgerFailureUpdate, MISSING_EVIDENCE_RETRY_MS } from "../src/lib/generation/failurePolicy";

const source = (side: string) => buildTeamDigest({ name: side, apiId: side === "Home" ? 101 : 202 });
const empty = assembleMatchDigest({
  fixture: { home: "Home", away: "Away", league: "Cup", kickoff: "2026-11-24T19:00:00Z", competitionType: "CUP" },
  homeTeam: source("Home"), awayTeam: source("Away"),
  homeApiId: 101, awayApiId: 202, meetings: [], standings: null,
});
assert.equal(hasSubstantiveFootballEvidence(empty), false, "Names and team IDs alone are not sports evidence");
const injuriesOnly: MatchDigest = { ...empty, coverage: { ...empty.coverage, availability: true } };
assert.equal(hasSubstantiveFootballEvidence(injuriesOnly), false, "Unknown or available squad lists cannot justify score forecasts");
const emptyH2h: MatchDigest = { ...empty, coverage: { ...empty.coverage, h2h: true } };
assert.equal(hasSubstantiveFootballEvidence(emptyH2h), false, "A fetched empty H2H is not a sample of matches");
const oneForm: MatchDigest = { ...empty, teams: { ...empty.teams, home: { ...empty.teams.home, last5: [{ opponent: "Opponent", venue: "home", result: "W", goalsFor: 1, goalsAgainst: 0, date: "2026-11-20" }] } } };
assert.equal(hasSubstantiveFootballEvidence(oneForm), true, "Observed real previous matches permit admin-reviewed analysis");
const standings: MatchDigest = { ...empty, standings: { totalTeams: 8, leaderPoints: 12, bottomPoints: 0, avgGoalsPerGame: 2, neighbourhood: [{ rank: 1, team: "Home", points: 12, played: 5, goalDiff: 7, isFixtureTeam: true }] } };
assert.equal(hasSubstantiveFootballEvidence(standings), true, "Team's played competition record is usable");
const noTeamStanding: MatchDigest = { ...empty, standings: { totalTeams: 8, leaderPoints: null, bottomPoints: null, avgGoalsPerGame: null, neighbourhood: [] } };
assert.equal(hasSubstantiveFootballEvidence(noTeamStanding), false, "Empty standings are not proof");
assert.equal(assessSavedGenerationEvidence(empty, false).status, "missing-sporting-evidence");
assert.equal(assessSavedGenerationEvidence(empty, true).status, "missing-sporting-evidence",
  "A legacy contextComplete=true is not proof of sporting evidence");
const staleReview = assessSavedGenerationEvidence(oneForm, false);
assert.equal(staleReview.status, "needs-freshness-review",
  "Recorded form must not be mislabelled no live data when only freshness failed");
assert.equal(staleReview.homeRecentMatches, 1);
assert.equal(assessSavedGenerationEvidence(oneForm, true).status, "ready");
assert.equal(assessSavedGenerationEvidence(null, false).status, "no-saved-snapshot");
const err = new FootballEvidenceUnavailableError("Fixture has no data");
assert.equal(isFootballEvidenceUnavailable(err), true);
assert.equal(isFootballEvidenceUnavailable(new Error("unrelated")), false);
const now = new Date("2026-11-22T09:00:00Z");
const deferred = ledgerFailureUpdate(2, false, now, true);
assert.equal(deferred.status, "FAILED");
assert.equal(deferred.attempts, 2, "Missing evidence must not burn a fixture's retry allowance");
assert.equal(deferred.nextAttemptAt?.getTime(), now.getTime() + MISSING_EVIDENCE_RETRY_MS);
assert.equal(ledgerFailureUpdate(2, false, now).status, "ABANDONED", "Real fixture-specific failures retain their existing 3-attempt ceiling");
const reasons = unavailableEvidenceReason({ homeId: 101, awayId: null, cacheOnly: true }, { homeTeam: "cache", awayTeam: "missing", standings: "missing", h2h: "missing", apiCalls: 0 });
assert.match(reasons, /Unresolved team IDs: away/);
assert.match(reasons, /no API calls made/);
const gen = readFileSync("src/lib/ai/generate.ts", "utf8");
const guardIndex = gen.indexOf("if (!hasSubstantiveFootballEvidence(digest))");
const modelIndex = gen.indexOf("generatePredictionForFixture({");
assert.ok(guardIndex > 0 && modelIndex > guardIndex, "Fail before an expensive provider call");
const worker = readFileSync("src/lib/generation/worker.ts", "utf8");
assert.ok(worker.includes("isFootballEvidenceUnavailable(err)") && worker.includes("evidenceUnavailable"));
const admin = readFileSync("src/app/admin/predictions/[id]/page.tsx", "utf8");
assert.ok(admin.includes("Saved football evidence exists, but its freshness needs review") &&
  admin.includes("No usable football results or season statistics were saved") &&
  !admin.includes("Every football-data lookup"));
const route = readFileSync("src/app/api/admin/predictions/[id]/route.ts", "utf8");
assert.ok(route.includes("assessSavedGenerationEvidence(parseStoredContext(prediction.aiJob.context)") &&
  route.includes("aiJob: prediction.aiJob ? { model: prediction.aiJob.model } : null"),
  "Admin-only endpoint summarizes stored context rather than exposing raw historical evidence");
console.log("PASS: no-evidence generation guard, 4h nonterminal retry, one-sided evidence and safe warning");
