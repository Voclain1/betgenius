"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { PLAN_PRICING, PLAN_TIERS, formatNgn, formatUsd, type PaidTier } from "@/lib/pricing";
import { shouldShowSignupUpsell, signupUpsellKey } from "@/lib/signupUpsell";

/**
 * The post-signup plan offer.
 *
 * Shown once, on the dashboard a new account already lands on — NOT by
 * redirecting anyone to /pricing. A forced redirect takes the product away
 * from someone who has just joined and makes the first thing they see a bill;
 * a closable modal over their own account page offers the same choice without
 * moving them anywhere.
 *
 * PRICES AND PLAN COPY COME FROM lib/pricing, the same table
 * /api/subscription/initialize charges from. Nothing about a price is written
 * here. PAYMENT IS THE EXISTING FLOW, byte for byte: POST the tier alone to
 * /api/subscription/initialize and follow the authorization_url it returns.
 * The amount is derived server-side from the tier, so this component cannot
 * name a price even by accident — which is the property that made the pricing
 * page safe and is the reason this reuses it rather than posting its own body.
 *
 * ELIGIBILITY IS DECIDED ON THE SERVER (see the dashboard page) and arrives as
 * props. This component never reads a tier or a createdAt of its own: a client
 * that decided its own eligibility could be told it was new by anyone with
 * devtools, and would still be wrong on the honest path the moment a stale
 * session claim disagreed with the database.
 */
export function SignupUpsellModal({
  userId,
  createdAt,
  tier,
  paid,
}: {
  userId: string;
  /** ISO string — the User row's creation time, serialised across the server boundary. */
  createdAt: string;
  tier: string;
  paid: boolean;
}) {
  // Starts closed and opens in an effect. localStorage is not readable during
  // render (and does not exist on the server), so rendering the modal open and
  // hiding it afterwards would flash it at someone who had already dismissed it.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(signupUpsellKey(userId)) === "1";
    } catch {
      // Private mode or blocked storage. Treated as not dismissed — the cost is
      // one extra modal, where the opposite default would silently disable the
      // feature for a whole class of browsers.
      dismissed = false;
    }
    setOpen(shouldShowSignupUpsell({ createdAt, tier, paid, dismissed }));
  }, [userId, createdAt, tier, paid]);

  /**
   * Closing writes the durable flag BEFORE hiding.
   *
   * This is what makes "closed" survive a navigation, a refresh and a new tab,
   * rather than only the current React tree. Keyed by user id — see
   * signupUpsellKey.
   */
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(signupUpsellKey(userId), "1");
    } catch {
      /* storage blocked — it still closes for this page view */
    }
    setOpen(false);
  }, [userId]);

  // Escape closes it, like any dialog. A modal a keyboard user cannot dismiss
  // is a trap, and this one covers the page they were trying to reach.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  /**
   * Identical to the pricing page's subscribe(): tier only, server derives the
   * amount, follow authorization_url. Deliberately not extracted into a shared
   * helper — the duplication here is nine lines of fetch, and the thing that
   * must not be duplicated (the price, and the decision of what to charge)
   * already lives on the server.
   */
  const subscribe = async (selected: PaidTier) => {
    setBusy(selected);
    setError(null);
    try {
      const res = await fetch("/api/subscription/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selected }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.formErrors?.[0] || "Failed to initialize");
      // Leaving for Paystack counts as having dealt with the offer. Without
      // this, abandoning the checkout and pressing Back reopens the modal on a
      // page they have already answered.
      try {
        window.localStorage.setItem(signupUpsellKey(userId), "1");
      } catch {
        /* storage blocked */
      }
      window.location.href = j.authorization_url;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-upsell-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-brand-border bg-brand-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="signup-upsell-title" className="text-lg font-semibold text-gray-100">
              Welcome to BetGenius
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              Your free account is ready. Unlock more prediction categories and tools whenever you like.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-brand-bg hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PLAN_TIERS.map((t) => {
            const price = PLAN_PRICING[t.id];
            return (
              <div key={t.id} className={`rounded-lg border-2 bg-brand-bg/40 p-4 ${t.color}`}>
                <div className={`flex items-center gap-2 font-semibold ${t.accent}`}>
                  <span aria-hidden="true">{t.glyph}</span>
                  {t.name}
                </div>
                <div className="mt-1 text-2xl font-bold text-gray-100">
                  {formatNgn(price.ngn)}
                  <span className="text-sm font-normal text-gray-400">/30 days</span>
                </div>
                <div className="mt-0.5 text-xs text-gray-400">≈ {formatUsd(price.usd)} — billed in naira</div>
                {/* Same promise the pricing page makes. While recurring billing
                    is unavailable, nothing may imply a card is charged again. */}
                <div className="mt-1 text-xs text-gray-300">30-day access — renew when it ends.</div>
                <ul className="mt-3 space-y-1 text-sm text-gray-300">
                  {t.headline.map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => subscribe(t.id)}
                  className="btn btn-primary mt-4 w-full text-sm disabled:opacity-50"
                >
                  {busy === t.id ? "Redirecting…" : `Get ${t.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/pricing" className="text-sm text-brand hover:underline" onClick={dismiss}>
            Compare plans in full
          </Link>
          <button type="button" onClick={dismiss} className="btn btn-ghost text-sm" disabled={busy !== null}>
            Maybe later
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Paid access provides analysis; it does not guarantee that any prediction will win.
        </p>
      </div>
    </div>
  );
}
