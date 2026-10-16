"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AdFrame } from "@/components/ads/AdUnit";
import { AdLabel } from "@/components/ads/AdPlacements";

const CLOSED_KEY = "betgenius:sticky-ad-closed";

/**
 * The phone's bottom bar: one 320x50, pinned to the foot of the screen.
 *
 * PHONES ONLY (sm:hidden). On a wider screen the in-content bands and the rail
 * already carry the inventory, and a pinned bar there reads as clutter.
 *
 * THE BOTTOM EDGE IS SHARED, and this bar always yields:
 *   - the app install banner and the cookie notice are fixed to the same edge;
 *     while either is open this bar is hidden (globals.css, `.ad-sticky`), so
 *     it can never cover them;
 *   - in the installed app it sits ABOVE the tab bar rather than over it;
 *   - the body gets matching bottom padding while it shows, so the footer and
 *     the last of the page are never underneath it.
 *
 * CLOSABLE for the rest of the visit, with the close control outside the
 * creative's box so it cannot be mistaken for, or misfire into, the ad.
 *
 * Mounted only by reader layouts and pages that already carry ads (never
 * the public layout), so the ad-free routes in src/lib/ads.ts stay ad-free and
 * scripts/check-ad-placement.ts can still prove it.
 */
export function AdStickyMobile() {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(CLOSED_KEY)) setClosed(true);
    } catch {
      // Storage blocked: the bar stays closable for this page view.
    }
  }, []);

  if (closed) return null;

  const close = () => {
    setClosed(true);
    try {
      window.sessionStorage.setItem(CLOSED_KEY, "1");
    } catch {
      // Closed for this page view only.
    }
  };

  return (
    <aside
      aria-label="Advertisement"
      className="ad-sticky fixed inset-x-0 bottom-0 z-40 border-t border-brand-border bg-brand-card/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative flex justify-center pb-1.5 pt-5">
        <AdLabel />
        <button
          type="button"
          onClick={close}
          aria-label="Close ad"
          className="absolute right-1 top-0 inline-flex h-7 w-7 items-center justify-center text-gray-400 hover:text-gray-100"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
        <AdFrame id="mobileBanner" />
      </div>
    </aside>
  );
}
