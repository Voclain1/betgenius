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
  check("no past results (they would go stale between refreshes)", !text.includes("Spurs") && !text.includes("most recent match"));
  check("next match in WAT", text.includes("on Sunday 18 October at 17:30 (West Africa Time)"));
  check("no prediction claimed when none is linked", !text.includes("already published"));
  check("singular prediction", text.includes("published 1 prediction on"));
  check("no recent-form line", !text.includes("Across their last"));
  check("no empty paragraphs", full.every((p) => p.trim().length > 0));

  check("ids from stored fields", JSON.stringify(upcomingTeamIds({ id: 1, date: "", homeTeam: "a", awayTeam: "b", homeLogo: null, awayLogo: null, homeId: 5, awayId: 6 })) === '{"home":5,"away":6}');
  check(
    "ids from crest URLs on older rows",
    JSON.stringify(upcomingTeamIds({ id: 1, date: "", homeTeam: "a", awayTeam: "b", homeLogo: "https://media.api-sports.io/football/teams/165.png", awayLogo: null })) === '{"home":165,"away":null}',
  );

  const { competitionInSentence } = await import("../src/lib/teamProfile");
  check(
    "competition articles",
    competitionInSentence("Premier League") === "the Premier League" &&
      competitionInSentence("La Liga") === "La Liga" &&
      competitionInSentence("Serie A") === "Serie A" &&
      competitionInSentence("Ligue 1") === "Ligue 1" &&
      competitionInSentence("UEFA Champions League") === "the UEFA Champions League" &&
      competitionInSentence("Copa del Rey") === "Copa del Rey",
  );
  check("one competition reads with its article", text.includes("This season Arsenal competes in the Premier League."), text.split("\n")[1]);

  const { aggregatePlayerStats, playerStatsWanted } = await import("../src/lib/enrichment");
  const agg = aggregatePlayerStats(
    [
      {
        player: { id: 9, name: "Striker" },
        statistics: [
          { team: { id: 50, name: "City" }, games: { appearences: 10, minutes: 800, rating: "7.50" }, goals: { total: 8, assists: 2 }, cards: { yellow: 0, yellowred: 0, red: 0 } },
          { team: { id: 50, name: "City" }, games: { appearences: 2, minutes: 90, rating: "6.30" }, goals: { total: 1, assists: null }, cards: { yellow: 0, yellowred: 0, red: 0 } },
          // A loan spell at another club this season is not this club's numbers.
          { team: { id: 77, name: "Other" }, games: { appearences: 5, minutes: 400, rating: "8.00" }, goals: { total: 4, assists: 4 }, cards: { yellow: 0, yellowred: 0, red: 0 } },
        ],
      },
    ] as any,
    50,
  ).get(9)!;
  check("season totals across this club's competitions only", agg.appearances === 12 && agg.goals === 9 && agg.assists === 2 && agg.minutes === 890, JSON.stringify(agg));
  check("rating is appearance-weighted", agg.rating === 7.3, String(agg.rating));
  check("player stats fetched for top-league clubs", playerStatsWanted(39) && !playerStatsWanted(null));

  const { clubHonours } = await import("../src/lib/clubHonours");
  check("honours for a curated club", (clubHonours(49, "Chelsea") ?? []).some((h) => h.title === "FA Cup" && h.count === 8));
  check("accented names still match", clubHonours(157, "Bayern München") !== null);
  check("an id whose name does not match shows nothing", clubHonours(49, "Chelsea FC Women".replace("Chelsea", "Arsenal")) === null);
  check("uncurated club shows nothing", clubHonours(999999, "Anyone") === null);

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
