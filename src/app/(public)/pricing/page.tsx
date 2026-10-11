"use client";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_PRICING, PLAN_TIERS, formatNgn, formatUsd, type PaidTier } from "@/lib/pricing";
import { trackEvent } from "@/lib/clientAnalytics";

// Prices AND plan copy come from lib/pricing — the same table the checkout
// charges from, so the page, the post-signup modal and the invoice cannot
// disagree. Tier accents use the vip/premium tokens the nav pills and
// dashboard banner already use.
const tiers = PLAN_TIERS;

type Method = "PAYSTACK" | "FLUTTERWAVE" | "BANK" | "USDT";

function methodCopy(method: Method, tier: PaidTier, usdtNetwork: string): { title: string; detail: string } {
  switch (method) {
    case "PAYSTACK":
      return { title: "Paystack", detail: "Pay on Paystack's secure checkout. Unlocks as soon as it's confirmed." };
    case "FLUTTERWAVE":
      return { title: "Flutterwave", detail: "Pay on Flutterwave's secure checkout. Unlocks as soon as it's confirmed." };
    case "BANK":
      return { title: "Direct bank transfer", detail: `Pay ${formatNgn(PLAN_PRICING[tier].ngn)} into our account. Unlocks once we confirm, usually within a few hours.` };
    case "USDT":
      return { title: `USDT (${usdtNetwork})`, detail: `Pay ${formatUsd(PLAN_PRICING[tier].usd)} in USDT. Unlocks once we confirm, usually within a few hours.` };
  }
}

export default function Pricing() {
  const { data } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const router = useRouter();
  // Which ways to pay are switched on (lib/payments/methods). Until it loads,
  // Paystack alone — the behaviour before there was a choice.
  const [methods, setMethods] = useState<Method[]>(["PAYSTACK"]);
  const [usdtNetwork, setUsdtNetwork] = useState("TRC20");
  const [choosing, setChoosing] = useState<PaidTier | null>(null);

  // The chooser renders below both plan cards; on a phone that is off screen
  // from the VIP button, so bring it into view when it opens.
  useEffect(() => {
    if (choosing) document.getElementById("pay-with")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [choosing]);

  useEffect(() => {
    fetch("/api/payments/methods")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { methods: Method[]; usdtNetwork: string } | null) => {
        if (j?.methods?.length) setMethods(j.methods);
        if (j?.usdtNetwork) setUsdtNetwork(j.usdtNetwork);
      })
      .catch(() => {});
  }, []);

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
  // One method: straight to it, as before. Several: ask which.
  const choose = (tier: PaidTier) => {
    if (!data?.user) return (window.location.href = "/login");
    setErr(null);
    if (methods.length <= 1) return void pay(tier, methods[0] ?? "PAYSTACK");
    setChoosing(tier);
  };

  const pay = async (tier: PaidTier, method: Method) => {
    if (method === "PAYSTACK") return subscribe(tier);
    setBusy(tier);
    setErr(null);
    try {
      const manual = method === "BANK" || method === "USDT";
      const res = await fetch(manual ? "/api/payments/manual" : "/api/payments/flutterwave/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual ? { tier, method } : { tier }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to start checkout");
      trackEvent("begin_checkout", {
        currency: "NGN",
        value: PLAN_PRICING[tier].ngn,
        payment_type: method.toLowerCase(),
        items: [{ item_id: tier, item_name: `BetGenius ${tier}`, price: PLAN_PRICING[tier].ngn, quantity: 1 }],
      });
      if (manual) router.push(`/pay/${j.id}`);
      else window.location.href = j.authorization_url;
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };

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
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">Choose a plan for access to additional prediction categories and analysis tools. Each payment buys a single 30-day access period — there is no automatic renewal, so you renew yourself when the period ends. Prices are charged in naira; the dollar figure is what you pay if you choose USDT.</p>
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
              <div className="mt-0.5 text-sm text-gray-400">{formatUsd(price.usd)} if you pay in USDT</div>
              {/* Says what the payment actually buys. While recurring billing
                  is unavailable this is a single period, so the page must not
                  imply a card will be charged again. */}
              <div className="mt-1 text-sm text-gray-300">30-day access — renew when your access period ends.</div>
              <ul className="mt-3 space-y-1 text-sm text-gray-300">
                {t.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button
                disabled={busy === t.id}
                onClick={() => choose(t.id)}
                className="btn btn-primary mt-4 w-full disabled:opacity-50">
                {busy === t.id ? "Redirecting…" : `Get ${t.name} — 30 days`}
              </button>
            </div>
          );
        })}
      </div>
      {choosing && (
        <section id="pay-with" className="card space-y-3" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-100">
              Pay for {choosing === "PREMIUM" ? "Premium" : "VIP"} — choose how
            </h2>
            <button type="button" onClick={() => setChoosing(null)} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {methods.map((m) => {
              const copy = methodCopy(m, choosing, usdtNetwork);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={busy === choosing}
                  onClick={() => pay(choosing, m)}
                  className="rounded-lg border border-brand-border p-4 text-left transition hover:bg-brand-card disabled:opacity-50"
                >
                  <div className="font-semibold text-gray-100">{copy.title}</div>
                  <div className="mt-1 text-sm text-gray-400">{copy.detail}</div>
                </button>
              );
            })}
          </div>
          {busy === choosing && <p className="text-sm text-gray-400">Opening checkout…</p>}
        </section>
      )}
      {/* What happens when they press the button. Deliberately does not list
          payment methods: Paystack decides which it offers on the account, and
          naming one that is then missing or declined breaks the promise. */}
      <section className="card space-y-2 text-sm leading-6 text-gray-300">
        <h2 className="text-lg font-semibold text-gray-100">How payment works</h2>
        {/* Names no payment methods inside the gateways: each shows what it
            offers on our account, and naming one that is missing there
            breaks the promise. */}
        <p>Online payments happen on Paystack&apos;s{methods.includes("FLUTTERWAVE") ? " or Flutterwave\u2019s" : ""} secure checkout page, which shows the payment methods available to you; BetGenius never sees your card or bank details. Your plan unlocks as soon as the payment is confirmed, even if you have closed the page.</p>
        {(methods.includes("BANK") || methods.includes("USDT")) && (
          <p>You can also pay {methods.includes("BANK") ? "straight into our bank account" : ""}{methods.includes("BANK") && methods.includes("USDT") ? " or " : ""}{methods.includes("USDT") ? "in USDT" : ""}. Those payments are confirmed by our team, usually within a few hours, and you get an email when your plan is active.</p>
        )}
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
