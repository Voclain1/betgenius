"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2, X } from "lucide-react";
import { trackEngagement } from "@/lib/engagement";

/** Fires dashboard_view once per mount. `personalized` is a 0/1 flag, nothing else. */
export function DashboardViewTracker({ personalized }: { personalized: boolean }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackEngagement("dashboard_view", { personalized: personalized ? 1 : 0 });
  }, [personalized]);
  return null;
}

/**
 * The non-intrusive invitation existing users see instead of a forced flow:
 * one row, one action, dismissible. Dismissing records a skip, so it stays
 * dismissed on every device.
 */
export function PersonalizeInvite() {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (hidden) return null;
  const dismiss = () =>
    start(async () => {
      setHidden(true);
      await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboarding: "skip" }) }).catch(() => null);
      trackEngagement("onboarding_skip", { step: "invite" });
      router.refresh();
    });
  return (
    <div className="flex items-start gap-3 rounded-xl bg-brand-card px-4 py-3 ring-1 ring-brand-border sm:items-center">
      <Sparkles size={18} className="mt-0.5 shrink-0 text-brand sm:mt-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-gray-100">Make this dashboard yours</p>
        <p className="text-gray-400">Pick your teams, competitions and markets. Their matches and predictions will lead every day.</p>
      </div>
      <Link href="/dashboard/welcome" className="btn btn-primary shrink-0 px-3 py-1.5 text-sm">Personalise</Link>
      <button type="button" onClick={dismiss} disabled={pending} aria-label="Dismiss" className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-100">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Remove a bookmark (by prediction or by bookmark id) and refresh the server-rendered list. */
export function RemoveSavedButton({ predictionId, savedId }: { predictionId: string | null; savedId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const remove = () =>
    start(async () => {
      setError(false);
      const r = await fetch("/api/saved-predictions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(predictionId ? { predictionId } : { savedId }),
      }).catch(() => null);
      if (!r?.ok) {
        setError(true);
        return;
      }
      trackEngagement("prediction_unsave", { source: "saved" });
      router.refresh();
    });
  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      aria-label={error ? "Could not remove — try again" : "Remove from saved"}
      title={error ? "Could not remove — try again" : "Remove from saved"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition hover:text-red-300 disabled:opacity-50 ${error ? "text-red-400" : "text-gray-500"}`}
    >
      <Trash2 size={16} aria-hidden />
    </button>
  );
}
