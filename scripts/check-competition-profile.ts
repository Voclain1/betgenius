/**
 * League/cup page profile: season stats, featured matches, the live season
 * paragraph, and the curated champions lists.
 *
 * Pure. Run: npx tsx scripts/check-competition-profile.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { competitionStats, featuredMatches, seasonParagraph } = await import("../src/lib/competitionProfile");
  const { COMPETITION_HISTORY, titlesSince } = await import("../src/lib/competitionHistory");

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  const split = (played: number, win: number, draw: number, loss: number) => ({ played, win, draw, loss, goalsFor: 0, goalsAgainst: 0 });
  // A four-club league, two matchdays: 4 matches, 10 goals.
  const table: any[] = [
    { rank: 1, teamId: 1, teamName: "Alpha", teamLogo: null, points: 6, played: 2, win: 2, draw: 0, loss: 0, goalsFor: 4, goalsAgainst: 1, form: null, home: split(1, 1, 0, 0) },
    { rank: 2, teamId: 2, teamName: "Bravo", teamLogo: null, points: 4, played: 2, win: 1, draw: 1, loss: 0, goalsFor: 3, goalsAgainst: 1, form: null, home: split(1, 0, 1, 0) },
    { rank: 3, teamId: 3, teamName: "Charlie", teamLogo: null, points: 1, played: 2, win: 0, draw: 1, loss: 1, goalsFor: 2, goalsAgainst: 3, form: null, home: split(1, 0, 0, 1) },
    { rank: 4, teamId: 4, teamName: "Delta", teamLogo: null, points: 0, played: 2, win: 0, draw: 0, loss: 2, goalsFor: 1, goalsAgainst: 5, form: null, home: split(1, 0, 0, 1) },
  ];
  const s = competitionStats(table)!;
  check("matches counted once", s.matches === 4, String(s.matches));
  check("goals and goals per match", s.goals === 10 && s.goalsPerMatch === 2.5, `${s.goals} ${s.goalsPerMatch}`);
  check("home/draw/away shares from the home splits", s.homeWinPct === 25 && s.drawPct === 25 && s.awayWinPct === 50, `${s.homeWinPct}/${s.drawPct}/${s.awayWinPct}`);
  check("leader, best attack, best defence", s.leader.teamName === "Alpha" && s.bestAttack.teamName === "Alpha" && s.bestDefence.teamName === "Alpha");
  check("no stats before a ball is kicked", competitionStats(table.map((r) => ({ ...r, played: 0 }))) === null);

  const now = new Date("2026-10-08T12:00:00Z");
  const up = [
    { id: 1, date: "2026-10-10T14:00:00Z", homeTeam: "Charlie", awayTeam: "Delta", homeLogo: null, awayLogo: null, homeId: 3, awayId: 4 },
    { id: 2, date: "2026-10-10T16:30:00Z", homeTeam: "Alpha", awayTeam: "Bravo", homeLogo: null, awayLogo: null, homeId: 1, awayId: 2 },
    { id: 3, date: "2026-10-11T14:00:00Z", homeTeam: "Bravo", awayTeam: "Delta", homeLogo: null, awayLogo: null, homeId: 2, awayId: 4 },
    { id: 4, date: "2026-10-25T14:00:00Z", homeTeam: "Alpha", awayTeam: "Charlie", homeLogo: null, awayLogo: null, homeId: 1, awayId: 3 },
    { id: 5, date: "2026-10-07T14:00:00Z", homeTeam: "Delta", awayTeam: "Alpha", homeLogo: null, awayLogo: null, homeId: 4, awayId: 1 },
  ];
  const f = featuredMatches(up, table, ["charlie-vs-delta-2026-10-10"], 39, "Premier League", now, 2);
  check("published fixture first, then the top-placed meeting", f.map((m) => `${m.homeTeam}-${m.awayTeam}`).join(",") === "Charlie-Delta,Alpha-Bravo", f.map((m) => `${m.homeTeam}-${m.awayTeam}`).join(","));
  check("published fixture links to its match page", f[0].href === "/predictions/match/charlie-vs-delta-2026-10-10" && f[1].href === null);
  check("past and next-round-plus fixtures are excluded", !f.some((m) => m.awayTeam === "Charlie" || m.homeTeam === "Delta"));
  check("no upcoming fixtures, no featured matches", featuredMatches([], table, [], 39, "x", now).length === 0);

  const p = seasonParagraph({ name: "Premier League", stats: s, table, scorers: [{ playerId: 1, name: "A. Striker", photo: null, teamId: 1, teamName: "Alpha", teamLogo: null, value: 3, appearances: 2, minutes: 180 }], pickCount: 1 })!;
  check("season paragraph states the leader and the gap", p.includes("Alpha lead the table on 6 points from 2 matches, 2 clear of Bravo in 2nd"), p);
  check("season paragraph names the top scorer", p.includes("A. Striker of Alpha leads the scoring charts with 3 goals."));
  check("season paragraph uses the article", p.includes("in the Premier League"));
  check("nothing to say yields null", seasonParagraph({ name: "X", stats: null, table: [], scorers: [], pickCount: 0 }) === null);

  for (const [id, h] of Object.entries(COMPETITION_HISTORY)) {
    check(`competition ${id}: every season from 2004/05, newest first, no gaps`, h.champions.at(-1)!.season === "2004/05" && h.champions.every((c, i) => i === 0 || Number(h.champions[i - 1].season.slice(0, 4)) - Number(c.season.slice(0, 4)) === 1));
    check(`competition ${id}: profile has text`, h.profile.length >= 2 && h.profile.every((t) => t.length > 80));
  }
  const epl = titlesSince(COMPETITION_HISTORY[39].champions);
  check("Premier League 2025/26: Arsenal", COMPETITION_HISTORY[39].champions[0].season === "2025/26" && COMPETITION_HISTORY[39].champions[0].winner === "Arsenal");
  check("Premier League since 2004/05: Man City 8, Chelsea 5, Man United 5", epl[0].winner === "Manchester City" && epl[0].count === 8 && epl.find((e) => e.winner === "Chelsea")?.count === 5 && epl.find((e) => e.winner === "Manchester United")?.count === 5);
  check("Bundesliga: Bayern 16 of 21", titlesSince(COMPETITION_HISTORY[78].champions)[0].count === 16);
  check("Serie A: the revoked 2004/05 title counts for nobody", titlesSince(COMPETITION_HISTORY[135].champions).every((t) => t.winner !== "Not assigned"));
  check("Champions League 2024/25: Paris Saint-Germain", COMPETITION_HISTORY[2].champions[0].winner === "Paris Saint-Germain");

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
