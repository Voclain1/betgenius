import assert from "node:assert/strict";
import { assertCompetitionStage, competitionStage, CompetitionStageError } from "../src/lib/ai/competitionStage";
import { readFileSync } from "node:fs";
import { stripUnsupportedClaims } from "../src/lib/ai/evidenceClaims";
import { buildTeamDigest, assembleMatchDigest } from "../src/lib/ai/digest";

for (const round of ["League Stage - 3", "League Phase", "Group Stage - 2", "Group A", "Regular Season - 9"]) {
  assert.equal(competitionStage({ competitionType: "CUP", round }), "league");
  for (const output of [
    { matchPreview: "Juventus arrive in this Europa League knockout tie." },
    { keyFactors: ["A knock-out clash awaits."] },
    { predictions: [{ reasoning: "This knockout cup match favours the hosts." }] },
  ]) assert.throws(() => assertCompetitionStage({ competitionType: "CUP", round }, output), CompetitionStageError);
}
assert.doesNotThrow(() => assertCompetitionStage({ competitionType: "CUP", round: "League Stage - 3" }, { matchPreview: "A league-stage meeting with table points at stake." }));
assert.doesNotThrow(() => assertCompetitionStage({ competitionType: "CUP", round: "Quarter-finals" }, { matchPreview: "A knockout tie." }));
assert.equal(competitionStage({ competitionType: "CUP", round: null }), "unknown");
assert.equal(competitionStage({ competitionType: "CUP", round: "1st Round" }), "unknown");
assert.throws(() => assertCompetitionStage({ competitionType: "CUP", round: null }, { matchPreview: "A knockout tie." }), CompetitionStageError);
const source = readFileSync("src/lib/ai/analysis.ts", "utf8");
assert.ok(!source.includes('When fixture.competitionType is "CUP", analyse it as a knockout cup tie.'));
// Generation removes the unsupported sentence instead of rejecting the paid
// draft (src/lib/ai/evidenceClaims.ts stripUnsupportedClaims); the knockout
// wording still never reaches a published row.
assert.ok(source.includes("stripUnsupportedClaims(d, result.output)"));
{
  const d = assembleMatchDigest({ fixture: { home: "Juventus", away: "Lille", league: "Europa League", kickoff: "2026-10-29", competitionType: "CUP", round: "League Stage - 3" }, homeTeam: buildTeamDigest({ name: "Juventus", apiId: 1 }), awayTeam: buildTeamDigest({ name: "Lille", apiId: 2 }), homeApiId: 1, awayApiId: 2, meetings: [], standings: null });
  const r = stripUnsupportedClaims(d, { matchPreview: "Juventus arrive in this Europa League knockout tie. They are unbeaten at home.", predictions: [{ reasoning: "Home form is strong." }] });
  assert.equal(r.output.matchPreview, "They are unbeaten at home.");
  assert.equal(r.removed.length, 1);
  assert.equal(r.emptied, false);
  const gone = stripUnsupportedClaims(d, { predictions: [{ reasoning: "A knockout tie favours the hosts." }] });
  assert.equal(gone.emptied, true, "a pick left with no reasoning is still rejected");
}
console.log("Competition-stage checks passed: league/group rejection, legitimate knockout, unknown stage and shared enforcement.");
