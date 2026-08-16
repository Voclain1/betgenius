import { FORM_BAND_STYLES, formSummaryLine, type FormRating } from "@/lib/form";

/**
 * Score + band + the sample it came from. The caveat line is not optional
 * decoration — a 0-100 number off five matches invites more confidence than it
 * has earned, so the record behind it is always shown next to it.
 */
export function FormRatingBadge({ rating, label, align = "left" }: { rating: FormRating; label?: string; align?: "left" | "right" }) {
  const right = align === "right";
  return (
    <div className={`space-y-1 ${right ? "text-right" : ""}`}>
      {label && <div className="text-[10px] uppercase text-gray-500">{label}</div>}
      <div className={`flex items-baseline gap-2 ${right ? "justify-end" : ""}`}>
        <span className="text-2xl font-bold tabular-nums">{rating.score}</span>
        <span className={`chip ${FORM_BAND_STYLES[rating.band]}`}>{rating.band}</span>
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
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Recent form</h2>
        <FormRatingBadge rating={only} label={home ? homeName : awayName} />
        <p className="text-xs text-gray-500">
          Not enough recent data to rate {home ? awayName : homeName} yet, so there&apos;s nothing to compare against.
        </p>
      </div>
    );
  }

  const total = home.score + away.score;
  // Both sides bottoming out at 0 would divide by zero; an even split is the
  // honest rendering of "neither is in any form at all".
  const homeShare = total === 0 ? 50 : (home.score / total) * 100;

  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold text-gray-300">Recent form</h2>
      <div className="grid grid-cols-2 gap-3">
        <FormRatingBadge rating={home} label={homeName} />
        <FormRatingBadge rating={away} label={awayName} align="right" />
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-brand-border">
        <div className="bg-brand" style={{ width: `${homeShare}%` }} />
        <div className="bg-gray-500" style={{ width: `${100 - homeShare}%` }} />
      </div>
    </div>
  );
}
