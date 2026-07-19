"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";

const tiers = [
  {
    id: "VIP",
    name: "VIP",
    price: 5000,
    features: ["All Free tips", "VIP category (locked to others)", "Bet builder + StatsPad"],
    color: "border-yellow-500/40",
  },
  {
    id: "PREMIUM",
    name: "Premium",
    price: 15000,
    features: ["Everything in VIP", "Premium category tips", "AI match previews", "Priority support"],
    color: "border-purple-500/40",
  },
];

export default function Pricing() {
  const { data } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const subscribe = async (tier: "VIP" | "PREMIUM", amount: number) => {
    if (!data?.user) return (window.location.href = "/login");
    setBusy(tier);
    setErr(null);
    try {
      const res = await fetch("/api/subscription/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, amountKobo: amount * 100 }),
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
        {tiers.map((t) => (
          <div key={t.id} className={`card border-2 ${t.color}`}>
            <div className="text-xl font-semibold">{t.name}</div>
            <div className="mt-1 text-3xl font-bold">₦{t.price.toLocaleString()}<span className="text-sm text-gray-400">/month</span></div>
            <ul className="mt-3 space-y-1 text-sm text-gray-300">
              {t.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            <button
              disabled={busy === t.id}
              onClick={() => subscribe(t.id as any, t.price)}
              className="btn btn-primary mt-4 w-full disabled:opacity-50">
              {busy === t.id ? "Redirecting…" : `Subscribe to ${t.name}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
