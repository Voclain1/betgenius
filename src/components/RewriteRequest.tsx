"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * "Request rewrite" control for a PENDING_REVIEW prediction — a toggle that
 * opens an optional direction box and posts to the rewrite endpoint.
 *
 * Shared by /admin/ai (freshly generated cards) and the prediction edit page so
 * the wording of the cost disclosure and the empty-note behaviour can't drift
 * between the two places an admin meets this action.
 */
export function RewriteRequest({
  predictionId,
  rewriteCount = 0,
  onDone,
  compact = false,
}: {
  predictionId: string;
  rewriteCount?: number;
  onDone?: (prediction: any) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/predictions/${predictionId}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNote: note.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || j.error || "Rewrite failed");
      setNote("");
      setOpen(false);
      onDone?.(j.prediction);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className={`btn btn-ghost ${compact ? "text-sm" : ""}`} onClick={() => setOpen(true)}>
        <RefreshCw size={14} className="mr-1.5 inline" />
        Request rewrite{rewriteCount > 0 ? ` (${rewriteCount})` : ""}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-brand-border bg-brand-bg p-3">
      <label className="block text-sm">
        Direction for the rewrite <span className="text-gray-500">(optional)</span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          autoFocus
          placeholder='e.g. "focus more on the injury angle", "confidence feels too high given the h2h", "mention their away form specifically"'
          className="mt-1 w-full rounded-md border border-brand-border bg-brand-card px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-gray-500">
        Leave empty for a plain regenerate. Reuses the football data already fetched for this fixture — no new
        API-Football requests — but <b>each rewrite runs a fresh analysis</b>. Iterate as many rounds as you need;
        the previous draft is kept for audit.
      </p>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost text-sm" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </button>
        <button className="btn btn-primary text-sm disabled:opacity-50" disabled={busy} onClick={submit}>
          {busy ? "Rewriting…" : note.trim() ? "Rewrite with direction" : "Rewrite"}
        </button>
      </div>
    </div>
  );
}
