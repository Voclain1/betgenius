/**
 * The team page's "Know more about" text and next-match helpers.
 *
 * buildTeamAbout writes indexable prose from stored facts only, so the rules
 * that matter are what it must NOT say: nothing for a fact it does not have,
 * no claim of a published prediction without a link, and no empty paragraphs.
 *
 * Pure. Run: npx tsx scripts/check-team-profile.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { buildTeamAbout } = await import("../src/lib/teamProfile");
  const { upcomingTeamIds } = await import("../src/lib/enrichment");

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  const bare = buildTeamAbout({ name: "Nowhere FC", profile: null, venue: { name: null, city: null, capacity: null }, coach: null, lastFixtures: null, squad: [], pickCount: 0 });
  check("no facts -> no paragraphs", bare.length === 0, JSON.stringify(bare));

  const full = buildTeamAbout({
    name: "Arsenal",
    profile: {
      nextMatch: { homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamApiId: 42, awayTeamApiId: 49, kickoff: new Date("2026-10-18T16:30:00Z"), leagueApiId: 39, leagueName: "Premier League", href: null },
      upcoming: [],
      competitions: [{ leagueApiId: 39, name: "Premier League", href: "/predictions/league/premier-league" }],
      standing: { leagueApiId: 39, leagueName: "Premier League", size: 20, row: { rank: 2, teamId: 42, teamName: "Arsenal", teamLogo: null, points: 16, played: 7, win: 5, draw: 1, loss: 1, goalsFor: 14, goalsAgainst: 5, form: null } },
      country: "England",
      flagCode: "gb-eng",
    },
    venue: { name: "Emirates Stadium", city: "London", capacity: 60383 },
    coach: { name: "Mikel Arteta", nationality: "Spain", since: null },
    lastFixtures: [{ opponent: "Spurs", result: "W", date: "2026-10-04T12:00:00Z", venue: "home", goalsFor: 2, goalsAgainst: 0 }],
    squad: [],
    pickCount: 1,
  });
  const text = full.join("\n");
  check("states the ground", text.includes("Emirates Stadium in London, which holds 60,383 spectators"));
  check("states the table", text.includes("they sit 2nd of 20 with 16 points from 7 matches"));
  check("coach without an unassertable start date", text.includes("coached by Mikel Arteta (Spain).") && !text.includes("since"));
  check("last result reads naturally", text.includes("Arsenal beat Spurs 2-0 at home"));
  check("next match in WAT", text.includes("on Sunday 18 October at 17:30 (West Africa Time)"));
  check("no prediction claimed when none is linked", !text.includes("already published"));
  check("singular prediction", text.includes("published 1 prediction on"));
  check("one-result form line is not stated", !text.includes("Across their last"));
  check("no empty paragraphs", full.every((p) => p.trim().length > 0));

  check("ids from stored fields", JSON.stringify(upcomingTeamIds({ id: 1, date: "", homeTeam: "a", awayTeam: "b", homeLogo: null, awayLogo: null, homeId: 5, awayId: 6 })) === '{"home":5,"away":6}');
  check(
    "ids from crest URLs on older rows",
    JSON.stringify(upcomingTeamIds({ id: 1, date: "", homeTeam: "a", awayTeam: "b", homeLogo: "https://media.api-sports.io/football/teams/165.png", awayLogo: null })) === '{"home":165,"away":null}',
  );

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
