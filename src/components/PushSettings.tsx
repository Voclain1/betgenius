"use client";

import { useEffect, useState } from "react";
import { currentPermission, disablePush, enablePush, ensureSubscriptionPersisted, pushSupported } from "@/lib/pushClient";
import type { PushPermission } from "@/lib/pushOnboarding";

/**
 * Per-device push controls.
 *
 * The subscribe/unsubscribe mechanics live in src/lib/pushClient.ts, shared
 * with the onboarding modal. Two components asking for the same permission and
 * POSTing the same endpoint by two different routes would be two push systems
 * in everything but name, and they would drift the first time one of them
 * learned something the other did not.
 *
 * This panel and the onboarding modal answer different questions. The modal is
 * the one-time ask for someone who has not decided; this is the settings
 * surface, always present, for someone who wants to change their mind or add a
 * second device. It is therefore NOT subject to the onboarding cooldown, and it
 * is the place the "blocked in browser settings" state is explained in full.
 */
export function PushSettings() {
  const [state, setState] = useState<PushPermission | "loading" | "unsupported">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) {
      setState("unsupported");
      return;
    }
    setState(currentPermission());
    // Permission alone does not prove a PushSubscription row exists for the
    // account now signed in — see ensureSubscriptionPersisted. Never prompts,
    // so it is safe in an effect.
    void ensureSubscriptionPersisted();
  }, []);

  const enable = async () => {
    setBusy(true);
    setMessage("");
    try {
      // "settings", never "onboarding". This panel enables push on a device;
      // it makes no promise about editorial broadcasts, which have their own
      // checkbox in NotificationPreferences directly above.
      const result = await enablePush("settings");
      setState(currentPermission());
      if (result.ok) setMessage("Push enabled on this device.");
      else if (result.reason === "unauthenticated") setMessage("Log in to enable push on this device.");
      else if (result.reason !== "dismissed") setMessage(result.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage("");
    try {
      await disablePush();
      setMessage("Push disabled on this device.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/push-test", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      setMessage(r.ok ? `Sent to ${data.sent} device(s).` : data.error || "Could not send a test.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="section-heading">Browser push</h2>
      {state === "unsupported" ? (
        <p className="text-sm text-gray-400">Push is unavailable in this browser. On iPhone or iPad, add BetGenius to the Home Screen first. Your inbox still works.</p>
      ) : (
        <>
          <p className="text-sm text-gray-400">
            {state === "denied"
              ? "Notifications are blocked for this site. Allow them in your browser settings to enable push."
              : "Permission is only requested when you choose Enable."}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Disabled on "denied" because requestPermission() would resolve
                to denied without showing anything — a button that can only
                appear to fail. The browser settings are the only way out. */}
            <button className="btn btn-primary" onClick={enable} disabled={busy || state === "denied"}>Enable push</button>
            <button className="btn btn-ghost" onClick={disable} disabled={busy}>Disable on this device</button>
            <button className="btn btn-ghost" onClick={test} disabled={busy || state !== "granted"}>Send test notification</button>
          </div>
        </>
      )}
      {message && <p className="text-sm text-brand" role="status">{message}</p>}
    </section>
  );
}
