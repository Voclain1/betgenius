"use client";
import { useCallback, useEffect, useState } from "react";
import { CATEGORY_COPY, PAYMENT_CATEGORIES, type PaymentCategory } from "@/lib/paystack/failureCategory";

type Attempt = {
  id: string;
  reference: string;
  userId: string | null;
  email: string | null;
  tier: string | null;
  channel: string | null;
  status: string;
  category: PaymentCategory;
  gatewayResponse: string | null;
  amountKobo: number | null;
  currency: string | null;
  occurredAt: string;
  source: string;
};

// Paid reads green, the payer's own problem reads amber, ours reads red. An
// admin should be able to tell whether to act from the colour alone, before
// reading a word.
const TONE: Record<PaymentCategory, string> = {
  SUCCESS: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ABANDONED: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  FRAUD_BLOCK: "bg-red-500/15 text-red-300 border-red-500/30",
  ISSUER_DECLINE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  INSUFFICIENT_FUNDS: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  GATEWAY_FAILURE: "bg-red-500/15 text-red-300 border-red-500/30",
  PENDING: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  UNKNOWN_FAILURE: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

const naira = (kobo: number | null) =>
  kobo == null ? "—" : `₦${(kobo / 100).toLocaleString("en-NG")}`;

export default function AdminPayments() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [byChannel, setByChannel] = useState<Record<string, { paid: number; failed: number }>>({});
  const [filter, setFilter] = useState<PaymentCategory | "ALL">("ALL");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/payments");
    if (!res.ok) return setNote("Could not load payment attempts.");
    const json = await res.json();
    setAttempts(json.attempts ?? []);
    setByCategory(json.byCategory ?? {});
    setByChannel(json.byChannel ?? {});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Pulls Paystack's recent transactions into the log. It does not retry or
  // re-charge anything — see the route.
  const reconcile = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/payments", { method: "POST" });
      const json = await res.json();
      setNote(res.ok ? `Reconciled ${json.reconciled} transactions from Paystack.` : json.error);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rows = filter === "ALL" ? attempts : attempts.filter((a) => a.category === filter);
  const present = PAYMENT_CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-gray-400">
            Every checkout attempt and what became of it. No card, authorization or session data is stored.
          </p>
        </div>
        <button onClick={reconcile} disabled={busy} className="btn btn-ghost text-sm disabled:opacity-50">
          {busy ? "Reconciling…" : "Reconcile from Paystack"}
        </button>
      </div>

      {note && <div className="card text-sm text-gray-300">{note}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {present.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(filter === c ? "ALL" : c)}
            className={`rounded-xl border p-3 text-left transition ${TONE[c]} ${
              filter === c ? "ring-2 ring-brand" : ""
            }`}
          >
            <div className="text-2xl font-bold">{byCategory[c]}</div>
            <div className="text-sm font-medium">{CATEGORY_COPY[c].label}</div>
            <div className="mt-1 text-xs opacity-80">{CATEGORY_COPY[c].hint}</div>
          </button>
        ))}
        {present.length === 0 && (
          <div className="card text-sm text-gray-400 sm:col-span-2 lg:col-span-4">
            No attempts recorded yet. Use “Reconcile from Paystack” to pull in recent transactions.
          </div>
        )}
      </div>

      {Object.keys(byChannel).length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Channel outcomes</h2>
          <p className="text-xs text-gray-500">
            Which channels actually complete. Evidence for a future channel decision — not a reason to change
            the channel configuration yet.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(byChannel).map(([channel, n]) => (
              <span key={channel} className="chip border border-brand-border bg-brand-bg text-xs">
                {channel}: <span className="text-emerald-300">{n.paid} paid</span> ·{" "}
                <span className="text-gray-400">{n.failed} not</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-brand-border">
        <table className="w-full text-sm">
          <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">Paystack said</th>
              <th className="px-3 py-2">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                  {new Date(a.occurredAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <span className={`chip border text-xs ${TONE[a.category]}`}>{CATEGORY_COPY[a.category].label}</span>
                  <div className="mt-0.5 text-xs text-gray-500">{a.status}</div>
                </td>
                <td className="px-3 py-2">{a.email ?? <span className="text-gray-500">unknown</span>}</td>
                <td className="px-3 py-2">{a.tier ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{naira(a.amountKobo)}</td>
                <td className="px-3 py-2">{a.channel ?? "—"}</td>
                <td className="px-3 py-2 text-gray-400">{a.gatewayResponse ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{a.reference}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  Nothing to show for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
