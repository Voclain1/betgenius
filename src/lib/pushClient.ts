"use client";

/**
 * The ONE browser-side push subscription flow.
 *
 * Extracted from PushSettings so the onboarding modal and the settings panel
 * cannot drift into two different ways of subscribing. There is exactly one
 * place that calls requestPermission(), one place that calls
 * pushManager.subscribe(), and one place that POSTs to
 * /api/push-subscriptions - which is also what keeps the "do not build a second
 * push system" rule true on the client, not only on the server.
 *
 * Every entry point here is called from a user gesture. Nothing in this module
 * may be invoked from a mount or an effect: see the note in
 * src/lib/pushOnboarding.ts on why the native permission dialog is a one-shot
 * resource.
 */

import type { PushPermission } from "@/lib/pushOnboarding";

function urlBase64ToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** True when this browser can do web push at all. iOS Safari only qualifies once installed to the Home Screen. */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The browser's current answer, or "default" where the API does not exist. */
export function currentPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "default";
  return Notification.permission as PushPermission;
}

/**
 * The registration from ServiceWorkerRegistration, registering it here if it
 * has not happened yet. Deliberately not `serviceWorker.ready`, which never
 * resolves when nothing is registered and would leave the button spinning.
 */
async function workerRegistration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Which surface asked. Forwarded to the API, which uses it to decide whether
 * the user was shown the editorial-alerts promise before agreeing — see the
 * `source` field in src/app/api/push-subscriptions/route.ts. Not cosmetic:
 * "onboarding" is the only value that opts someone into broadcasts.
 */
export type PushSource = "onboarding" | "settings";

export type SubscribeResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: "unsupported" | "unconfigured" | "denied" | "dismissed" | "unauthenticated" | "error"; message: string };

/**
 * Requests permission if needed, subscribes, and persists through the existing
 * endpoint. MUST be called from a click handler.
 *
 * The permission branch distinguishes "denied" from "dismissed" because the two
 * are different futures: denied is final and the caller should switch to the
 * blocked readout, while dismissing the dialog (Escape, or clicking away)
 * leaves permission at "default" and the visitor can be asked again later.
 *
 * A 401 is surfaced as "unauthenticated" rather than swallowed, so the caller
 * can send an anonymous visitor through login and resume - which is what keeps
 * PushSubscription ownership intact instead of inventing an anonymous row.
 */
export async function enablePush(source: PushSource): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported", message: "Push is unavailable in this browser." };

  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, reason: "unconfigured", message: "Push has not been configured by the site operator." };

  // Never called anywhere else in the app. This is the single-gesture ask.
  const permission = (await Notification.requestPermission()) as PushPermission;
  if (permission === "denied") return { ok: false, reason: "denied", message: "Notifications are blocked in your browser settings." };
  if (permission !== "granted") return { ok: false, reason: "dismissed", message: "" };

  try {
    const reg = await workerRegistration();
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) }));
    const r = await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), source }),
    });
    if (r.status === 401) return { ok: false, reason: "unauthenticated", message: "Log in to finish enabling notifications." };
    if (!r.ok) {
      const message = (await r.json().catch(() => null))?.error || "Could not enable push.";
      return { ok: false, reason: "error", message };
    }
    return { ok: true, created: true };
  } catch {
    return { ok: false, reason: "error", message: "Something went wrong. Please try again." };
  }
}

/**
 * Re-persists an existing browser subscription for the signed-in account,
 * without touching permission.
 *
 * This is the "granted" reconciliation required of item 2: permission granted
 * on this browser does NOT imply a PushSubscription row exists for the CURRENT
 * account. It does not after logging in on a shared browser, after the row was
 * pruned by a 404/410 from the push service (see sendPush), or after the
 * service worker rotated its subscription. Safe to call on mount precisely
 * because it never prompts: it returns null when there is nothing already
 * subscribed, and the POST upserts on endpointHash, so a repeat is a no-op.
 *
 * Sends source "settings", never "onboarding": this is a reconciliation of a
 * decision already made, not a fresh agreement, so it must not opt anyone into
 * editorial broadcasts on its way past.
 */
export async function ensureSubscriptionPersisted(): Promise<boolean | null> {
  if (!pushSupported() || currentPermission() !== "granted") return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    const r = await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), source: "settings" }),
    });
    return r.ok;
  } catch {
    return null;
  }
}

/** Removes this browser's subscription, server-side first so a failed unsubscribe cannot orphan the row. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push-subscriptions", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}
