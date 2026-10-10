"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trackEvent } from "@/lib/clientAnalytics";
import type { PaidTier } from "@/lib/pricing";

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
 *    the payment. Rather than show a padlock to someone who has just paid, ask
 *    the server to verify the reference NOW (POST /api/subscription/verify),
 *    then keep the existing brief poll as the fallback for when there is no
 *    reference in the URL, or the verify call fails, or the payer arrived some
 *    other way.
 *
 *    THE REFERENCE IS NOT A CREDENTIAL. It is handed to the server only so the
 *    server can fetch Paystack's own verified transaction and decide; posting
 *    one grants nothing on its own, and posting someone else's grants nothing
 *    at all. See the route for why.
 *
 * `activated` is computed on the SERVER from the database row and passed in —
 * this component only decides whether to keep waiting.
 *
 * 3. A payer who comes back WITHOUT paying — cancelled on Paystack, or closed
 *    the page and pressed Back — used to sit through thirty seconds of
 *    "Confirming your payment…" and then be told Paystack had not confirmed it
 *    yet, with no way forward. The verify route now returns Paystack's own
 *    status for the payer's own reference, so an unpaid checkout says so at
 *    once and offers the plans again. That status decides only what is SAID;
 *    access still comes from the server alone.
 */
type PaymentStatus = "not_completed" | "failed" | "pending" | "unconfirmed";
const ATTEMPTS = 10;
const INTERVAL_MS = 3000;

export function PaymentConfirmation({
  activated,
  reference,
  tier,
  value,
}: {
  activated: boolean;
  reference?: string | null;
  tier?: PaidTier | null;
  value?: number | null;
}) {
  const { update } = useSession();
  const router = useRouter();
  const [waiting, setWaiting] = useState(!activated);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const attempts = useRef(0);

  // A confirmed, reference-backed activation is the purchase boundary. GA4
  // also deduplicates transaction_id, while sessionStorage avoids repeat hits
  // from this component refreshing as the session catches up.
  useEffect(() => {
    if (!activated || !reference || !tier || !value) return;
    const key = `bg_purchase_${reference}`;
    if (sessionStorage.getItem(key)) return;
    trackEvent("purchase", {
      transaction_id: reference,
      currency: "NGN",
      value,
      items: [{ item_id: tier, item_name: `BetGenius ${tier}`, price: value, quantity: 1 }],
    });
    sessionStorage.setItem(key, "1");
  }, [activated, reference, tier, value]);

  // Sync the browser's session claims with the database once, either way, and
  // — when Paystack gave us a reference to check — trigger verification before
  // the first poll tick so a paid customer is not made to wait out a webhook.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (reference && !activated) {
        try {
          const res = await fetch("/api/subscription/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference }),
          });
          const json = (await res.json().catch(() => null)) as { activated?: boolean; paymentStatus?: PaymentStatus } | null;
          if (!cancelled && json && !json.activated && json.paymentStatus) setStatus(json.paymentStatus);
        } catch {
          // The poll below is the fallback; a failed verify is not worth
          // showing anyone, because the webhook still grants access.
        }
      }
      if (cancelled) return;
      await update();
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to wait for once Paystack has said the payment did not happen.
  const settledUnpaid = status === "not_completed" || status === "failed";

  useEffect(() => {
    if (activated || settledUnpaid) {
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
  }, [activated, settledUnpaid, router, update]);

  if (activated) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        Payment received — your subscription is active.
      </div>
    );
  }

  if (settledUnpaid) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        {status === "failed"
          ? "Paystack declined this payment, so your plan has not changed. You can try again — choosing a different payment method sometimes helps."
          : "Paystack hasn't received this payment, so your plan has not changed. If you already sent a bank transfer, access unlocks automatically when it arrives — you don't need to pay again. Otherwise you can try again whenever you're ready."}{" "}
        <Link href="/pricing" className="font-medium text-brand underline">
          Choose a plan
        </Link>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
        Paystack is still confirming your payment — bank transfers can take a few minutes. Your access unlocks
        automatically as soon as it clears; you don&apos;t need to stay on this page.
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
      arrives — refresh this page in a minute, or contact support if it persists. If you didn&apos;t finish paying,{" "}
      <Link href="/pricing" className="font-medium text-brand underline">
        choose a plan
      </Link>{" "}
      to try again.
    </div>
  );
}
