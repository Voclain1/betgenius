import { cupById } from "@/lib/cupConfig";
import { leagueSlug } from "@/lib/slug";

/** Route a fixture to the competition hub that really exists. Cups have their
 * own /predictions/cup route, not a league alias. No API or database reads. */
export function competitionPredictionHref(leagueName: string | null, leagueApiId: number | null): string | null {
  const cup = cupById(leagueApiId);
  if (cup) return `/predictions/cup/${cup.slug}`;
  if (!leagueName) return null;
  return `/predictions/league/${leagueSlug(leagueName, leagueApiId)}`;
}
