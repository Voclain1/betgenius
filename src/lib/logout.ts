"use client";

/**
 * The ONE sign-out flow.
 *
 * Every surface that offers "Log out" calls logOut() — the public Nav and the
 * dashboard shell today — so there is exactly one place that decides what
 * leaving an account does to this browser. Before it existed, the logic lived
 * inline in Nav, and the dashboard had no way out at all; a second, simpler
 * copy there would have been the easy fix and the wrong one, because the part
 * that is easy to leave out is the part that matters.
 *
 * WHAT THAT PART IS. A PushSubscription belongs to a browser, but the row that
 * routes notifications to it belongs to an account. Signing out without
 * detaching it would leave this browser receiving the previous user's alerts —
 * on a shared or borrowed device, that is someone else's picks and account
 * activity arriving on the lock screen of whoever uses it next.
 *
 * ORDER, AND WHY EACH STEP IS GUARDED ON ITS OWN:
 *   1. DELETE the row server-side while the session still exists (the endpoint
 *      is session-scoped, so after signOut() it would 401);
 *   2. unsubscribe the browser — attempted even if step 1 failed, because a
 *      dead endpoint is the backstop: the push service answers 404/410 for it
 *      and sendPush prunes the row, so ownership stays safe either way;
 *   3. signOut() — always. A flaky network, a missing service worker or a
 *      browser without push support must never be the reason someone cannot
 *      leave their account.
 */

import { signOut as nextAuthSignOut } from "next-auth/react";

/** The slice of the browser APIs this flow touches, injectable so it can be asserted without a browser. */
export type LogoutEnvironment = {
  getSubscription: () => Promise<{ endpoint: string; unsubscribe: () => Promise<unknown> } | null | undefined>;
  deleteServerSubscription: (endpoint: string) => Promise<unknown>;
};

function browserEnvironment(): LogoutEnvironment {
  return {
    // getRegistration() resolves to undefined when no worker is registered;
    // `serviceWorker.ready` would never resolve and sign-out would silently hang.
    getSubscription: async () => {
      if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      return (await reg?.pushManager.getSubscription()) ?? null;
    },
    deleteServerSubscription: (endpoint) =>
      fetch("/api/push-subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }),
  };
}

/** Steps 1 and 2 above. Never throws. Reports what happened, for the checks' benefit. */
export async function detachPushForLogout(env: LogoutEnvironment = browserEnvironment()): Promise<{ endpoint: string | null; serverDeleted: boolean; unsubscribed: boolean }> {
  let sub: Awaited<ReturnType<LogoutEnvironment["getSubscription"]>> = null;
  try {
    sub = await env.getSubscription();
  } catch {
    return { endpoint: null, serverDeleted: false, unsubscribed: false };
  }
  if (!sub) return { endpoint: null, serverDeleted: false, unsubscribed: false };

  let serverDeleted = false;
  try {
    await env.deleteServerSubscription(sub.endpoint);
    serverDeleted = true;
  } catch {}
  let unsubscribed = false;
  try {
    await sub.unsubscribe();
    unsubscribed = true;
  } catch {}
  return { endpoint: sub.endpoint, serverDeleted, unsubscribed };
}

export type LogOutOptions = {
  /** Where NextAuth sends the browser afterwards. Omitted = NextAuth's default (the current page). */
  callbackUrl?: string;
  env?: LogoutEnvironment;
  signOut?: (options?: { callbackUrl?: string }) => Promise<unknown> | unknown;
};

/** Detach this browser's push subscription, then sign out. Sign-out runs whatever the push cleanup did. */
export async function logOut(options: LogOutOptions = {}): Promise<void> {
  await detachPushForLogout(options.env);
  const signOut = options.signOut ?? nextAuthSignOut;
  await signOut(options.callbackUrl ? { callbackUrl: options.callbackUrl } : undefined);
}
