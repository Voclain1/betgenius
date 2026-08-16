import { getTeamEnrichment } from "@/lib/predictionScope";
import { computeFormRating } from "@/lib/form";
import { FormComparison } from "@/components/FormRatingBadge";
import type { TeamFixtureSummary } from "@/lib/enrichment";

/**
 * Home vs away form for the match page. Reads both sides' cached fixtures —
 * the same TeamEnrichmentCache the team pages use, so this adds no fetching of
 * its own — and renders nothing at all when neither side has enough history to
 * rate, rather than an empty card.
 */
export async function MatchFormComparison({
  homeTeamApiId,
  awayTeamApiId,
  homeTeam,
  awayTeam,
}: {
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  homeTeam: string;
  awayTeam: string;
}) {
  const [homeRow, awayRow] = await Promise.all([getTeamEnrichment(homeTeamApiId), getTeamEnrichment(awayTeamApiId)]);

  const homeRating = computeFormRating((homeRow?.lastFixtures as unknown as TeamFixtureSummary[] | null) ?? null);
  const awayRating = computeFormRating((awayRow?.lastFixtures as unknown as TeamFixtureSummary[] | null) ?? null);

  if (!homeRating && !awayRating) return null;

  return <FormComparison home={homeRating} away={awayRating} homeName={homeTeam} awayName={awayTeam} />;
}
