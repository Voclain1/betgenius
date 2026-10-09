/**
 * Curated history for the headline competitions: every champion since the
 * competition (or the national championship it continues) began, and a short,
 * durable profile (founding, format, record holders, rivalries, reach).
 *
 * API-Football has no honours data, so this is maintained by hand. A newer
 * season's champion is one more code at the end of its roll. The profile text
 * sticks to facts that do not drift between seasons: no revenue figures,
 * attendances or other numbers that would go stale silently. Anything about
 * the season in progress is written from live data instead (see
 * seasonParagraph in competitionProfile.ts).
 *
 * The rolls are checked against the all-time totals in src/lib/clubHonours.ts
 * (scripts/check-competition-profile.ts), two hand-kept sources that must
 * agree club by club, title count and year of the last win alike.
 *
 * `teamId` is set only for clubs whose API-Football id has been checked
 * against production (the same set as src/lib/clubHonours.ts, plus Leicester),
 * so a crest is never shown against the wrong name.
 */

/** The newest season any roll covers. Each roll's own newest season is its first entry. */
export const HISTORY_AS_OF = "2025/26";

type Club = { winner: string; teamId?: number };
export type Champion = Club & {
  season: string;
  note?: string;
  /** A season with two recognised champions (Italy 1921/22): both count. */
  also?: Club;
};
export type CompetitionHistory = {
  /** Paragraphs for "Know more about", before the live season paragraph. */
  profile: string[];
  /** Newest first, from the first season ever played. */
  champions: Champion[];
  /** What the roll covers, where it is more than the competition's current name. */
  scope?: string;
};

/**
 * Every club on any roll, by a three-letter code. A code is unique across
 * competitions, so the same club always reads the same way.
 */
const CLUBS: Record<string, Club> = {
  // England
  PNE: { winner: "Preston North End" },
  EVE: { winner: "Everton", teamId: 45 },
  SUN: { winner: "Sunderland" },
  AVL: { winner: "Aston Villa", teamId: 66 },
  SHU: { winner: "Sheffield United" },
  LIV: { winner: "Liverpool", teamId: 40 },
  SHW: { winner: "Sheffield Wednesday" },
  NEW: { winner: "Newcastle United", teamId: 34 },
  MUN: { winner: "Manchester United", teamId: 33 },
  BLB: { winner: "Blackburn Rovers" },
  WBA: { winner: "West Bromwich Albion" },
  BUR: { winner: "Burnley" },
  HUD: { winner: "Huddersfield Town" },
  ARS: { winner: "Arsenal", teamId: 42 },
  MCI: { winner: "Manchester City", teamId: 50 },
  PMH: { winner: "Portsmouth" },
  TOT: { winner: "Tottenham Hotspur", teamId: 47 },
  WOL: { winner: "Wolverhampton Wanderers" },
  CHE: { winner: "Chelsea", teamId: 49 },
  IPS: { winner: "Ipswich Town" },
  LEE: { winner: "Leeds United" },
  DER: { winner: "Derby County" },
  NFO: { winner: "Nottingham Forest" },
  LEI: { winner: "Leicester City", teamId: 46 },
  // Spain
  BAR: { winner: "Barcelona", teamId: 529 },
  ATH: { winner: "Athletic Club", teamId: 531 },
  RMA: { winner: "Real Madrid", teamId: 541 },
  BET: { winner: "Real Betis" },
  ATM: { winner: "Atlético Madrid", teamId: 530 },
  VAL: { winner: "Valencia", teamId: 532 },
  SEV: { winner: "Sevilla", teamId: 536 },
  RSO: { winner: "Real Sociedad" },
  DEP: { winner: "Deportivo La Coruña" },
  VIL: { winner: "Villarreal" },
  // Italy
  GEN: { winner: "Genoa" },
  MIL: { winner: "AC Milan", teamId: 489 },
  JUV: { winner: "Juventus", teamId: 496 },
  PRO: { winner: "Pro Vercelli" },
  INT: { winner: "Inter", teamId: 505 },
  CAS: { winner: "Casale" },
  NOV: { winner: "Novese" },
  BOL: { winner: "Bologna" },
  TOR: { winner: "Torino" },
  ROM: { winner: "Roma", teamId: 497 },
  FIO: { winner: "Fiorentina" },
  CAG: { winner: "Cagliari" },
  LAZ: { winner: "Lazio", teamId: 487 },
  NAP: { winner: "Napoli", teamId: 492 },
  VER: { winner: "Hellas Verona" },
  SAM: { winner: "Sampdoria" },
  PAR: { winner: "Parma" },
  ATA: { winner: "Atalanta" },
  // Germany and Austria
  VFL: { winner: "VfB Leipzig" },
  U92: { winner: "Union 92 Berlin" },
  FFC: { winner: "Freiburger FC" },
  VIK: { winner: "Viktoria Berlin" },
  PHO: { winner: "Phönix Karlsruhe" },
  KFV: { winner: "Karlsruher FV" },
  KIE: { winner: "Holstein Kiel" },
  FUR: { winner: "SpVgg Fürth" },
  FCN: { winner: "1. FC Nürnberg" },
  HSV: { winner: "Hamburger SV" },
  BSC: { winner: "Hertha BSC" },
  BAY: { winner: "Bayern Munich", teamId: 157 },
  F95: { winner: "Fortuna Düsseldorf" },
  S04: { winner: "Schalke 04" },
  H96: { winner: "Hannover 96" },
  RAP: { winner: "Rapid Vienna" },
  DSC: { winner: "Dresdner SC" },
  MAN: { winner: "VfR Mannheim" },
  VFB: { winner: "VfB Stuttgart", teamId: 172 },
  FCK: { winner: "1. FC Kaiserslautern" },
  RWE: { winner: "Rot-Weiss Essen" },
  BVB: { winner: "Borussia Dortmund", teamId: 165 },
  SGE: { winner: "Eintracht Frankfurt" },
  KOE: { winner: "1. FC Köln" },
  SVW: { winner: "Werder Bremen" },
  M60: { winner: "1860 Munich" },
  EBS: { winner: "Eintracht Braunschweig" },
  BMG: { winner: "Borussia Mönchengladbach" },
  WOB: { winner: "Wolfsburg" },
  B04: { winner: "Bayer Leverkusen", teamId: 168 },
  // France
  OLL: { winner: "Olympique Lillois" },
  SET: { winner: "Sète" },
  SOC: { winner: "Sochaux" },
  RCP: { winner: "Racing Paris" },
  OM: { winner: "Marseille", teamId: 81 },
  LIL: { winner: "Lille" },
  CRT: { winner: "Roubaix-Tourcoing" },
  REI: { winner: "Reims" },
  BOR: { winner: "Bordeaux" },
  NIC: { winner: "Nice" },
  STE: { winner: "Saint-Étienne" },
  ASM: { winner: "Monaco", teamId: 91 },
  NAN: { winner: "Nantes" },
  STR: { winner: "Strasbourg" },
  PSG: { winner: "Paris Saint-Germain", teamId: 85 },
  AUX: { winner: "Auxerre" },
  LEN: { winner: "Lens" },
  OL: { winner: "Lyon", teamId: 80 },
  MTP: { winner: "Montpellier" },
  // Elsewhere in Europe
  BEN: { winner: "Benfica" },
  CEL: { winner: "Celtic" },
  FEY: { winner: "Feyenoord" },
  AJA: { winner: "Ajax" },
  STB: { winner: "Steaua Bucharest" },
  FCP: { winner: "Porto" },
  PSV: { winner: "PSV Eindhoven" },
  RSB: { winner: "Red Star Belgrade" },
  GOT: { winner: "IFK Göteborg" },
  AND: { winner: "Anderlecht" },
  GAL: { winner: "Galatasaray" },
  CSK: { winner: "CSKA Moscow" },
  ZEN: { winner: "Zenit Saint Petersburg" },
  SHA: { winner: "Shakhtar Donetsk" },
};

/** Seasons with no champion: the title was revoked or never awarded. */
const VOID: Record<string, Champion & { winner: string }> = {
  XT: { season: "", winner: "Not assigned", note: "Title revoked (Torino)" },
  XC: { season: "", winner: "Not assigned", note: "Title revoked (Calciopoli)" },
  XM: { season: "", winner: "Not assigned", note: "Title revoked (Marseille)" },
  XN: { season: "", winner: "Not awarded", note: "Final unresolved" },
};

/**
 * "2025/26" for the season starting in 2025; "1903" for one played inside a
 * single calendar year (the early German and Italian championships, and the
 * first La Liga in 1929), named by the year it was decided.
 */
const seasonLabel = (start: number, calendarBefore: number) =>
  start < calendarBefore ? String(start + 1) : `${start}/${String(start + 1).slice(-2)}`;

/**
 * A roll of champions from codes, oldest first, one per season from the
 * season starting in `firstStart`: "-" for a season not played (the wars),
 * "A+B" for a shared title, an X code for one revoked or never awarded.
 * Returned newest first. Adding a champion is one more code at the end.
 */
function roll(firstStart: number, codes: string, calendarBefore = 0): Champion[] {
  const out: Champion[] = [];
  codes.trim().split(/\s+/).forEach((code, i) => {
    if (code === "-") return;
    const season = seasonLabel(firstStart + i, calendarBefore);
    if (VOID[code]) return out.push({ ...VOID[code], season });
    const [a, b] = code.split("+");
    const club = CLUBS[a];
    if (!club || (b && !CLUBS[b])) throw new Error(`competitionHistory: unknown club code ${code}`);
    out.push(b ? { season, ...club, also: CLUBS[b], note: "Shared title" } : { season, ...club });
  });
  return out.reverse();
}

export const COMPETITION_HISTORY: Record<number, CompetitionHistory> = {
  39: {
    profile: [
      "The Premier League began in 1992, when the clubs of the old First Division broke away from the Football League to form their own competition. Twenty clubs play each other home and away over 38 matches, and the bottom three are relegated to the Championship.",
      "Manchester United dominated the early years under Sir Alex Ferguson, before Chelsea, Manchester City and Liverpool took their turns at the top; Manchester City's run of four straight titles from 2020/21 is a league record. Leicester City's 2015/16 title, won from odds of 5000-1, remains the competition's great upset, and Arsenal ended a 22-year wait for the title in 2025/26.",
      "Its fiercest rivalries are the North West derby between Liverpool and Manchester United, the Manchester and Merseyside derbies, and the North London derby between Arsenal and Tottenham. It is the most watched football league in the world and earns the most from broadcasting of any league, which is why its clubs dominate the sport's rich lists.",
    ],
    scope: "English champions since 1888/89: the Football League First Division until 1991/92, the Premier League since 1992/93.",
    champions: roll(1888, `
      PNE PNE EVE SUN SUN AVL SUN AVL AVL SHU AVL AVL LIV SUN SHW SHW NEW LIV NEW MUN NEW AVL MUN BLB SUN BLB EVE
      - - - -
      WBA BUR LIV LIV HUD HUD HUD NEW EVE SHW SHW ARS EVE ARS ARS ARS SUN MCI ARS EVE
      - - - - - - -
      LIV ARS PMH PMH TOT MUN ARS WOL CHE MUN MUN WOL WOL BUR TOT IPS EVE LIV MUN LIV MUN MCI LEE EVE ARS DER LIV LEE DER LIV LIV NFO LIV LIV AVL LIV LIV LIV EVE LIV EVE LIV ARS LIV ARS LEE
      MUN MUN BLB MUN MUN ARS MUN MUN MUN ARS MUN ARS CHE CHE MUN MUN MUN CHE MUN MCI MUN MCI CHE LEI CHE MCI MCI LIV MCI MCI MCI MCI LIV ARS
    `),
  },
  140: {
    profile: [
      "La Liga was founded in 1929 and is played by 20 clubs over 38 rounds, with three relegated each season. Real Madrid hold the record for titles, with Barcelona second, and the two have shared the vast majority of championships between them.",
      "Atlético Madrid are the one club to have broken that duopoly repeatedly in the modern era, with titles in 2013/14 and 2020/21. Spanish clubs have also been the most successful in European competition, led by Real Madrid in the Champions League and Sevilla in the Europa League.",
      "El Clásico between Real Madrid and Barcelona is one of the most watched club matches in the world. The Madrid derby, the Seville derby between Sevilla and Real Betis, and the Basque derby between Athletic Club and Real Sociedad carry their own long histories.",
    ],
    scope: "Spanish champions since La Liga's first season in 1929.",
    champions: roll(1928, `
      BAR ATH ATH RMA RMA ATH BET ATH
      - - -
      ATM ATM VAL ATH VAL BAR SEV VAL BAR BAR ATM ATM BAR BAR RMA RMA ATH RMA RMA BAR BAR
      RMA RMA RMA RMA RMA ATM RMA RMA RMA ATM VAL RMA ATM BAR RMA RMA ATM RMA RMA RMA RSO RSO ATH ATH BAR
      RMA RMA RMA RMA RMA BAR BAR BAR BAR RMA ATM RMA BAR BAR DEP RMA VAL RMA VAL BAR BAR RMA RMA BAR BAR BAR RMA BAR ATM BAR BAR RMA BAR BAR RMA ATM RMA BAR RMA BAR
    `, 1929),
  },
  135: {
    profile: [
      "Serie A has been played as a single national league since 1929/30. Twenty clubs meet home and away over 38 rounds, and three are relegated to Serie B.",
      "Juventus hold the record for titles, including nine in a row from 2011/12 to 2019/20. Inter and AC Milan follow, and Napoli won their first title since the Maradona era in 2022/23 before adding another in 2024/25. The 2004/05 title was revoked after the Calciopoli scandal and never reassigned, and the 2005/06 title was awarded to Inter.",
      "The Derby della Madonnina between Inter and AC Milan, the Derby d'Italia between Inter and Juventus, the Rome derby between Roma and Lazio and the Turin derby are its defining fixtures. Italian football is known for tactical, defensive sophistication, and its clubs have won the European Cup twelve times between them.",
    ],
    scope: "Italian champions since 1898; Serie A has been played as a single league since 1929/30.",
    champions: roll(1897, `
      GEN GEN GEN MIL GEN GEN GEN JUV MIL MIL PRO PRO INT PRO PRO PRO CAS GEN
      - - - -
      INT PRO PRO+NOV GEN GEN BOL JUV XT TOR BOL INT JUV JUV JUV JUV JUV BOL BOL INT BOL INT BOL ROM TOR
      - -
      TOR TOR TOR TOR JUV MIL JUV INT INT MIL FIO MIL JUV MIL JUV JUV MIL INT BOL INT INT JUV MIL FIO CAG INT JUV JUV LAZ JUV TOR JUV JUV MIL INT JUV JUV ROM JUV VER JUV NAP MIL INT NAP SAM
      MIL MIL MIL JUV MIL JUV JUV MIL LAZ ROM JUV JUV MIL XC INT INT INT INT INT MIL JUV JUV JUV JUV JUV JUV JUV JUV JUV INT MIL NAP INT NAP
    `, 1909),
  },
  78: {
    profile: [
      "The Bundesliga was founded in 1963 as West Germany's first national league. Eighteen clubs play 34 matchdays; the bottom two are relegated and the 16th-placed club meets the third-placed side from the 2. Bundesliga in a play-off.",
      "Bayern Munich are the most successful club by a distance, including eleven straight titles from 2012/13 to 2022/23. That run was ended by Bayer Leverkusen, who won the 2023/24 title without losing a league match. Borussia Dortmund, champions in 2010/11 and 2011/12, have been Bayern's most consistent challengers.",
      "Der Klassiker between Bayern and Dortmund and the Revierderby between Dortmund and Schalke are its biggest matches. German clubs are majority-owned by their members under the 50+1 rule, ticket prices are kept low, and the league is famous for the fullest stadiums in European football.",
    ],
    scope: "German champions since 1903; the Bundesliga has decided the title since 1963/64.",
    champions: roll(1902, `
      VFL - U92 VFL FFC VIK PHO KFV VIK KIE VFL FUR
      - - - - -
      FCN FCN XN HSV FCN FCN FUR FCN HSV FUR BSC BSC BAY F95 S04 S04 FCN S04 H96 S04 S04 RAP S04 DSC DSC
      - - -
      FCN MAN VFB FCK VFB FCK H96 RWE BVB BVB S04 SGE HSV FCN KOE BVB
      KOE SVW M60 EBS FCN BAY BMG BMG BAY BAY BAY BMG BMG BMG KOE HSV BAY BAY HSV HSV VFB BAY BAY BAY SVW BAY BAY FCK VFB SVW BAY BVB BVB BAY FCK BAY BAY BAY BVB BAY SVW BAY BAY VFB BAY WOB BAY BVB BVB
      BAY BAY BAY BAY BAY BAY BAY BAY BAY BAY BAY B04 BAY
    `, 1963),
  },
  61: {
    profile: [
      "France's national championship dates from 1932/33. Ligue 1 has been played by 18 clubs since 2023/24, meeting home and away over 34 rounds.",
      "Paris Saint-Germain hold the record for titles and have won most championships since 2012/13. Before them, Lyon won seven in a row from 2001/02 to 2007/08, and Saint-Étienne and Marseille were the most decorated clubs of earlier eras. Monaco (2016/17) and Lille (2020/21) are the only clubs to have broken PSG's run in the past decade.",
      "Le Classique between PSG and Marseille is the country's biggest match. The Derby du Rhône between Lyon and Saint-Étienne and the Derby du Nord between Lille and Lens are among the oldest rivalries. Ligue 1 is renowned for producing young talent that goes on to Europe's biggest clubs.",
    ],
    scope: "French champions since 1932/33, the first season of the national league.",
    champions: roll(1932, `
      OLL SET SOC RCP OM SOC SET
      - - - - - -
      LIL CRT OM REI BOR NIC NIC REI LIL REI NIC STE REI NIC REI ASM REI ASM STE NAN NAN STE STE STE STE OM OM NAN STE STE STE NAN ASM STR NAN STE ASM NAN BOR BOR PSG BOR ASM OM OM OM OM XM
      PSG NAN AUX ASM LEN BOR ASM NAN OL OL OL OL OL OL OL BOR OM LIL MTP PSG PSG PSG PSG ASM PSG PSG PSG LIL PSG PSG PSG PSG
    `),
  },
  2: {
    profile: [
      "The European Cup began in 1955/56 and became the UEFA Champions League in 1992/93. From 2024/25 it opens with a single 36-team league phase, followed by knockout rounds and a one-off final.",
      "Real Madrid have won it more often than any other club, including the first five editions and three in a row from 2016 to 2018. AC Milan, Bayern Munich and Liverpool are next on the roll of honour, and Paris Saint-Germain won it for the first time in 2024/25.",
      "It is the most watched annual club competition in the world, and its anthem and group-stage nights are central to the modern game. Qualification comes through domestic leagues, so a club's league position decides whether it plays here the following season.",
    ],
    scope: "European Cup winners since 1955/56; the Champions League since 1992/93.",
    champions: roll(1955, `
      RMA RMA RMA RMA RMA BEN BEN MIL INT INT RMA CEL MUN MIL FEY AJA AJA AJA BAY BAY BAY LIV LIV NFO NFO LIV AVL HSV LIV JUV STB FCP PSV MIL MIL RSB BAR OM MIL AJA JUV BVB RMA MUN RMA BAY RMA MIL FCP LIV BAR MIL MUN BAR INT BAR CHE BAY RMA BAR RMA RMA RMA LIV BAY CHE RMA MCI RMA PSG
    `),
  },
  3: {
    profile: [
      "The UEFA Cup began in 1971/72 and was renamed the UEFA Europa League in 2009/10. Since 2024/25 it opens with a 36-team league phase before the knockout rounds and the final.",
      "Sevilla are its most successful club by far, with seven titles, three of them in a row from 2014 to 2016. Its winner earns a place in the next season's Champions League, which has made it a serious target for clubs outside their domestic top four.",
      "Recent finals have brought first European trophies or long-awaited ones: Eintracht Frankfurt in 2022, Atalanta in 2024 and Tottenham Hotspur, ending a 17-year wait for silverware, in 2025.",
    ],
    scope: "UEFA Cup winners since 1971/72; the Europa League since 2009/10.",
    champions: roll(1971, `
      TOT LIV FEY BMG LIV JUV PSV BMG SGE IPS GOT AND TOT RMA RMA GOT B04 NAP JUV INT AJA JUV INT PAR BAY S04 INT PAR GAL LIV FEY FCP VAL CSK SEV SEV ZEN SHA ATM FCP ATM CHE SEV SEV SEV MUN ATM CHE SEV VIL SGE SEV ATA TOT
    `),
  },
};

type Tally = { winner: string; teamId?: number; count: number; /** Season label of the most recent title. */ last: string };

/** Titles per club across the roll, most first; ties go to the more recent winner. */
export function titlesSince(champions: Champion[]): Tally[] {
  const by = new Map<string, Tally>();
  const add = (club: Club, season: string) => {
    const e = by.get(club.winner) ?? { winner: club.winner, teamId: club.teamId, count: 0, last: season };
    e.count++;
    by.set(club.winner, e);
  };
  // Newest first, so a club's first sighting is its latest title.
  for (const c of champions) {
    if (c.note && !c.also) continue;
    add(c, c.season);
    if (c.also) add(c.also, c.season);
  }
  const order = new Map(champions.map((c, i) => [c.season, i]));
  return [...by.values()].sort((a, b) => b.count - a.count || order.get(a.last)! - order.get(b.last)!);
}
