/**
 * Major honours for the best-known clubs in the top five leagues.
 *
 * API-Football has no club honours (its /trophies endpoint covers players and
 * coaches only), so this is curated by hand. Counts are senior men's titles in
 * the competitions listed, correct up to and including the season named in
 * HONOURS_AS_OF; a club's title in a later season needs adding here.
 *
 * Keyed by API-Football team id. Each entry also names a token that must
 * appear in the club's name as the page shows it (`match`), so a wrong id can
 * never put one club's trophies on another's page: the honours are simply
 * not shown.
 *
 * League titles count the national championship across its eras (e.g. the
 * English First Division and the Premier League together). European titles
 * count the competition across its names (European Cup and Champions League;
 * UEFA Cup and Europa League).
 */

export const HONOURS_AS_OF = "2024/25";

export type Honour = { title: string; count: number; /** Year of the most recent win (the year the final or title race ended). */ last: number };
/** `asOf` overrides HONOURS_AS_OF for a club updated with a later season. */
type ClubHonours = { match: string; honours: Honour[]; asOf?: string };

const UCL = "European Cup / Champions League";
const UEL = "UEFA Cup / Europa League";
const CWC = "Cup Winners' Cup";
const UECL = "Conference League";

export const CLUB_HONOURS: Record<number, ClubHonours> = {
  // England
  33: { match: "manchester united", honours: [
    { title: "League titles", count: 20, last: 2013 }, { title: "FA Cup", count: 13, last: 2024 }, { title: "League Cup", count: 6, last: 2023 },
    { title: UCL, count: 3, last: 2008 }, { title: UEL, count: 1, last: 2017 }, { title: CWC, count: 1, last: 1991 },
  ] },
  40: { match: "liverpool", honours: [
    { title: "League titles", count: 20, last: 2025 }, { title: "FA Cup", count: 8, last: 2022 }, { title: "League Cup", count: 10, last: 2024 },
    { title: UCL, count: 6, last: 2019 }, { title: UEL, count: 3, last: 2001 },
  ] },
  42: { match: "arsenal", asOf: "2025/26", honours: [
    { title: "League titles", count: 14, last: 2026 }, { title: "FA Cup", count: 14, last: 2020 }, { title: "League Cup", count: 2, last: 1993 },
    { title: CWC, count: 1, last: 1994 },
  ] },
  49: { match: "chelsea", honours: [
    { title: "League titles", count: 6, last: 2017 }, { title: "FA Cup", count: 8, last: 2018 }, { title: "League Cup", count: 5, last: 2015 },
    { title: UCL, count: 2, last: 2021 }, { title: UEL, count: 2, last: 2019 }, { title: CWC, count: 2, last: 1998 }, { title: UECL, count: 1, last: 2025 },
  ] },
  50: { match: "manchester city", honours: [
    { title: "League titles", count: 10, last: 2024 }, { title: "FA Cup", count: 7, last: 2023 }, { title: "League Cup", count: 8, last: 2021 },
    { title: UCL, count: 1, last: 2023 }, { title: CWC, count: 1, last: 1970 },
  ] },
  47: { match: "tottenham", honours: [
    { title: "League titles", count: 2, last: 1961 }, { title: "FA Cup", count: 8, last: 1991 }, { title: "League Cup", count: 4, last: 2008 },
    { title: UEL, count: 3, last: 2025 }, { title: CWC, count: 1, last: 1963 },
  ] },
  45: { match: "everton", honours: [
    { title: "League titles", count: 9, last: 1987 }, { title: "FA Cup", count: 5, last: 1995 }, { title: CWC, count: 1, last: 1985 },
  ] },
  66: { match: "aston villa", honours: [
    { title: "League titles", count: 7, last: 1981 }, { title: "FA Cup", count: 7, last: 1957 }, { title: "League Cup", count: 5, last: 1996 },
    { title: UCL, count: 1, last: 1982 },
  ] },
  34: { match: "newcastle", honours: [
    { title: "League titles", count: 4, last: 1927 }, { title: "FA Cup", count: 6, last: 1955 }, { title: "League Cup", count: 1, last: 2025 },
  ] },

  // Spain
  541: { match: "real madrid", honours: [
    { title: "La Liga", count: 36, last: 2024 }, { title: "Copa del Rey", count: 20, last: 2023 },
    { title: UCL, count: 15, last: 2024 }, { title: UEL, count: 2, last: 1986 },
  ] },
  529: { match: "barcelona", honours: [
    { title: "La Liga", count: 28, last: 2025 }, { title: "Copa del Rey", count: 32, last: 2025 },
    { title: UCL, count: 5, last: 2015 }, { title: CWC, count: 4, last: 1997 },
  ] },
  530: { match: "atletico", honours: [
    { title: "La Liga", count: 11, last: 2021 }, { title: "Copa del Rey", count: 10, last: 2013 },
    { title: UEL, count: 3, last: 2018 }, { title: CWC, count: 1, last: 1962 },
  ] },
  531: { match: "athletic", honours: [
    { title: "La Liga", count: 8, last: 1984 }, { title: "Copa del Rey", count: 24, last: 2024 },
  ] },
  532: { match: "valencia", honours: [
    { title: "La Liga", count: 6, last: 2004 }, { title: "Copa del Rey", count: 8, last: 2019 },
    { title: UEL, count: 1, last: 2004 }, { title: CWC, count: 1, last: 1980 },
  ] },
  536: { match: "sevilla", honours: [
    { title: "La Liga", count: 1, last: 1946 }, { title: "Copa del Rey", count: 5, last: 2010 }, { title: UEL, count: 7, last: 2023 },
  ] },

  // Italy
  496: { match: "juventus", honours: [
    { title: "Serie A", count: 36, last: 2020 }, { title: "Coppa Italia", count: 15, last: 2024 },
    { title: UCL, count: 2, last: 1996 }, { title: UEL, count: 3, last: 1993 }, { title: CWC, count: 1, last: 1984 },
  ] },
  505: { match: "inter", honours: [
    { title: "Serie A", count: 20, last: 2024 }, { title: "Coppa Italia", count: 9, last: 2023 },
    { title: UCL, count: 3, last: 2010 }, { title: UEL, count: 3, last: 1998 },
  ] },
  489: { match: "milan", honours: [
    { title: "Serie A", count: 19, last: 2022 }, { title: "Coppa Italia", count: 5, last: 2003 },
    { title: UCL, count: 7, last: 2007 }, { title: CWC, count: 2, last: 1973 },
  ] },
  492: { match: "napoli", honours: [
    { title: "Serie A", count: 4, last: 2025 }, { title: "Coppa Italia", count: 6, last: 2020 }, { title: UEL, count: 1, last: 1989 },
  ] },
  497: { match: "roma", honours: [
    { title: "Serie A", count: 3, last: 2001 }, { title: "Coppa Italia", count: 9, last: 2008 }, { title: UECL, count: 1, last: 2022 },
  ] },
  487: { match: "lazio", honours: [
    { title: "Serie A", count: 2, last: 2000 }, { title: "Coppa Italia", count: 7, last: 2019 }, { title: CWC, count: 1, last: 1999 },
  ] },

  // Germany
  157: { match: "bayern", honours: [
    { title: "German titles", count: 34, last: 2025 }, { title: "DFB-Pokal", count: 20, last: 2020 },
    { title: UCL, count: 6, last: 2020 }, { title: UEL, count: 1, last: 1996 }, { title: CWC, count: 1, last: 1967 },
  ] },
  165: { match: "dortmund", honours: [
    { title: "German titles", count: 8, last: 2012 }, { title: "DFB-Pokal", count: 5, last: 2021 },
    { title: UCL, count: 1, last: 1997 }, { title: CWC, count: 1, last: 1966 },
  ] },
  168: { match: "leverkusen", honours: [
    { title: "German titles", count: 1, last: 2024 }, { title: "DFB-Pokal", count: 2, last: 2024 }, { title: UEL, count: 1, last: 1988 },
  ] },
  172: { match: "stuttgart", honours: [
    { title: "German titles", count: 5, last: 2007 }, { title: "DFB-Pokal", count: 4, last: 2025 },
  ] },

  // France
  85: { match: "paris", honours: [
    { title: "Ligue 1", count: 13, last: 2025 }, { title: "Coupe de France", count: 16, last: 2025 },
    { title: UCL, count: 1, last: 2025 }, { title: CWC, count: 1, last: 1996 },
  ] },
  81: { match: "marseille", honours: [
    { title: "Ligue 1", count: 9, last: 2010 }, { title: "Coupe de France", count: 10, last: 1989 }, { title: UCL, count: 1, last: 1993 },
  ] },
  80: { match: "lyon", honours: [
    { title: "Ligue 1", count: 7, last: 2008 }, { title: "Coupe de France", count: 5, last: 2012 },
  ] },
  91: { match: "monaco", honours: [
    { title: "Ligue 1", count: 8, last: 2017 }, { title: "Coupe de France", count: 5, last: 1991 },
  ] },
};

const normalise = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A club's honours, or null when none are curated or the id does not match the name shown. */
export function clubHonours(teamApiId: number | null | undefined, teamName: string): Honour[] | null {
  return clubHonoursEntry(teamApiId, teamName)?.honours ?? null;
}

/** The season a club's honours are complete to. */
export function clubHonoursAsOf(teamApiId: number | null | undefined, teamName: string): string {
  return clubHonoursEntry(teamApiId, teamName)?.asOf ?? HONOURS_AS_OF;
}

function clubHonoursEntry(teamApiId: number | null | undefined, teamName: string): ClubHonours | null {
  if (teamApiId == null) return null;
  const entry = CLUB_HONOURS[teamApiId];
  if (!entry) return null;
  if (!normalise(teamName).includes(entry.match)) return null;
  return entry;
}
