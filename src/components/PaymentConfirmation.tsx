"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * Shown on /dashboard?paid=1 — the page Paystack sends a payer back to.
 *
 * TWO THINGS ARE OUT OF STEP AT THAT MOMENT, AND NEITHER IS FIXED BY TRUSTING
 * THE `paid=1` IN THE URL. Anyone can type that; it is a hint that a checkout
 * happened, never evidence that one succeeded. It gates nothing.
 *
 * 1. The browser's session still holds the tier/subStatus claims from sign-in,
 *    so client components (the account banner) would read the old tier. The fix
 *    is `update()`: the client asks NextAuth to reissue the token, and the
 *    server's jwt callback recomputes the claims from the database. The client
 *    supplies no values.
 *
 * 2. Paystack redirects the payer here as soon as the charge clears, which can
 *    beat its own webhook. The row is then still PENDING through no fault of
 *    the payment. Rather than show a padlock to someone who has just paid, poll
 *    briefly: refresh the server components (which re-read the subscription)
 *    and stop as soon as access appears, or after ~30s.
 *
 * `activated` is computed on the SERVER from the database row and passed in —
 * this component only decides whether to keep waiting.
 */
const ATTEMPTS = 10;
const INTERVAL_MS = 3000;

export function PaymentConfirmation({ activated }: { activated: boolean }) {
  const { update } = useSession();
  const router = useRouter();
  const [waiting, setWaiting] = useState(!activated);
  const attempts = useRef(0);

  // Sync the browser's session claims with the database once, either way.
  useEffect(() => {
    void update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activated) {
      setWaiting(false);
      return;
    }
    const timer = setInterval(() => {
      attempts.current += 1;
      if (attempts.current >= ATTEMPTS) {
        setWaiting(false);
        clearInterval(timer);
        return;
      }
      void update();
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activated, router, update]);

  if (activated) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        Payment received — your subscription is active.
      </div>
    );
  }

  return waiting ? (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      Confirming your payment… this usually takes a few seconds.
    </div>
  ) : (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      We haven&apos;t had confirmation from Paystack yet. If you were charged, your access will unlock as soon as it
      arrives — refresh this page in a minute, or contact support if it persists.
    </div>
  );
}
