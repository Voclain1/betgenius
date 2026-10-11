/**
 * The visitor's cookie choice for analytics and advertising measurement.
 *
 * One stored value, three states: "granted", "denied", or nothing (not asked
 * yet). Until a visitor chooses, both tags run in their most restricted mode —
 * GA4 under Consent Mode with every storage type denied (no cookies; Google
 * receives only cookieless pings), and the Meta Pixel revoked (it sends
 * nothing). Accepting upgrades both in place, without a reload.
 *
 * The tags themselves read the stored choice in their own inline init scripts
 * (see CONSENT_STORAGE_KEY's use in Analytics.tsx and MetaPixel.tsx), because
 * they start before React hydrates. This module is the one place that WRITES
 * the choice and tells both tags about a change.
 *
 * localStorage, not a cookie: nothing on the server needs the answer, and a
 * consent cookie would itself be sent with every request for no reason.
 */
export type ConsentChoice = "granted" | "denied";

/** Versioned: bump it if the categories asked about ever change, so everyone is asked again. */
export const CONSENT_STORAGE_KEY = "bg_consent_v1";

/** Fired on window whenever the choice changes, or the banner is asked to reopen. */
export const CONSENT_EVENT = "bg:consent";
export const CONSENT_REOPEN_EVENT = "bg:consent-reopen";

export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

export function readConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    // Storage blocked: treated as "not chosen", so the tags stay restricted.
    return null;
  }
}

type TagWindow = Window & { gtag?: (...args: unknown[]) => void; fbq?: (...args: unknown[]) => void };

/** Applies a choice to whichever tags are on the page. Harmless when neither is. */
export function applyConsentToTags(choice: ConsentChoice, w: TagWindow): void {
  const value = choice === "granted" ? "granted" : "denied";
  if (typeof w.gtag === "function") {
    w.gtag("consent", "update", {
      analytics_storage: value,
      ad_storage: value,
      ad_user_data: value,
      ad_personalization: value,
    });
  }
  if (typeof w.fbq === "function") w.fbq("consent", choice === "granted" ? "grant" : "revoke");
}

export function saveConsent(choice: ConsentChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view, and the
    // banner will ask again next time — the safe direction to fail in.
  }
  applyConsentToTags(choice, window as TagWindow);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}

/** Reopens the banner (the footer's "Cookie settings" link). */
export function reopenConsent(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
}
