"use client";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  code: string;
  email: string;
  tier: string;
  method: string;
  amount: string;
  payerDetails: string | null;
  status: string;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
};

const STATUS: Record<string, string> = {
  SUBMITTED: "Says paid — check and decide",
  AWAITING_PAYMENT: "Opened, not marked paid yet",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Bank-transfer and USDT payments. Nothing here is automatic: approve only
 * after seeing the money — the amount, with the code in the narration, in the
 * bank app; or the transaction on the blockchain, to our wallet, on the right
 * network. A customer's "I've paid" and their screenshot are claims, not proof.
 */
export default function AdminManualPayments() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/manual-payments");
    if (res.ok) setRows((await res.json()).payments);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: Row, action: "approve" | "reject") => {
    let reason = "";
    if (action === "approve" && !window.confirm(`Approve ${row.code}: ${row.amount} from ${row.email}?\n\nOnly approve if you can see this payment in your ${row.method === "USDT" ? "wallet" : "bank app"}.`)) return;
    if (action === "reject") {
      const answer = window.prompt(`Reject ${row.code}? Tell the customer why (they get an email):`, "We couldn't find a transfer matching this code and amount.");
      if (answer === null) return;
      reason = answer;
    }
    setBusy(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/manual-payments/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const json = await res.json().catch(() => ({}));
      setMessage(res.ok ? (action === "approve" ? `${row.code} approved — ${row.tier} is active and a receipt is on its way.` : `${row.code} rejected — the customer has been emailed.`) : json.error ?? "That didn't work.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bank &amp; USDT payments</h1>
        <p className="mt-1 text-sm text-gray-400">
          Approve only after you can see the money: the exact amount with the code in the narration in your bank app, or the transaction on the
          blockchain to our wallet on the right network. Screenshots can be faked.
        </p>
      </div>
      {message && <p className="text-sm text-gray-200">{message}</p>}
      {!rows ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No bank or USDT payments yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold text-gray-100">
                  {r.code} · {r.amount} · {r.tier} · {r.method === "USDT" ? "USDT" : "Bank transfer"}
                </div>
                <div className="text-sm text-gray-400">{STATUS[r.status] ?? r.status}</div>
              </div>
              <div className="grid gap-1 text-sm text-gray-300 sm:grid-cols-2">
                <div>Customer: {r.email}</div>
                <div>
                  {r.method === "USDT" ? "Transaction hash" : "Sent from"}: <span className="break-all text-gray-100">{r.payerDetails ?? "—"}</span>
                </div>
                <div>Opened: {fmt(r.createdAt)}</div>
                <div>Marked paid: {fmt(r.submittedAt)}</div>
                {r.reviewedAt && <div>Reviewed: {fmt(r.reviewedAt)}</div>}
                {r.rejectReason && <div>Reason given: {r.rejectReason}</div>}
              </div>
              {(r.status === "SUBMITTED" || r.status === "AWAITING_PAYMENT") && (
                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={busy === r.id} onClick={() => act(r, "approve")} className="btn btn-primary text-sm disabled:opacity-60">Approve</button>
                  <button type="button" disabled={busy === r.id} onClick={() => act(r, "reject")} className="btn btn-ghost text-sm disabled:opacity-60">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
