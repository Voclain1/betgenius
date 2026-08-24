"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js once the page has settled.
 *
 * Deliberately not a <Script> tag: registration must happen after `load`, not
 * during it. A service worker registering mid-load competes with the very
 * requests it exists to make faster, and its install step then precaches the
 * shell while the first paint is still outstanding.
 *
 * Renders nothing, and fails silently. A browser with service workers disabled
 * (or a private window, or an insecure origin in local dev) must get the plain
 * web app, not an error — every feature here is an enhancement over a site that
 * already works without it.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
