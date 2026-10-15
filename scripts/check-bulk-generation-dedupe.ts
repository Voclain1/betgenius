/**
 * Manual bulk generation (admin picks competitions) skips fixtures that
 * already have tips, live or in review (src/lib/generation/existingCoverage.ts).
 * Pure, no database.
 *
 * Run: npx tsx scripts/check-bulk-generation-dedupe.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitByCoverage } from "../src/lib/generation/existingCoverage";
import type { FixtureRow } from "../src/lib/football/api-football";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures++;
}

const fx = (id: number, home: number, away: number, date: string): FixtureRow =>
  ({
    fixture: { id, date, status: { short: "NS", elapsed: null } },
    league: { id: 39, name: "Premier League", country: "England", logo: "", season: 2026, round: null },
    teams: { home: { id: home, name: `H${home}`, logo: "" }, away: { id: away, name: `A${away}`, logo: "" } },
    goals: { home: null, away: null },
  }) as unknown as FixtureRow;
const row = (over: Partial<{ id: string; status: string; fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; kickoff: Date | null }>) => ({
  id: "p", status: "PUBLISHED", fixtureApiId: null, homeTeamApiId: null, awayTeamApiId: null, kickoff: null, ...over,
});

const slate = [fx(1, 10, 11, "2026-10-18T14:00:00Z"), fx(2, 20, 21, "2026-10-18T16:30:00Z"), fx(3, 30, 31, "2026-10-18T19:00:00Z")];

{
  const { open, covered } = splitByCoverage(slate, [row({ id: "live", fixtureApiId: 1 })]);
  check("a fixture with a live tip is skipped", covered.length === 1 && covered[0].fixtureApiId === 1 && covered[0].predictionId === "live", covered);
  check("the rest stay open", open.map((f) => f.fixture.id).join() === "2,3", open.map((f) => f.fixture.id));
}
{
  const { covered } = splitByCoverage(slate, [row({ status: "PENDING_REVIEW", fixtureApiId: 2 }), row({ status: "APPROVED", fixtureApiId: 3 })]);
  check("tips in review or approved also count", covered.length === 2, covered);
}
{
  const { open } = splitByCoverage(slate, [row({ status: "ARCHIVED", fixtureApiId: 1 })]);
  check("archived tips do not block a fresh attempt", open.length === 3, open.length);
}
{
  const { covered } = splitByCoverage(slate, [row({ homeTeamApiId: 20, awayTeamApiId: 21, kickoff: new Date("2026-10-18T16:30:00Z") })]);
  check("rows saved without a fixture id match on teams and day", covered.length === 1 && covered[0].fixtureApiId === 2, covered);
}
{
  const { open } = splitByCoverage(slate, [row({ homeTeamApiId: 20, awayTeamApiId: 21, kickoff: new Date("2026-03-02T16:30:00Z") })]);
  check("the same pairing on another day is a different match", open.length === 3, open.length);
}
{
  const { covered } = splitByCoverage(slate, [row({ id: "draft", status: "DRAFT", fixtureApiId: 1 }), row({ id: "pub", status: "PUBLISHED", fixtureApiId: 1 })]);
  check("the live tip is the one reported when there are several", covered[0]?.predictionId === "pub" && covered[0]?.status === "PUBLISHED", covered);
}

const route = readFileSync(join(__dirname, "../src/app/api/admin/ai/bulk/route.ts"), "utf8");
check(
  "the bulk route drops covered fixtures before applying the limit",
  route.indexOf("excludeCoveredFixtures(notStarted)") > 0 && route.indexOf("excludeCoveredFixtures(notStarted)") < route.indexOf("candidates.slice(0"),
);
check("the bulk route reports what it skipped", /alreadyCovered: covered/.test(route));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll bulk generation dedupe checks passed");
