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
  const names = (ms: { homeTeam: string; awayTeam: string }[]) => ms.map((m) => `${m.homeTeam}-${m.awayTeam}`).join(",");
  const f = featuredMatches(up, table, ["charlie-vs-delta-2026-10-10"], 39, "Premier League", now, 2);
  check("the week's two biggest meetings, by table position, in kickoff order", names(f) === "Alpha-Bravo,Bravo-Delta", names(f));
  check("a published pick does not lift a smaller match", !f.some((m) => m.homeTeam === "Charlie"));
  check("past fixtures and those beyond the week are excluded", !f.some((m) => m.awayTeam === "Charlie" || m.homeTeam === "Delta"));
  const f3 = featuredMatches(up, table, ["charlie-vs-delta-2026-10-10"], 39, "Premier League", now);
  check("three by default; a published fixture links to its match page", f3.length === 3 && f3.find((m) => m.homeTeam === "Charlie")?.href === "/predictions/match/charlie-vs-delta-2026-10-10" && f3.find((m) => m.homeTeam === "Alpha")?.href === null);
  const tie = featuredMatches(
    [up[0], { ...up[0], id: 9, date: "2026-10-09T14:00:00Z", homeTeam: "Delta", awayTeam: "Charlie", homeId: 4, awayId: 3 }],
    table, ["charlie-vs-delta-2026-10-10"], 39, "Premier League", now, 1,
  );
  check("a published pick breaks a tie", names(tie) === "Charlie-Delta", names(tie));
  const brk = featuredMatches(up, table, [], 39, "Premier League", new Date("2026-10-12T12:00:00Z"));
  check("in a break, the week from the next fixture", names(brk) === "Alpha-Charlie", names(brk));
  check("no upcoming fixtures, no featured matches", featuredMatches([], table, [], 39, "x", now).length === 0);

  const p = seasonParagraph({ name: "Premier League", stats: s, table, scorers: [{ playerId: 1, name: "A. Striker", photo: null, teamId: 1, teamName: "Alpha", teamLogo: null, value: 3, appearances: 2, minutes: 180 }], pickCount: 1 })!;
  check("season paragraph states the leader and the gap", p.includes("Alpha lead the table on 6 points from 2 matches, 2 clear of Bravo in 2nd"), p);
  check("season paragraph names the top scorer", p.includes("A. Striker of Alpha leads the scoring charts with 3 goals."));
  check("season paragraph uses the article", p.includes("in the Premier League"));
  check("nothing to say yields null", seasonParagraph({ name: "X", stats: null, table: [], scorers: [], pickCount: 0 }) === null);

  const FIRST: Record<string, string> = { 39: "1888/89", 140: "1929", 135: "1898", 78: "1903", 61: "1932/33", 2: "1955/56", 3: "1971/72" };
  const startYear = (season: string) => (season.includes("/") ? Number(season.slice(0, 4)) : Number(season) - 1);
  const endYear = (season: string) => startYear(season) + 1;
  for (const [id, h] of Object.entries(COMPETITION_HISTORY)) {
    check(`competition ${id}: roll runs from the first season (${FIRST[id]}), newest first`, h.champions.at(-1)!.season === FIRST[id], h.champions.at(-1)!.season);
    check(
      `competition ${id}: seasons strictly descending, one champion each`,
      h.champions.every((c, i) => i === 0 || startYear(h.champions[i - 1].season) > startYear(c.season)) && new Set(h.champions.map((c) => c.season)).size === h.champions.length,
    );
    check(`competition ${id}: profile has text`, h.profile.length >= 2 && h.profile.every((t) => t.length > 80));
  }
  // Only the wars (and Spain's civil war) leave seasons without a champion.
  const missing = (id: number) => {
    const have = new Set(COMPETITION_HISTORY[id].champions.map((c) => startYear(c.season)));
    const out: number[] = [];
    for (let y = startYear(FIRST[id]); y <= startYear(COMPETITION_HISTORY[id].champions[0].season); y++) if (!have.has(y)) out.push(y);
    return out.join(",");
  };
  check("England: no title 1915-19 or 1939-46", missing(39) === "1915,1916,1917,1918,1939,1940,1941,1942,1943,1944,1945", missing(39));
  check("Spain: no title 1936-39", missing(140) === "1936,1937,1938", missing(140));
  check("Italy: no title 1915-19 or 1943-45", missing(135) === "1915,1916,1917,1918,1943,1944", missing(135));
  check("Germany: no title 1904, 1915-19 or 1945-47", missing(78) === "1903,1914,1915,1916,1917,1918,1944,1945,1946", missing(78));
  check("France: no title 1939-45", missing(61) === "1939,1940,1941,1942,1943,1944", missing(61));
  check("European competitions: every season played", missing(2) === "" && missing(3) === "");

  const tally = (id: number) => titlesSince(COMPETITION_HISTORY[id].champions);
  const top = (id: number, n: number) => tally(id).slice(0, n).map((t) => `${t.winner} ${t.count}`).join(", ");
  check("England all-time: Liverpool 20, Man United 20, Arsenal 14, Man City 10, Everton 9", top(39, 5) === "Liverpool 20, Manchester United 20, Arsenal 14, Manchester City 10, Everton 9", top(39, 5));
  check("Premier League 2025/26: Arsenal", COMPETITION_HISTORY[39].champions[0].season === "2025/26" && COMPETITION_HISTORY[39].champions[0].winner === "Arsenal");
  check("Spain all-time: Real Madrid 36, Barcelona 29, Atlético 11", top(140, 3) === "Real Madrid 36, Barcelona 29, Atlético Madrid 11", top(140, 3));
  check("Italy all-time: Juventus 36, Inter 21, Milan 19", top(135, 3) === "Juventus 36, Inter 21, AC Milan 19", top(135, 3));
  check("Italy 1921/22: both champions count", COMPETITION_HISTORY[135].champions.find((c) => c.season === "1921/22")?.also?.winner === "Novese" && tally(135).some((t) => t.winner === "Novese" && t.count === 1));
  check("Italy: revoked titles count for nobody", tally(135).every((t) => t.winner !== "Not assigned"));
  check("Germany all-time: Bayern 35, Nürnberg 9, Dortmund 8", top(78, 3) === "Bayern Munich 35, 1. FC Nürnberg 9, Borussia Dortmund 8", top(78, 3));
  check("France all-time: PSG 14, Saint-Étienne 10, Marseille 9", top(61, 3) === "Paris Saint-Germain 14, Saint-Étienne 10, Marseille 9", top(61, 3));
  check("Champions League all-time: Real Madrid 15, Milan 7", top(2, 2) === "Real Madrid 15, AC Milan 7", top(2, 2));
  const latest = Object.fromEntries(Object.entries(COMPETITION_HISTORY).map(([id, h]) => [id, `${h.champions[0].season} ${h.champions[0].winner}`]));
  check("2025/26 champions everywhere", JSON.stringify(latest) === JSON.stringify({
    2: "2025/26 Paris Saint-Germain", 3: "2025/26 Aston Villa", 39: "2025/26 Arsenal", 61: "2025/26 Paris Saint-Germain",
    78: "2025/26 Bayern Munich", 135: "2025/26 Inter", 140: "2025/26 Barcelona",
  }), JSON.stringify(latest));
  check("Europa League all-time: Sevilla 7", top(3, 1) === "Sevilla 7", top(3, 1));

  // The rolls and the club honours are kept by hand in two places: they must
  // agree on every verified club's count and last win, both ways round.
  const { CLUB_HONOURS } = await import("../src/lib/clubHonours");
  const TITLE_TO_COMPETITION: Record<string, number> = {
    "League titles": 39, "La Liga": 140, "Serie A": 135, "German titles": 78, "Ligue 1": 61,
    "European Cup / Champions League": 2, "UEFA Cup / Europa League": 3,
  };
  const COUNTRY_LEAGUE: Record<string, number> = { "League titles": 39, "La Liga": 140, "Serie A": 135, "German titles": 78, "Ligue 1": 61 };
  for (const [teamId, club] of Object.entries(CLUB_HONOURS)) {
    const leagueTitle = club.honours.find((h) => COUNTRY_LEAGUE[h.title])?.title;
    const competitions = [...new Set([leagueTitle ? COUNTRY_LEAGUE[leagueTitle] : null, 2, 3].filter((x): x is number => x != null))];
    for (const comp of competitions) {
      const t = tally(comp).find((x) => x.teamId === Number(teamId));
      const h = club.honours.find((x) => TITLE_TO_COMPETITION[x.title] === comp);
      const rollSays = t ? `${t.count} (last ${endYear(t.last)})` : "none";
      const honoursSay = h ? `${h.count} (last ${h.last})` : "none";
      check(`honours agree with the roll: ${club.match} in ${comp}`, rollSays === honoursSay, `roll ${rollSays}, honours ${honoursSay}`);
    }
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
