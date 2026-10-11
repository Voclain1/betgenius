"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the value is on screen to copy by hand */
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="btn btn-ghost shrink-0 p-2">
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

/** "I've paid": sends the customer's detail to the admin queue. */
export function SubmitManualPayment({ id, method, initial }: { id: string; method: string; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usdt = method === "USDT";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/payments/manual/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerDetails: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "That didn't work. Please try again.");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm text-gray-300">{usdt ? "Transaction hash (TxID)" : "Name on the account you sent from"}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          minLength={3}
          maxLength={200}
          placeholder={usdt ? "e.g. 7c1f…a9e2" : "e.g. Chinedu Okafor, Access Bank"}
          className="w-full rounded-md border border-brand-border bg-brand-bg px-3 py-2"
        />
      </label>
      <button type="submit" disabled={busy || value.trim().length < 3} className="btn btn-primary w-full justify-center disabled:opacity-60 sm:w-auto">
        {busy ? "Sending…" : initial ? "Update details" : "I've paid"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
