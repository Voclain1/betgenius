import { PremiumPanel } from "@/components/PremiumPanel";
import { FormGoalsBody } from "@/components/matchcentre/FormGoalsBody";
import { hasAnyFormSource, type FormSource } from "@/lib/matchCentre";

/**
 * Server wrapper for the form-and-goals comparison. Renders nothing when
 * neither team has a single verified match in its cached history — an empty
 * comparison table would only be a grid of dashes.
 */
export function MatchFormGoals(props: {
  source: FormSource | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  leagueName: string | null;
  timeZone: string;
}) {
  const { source, homeTeamApiId, awayTeamApiId } = props;
  if (!source || homeTeamApiId == null || awayTeamApiId == null || !hasAnyFormSource(source)) return null;
  return (
    <PremiumPanel kicker="Form & goals" title="Form and scoring compared" id="form-goals">
      <FormGoalsBody
        source={source}
        homeTeam={props.homeTeam}
        awayTeam={props.awayTeam}
        homeTeamApiId={homeTeamApiId}
        awayTeamApiId={awayTeamApiId}
        leagueName={props.leagueName}
        timeZone={props.timeZone}
      />
    </PremiumPanel>
  );
}
