"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Share, X } from "lucide-react";
import { BRAND_ICON_DARK, BRAND_ICON_LIGHT } from "@/lib/brandAssets";
import { CONSENT_EVENT, readConsent } from "@/lib/consent";
import {
  DISMISS_KEY,
  INSTALLED_KEY,
  LEGACY_DISMISS_KEY,
  PAGEVIEW_KEY,
  PAGEVIEW_PATH_KEY,
  SECONDS_BEFORE_PROMPT,
  hasEngaged,
  isDismissedThisSession,
  isIosDevice,
  nextPageviewCount,
  isRunningStandalone,
  resolveInstallPrompt,
  type InstallPromptMode,
} from "@/lib/installPrompt";

/**
 * The home-screen install banner.
 *
 * Two platforms, two mechanisms, one banner:
 *
 *   ANDROID / CHROME / EDGE — `beforeinstallprompt` is captured and its default
 *   suppressed, which is what stops the browser showing its own mini-infobar
 *   and hands us the right to trigger the real dialog later. The captured event
 *   is the ONLY way to open that dialog; there is no API to summon it from
 *   nothing, so if the event never arrives there is genuinely nothing to show.
 *
 *   IOS SAFARI — no `beforeinstallprompt`, no install API of any kind. Adding
 *   to the home screen is a manual Share-sheet action, so the honest fallback
 *   is instructions rather than a button that cannot work. Keyed off the DEVICE
 *   (see isIosDevice) rather than off "we got no event", because a Chrome user
 *   who is merely early would otherwise be shown Safari's Share icon.
 *
 * Bottom-anchored rather than below the nav. The nav is already sticky, so a
 * banner under it would either stack two fixed bars at the top or push the page
 * down on arrival; a bottom bar overlays content the reader has already passed,
 * sits under the thumb on a phone, and needs no layout shift. It carries
 * safe-area padding so it clears the iOS home indicator.
 *
 * Renders nothing at all — no wrapper, no placeholder — whenever the decision
 * in resolveInstallPrompt says so.
 */

/**
 * The Chrome-only event. Not in TypeScript's DOM lib, because it is not a
 * standard: it exists in Chromium browsers and nowhere else, which is the whole
 * reason the iOS branch below has to exist.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function InstallPrompt() {
  const pathname = usePathname();
  const [mode, setMode] = useState<InstallPromptMode | null>(null);
  // The cookie banner occupies the same bottom strip, and it asks first: this
  // waits until the visitor has answered it, so the two never stack.
  const [consentAnswered, setConsentAnswered] = useState(false);
  useEffect(() => {
    setConsentAnswered(readConsent() !== null);
    const answered = () => setConsentAnswered(true);
    window.addEventListener(CONSENT_EVENT, answered);
    return () => window.removeEventListener(CONSENT_EVENT, answered);
  }, []);
  const [installing, setInstalling] = useState(false);
  // iOS: the Share-sheet instruction, opened from the pill.
  const [iosHelp, setIosHelp] = useState(false);

  // The captured event, held in a ref rather than state: storing it in state
  // would re-render on capture, and capture happens during load — before the
  // banner is allowed to appear anyway.
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  // Engagement inputs. Kept in refs so the re-evaluation below reads current
  // values without re-subscribing its listeners on every tick.
  const pageviewsRef = useRef(0);
  const secondsRef = useRef(0);
  const dismissedRef = useRef(false);

  /**
   * Re-runs the whole decision. Called after every input changes — event
   * captured, page viewed, timer elapsed, app installed — so there is exactly
   * one place where "should this be visible" is decided.
   */
  const evaluate = useCallback(() => {
    if (typeof window === "undefined") return;
    if (dismissedRef.current) {
      setMode(null);
      return;
    }
    let dismissedThisSession = false;
    let knownInstalled = false;
    try {
      // Two different storages on purpose. The dismissal lives in
      // sessionStorage so it expires with the visit; the install lives in
      // localStorage because it never expires.
      dismissedThisSession = isDismissedThisSession(window.sessionStorage.getItem(DISMISS_KEY));
      knownInstalled = window.localStorage.getItem(INSTALLED_KEY) === "1";
    } catch {
      // Private mode, or storage blocked. Treat as "not dismissed" — the banner
      // is dismissible in-session via the ref above either way, and a thrown
      // getItem must not be able to suppress or force the banner.
      dismissedThisSession = false;
      knownInstalled = false;
    }
    setMode(
      resolveInstallPrompt({
        standalone: isRunningStandalone(window),
        knownInstalled,
        dismissedThisSession,
        engaged: hasEngaged({ pageviews: pageviewsRef.current, secondsOnPage: secondsRef.current }),
        isIos: isIosDevice(window.navigator.userAgent, window.navigator.maxTouchPoints ?? 0),
        canPromptNatively: deferredRef.current !== null,
      }),
    );
  }, []);

  /**
   * Drops the old 14-day dismissal key.
   *
   * It is already written into the localStorage of anyone who dismissed the
   * banner under the previous behaviour, and nothing reads it any more. Without
   * this it would sit there permanently — a stale key that looks meaningful to
   * the next person who opens devtools. Removing it is also what makes those
   * readers eligible again, which is the point of the change.
   */
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_DISMISS_KEY);
    } catch {
      /* storage blocked — nothing to clean up that we could reach anyway */
    }
  }, []);

  // --- capture the native event, and stand down permanently once installed ---
  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      // Suppresses Chrome's own mini-infobar. Without this the browser shows
      // its banner AND we show ours.
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      evaluate();
    };
    const onInstalled = () => {
      // Fires whether the install came from our button or from the browser's
      // own address-bar control, so this is what covers the second case.
      deferredRef.current = null;
      dismissedRef.current = true;
      setMode(null);
      // Persisted, not just held in the ref above: this event fires once, and
      // the reader who keeps browsing after installing gets a fresh mount on
      // the next navigation with nothing left to tell it. See INSTALLED_KEY.
      try {
        window.localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        // Storage blocked — the in-session refs still hold for this page.
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [evaluate]);

  // --- engagement: page views this session ---
  useEffect(() => {
    let count = 1;
    try {
      // Keyed on the path, so a remount on the SAME page does not count twice —
      // see the note on PAGEVIEW_PATH_KEY. Without it a single load counted as
      // two under StrictMode, which is the entire engagement gate.
      count = nextPageviewCount({
        storedCount: window.sessionStorage.getItem(PAGEVIEW_KEY),
        storedPath: window.sessionStorage.getItem(PAGEVIEW_PATH_KEY),
        path: pathname,
      });
      window.sessionStorage.setItem(PAGEVIEW_KEY, String(count));
      window.sessionStorage.setItem(PAGEVIEW_PATH_KEY, pathname);
    } catch {
      // sessionStorage unavailable — fall back to the dwell timer alone.
    }
    pageviewsRef.current = count;
    secondsRef.current = 0;
    evaluate();
  }, [pathname, evaluate]);

  // --- engagement: dwell time on the current page ---
  useEffect(() => {
    const id = window.setInterval(() => {
      secondsRef.current += 5;
      if (secondsRef.current >= SECONDS_BEFORE_PROMPT) {
        evaluate();
        window.clearInterval(id);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [pathname, evaluate]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setMode(null);
    try {
      // sessionStorage, so the dismissal covers the rest of this visit and no
      // longer. The ref above already handles the current page; this is what
      // carries the answer across navigations within the same sitting.
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: the banner still goes away for this page, it just
      // cannot survive a navigation. Better than refusing to dismiss.
    }
  }, []);

  const install = useCallback(async () => {
    const deferred = deferredRef.current;
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // The event is single-use: once prompted it cannot be prompted again, so
      // it is cleared whatever the answer. A fresh one arrives on a later visit
      // if the app is still uninstalled.
      deferredRef.current = null;
      if (outcome === "accepted") {
        // `appinstalled` will also fire and hide the banner; this closes it
        // immediately rather than waiting for it, and records the same flag in
        // case that event is missed (it does not fire on every platform).
        dismissedRef.current = true;
        setMode(null);
        try {
          window.localStorage.setItem(INSTALLED_KEY, "1");
        } catch {
          /* storage blocked — in-session refs still hold */
        }
      } else {
        // Declining the OS dialog is a dismissal — nagging someone who just
        // said no in a system prompt is exactly the ambush this feature avoids.
        dismiss();
      }
    } catch {
      deferredRef.current = null;
      setMode(null);
    } finally {
      setInstalling(false);
    }
  }, [dismiss]);

  if (!mode || !consentAnswered) return null;

  // A small pill floating at the bottom-right corner rather than a full-width
  // bar, so it covers as little of the page as possible. It sits above the
  // phone's sticky ad bar when that is showing (globals.css, .install-prompt).
  // On iOS there is no install button to press, so tapping the pill opens the
  // two-step Share instruction in place.
  return (
    <div
      role="region"
      aria-label="Install BetGenius"
      className="install-prompt fixed right-3 z-50 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-brand-border bg-brand-card/95 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur sm:right-5"
    >
      <div className="flex items-center gap-2 py-1.5 pl-2 pr-1">
        {/* Same two-colourway mark as the nav, swapped in CSS — a white mark
            would vanish against the light theme's card. */}
        <Image src={BRAND_ICON_DARK} alt="" width={520} height={530} sizes="22px" className="brand-mark-dark h-[22px] w-auto shrink-0" />
        <Image src={BRAND_ICON_LIGHT} alt="" width={520} height={530} sizes="22px" className="brand-mark-light h-[22px] w-auto shrink-0" />
        {mode === "native" ? (
          <button
            type="button"
            onClick={install}
            disabled={installing}
            className="whitespace-nowrap rounded-lg bg-brand px-2.5 py-1 text-xs font-black text-on-brand transition hover:bg-brand-dark disabled:opacity-60"
          >
            {installing ? "Opening…" : "Get the app"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIosHelp((v) => !v)}
            aria-expanded={iosHelp}
            className="whitespace-nowrap rounded-lg bg-brand px-2.5 py-1 text-xs font-black text-on-brand transition hover:bg-brand-dark"
          >
            Get the app
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-brand-bg hover:text-gray-100"
        >
          <X size={14} />
        </button>
      </div>
      {mode !== "native" && iosHelp && (
        <p className="max-w-[14rem] border-t border-brand-border px-3 py-2 text-xs leading-snug text-gray-400">
          Tap <Share size={12} className="mx-0.5 inline align-[-1px]" aria-hidden="true" />
          <span className="font-medium text-gray-300">Share</span>, then{" "}
          <span className="font-medium text-gray-300">Add to Home Screen</span>.
        </p>
      )}
    </div>
  );
}
