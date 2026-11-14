"use client";

import { useSession } from "next-auth/react";
import { HomeLink } from "@/components/HomeLink";

/** A reader on an active VIP or Premium plan, from the signed-in session. */
function isPaid(user: { tier?: string; subStatus?: string } | undefined): boolean {
  return !!user && (user.tier === "VIP" || user.tier === "PREMIUM") && user.subStatus === "ACTIVE";
}

/**
 * "Go VIP", for everyone who does not already have it.
 *
 * The homepage itself is cached and the same for everyone, so who is reading
 * is known only here, in the browser. It renders for a signed-out visitor and
 * while the session loads (the common case, so no wait), and drops out once
 * the session shows an active paid plan: a subscriber is not sold the plan they
 * hold.
 */
export function HomeUpgradeButton() {
  const { data } = useSession();
  if (isPaid(data?.user as { tier?: string; subStatus?: string } | undefined)) return null;
  return (
    <HomeLink target="pricing" placement="hero" href="/pricing" className="btn btn-ghost">
      Go VIP
    </HomeLink>
  );
}

const LINK = "inline-flex min-h-9 items-center font-semibold text-brand hover:underline";

/**
 * One quiet line under the hero buttons, in two states:
 *   - visiting, or session still loading: what a free account is for (the
 *     features that exist today: saving predictions and following teams) and
 *     one link to join;
 *   - signed in: a way back to the reader's own things.
 * A fixed minimum height (the two-line height on a phone, where the visitor's
 * sentence wraps) means neither state moves the page when the session
 * resolves. It is not a banner: one line of small text, no box, no dismissal.
 */
export function HomeAccountLine() {
  const { data } = useSession();
  const signedIn = !!data?.user;
  return (
    <p className="mt-1 flex min-h-[3.25rem] flex-wrap sm:min-h-9 items-center gap-x-3 text-xs text-gray-400" data-home-account-line>
      {signedIn ? (
        <>
          <span>Welcome back</span>
          <HomeLink target="dashboard" placement="account_line" href="/dashboard" className={LINK}>My dashboard</HomeLink>
          <HomeLink target="saved" placement="account_line" href="/dashboard/saved" className={LINK}>Saved predictions</HomeLink>
        </>
      ) : (
        <>
          <span>Save picks and follow teams with a free account.</span>
          <HomeLink target="register" placement="account_line" href="/register" className={LINK}>Join free</HomeLink>
        </>
      )}
    </p>
  );
}
