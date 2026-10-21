"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Retry and Dismiss for one failed match. Both act on the whole match, not one attempt. */
export function FailureActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "dismiss" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const act = async (action: "retry" | "dismiss") => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/generation-failures/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(j.error ?? "That did not work. Try again shortly.");
      else if (action === "retry" && j.predictions === 0) setMessage("Ran, but no pick qualified. It stays on this list.");
      else if (action === "retry") setMessage(`Done: ${j.predictions} pick${j.predictions === 1 ? "" : "s"} waiting in review.`);
      router.refresh();
    } catch {
      setMessage("That did not work. Try again shortly.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary text-sm disabled:opacity-50" disabled={busy !== null} onClick={() => act("retry")}>
          {busy === "retry" ? "Generating…" : "Retry"}
        </button>
        <button type="button" className="btn btn-ghost text-sm disabled:opacity-50" disabled={busy !== null} onClick={() => act("dismiss")}>
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
      {message && <p className="max-w-[260px] text-right text-xs text-gray-400">{message}</p>}
    </div>
  );
}
