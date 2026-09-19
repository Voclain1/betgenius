"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import {
  DISMISS_KEY,
  RESUME_KEY,
  SESSION_COUNTED_KEY,
  SHOWN_KEY,
  countSession,
  parseDismissal,
  recordDismissal,
  resolvePushOnboarding,
  type PushOnboardingMode,
} from "@/lib/pushOnboarding";
import { currentPermission, enablePush, ensureSubscriptionPersisted, pushSupported } from "@/lib/pushClient";

/**
 * The first-visit push onboarding prompt.
 *
 * WHAT THIS IS NOT: it is not Notification.requestPermission() on load. Nothing
 * in this component opens the native dialog; only the Enable button does, via
 * enablePush(). See the header of src/lib/pushOnboarding.ts for why that
 * distinction is the whole point of the feature.
 *
 * Three outcomes, kept apart on purpose:
 *
 *   ENABLE   - opens the native dialog, subscribes, persists through the
 *              existing /api/push-subscriptions endpoint. An anonymous visitor
 *              is routed through login FIRST and resumed on return, because the
 *              endpoint requires a session by design and weakening that to
 *              support an anonymous row would hand a browser subscription no
 *              owner (see item 3 of the brief).
 *   NOT NOW  - a soft dismissal. Persisted with a timestamp and a session
 *              tally; the visitor becomes eligible again once BOTH cooldown
 *              gates pass. Never written as, and never read as, a browser
 *              denial.
 *   BLOCKED  - browser-level denied. A small inline readout, no modal, no
 *              button, and no further requestPermission() call ever.
 *
 * Rendered on the public layout beside InstallPrompt. It is deliberately quiet
 * about paid tiers: the modal describes what notifications cover, and
 * entitlement is enforced at dispatch, not in marketing copy.
 */
export function PushOnboarding() {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<PushOnboardingMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Closed during this render pass. Kept in a ref so the evaluation below can
  // read it without re-subscribing anything, exactly as InstallPrompt does.
  const closedRef = useRef(false);

  const read = (storage: "local" | "session", key: string) => {
    try {
      return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    } catch {
      // Private mode or blocked storage. Treated as absent everywhere it is
      // read: a throwing getItem must not be able to force OR suppress the modal.
      return null;
    }
  };
  const write = (storage: "local" | "session", key: string, value: string) => {
    try {
      (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
    } catch {
      /* storage blocked - the in-session ref below still holds for this page */
    }
  };

  const evaluate = useCallback(() => {
    if (typeof window === "undefined" || closedRef.current) return;

    // Count this visit against the cooldown before deciding, and only once per
    // session - countSession is idempotent on the flag for exactly the remount
    // cases React creates on its own.
    const stored = parseDismissal(read("local", DISMISS_KEY));
    const alreadyCounted = read("session", SESSION_COUNTED_KEY) === "1";
    const dismissal = countSession(stored, alreadyCounted);
    if (dismissal && !alreadyCounted) {
      write("local", DISMISS_KEY, JSON.stringify(dismissal));
    }
    // Set whether or not a dismissal exists, so the FIRST session after a
    // future dismissal is not double-counted on the page it was made.
    if (!alreadyCounted) write("session", SESSION_COUNTED_KEY, "1");

    const next = resolvePushOnboarding({
      supported: pushSupported(),
      permission: currentPermission(),
      shownThisSession: read("session", SHOWN_KEY) === "1",
      dismissal,
    });
    // Marked as soon as it is decided to show, not when it is closed: a visitor
    // who ignores the modal and navigates away has still seen it this session.
    if (next === "prompt") write("session", SHOWN_KEY, "1");
    setMode(next);
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  /**
   * Permission is granted, so onboarding is over - but a granted permission is
   * not a persisted subscription for the CURRENT account. Reconciles one
   * without ever prompting (see ensureSubscriptionPersisted).
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    void ensureSubscriptionPersisted();
  }, [status]);

  const close = useCallback(() => {
    closedRef.current = true;
    setMode(null);
  }, []);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      // "onboarding" is what opts this user into editorial broadcasts: the
      // modal above lists Bet of the Day and top-prediction alerts, so pressing
      // Enable is agreement to them. No other caller may pass this.
      const result = await enablePush("onboarding");
      if (result.ok) {
        setMessage("Notifications are on for this device.");
        // Clear the soft dismissal: it described someone who had not decided,
        // and they now have. Leaving it would be harmless but misleading to
        // anyone reading storage later.
        try {
          window.localStorage.removeItem(DISMISS_KEY);
        } catch {
          /* storage blocked */
        }
        window.setTimeout(close, 1200);
        return;
      }
      if (result.reason === "unauthenticated") {
        // The subscription endpoint owns this rule, not us: it 401s without a
        // session. Resume on return rather than making them find the button.
        write("session", RESUME_KEY, "1");
        router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (result.reason === "denied") {
        // A browser denial is NOT our "Not now" - switch to the blocked
        // readout instead of writing a soft dismissal.
        setMode("blocked");
        return;
      }
      // "dismissed" means the native dialog was closed without an answer:
      // permission is still "default", so this visit is over but the visitor
      // stays eligible. Treated exactly like Not now.
      if (result.reason === "dismissed") {
        dismiss();
        return;
      }
      setMessage(result.message);
    } finally {
      setBusy(false);
    }
    // `dismiss` is declared below and is stable; referencing it here would need
    // a forward declaration, so it is intentionally left out of the deps and
    // called through the hoisted function binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, pathname, router]);

  /**
   * Resumes the flow for a visitor who was sent to log in from the modal.
   *
   * Guarded on the flag being present AND the session being authenticated, so
   * a stale flag cannot open the permission dialog for someone who abandoned
   * the login. The flag is cleared before the call, so a failure does not leave
   * it armed for every later page of the session.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    if (read("session", RESUME_KEY) !== "1") return;
    try {
      window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* storage blocked */
    }
    if (currentPermission() === "granted") {
      void ensureSubscriptionPersisted();
      return;
    }
    closedRef.current = false;
    setMode("prompt");
    void subscribe();
  }, [status, subscribe]);

  function dismiss() {
    write("local", DISMISS_KEY, JSON.stringify(recordDismissal()));
    close();
  }

  if (!mode) return null;

  if (mode === "blocked") {
    // Non-intrusive by design: no overlay, no dismiss button, no action. There
    // is nothing this page can do about a browser-level block, so it says so
    // once and gets out of the way.
    return (
      <div className="mx-auto max-w-7xl px-4 pb-2" role="status">
        <p className="text-xs text-gray-500">
          Notifications are blocked for BetGenius in your browser settings. Your{" "}
          <a className="underline hover:text-gray-300" href="/notifications">
            inbox
          </a>{" "}
          still works.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="push-onboarding-title">
      <div className="w-full max-w-md rounded-xl border border-brand-border bg-brand-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-lg bg-brand/15 p-2 text-brand" aria-hidden="true">
            <Bell size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="push-onboarding-title" className="text-base font-semibold text-gray-100">
              Turn on BetGenius notifications?
            </h2>
            <p className="mt-1 text-sm text-gray-400">We only send what you ask for:</p>
            <ul className="mt-2 space-y-1 text-sm text-gray-400">
              <li>• Updates on teams and matches you follow</li>
              <li>• Updates from leagues you follow</li>
              <li>• Important Match Insights</li>
              <li>• Bet of the Day and top prediction alerts</li>
            </ul>
          </div>
          <button type="button" onClick={dismiss} aria-label="Close" className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-brand-bg hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={dismiss} disabled={busy}>
            Not now
          </button>
          <button type="button" className="btn btn-primary text-sm disabled:opacity-60" onClick={subscribe} disabled={busy}>
            {busy ? "Enabling…" : "Enable notifications"}
          </button>
        </div>
        {message && (
          <p className="mt-2 text-right text-xs text-brand" role="status">
            {message}
          </p>
        )}
        <p className="mt-2 text-right text-xs text-gray-500">You can change this any time in Notifications.</p>
      </div>
    </div>
  );
}
