"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { PLAN_PRICING, formatNgn, formatUsd, type PaidTier } from "@/lib/pricing";

// Prices come from lib/pricing — the same table the checkout charges from,
// so the page and the invoice can't disagree. Tier accents use the vip/premium
// tokens the nav pills and dashboard banner already use.
const tiers = [
  {
    id: "VIP" as const,
    name: "VIP",
    glyph: "★",
    features: ["All Free tips", "VIP category (locked to others)", "Bet builder + StatsPad"],
    color: "border-vip/40",
    accent: "text-vip",
  },
  {
    id: "PREMIUM" as const,
    name: "Premium",
    glyph: "◆",
    features: ["Everything in VIP", "Premium category tips", "In-depth match previews", "Priority support"],
    color: "border-premium/40",
    accent: "text-premium",
  },
];

export default function Pricing() {
  const { data } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      window.location.href = j.authorization_url;
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Pricing</h1>
      <p className="text-gray-400">Payments handled by Paystack. Cancel anytime.</p>
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
                <span className="text-sm font-normal text-gray-400">/month</span>
              </div>
              <div className="mt-0.5 text-sm text-gray-400">≈ {formatUsd(price.usd)} — billed in naira</div>
              <ul className="mt-3 space-y-1 text-sm text-gray-300">
                {t.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button
                disabled={busy === t.id}
                onClick={() => subscribe(t.id)}
                className="btn btn-primary mt-4 w-full disabled:opacity-50">
                {busy === t.id ? "Redirecting…" : `Subscribe to ${t.name}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
