"use client";
import { useCallback, useEffect, useState } from "react";
import { CATEGORY_COPY, PAYMENT_CATEGORIES, type PaymentCategory } from "@/lib/paystack/failureCategory";
import { CHECKOUT_STAGES, STAGE_COPY, type AttemptOrigin, type AttemptOutcome, type CheckoutStage } from "@/lib/paystack/attemptDiagnosis";

type Attempt = {
  id: string;
  reference: string;
  userId: string | null;
  email: string | null;
  knownUser: boolean;
  tier: string | null;
  channel: string | null;
  status: string;
  category: PaymentCategory;
  gatewayResponse: string | null;
  amountKobo: number | null;
  currency: string | null;
  occurredAt: string;
  source: string;
  methodsTried: string | null;
  authAttempts: number | null;
  sessionError: string | null;
  timeSpentSec: number | null;
  webhookAt: string | null;
  callbackAt: string | null;
  verifyError: string | null;
  entitlementError: string | null;
  entitlementGrantedAt: string | null;
  origin: AttemptOrigin;
  entitled: boolean;
  stage: CheckoutStage;
  outcome: AttemptOutcome;
};

type Finding = { reference: string; action: "GRANT_MISSING" | "REVIEW"; note: string };

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
  VERIFICATION_FAILED: "bg-red-500/15 text-red-300 border-red-500/30",
  UNKNOWN_FAILURE: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

const naira = (kobo: number | null) =>
  kobo == null ? "—" : `₦${(kobo / 100).toLocaleString("en-NG")}`;

export default function AdminPayments() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [byStage, setByStage] = useState<Record<string, number>>({});
  const [byMethod, setByMethod] = useState<Record<string, { paid: number; notCompleted: number }>>({});
  const [excluded, setExcluded] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [filter, setFilter] = useState<PaymentCategory | "ALL">("ALL");
  const [showExternal, setShowExternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/payments");
    if (!res.ok) return setNote("Could not load payment attempts.");
    const json = await res.json();
    setAttempts(json.attempts ?? []);
    setByCategory(json.byCategory ?? {});
    setByStage(json.byStage ?? {});
    setByMethod(json.byMethod ?? {});
    setExcluded(json.excluded ?? 0);
    setMissing(json.entitlementMissing ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Pulls Paystack's recent transactions into the log and reports anything
  // paid without access. It grants nothing — see the route.
  const reconcile = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/payments", { method: "POST" });
      const json = await res.json();
      setFindings(json.findings ?? []);
      setNote(
        res.ok
          ? `Reconciled ${json.reconciled} transactions from Paystack. ${
              (json.findings ?? []).length ? `${json.findings.length} need attention.` : "Nothing paid is missing access."
            }`
          : json.error,
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  // The one action here that can grant. The server re-verifies with Paystack
  // and applies every check the webhook does; this button supplies only the
  // reference.
  const grant = async (reference: string) => {
    if (!window.confirm(`Verify ${reference} with Paystack and grant access if it is a valid, unpaid-for payment?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, apply: true }),
      });
      const json = await res.json();
      setNote(res.ok ? `${reference}: ${json.outcome}` : json.error);
      setFindings((f) => f.filter((x) => x.reference !== reference));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const visible = showExternal ? attempts : attempts.filter((a) => a.origin !== "EXTERNAL");
  const rows = filter === "ALL" ? visible : visible.filter((a) => a.category === filter);
  const present = PAYMENT_CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0);
  const attention = [
    ...findings,
    ...missing.filter((r) => !findings.some((f) => f.reference === r)).map((reference) => ({
      reference,
      action: "GRANT_MISSING" as const,
      note: "P0: paid at Paystack with no entitlement recorded.",
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="mt-1 text-sm text-gray-400">
            Every checkout attempt and what became of it. No card, authorization or session data is stored — only
            which methods were chosen and Paystack&apos;s own outcome text.
          </p>
        </div>
        <button onClick={reconcile} disabled={busy} className="btn btn-ghost text-sm disabled:opacity-50">
          {busy ? "Working…" : "Reconcile from Paystack"}
        </button>
      </div>

      {note && <div className="card text-sm text-gray-300">{note}</div>}

      {attention.length > 0 && (
        <div className="card space-y-2 border border-red-500/40 bg-red-500/10">
          <h2 className="text-sm font-semibold text-red-300">Paid at Paystack, no access recorded</h2>
          {attention.map((f) => (
            <div key={f.reference} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-mono text-xs">{f.reference}</span>{" "}
                <span className="text-gray-300">{f.note}</span>
              </span>
              {f.action === "GRANT_MISSING" && (
                <button onClick={() => grant(f.reference)} disabled={busy} className="btn btn-primary text-xs">
                  Verify &amp; grant
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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
      {excluded > 0 && (
        <p className="text-xs text-gray-500">
          Counts cover BetGenius checkouts only. {excluded} other transaction{excluded === 1 ? "" : "s"} on the
          Paystack account (test probes, payment pages) {excluded === 1 ? "is" : "are"} excluded.{" "}
          <button className="underline" onClick={() => setShowExternal((v) => !v)}>
            {showExternal ? "Hide" : "Show"} them in the table
          </button>
        </p>
      )}

      {Object.keys(byStage).length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">How far payers got</h2>
          <p className="text-xs text-gray-500">
            From Paystack&apos;s checkout session log. “No checkout activity” means Paystack recorded nothing on the
            page — it cannot tell a page that never loaded from one closed untouched.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {CHECKOUT_STAGES.filter((s) => byStage[s]).map((s) => (
              <span key={s} className="chip border border-brand-border bg-brand-bg text-xs">
                {STAGE_COPY[s]}: <span className="font-semibold">{byStage[s]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(byMethod).length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Method the payer chose</h2>
          <p className="text-xs text-gray-500">
            The last method chosen on Paystack&apos;s page. Paystack&apos;s own “channel” on an unpaid transaction is a
            default, not the payer&apos;s choice, so it is not used here.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(byMethod).map(([method, n]) => (
              <span key={method} className="chip border border-brand-border bg-brand-bg text-xs">
                {method}: <span className="text-emerald-300">{n.paid} paid</span> ·{" "}
                <span className="text-gray-400">{n.notCompleted} not</span>
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
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Methods tried</th>
              <th className="px-3 py-2">Paystack said</th>
              <th className="px-3 py-2">Our side</th>
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
                  {a.outcome === "ENTITLEMENT_MISSING" ? (
                    <span className="chip border border-red-500/50 bg-red-500/20 text-xs text-red-200">Paid — NO ACCESS</span>
                  ) : a.outcome === "EXTERNAL_PAYMENT" ? (
                    <span className="chip border border-gray-500/30 text-xs text-gray-300">Paid — not a BetGenius checkout</span>
                  ) : (
                    <span className={`chip border text-xs ${TONE[a.category]}`}>{CATEGORY_COPY[a.category].label}</span>
                  )}
                  <div className="mt-0.5 text-xs text-gray-500">
                    {a.status}
                    {a.origin === "EXTERNAL" ? " · external" : a.origin === "LEGACY" ? " · legacy ref" : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-300">
                  {STAGE_COPY[a.stage]}
                  {a.timeSpentSec != null && <div className="text-gray-500">{a.timeSpentSec}s on page</div>}
                </td>
                <td className="px-3 py-2">
                  {a.email ?? <span className="text-gray-500">{a.userId ? "no such account" : "unknown"}</span>}
                </td>
                <td className="px-3 py-2">{a.tier ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{naira(a.amountKobo)}</td>
                <td className="px-3 py-2 text-xs text-gray-300">
                  {a.methodsTried?.split(",").join(" → ") ?? "—"}
                  {a.authAttempts != null && a.authAttempts > 0 && (
                    <div className="text-gray-500">{a.authAttempts} authorization attempt(s)</div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {a.gatewayResponse ?? "—"}
                  {a.sessionError && a.sessionError !== a.gatewayResponse && (
                    <div className="text-xs text-red-300">{a.sessionError}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-400">
                  {a.webhookAt && <div>webhook ✓</div>}
                  {a.callbackAt && <div>callback ✓</div>}
                  {a.entitled && <div className="text-emerald-300">access granted</div>}
                  {a.verifyError && <div className="text-red-300">verify failed: {a.verifyError}</div>}
                  {a.entitlementError && <div className="text-red-300">refused: {a.entitlementError}</div>}
                  {!a.webhookAt && !a.callbackAt && !a.entitled && !a.verifyError && <div>reconcile only</div>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{a.reference}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
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
