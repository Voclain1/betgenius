"use client";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { PLAN_PRICING, PLAN_TIERS, formatNgn, formatUsd, type PaidTier } from "@/lib/pricing";
import { trackEvent } from "@/lib/clientAnalytics";

// Prices AND plan copy come from lib/pricing — the same table the checkout
// charges from, so the page, the post-signup modal and the invoice cannot
// disagree. Tier accents use the vip/premium tokens the nav pills and
// dashboard banner already use.
const tiers = PLAN_TIERS;

export default function Pricing() {
  const { data } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // Paystack's "Cancel payment" link returns here (metadata.cancel_action, set
  // by the initialize route). Read after mount rather than via
  // useSearchParams so this static page needs no Suspense boundary. It only
  // changes what is said; nothing about access is read from the URL.
  useEffect(() => {
    setCancelled(new URLSearchParams(window.location.search).get("checkout") === "cancelled");
  }, []);

  // Sends the tier only — the server derives the amount from lib/pricing.
  // Posting an amount from here would let anyone with devtools name their
  // own price.
  const subscribe = async (tier: PaidTier) => {
    if (!data?.user) return (window.location.href = "/login");
    setBusy(tier);
    setErr(null);
    try {
      const res = await fetch("/api/subscription/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.formErrors?.[0] || "Failed to initialize");
      trackEvent("begin_checkout", {
        currency: "NGN",
        value: PLAN_PRICING[tier].ngn,
        items: [{ item_id: tier, item_name: `BetGenius ${tier}`, price: PLAN_PRICING[tier].ngn, quantity: 1 }],
      });
      window.location.href = j.authorization_url;
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">BetGenius VIP and Premium pricing</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">Choose a plan for access to additional prediction categories and analysis tools. Each payment buys a single 30-day access period — there is no automatic renewal, so you renew yourself when the period ends. Prices shown in naira are the amounts charged through Paystack; the dollar figures are references only.</p>
      </div>
      {cancelled && (
        <div className="card border border-amber-500/30 text-sm text-amber-200">
          Checkout was cancelled, so your plan has not changed. Pick a plan below to try again.
        </div>
      )}
      {err && <div className="card text-red-400">{err}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {tiers.map((t) => {
          const price = PLAN_PRICING[t.id];
          return (
            <div key={t.id} className={`card border-2 ${t.color}`}>
              <div className={`flex items-center gap-2 text-xl font-semibold ${t.accent}`}>
                <span aria-hidden="true">{t.glyph}</span>
                {t.name}
              </div>
              {/* Naira is the price. The dollar figure beside it is a
                  reference for readers who don't think in naira — the charge
                  is the naira one either way, which the line below says
                  outright rather than leaving a visitor to assume they can
                  pay in dollars. */}
              <div className="mt-1 text-3xl font-bold">
                {formatNgn(price.ngn)}
                <span className="text-sm font-normal text-gray-400">/30 days</span>
              </div>
              <div className="mt-0.5 text-sm text-gray-400">≈ {formatUsd(price.usd)} — billed in naira</div>
              {/* Says what the payment actually buys. While recurring billing
                  is unavailable this is a single period, so the page must not
                  imply a card will be charged again. */}
              <div className="mt-1 text-sm text-gray-300">30-day access — renew when your access period ends.</div>
              <ul className="mt-3 space-y-1 text-sm text-gray-300">
                {t.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button
                disabled={busy === t.id}
                onClick={() => subscribe(t.id)}
                className="btn btn-primary mt-4 w-full disabled:opacity-50">
                {busy === t.id ? "Redirecting…" : `Get ${t.name} — 30 days`}
              </button>
            </div>
          );
        })}
      </div>
      {/* What happens when they press the button. Deliberately does not list
          payment methods: Paystack decides which it offers on the account, and
          naming one that is then missing or declined breaks the promise. */}
      <section className="card space-y-2 text-sm leading-6 text-gray-300">
        <h2 className="text-lg font-semibold text-gray-100">How payment works</h2>
        <p>You pay securely on Paystack&apos;s checkout page; BetGenius never sees your card or bank details. Paystack shows the payment methods available to you there, including bank transfer.</p>
        <p>When Paystack confirms the payment you return to your dashboard and your plan unlocks straight away. A bank transfer can take a few minutes to confirm; access unlocks automatically when it does, even if you have closed the page.</p>
        <p>If you cancel or leave checkout, nothing changes and you can start again from this page at any time.</p>
      </section>
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Before choosing a plan</h2>
        <p className="text-sm leading-6 text-gray-300">VIP adds the VIP prediction category plus Bet Builder and StatsPad. Premium includes the VIP features, Premium-category selections, deeper match previews and priority support. Paid access provides analysis; it does not guarantee that any prediction will win.</p>
        <p className="text-sm leading-6 text-gray-300">Review the public <Link href="/track-record" className="text-brand hover:underline">prediction track record</Link> and <Link href="/methodology" className="text-brand hover:underline">methodology</Link> before paying. Access runs for 30 days from payment and then stops on its own — nothing is charged automatically and there is no plan to cancel. Access remains subject to the current subscription terms.</p>
        <p className="text-xs leading-5 text-gray-500">Only bet with money you can afford to lose. See our <Link href="/responsible-gambling" className="text-brand hover:underline">responsible gambling guidance</Link>.</p>
      </section>
    </div>
  );
}
