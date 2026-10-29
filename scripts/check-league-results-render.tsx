/** Offline SSR regression: results and preview links exist before effects run.
 * TSX_TSCONFIG_PATH=scripts/tsconfig.render.json node --import tsx scripts/check-league-results-render.tsx
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { LeagueResults } from "../src/components/LeagueResults";
import { matchKey } from "../src/lib/slug";
import type { FixtureRow } from "../src/lib/football/api-football";

const now = Date.now();
const fixture = (id: number, leagueId: number, hoursAgo = 2, status = "FT"): FixtureRow => ({
  fixture: { id, date: new Date(now - hoursAgo * 3_600_000).toISOString(), status: { short: status } },
  league: { id: leagueId, name: "Test League", country: "England", season: 2026 },
  teams: { home: { id: 1, name: `Home ${id}` }, away: { id: 2, name: `Away ${id}` } },
  goals: { home: 2, away: 1 },
});
const current = fixture(1, 39);
const key = matchKey({ homeTeamApiId: 1, awayTeamApiId: 2, kickoff: current.fixture.date })!;
const html = renderToStaticMarkup(<LeagueResults leagueApiId={39} initialRows={[
  current, fixture(2, 140), fixture(3, 39, 40), fixture(4, 39, 2, "NS"), fixture(5, 39, 2, "PST"),
]} linkIndex={{ [key]: "test-match" }} />);
assert.ok(html.includes("Home 1") && html.includes("Away 1"), "server HTML contains result teams");
assert.ok(html.includes("/predictions/match/test-match"), "server HTML contains the published match link");
assert.ok(!html.includes("Loading recent results"), "seeded results require no client effect");
for (const id of [2, 3, 4, 5]) assert.ok(!html.includes(`Home ${id}`), "other leagues, stale and unfinished fixtures excluded");
const empty = renderToStaticMarkup(<LeagueResults leagueApiId={39} initialRows={[]} />);
assert.ok(empty.includes("No matches in this league") && !empty.includes("Loading"), "empty server snapshot renders immediately");
assert.ok(renderToStaticMarkup(<LeagueResults leagueApiId={399} />).includes("Loading recent results"), "uncovered leagues retain client loading path");
console.log("League results SSR checks passed (9 assertions)");
