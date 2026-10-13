import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * What a VIP or PREMIUM feed shows a reader who cannot see it: placeholder
 * rows under a subscribe banner.
 *
 * The placeholders carry NO data. Not blurred text, not hidden text: the
 * match, league, kickoff and pick of a paid tip never reach this markup, so
 * nothing can be read from the page source. The banner states only the count
 * and the tier's bar, which is what the reader is being asked to pay for.
 */
export function PaidFeedCover({
  tier,
  count,
  floor,
  dayWord,
  signedIn,
  path,
}: {
  tier: "VIP" | "Premium";
  count: number;
  /** The tier's confidence floor (VIP_CONFIDENCE_FLOOR / PREMIUM_CONFIDENCE_FLOOR). */
  floor: number;
  /** "today" or "tomorrow". */
  dayWord: string;
  signedIn: boolean;
  /** This feed's path, to come back to after logging in. */
  path: string;
}) {
  const rows = Math.min(Math.max(count, 3), 6);
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
            {count === 1 ? `1 ${tier} pick ${dayWord}` : `${count} ${tier} picks ${dayWord}`}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            Every {tier} pick clears {floor}% confidence or better. The matches and picks are for {tier} members.
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
