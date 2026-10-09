import { FORM_BAND_STYLES, formSummaryLine, type FormRating } from "@/lib/form";
import { PremiumPanel } from "@/components/PremiumPanel";
import { textTone } from "@/lib/tone";

/**
 * Score + band + the sample it came from. The caveat line is not optional
 * decoration — a 0-100 number off five matches invites more confidence than it
 * has earned, so the record behind it is always shown next to it.
 */
export function FormRatingBadge({ rating, label, align = "left" }: { rating: FormRating; label?: string; align?: "left" | "right" }) {
  const right = align === "right";
  return (
    <div className={`space-y-1 ${right ? "text-right" : ""}`}>
      {label && <div className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</div>}
      <div className={`flex items-baseline gap-2 ${right ? "justify-end" : ""}`}>
        <span className="text-3xl font-black tabular-nums text-gray-100">{rating.score}</span>
        <span className={`text-sm font-black ${textTone(FORM_BAND_STYLES[rating.band])}`}>{rating.band}</span>
      </div>
      <p className="text-xs text-gray-500">
        {formSummaryLine(rating)}
        {!rating.usedGoalDiff && " · results only"}
      </p>
    </div>
  );
}

/**
 * Two ratings side by side with a proportional bar — the match-page view.
 * The bar splits the two scores against each other rather than showing each
 * against 100, since the question it answers is "who's in better form", not
 * "how good is each in absolute terms".
 */
export function FormComparison({
  home,
  away,
  homeName,
  awayName,
}: {
  home: FormRating | null;
  away: FormRating | null;
  homeName: string;
  awayName: string;
}) {
  // With only one side rated there's nothing to compare — show the one we have
  // rather than an unbalanced bar implying the other is zero.
  if (!home || !away) {
    const only = home ?? away;
    if (!only) return null;
    return (
      <PremiumPanel kicker="Form" title="Recent form" id="form">
        <FormRatingBadge rating={only} label={home ? homeName : awayName} />
        <p className="mt-3 text-xs text-gray-500">
          Not enough recent data to rate {home ? awayName : homeName} yet, so there&apos;s nothing to compare against.
        </p>
      </PremiumPanel>
    );
  }

  const total = home.score + away.score;
  // Both sides bottoming out at 0 would divide by zero; an even split is the
  // honest rendering of "neither is in any form at all".
  const homeShare = total === 0 ? 50 : (home.score / total) * 100;

  return (
    <PremiumPanel kicker="Form" title="Recent form" id="form">
      <div className="grid grid-cols-2 gap-4">
        <FormRatingBadge rating={home} label={homeName} />
        <FormRatingBadge rating={away} label={awayName} align="right" />
      </div>
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-l-full bg-brand" style={{ width: `${homeShare}%` }} />
        <div className="rounded-r-full bg-gray-500" style={{ width: `${100 - homeShare}%` }} />
      </div>
    </PremiumPanel>
  );
}
