import { resultsRank } from "@/lib/recentResultsSnapshot";
import { leagueSlug } from "@/lib/slug";
import { getLeagueVisual } from "@/lib/leagues";

/**
 * The homepage's "competitions playing today" links: one tile per
 * competition with published predictions on the day being browsed, each
 * opening that competition's prediction page.
 *
 * ORDER. The headline competitions first, by the same order as Recent results
 * (European club competitions, then the site's competition priority), and
 * within the unranked rest, the competitions with the most tips that day. So
 * on a quiet day the mid-tier and smaller leagues that are playing take the
 * places the top leagues would have had.
 *
 * HOW MANY. At most DAY_COMPETITIONS_MAX. When the day has fewer than
 * DAY_COMPETITIONS_MIN, the popular competitions (those we publish most for)
 * top it up, shown without a day count so they never claim a match that day.
 */

export const DAY_COMPETITIONS_MAX = 10;
export const DAY_COMPETITIONS_MIN = 3;

/**
 * The abbreviation readers use for a competition, by API-Football league id.
 * Absent ids fall back to the competition's own name.
 */
export const COMPETITION_SHORT_NAMES: Readonly<Record<number, string>> = {
  2: "UCL",
  3: "UEL",
  848: "UECL",
  39: "EPL",
  40: "Championship",
  45: "FA Cup",
  48: "EFL Cup",
  140: "LaLiga",
  143: "Copa del Rey",
  135: "Serie A",
  137: "Coppa Italia",
  78: "Bundesliga",
  81: "DFB-Pokal",
  61: "Ligue 1",
  66: "Coupe de France",
  1: "World Cup",
  4: "Euro",
  5: "Nations League",
  88: "Eredivisie",
  94: "Liga Portugal",
  144: "Pro League",
  203: "Süper Lig",
  307: "Saudi Pro League",
  399: "NPFL",
  71: "Brasileirão",
  179: "SPFL",
  253: "MLS",
  44: "WSL",
};

export function competitionShortName(leagueApiId: number | null | undefined, name: string): string {
  return (leagueApiId != null && COMPETITION_SHORT_NAMES[leagueApiId]) || name;
}

export type DayCompetition = {
  slug: string;
  leagueApiId: number | null;
  /** Abbreviation where one exists (UCL, EPL), else the competition's name. */
  short: string;
  /** The full name, for the tooltip and accessible label. */
  name: string;
  country: string | null;
  crest: string | null;
  /** Published tips on the day; null for a popular competition topping up a quiet day. */
  count: number | null;
};

type Row = { leagueName: string | null; leagueApiId: number | null };
type Popular = { slug: string; name: string; leagueApiId: number | null; country: string | null; crest: string | null };

/** The day's competitions, ranked and capped, topped up from `popular`. Pure. */
export function selectDayCompetitions(rows: readonly Row[], popular: readonly Popular[] = []): DayCompetition[] {
  const bySlug = new Map<string, DayCompetition>();
  for (const r of rows) {
    if (!r.leagueName) continue;
    const slug = leagueSlug(r.leagueName, r.leagueApiId);
    const existing = bySlug.get(slug);
    if (existing) {
      existing.count = (existing.count ?? 0) + 1;
      continue;
    }
    const visual = getLeagueVisual(r.leagueApiId);
    bySlug.set(slug, {
      slug,
      leagueApiId: r.leagueApiId,
      short: competitionShortName(r.leagueApiId, visual?.name ?? r.leagueName),
      name: visual?.name ?? r.leagueName,
      country: visual?.country ?? null,
      crest: visual?.src ?? null,
      count: 1,
    });
  }

  const ranked = [...bySlug.values()].sort(
    (a, b) =>
      resultsRank(a.leagueApiId ?? -1) - resultsRank(b.leagueApiId ?? -1) ||
      (b.count ?? 0) - (a.count ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const out = ranked.slice(0, DAY_COMPETITIONS_MAX);

  for (const p of popular) {
    if (out.length >= DAY_COMPETITIONS_MIN) break;
    if (out.some((c) => c.slug === p.slug)) continue;
    out.push({
      slug: p.slug,
      leagueApiId: p.leagueApiId,
      short: competitionShortName(p.leagueApiId, p.name),
      name: p.name,
      country: p.country,
      crest: p.crest,
      count: null,
    });
  }
  return out;
}
