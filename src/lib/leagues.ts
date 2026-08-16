// League/competition IDs on API-Football, shared between server lookups and
// the admin AI panel. Every id and country/flag code below has been verified
// against the live API-Football /leagues endpoint.
//
// `kind: "cup"` = international competition with no single home country —
// displayed with the competition's own logo. `kind: "league"` = domestic
// league — displayed with its country's flag.
export const LEAGUE_CATALOGUE = [
  // Top 5
  { id: 39, name: "Premier League", country: "England", tier: "top", kind: "league", flagCode: "gb-eng" },
  { id: 140, name: "La Liga", country: "Spain", tier: "top", kind: "league", flagCode: "es" },
  { id: 135, name: "Serie A", country: "Italy", tier: "top", kind: "league", flagCode: "it" },
  { id: 78, name: "Bundesliga", country: "Germany", tier: "top", kind: "league", flagCode: "de" },
  { id: 61, name: "Ligue 1", country: "France", tier: "top", kind: "league", flagCode: "fr" },

  // International tournaments
  { id: 1, name: "World Cup", country: "World", tier: "international", kind: "cup" },
  { id: 4, name: "Euro Championship", country: "World", tier: "international", kind: "cup" },
  { id: 2, name: "UEFA Champions League", country: "World", tier: "international", kind: "cup" },
  { id: 3, name: "UEFA Europa League", country: "World", tier: "international", kind: "cup" },
  { id: 848, name: "UEFA Europa Conference League", country: "World", tier: "international", kind: "cup" },
  { id: 10, name: "Friendlies", country: "World", tier: "international", kind: "cup" },

  // Mid-tier European leagues
  { id: 88, name: "Eredivisie", country: "Netherlands", tier: "mid", kind: "league", flagCode: "nl" },
  { id: 94, name: "Primeira Liga", country: "Portugal", tier: "mid", kind: "league", flagCode: "pt" },
  { id: 144, name: "Jupiler Pro League", country: "Belgium", tier: "mid", kind: "league", flagCode: "be" },
  { id: 203, name: "Süper Lig", country: "Turkey", tier: "mid", kind: "league", flagCode: "tr" },
  { id: 40, name: "Championship", country: "England", tier: "mid", kind: "league", flagCode: "gb-eng" },

  // Smaller European leagues
  { id: 207, name: "Super League", country: "Switzerland", tier: "minor", kind: "league", flagCode: "ch" },
  { id: 218, name: "Bundesliga", country: "Austria", tier: "minor", kind: "league", flagCode: "at" },
  { id: 179, name: "Premiership", country: "Scotland", tier: "minor", kind: "league", flagCode: "gb-sct" },
  { id: 119, name: "Superliga", country: "Denmark", tier: "minor", kind: "league", flagCode: "dk" },
  { id: 103, name: "Eliteserien", country: "Norway", tier: "minor", kind: "league", flagCode: "no" },
  { id: 113, name: "Allsvenskan", country: "Sweden", tier: "minor", kind: "league", flagCode: "se" },
  { id: 114, name: "Superettan", country: "Sweden", tier: "minor", kind: "league", flagCode: "se" },
  { id: 106, name: "Ekstraklasa", country: "Poland", tier: "minor", kind: "league", flagCode: "pl" },
  { id: 197, name: "Super League 1", country: "Greece", tier: "minor", kind: "league", flagCode: "gr" },
  { id: 210, name: "HNL", country: "Croatia", tier: "minor", kind: "league", flagCode: "hr" },
  { id: 329, name: "Meistriliiga", country: "Estonia", tier: "minor", kind: "league", flagCode: "ee" },
  { id: 244, name: "Veikkausliiga", country: "Finland", tier: "minor", kind: "league", flagCode: "fi" },
  { id: 283, name: "Liga I", country: "Romania", tier: "minor", kind: "league", flagCode: "ro" },
  { id: 394, name: "Super Liga", country: "Moldova", tier: "minor", kind: "league", flagCode: "md" },
  { id: 365, name: "Virsliga", country: "Latvia", tier: "minor", kind: "league", flagCode: "lv" },
  { id: 362, name: "A Lyga", country: "Lithuania", tier: "minor", kind: "league", flagCode: "lt" },
  { id: 389, name: "Premier League", country: "Kazakhstan", tier: "minor", kind: "league", flagCode: "kz" },
  { id: 116, name: "Premier League", country: "Belarus", tier: "minor", kind: "league", flagCode: "by" },

  // Major non-European leagues
  { id: 71, name: "Serie A", country: "Brazil", tier: "world", kind: "league", flagCode: "br" },
  { id: 399, name: "NPFL", country: "Nigeria", tier: "world", kind: "league", flagCode: "ng" },
] as const;

/**
 * The leagues the PUBLIC surfaces treat as headline competitions: the
 * major-league default on /fixtures, the homepage's Recent results block, and
 * the Popular leagues ranking (which also takes its order from this array).
 *
 * Deliberately much smaller than LEAGUE_CATALOGUE above, and deliberately a
 * separate list rather than a filter over it. The catalogue answers "do we
 * know how to display this league, and may an admin generate for it" — it
 * must stay broad, since a quarter of today's published picks are Kazakh and
 * the admin pickers, standings and StatsPad all read it. This answers the
 * narrower question "is this league worth featuring to a visitor", and
 * shrinking it must not strip flags, names or admin options from everything
 * else.
 *
 * NPFL is included on coverage grounds: api-football returns 380 fixtures a
 * season for it with real scorelines. Its 2027 season opens 2026-08-28, so it
 * contributes nothing to the current window — expected, not a fault.
 */
const MAJOR_LEAGUE_IDS = [
  39, // Premier League (England)
  140, // La Liga
  135, // Serie A (Italy)
  78, // Bundesliga
  61, // Ligue 1
  2, // UEFA Champions League
  399, // NPFL (Nigeria)
] as const;

export const MAJOR_LEAGUES = MAJOR_LEAGUE_IDS.map(
  (id) => LEAGUE_CATALOGUE.find((l) => l.id === id)!,
);

export const LEAGUE_TIER_LABELS: Record<string, string> = {
  top: "Top 5",
  international: "International",
  mid: "Mid-tier Europe",
  minor: "Smaller European leagues",
  world: "Other leagues",
};

export type LeagueVisual = { src: string; alt: string; name: string; country: string };

/** True if `leagueApiId` is one of the headline competitions — backs the major-league default on /fixtures and the homepage's Recent results filter. NOT a test of whether we can display the league; that's getLeagueVisual. */
export function isMajorLeague(leagueApiId?: number | null): boolean {
  if (leagueApiId == null) return false;
  return (MAJOR_LEAGUE_IDS as readonly number[]).includes(leagueApiId);
}

/**
 * True if we recognise the league at all — i.e. it's in LEAGUE_CATALOGUE and
 * therefore has a flag, a name and a country we can render.
 *
 * The middle tier of the Fixtures scope fallback: broad enough to fill a page
 * when the seven headline competitions are idle, narrow enough to exclude the
 * third divisions, reserve sides and women's leagues that "literally every
 * league api-football returns" drags in.
 */
export function isKnownLeague(leagueApiId?: number | null): boolean {
  if (leagueApiId == null) return false;
  return LEAGUE_CATALOGUE.some((l) => l.id === leagueApiId);
}

/** Competition crest — used for cup/international entries, and as a fallback. */
export function leagueLogoUrl(id: number): string {
  return `https://media.api-sports.io/football/leagues/${id}.png`;
}

/**
 * Resolves the image to show for a league: a country flag for domestic
 * leagues, or the competition's own crest for cups/internationals (World
 * Cup, Champions League, etc). Returns null if the league id isn't in our
 * known list (e.g. legacy predictions with no leagueApiId).
 *
 * Resolves against the full LEAGUE_CATALOGUE, not MAJOR_LEAGUES: a league
 * being outside the headline set is no reason to lose its flag or its
 * country-disambiguated name.
 */
export function getLeagueVisual(leagueApiId?: number | null): LeagueVisual | null {
  if (leagueApiId == null) return null;
  const league = LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId);
  if (!league) return null;
  const src = league.kind === "cup" ? leagueLogoUrl(league.id) : `https://media.api-sports.io/flags/${league.flagCode}.svg`;
  return { src, alt: league.name, name: league.name, country: league.country };
}
