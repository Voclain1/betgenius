"use client";

import { useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SessionContext } from "next-auth/react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { trackEngagement } from "@/lib/engagement";

/**
 * One /api/saved-predictions request per page, shared by every button on it —
 * the same pattern as FollowButton's follows list. Signed-out visitors never
 * trigger it.
 */
let savedRequest: Promise<Set<string>> | null = null;
function loadSaved(): Promise<Set<string>> {
  savedRequest ??= fetch("/api/saved-predictions", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { predictionIds: [] }))
    .then((x) => new Set<string>(Array.isArray(x.predictionIds) ? x.predictionIds : []))
    .catch(() => {
      savedRequest = null;
      return new Set<string>();
    });
  return savedRequest;
}

function updateCache(id: string, saved: boolean) {
  if (!savedRequest) return;
  savedRequest = savedRequest.then((s) => {
    const next = new Set(s);
    if (saved) next.add(id);
    else next.delete(id);
    return next;
  });
}

/**
 * Bookmark control for a prediction.
 *
 * Reads the session through the raw context rather than useSession(): this
 * button sits inside PredictionCard, which is also rendered outside any
 * SessionProvider (the render checks in scripts/). There it simply renders
 * the signed-out invitation.
 *
 * Signed out, it is a plain link to sign in that returns to this page — a
 * lightweight invitation, not a popup.
 */
export function SavePredictionButton({
  predictionId,
  source,
  initiallySaved,
  withLabel = false,
  onChange,
  className = "",
}: {
  predictionId: string;
  /** Where the control sits, for analytics only (a fixed value, never free text). */
  source: "card" | "match" | "dashboard" | "saved";
  initiallySaved?: boolean;
  withLabel?: boolean;
  onChange?: (saved: boolean) => void;
  className?: string;
}) {
  const session = useContext(SessionContext);
  const status = session?.status ?? "unauthenticated";
  const path = usePathname() ?? "/";
  const [saved, setSaved] = useState(initiallySaved ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated" || initiallySaved !== undefined) return;
    let active = true;
    loadSaved().then((ids) => {
      if (active) setSaved(ids.has(predictionId));
    });
    return () => {
      active = false;
    };
  }, [status, predictionId, initiallySaved]);

  const base = `inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
    withLabel ? "min-h-9 border border-brand-border px-3" : "h-9 w-9"
  } ${className}`;

  if (status === "loading") {
    return <span className={`${base} text-gray-500`} aria-hidden><Bookmark size={16} /></span>;
  }

  if (status !== "authenticated") {
    return (
      <Link href={`/login?callbackUrl=${encodeURIComponent(path)}`} className={`${base} text-gray-400 hover:text-gray-100`} aria-label="Sign in to save this prediction" title="Sign in to save">
        <Bookmark size={16} aria-hidden />
        {withLabel && "Save"}
      </Link>
    );
  }

  const toggle = async () => {
    if (pending) return; // duplicate-submission guard; the API is idempotent as well
    const next = !saved;
    setPending(true);
    setError("");
    setSaved(next);
    try {
      const r = await fetch("/api/saved-predictions", {
        method: next ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ predictionId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Could not update");
      }
      updateCache(predictionId, next);
      trackEngagement(next ? "prediction_save" : "prediction_unsave", { source });
      onChange?.(next);
    } catch (e) {
      setSaved(!next);
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setPending(false);
    }
  };

  const label = saved ? "Saved" : "Save";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={error ? `${label} — ${error}` : saved ? "Remove from saved predictions" : "Save prediction"}
      title={error || (saved ? "Saved — tap to remove" : "Save prediction")}
      className={`${base} ${saved ? "text-brand" : "text-gray-400 hover:text-gray-100"} ${error ? "text-red-400" : ""} disabled:opacity-60`}
    >
      {saved ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
      {withLabel && label}
    </button>
  );
}
