/**
 * A hand-entered match must not be filed under a competition neither team plays in.
 *
 * Real case, 17 Nov 2026: two Ecuador v Bolivia picks entered through the admin
 * "generate one match" form kept its pre-selected first league (Premier League,
 * 39) and appeared on the England Premier League page.
 *
 * Run: npx tsx scripts/check-league-team-match.ts
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { teamsMatchKnown } from "../src/lib/leagueTeamCheck";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`); if (!ok) failed++; };

const epl = ["Arsenal", "Chelsea", "Manchester United", "Manchester City", "Brighton & Hove Albion", "Wolverhampton Wanderers", "Tottenham"];

check("Ecuador v Bolivia is not an English Premier League match", teamsMatchKnown(epl, "Ecuador", "Bolivia") === false);
check("one known team is enough (Arsenal v a newly promoted side)", teamsMatchKnown(epl, "Arsenal", "Some Promoted FC") === true);
check("short names still match (Man City ~ Manchester City)", teamsMatchKnown(epl, "Man City", "Nobody") === true);
check("a name inside the feed's name matches (Brighton ~ Brighton & Hove Albion)", teamsMatchKnown(epl, "Brighton", "Nobody") === true);
check("case and spacing do not matter", teamsMatchKnown(epl, "  CHELSEA ", "nobody") === true);
check("no discovery history for the competition: nothing to judge against, allow", teamsMatchKnown([], "Ecuador", "Bolivia") === true);
check("no team names at all: allow", teamsMatchKnown(epl, "", null) === true);
check("a one-word overlap that is too short does not count (Utd vs United FC)", teamsMatchKnown(["Real Madrid"], "Ecuador", "Bolivia") === false);

const src = (f: string) => readFileSync(f, "utf8");
const routes = ["src/app/api/admin/ai/route.ts", "src/app/api/admin/predictions/route.ts", "src/app/api/admin/predictions/[id]/route.ts"];
for (const f of routes) {
  const s = src(f);
  check(`${f}: asks for confirmation with 409 LEAGUE_TEAM_MISMATCH`, /leagueTeamMismatch\(/.test(s) && /status: 409/.test(s) && /LEAGUE_TEAM_MISMATCH/.test(s));
  check(`${f}: an explicit confirmation lets it through`, /leagueConfirmed/.test(s));
}
const patch = src("src/app/api/admin/predictions/[id]/route.ts");
check("edit: only checked when the league or a team name changes", /placementChanged/.test(patch) && /!leagueConfirmed && placementChanged/.test(patch));
check("edit: a provider fixture id is trusted (no check)", /fixtureApiId: before\.fixtureApiId/.test(patch));

const ai = src("src/app/admin/ai/page.tsx");
check("generate-one-match form no longer pre-selects the first league", !/league: LEAGUE_CATALOGUE\[0\]/.test(ai) && !/leagueApiId: LEAGUE_CATALOGUE\[0\]\.id as number \| undefined/.test(ai));
check("generate-one-match form requires a league choice before generating", /!leagueChosen/.test(ai) && /Select a league…/.test(ai));
for (const f of ["src/app/admin/ai/page.tsx", "src/app/admin/predictions/new/page.tsx", "src/app/admin/predictions/[id]/page.tsx"]) {
  check(`${f}: asks the admin to confirm a mismatch`, /withLeagueConfirm\(/.test(src(f)));
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nleague/team checks passed");
