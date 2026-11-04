/**
 * Asserts the homepage "Predictions by competition" selector
 * (src/lib/dayCompetitions.ts): headline competitions first, at most ten,
 * a quiet day topped up to three from the popular competitions without a
 * day count, smaller leagues taking the places when no top league plays,
 * and the short names readers use.
 *
 * Pure: no database, no network. Run: npx tsx scripts/check-day-competitions.ts
 */
export {};
import { selectDayCompetitions, DAY_COMPETITIONS_MAX, competitionShortName } from "../src/lib/dayCompetitions";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}
const row = (leagueApiId: number | null, leagueName: string, n = 1) => Array.from({ length: n }, () => ({ leagueApiId, leagueName }));
const pop = (leagueApiId: number, name: string) => ({ slug: `${name.toLowerCase().replace(/ /g, "-")}-${leagueApiId}`, name, leagueApiId, country: null, crest: null });

console.log("Order and short names");
{
  const rows = [...row(88, "Eredivisie", 6), ...row(39, "Premier League", 2), ...row(2, "UEFA Champions League", 9), ...row(140, "La Liga", 3)];
  const out = selectDayCompetitions(rows);
  check("UCL, then EPL, LaLiga, then the rest", out.map((c) => c.short).join(",") === "UCL,EPL,LaLiga,Eredivisie", out.map((c) => c.short).join(","));
  check("counts per competition", out[0].count === 9 && out[1].count === 2);
  check("Brazil's Serie A is not Italy's", competitionShortName(71, "Serie A") === "Brasileirão" && competitionShortName(135, "Serie A") === "Serie A");
  check("unknown id keeps its name", competitionShortName(9999, "Liga Pro") === "Liga Pro");
}

console.log("How many");
{
  const ids = [2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 144, 203];
  const rows = ids.flatMap((id) => row(id, `L${id}`));
  const out = selectDayCompetitions(rows);
  check(`busy day capped at ${DAY_COMPETITIONS_MAX}`, out.length === DAY_COMPETITIONS_MAX, String(out.length));
  check("the cap keeps the headline ones", out[0].leagueApiId === 2 && !out.some((c) => c.leagueApiId === 203));

  const quiet = selectDayCompetitions(row(39, "Premier League", 2), [pop(39, "Premier League"), pop(140, "La Liga"), pop(135, "Serie A"), pop(78, "Bundesliga")]);
  check("quiet day topped up to three", quiet.length === 3, String(quiet.length));
  check("top-ups carry no day count and no duplicate", quiet[0].count === 2 && quiet[1].count === null && quiet[1].leagueApiId === 140);

  const empty = selectDayCompetitions([], []);
  check("nothing published and nothing popular: empty (section hidden)", empty.length === 0);
}

console.log("No top league playing");
{
  const rows = [...row(4001, "Liga Pro", 2), ...row(71, "Serie A", 4), ...row(207, "Super League", 1)];
  const out = selectDayCompetitions(rows);
  check("the leagues that are playing take the spots", out.length === 3 && out.every((c) => c.count != null), out.map((c) => c.short).join(","));
  check("covered leagues before uncovered ones", out[out.length - 1].short === "Liga Pro", out.map((c) => c.short).join(","));
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll day-competitions checks passed");
