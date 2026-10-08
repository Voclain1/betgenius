/**
 * Curated history for the headline competitions: champions by season and a
 * short, durable profile (founding, format, record holders, rivalries, reach).
 *
 * API-Football has no honours data, so this is maintained by hand. Champions
 * run from 2004/05 to the newest season known for each competition (the first
 * entry of its list); a newer season's champion is added at the top. The profile text sticks to
 * facts that do not drift between seasons: no revenue figures, attendances or
 * other numbers that would go stale silently. Anything about the season in
 * progress is written from live data instead (see buildCompetitionAbout).
 *
 * `teamId` is set only for clubs whose API-Football id has been checked
 * against production (the same set as src/lib/clubHonours.ts, plus Leicester),
 * so a crest is never shown against the wrong name.
 */

/** The newest season any list covers. Each list's own newest season is its first entry. */
export const HISTORY_AS_OF = "2025/26";

export type Champion = { season: string; winner: string; teamId?: number; note?: string };
export type CompetitionHistory = {
  /** Paragraphs for "Know more about", before the live season paragraph. */
  profile: string[];
  champions: Champion[];
};

const MUN = { winner: "Manchester United", teamId: 33 };
const CHE = { winner: "Chelsea", teamId: 49 };
const MCI = { winner: "Manchester City", teamId: 50 };
const LIV = { winner: "Liverpool", teamId: 40 };
const LEI = { winner: "Leicester City", teamId: 46 };
const TOT = { winner: "Tottenham Hotspur", teamId: 47 };
const RMA = { winner: "Real Madrid", teamId: 541 };
const BAR = { winner: "Barcelona", teamId: 529 };
const ATM = { winner: "Atlético Madrid", teamId: 530 };
const SEV = { winner: "Sevilla", teamId: 536 };
const INT = { winner: "Inter", teamId: 505 };
const MIL = { winner: "AC Milan", teamId: 489 };
const JUV = { winner: "Juventus", teamId: 496 };
const NAP = { winner: "Napoli", teamId: 492 };
const BAY = { winner: "Bayern Munich", teamId: 157 };
const BVB = { winner: "Borussia Dortmund", teamId: 165 };
const B04 = { winner: "Bayer Leverkusen", teamId: 168 };
const VFB = { winner: "VfB Stuttgart", teamId: 172 };
const PSG = { winner: "Paris Saint-Germain", teamId: 85 };
const OL = { winner: "Lyon", teamId: 80 };
const OM = { winner: "Marseille", teamId: 81 };
const ASM = { winner: "Monaco", teamId: 91 };

/** "2025/26" for the season starting in 2025. */
const seasonLabel = (start: number) => `${start}/${String(start + 1).slice(-2)}`;
/**
 * Champions newest first, the first entry being the season that started in
 * `latestStart`. Adding a new champion is one line: prepend the winner and
 * bump `latestStart`.
 */
const list = (latestStart: number, winners: Omit<Champion, "season">[]): Champion[] =>
  winners.map((w, i) => ({ season: seasonLabel(latestStart - i), ...w }));
const ARS = { winner: "Arsenal", teamId: 42 };

export const COMPETITION_HISTORY: Record<number, CompetitionHistory> = {
  39: {
    profile: [
      "The Premier League began in 1992, when the clubs of the old First Division broke away from the Football League to form their own competition. Twenty clubs play each other home and away over 38 matches, and the bottom three are relegated to the Championship.",
      "Manchester United dominated the early years under Sir Alex Ferguson, before Chelsea, Manchester City and Liverpool took their turns at the top; Manchester City's run of four straight titles from 2020/21 is a league record. Leicester City's 2015/16 title, won from odds of 5000-1, remains the competition's great upset, and Arsenal ended a 22-year wait for the title in 2025/26.",
      "Its fiercest rivalries are the North West derby between Liverpool and Manchester United, the Manchester and Merseyside derbies, and the North London derby between Arsenal and Tottenham. It is the most watched football league in the world and earns the most from broadcasting of any league, which is why its clubs dominate the sport's rich lists.",
    ],
    champions: list(2025, [ARS, LIV, MCI, MCI, MCI, MCI, LIV, MCI, MCI, CHE, LEI, CHE, MCI, MUN, MCI, MUN, CHE, MUN, MUN, MUN, CHE, CHE]),
  },
  140: {
    profile: [
      "La Liga was founded in 1929 and is played by 20 clubs over 38 rounds, with three relegated each season. Real Madrid hold the record for titles, with Barcelona second, and the two have shared the vast majority of championships between them.",
      "Atlético Madrid are the one club to have broken that duopoly repeatedly in the modern era, with titles in 2013/14 and 2020/21. Spanish clubs have also been the most successful in European competition, led by Real Madrid in the Champions League and Sevilla in the Europa League.",
      "El Clásico between Real Madrid and Barcelona is one of the most watched club matches in the world. The Madrid derby, the Seville derby between Sevilla and Real Betis, and the Basque derby between Athletic Club and Real Sociedad carry their own long histories.",
    ],
    champions: list(2024, [BAR, RMA, BAR, RMA, ATM, RMA, BAR, BAR, RMA, BAR, BAR, ATM, BAR, RMA, BAR, BAR, BAR, RMA, RMA, BAR, BAR]),
  },
  135: {
    profile: [
      "Serie A has been played as a single national league since 1929/30. Twenty clubs meet home and away over 38 rounds, and three are relegated to Serie B.",
      "Juventus hold the record for titles, including nine in a row from 2011/12 to 2019/20. Inter and AC Milan follow, and Napoli won their first title since the Maradona era in 2022/23 before adding another in 2024/25. The 2004/05 title was revoked after the Calciopoli scandal and never reassigned, and the 2005/06 title was awarded to Inter.",
      "The Derby della Madonnina between Inter and AC Milan, the Derby d'Italia between Inter and Juventus, the Rome derby between Roma and Lazio and the Turin derby are its defining fixtures. Italian football is known for tactical, defensive sophistication, and its clubs have won the European Cup twelve times between them.",
    ],
    champions: list(2024, [NAP, INT, NAP, MIL, INT, JUV, JUV, JUV, JUV, JUV, JUV, JUV, JUV, JUV, MIL, INT, INT, INT, INT, INT, { winner: "Not assigned", note: "Title revoked (Calciopoli)" }]),
  },
  78: {
    profile: [
      "The Bundesliga was founded in 1963 as West Germany's first national league. Eighteen clubs play 34 matchdays; the bottom two are relegated and the 16th-placed club meets the third-placed side from the 2. Bundesliga in a play-off.",
      "Bayern Munich are the most successful club by a distance, including eleven straight titles from 2012/13 to 2022/23. That run was ended by Bayer Leverkusen, who won the 2023/24 title without losing a league match. Borussia Dortmund, champions in 2010/11 and 2011/12, have been Bayern's most consistent challengers.",
      "Der Klassiker between Bayern and Dortmund and the Revierderby between Dortmund and Schalke are its biggest matches. German clubs are majority-owned by their members under the 50+1 rule, ticket prices are kept low, and the league is famous for the fullest stadiums in European football.",
    ],
    champions: list(2024, [BAY, B04, BAY, BAY, BAY, BAY, BAY, BAY, BAY, BAY, BAY, BAY, BAY, BVB, BVB, BAY, { winner: "Wolfsburg" }, BAY, VFB, BAY, BAY]),
  },
  61: {
    profile: [
      "France's national championship dates from 1932/33. Ligue 1 has been played by 18 clubs since 2023/24, meeting home and away over 34 rounds.",
      "Paris Saint-Germain hold the record for titles and have won most championships since 2012/13. Before them, Lyon won seven in a row from 2001/02 to 2007/08, and Saint-Étienne and Marseille were the most decorated clubs of earlier eras. Monaco (2016/17) and Lille (2020/21) are the only clubs to have broken PSG's run in the past decade.",
      "Le Classique between PSG and Marseille is the country's biggest match. The Derby du Rhône between Lyon and Saint-Étienne and the Derby du Nord between Lille and Lens are among the oldest rivalries. Ligue 1 is renowned for producing young talent that goes on to Europe's biggest clubs.",
    ],
    champions: list(2024, [PSG, PSG, PSG, PSG, { winner: "Lille" }, PSG, PSG, PSG, ASM, PSG, PSG, PSG, PSG, { winner: "Montpellier" }, { winner: "Lille" }, OM, { winner: "Bordeaux" }, OL, OL, OL, OL]),
  },
  2: {
    profile: [
      "The European Cup began in 1955/56 and became the UEFA Champions League in 1992/93. From 2024/25 it opens with a single 36-team league phase, followed by knockout rounds and a one-off final.",
      "Real Madrid have won it more often than any other club, including the first five editions and three in a row from 2016 to 2018. AC Milan, Bayern Munich and Liverpool are next on the roll of honour, and Paris Saint-Germain won it for the first time in 2024/25.",
      "It is the most watched annual club competition in the world, and its anthem and group-stage nights are central to the modern game. Qualification comes through domestic leagues, so a club's league position decides whether it plays here the following season.",
    ],
    champions: list(2024, [PSG, RMA, MCI, RMA, CHE, BAY, LIV, RMA, RMA, RMA, BAR, RMA, BAY, CHE, BAR, INT, BAR, MUN, MIL, BAR, LIV]),
  },
  3: {
    profile: [
      "The UEFA Cup began in 1971/72 and was renamed the UEFA Europa League in 2009/10. Since 2024/25 it opens with a 36-team league phase before the knockout rounds and the final.",
      "Sevilla are its most successful club by far, with seven titles, three of them in a row from 2014 to 2016. Its winner earns a place in the next season's Champions League, which has made it a serious target for clubs outside their domestic top four.",
      "Recent finals have brought first European trophies or long-awaited ones: Eintracht Frankfurt in 2022, Atalanta in 2024 and Tottenham Hotspur, ending a 17-year wait for silverware, in 2025.",
    ],
    champions: list(2024, [TOT, { winner: "Atalanta" }, SEV, { winner: "Eintracht Frankfurt" }, { winner: "Villarreal" }, SEV, CHE, ATM, MUN, SEV, SEV, SEV, CHE, ATM, { winner: "Porto" }, ATM, { winner: "Shakhtar Donetsk" }, { winner: "Zenit Saint Petersburg" }, SEV, SEV, { winner: "CSKA Moscow" }]),
  },
};

/** Most titles in the listed seasons, highest first: e.g. [["Manchester City", 8], ...]. */
export function titlesSince(champions: Champion[]): { winner: string; teamId?: number; count: number }[] {
  const by = new Map<string, { winner: string; teamId?: number; count: number }>();
  for (const c of champions) {
    if (c.note) continue;
    const e = by.get(c.winner) ?? { winner: c.winner, teamId: c.teamId, count: 0 };
    e.count++;
    by.set(c.winner, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.winner.localeCompare(b.winner));
}
