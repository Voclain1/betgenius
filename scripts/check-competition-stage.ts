import assert from "node:assert/strict";
import { assertCompetitionStage, competitionStage, CompetitionStageError } from "../src/lib/ai/competitionStage";
import { readFileSync } from "node:fs";

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
assert.ok(source.includes("assertCompetitionStage(d.fixture, result.output)"));
console.log("Competition-stage checks passed: league/group rejection, legitimate knockout, unknown stage and shared enforcement.");
