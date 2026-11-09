import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * What a VIP or PREMIUM feed shows a reader who cannot see it: placeholder
 * rows under a subscribe banner.
 *
 * The placeholders carry NO data. Not blurred text, not hidden text: the
 * match, league, kickoff and pick of a paid tip never reach this markup, so
 * nothing can be read from the page source.
 *
 * Nor does it say how many picks there are. The owner's call: a reader deciding
 * whether to pay should not see "0 VIP picks" on a quiet day, or a small number
 * on a light one. The banner states the tier's bar, which holds every day, and
 * the same cover shows whether the day has six picks or none.
 */
export function PaidFeedCover({
  tier,
  floor,
  signedIn,
  path,
}: {
  tier: "VIP" | "Premium";
  /** The tier's confidence floor (VIP_CONFIDENCE_FLOOR / PREMIUM_CONFIDENCE_FLOOR). */
  floor: number;
  signedIn: boolean;
  /** This feed's path, to come back to after logging in. */
  path: string;
}) {
  // A fixed number of placeholders: a count-shaped list would give the count away.
  const rows = 5;
  return (
    <div className="grid overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
      {/* Both layers share one grid cell, so the card is as tall as the taller
          of the two and the banner is never clipped on a narrow screen. */}
      <div aria-hidden className="col-start-1 row-start-1 divide-y divide-brand-border opacity-40">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <span className="h-6 w-6 shrink-0 rounded-full bg-brand-border" />
            <span className="h-3 flex-1 rounded bg-brand-border" style={{ maxWidth: `${55 + ((i * 17) % 30)}%` }} />
            <span className="hidden h-3 w-16 rounded bg-brand-border sm:block" />
            <span className="h-3 w-10 rounded bg-brand-border" />
          </div>
        ))}
      </div>
      <div className="col-start-1 row-start-1 flex items-center justify-center bg-brand-card/70 p-6 backdrop-blur-[2px] sm:p-10">
        <div className="max-w-md text-center">
          <Lock aria-hidden className="mx-auto h-6 w-6 text-brand" />
          <h2 className="mt-3 text-xl font-black tracking-tight text-gray-100 sm:text-2xl">
            {tier} picks are for {tier} members
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            Every {tier} pick clears {floor}% confidence or better. Subscribe to see the matches, the picks and the reasoning.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <Link href="/pricing" className="btn btn-primary">
              {signedIn ? `Upgrade to ${tier}` : `Subscribe to ${tier}`}
            </Link>
            {!signedIn && (
              <Link href={`/login?callbackUrl=${encodeURIComponent(path)}`} className="text-sm font-semibold text-gray-400 hover:text-brand">
                Already subscribed? Log in
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The past-results section of a VIP or PREMIUM page for a reader without
 * access: the heading and an invitation, no days, no matches and no win rate.
 * The record is for members.
 */
export function PaidResultsCover({ tier, signedIn }: { tier: "VIP" | "Premium"; signedIn: boolean }) {
  return (
    <section aria-labelledby="feed-results-heading" className="space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Track record</p>
        <h2 id="feed-results-heading" className="mt-1 text-2xl font-black tracking-tight text-gray-100 sm:text-3xl">Past {tier} results</h2>
      </div>
      <div className="flex flex-col gap-4 rounded-3xl border border-brand-border bg-brand-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="flex items-start gap-3 text-sm leading-6 text-gray-300">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          Every {tier} pick, win or lose, day by day, is for {tier} members.
        </p>
        <Link href="/pricing" className="btn btn-primary shrink-0 self-start sm:self-auto">
          {signedIn ? `Upgrade to ${tier}` : `Subscribe to ${tier}`}
        </Link>
      </div>
    </section>
  );
}
