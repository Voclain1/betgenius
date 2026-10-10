"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CONSENT_REOPEN_EVENT, readConsent, reopenConsent, saveConsent, type ConsentChoice } from "@/lib/consent";

/**
 * The cookie banner. Asks once, before any analytics or advertising cookie is
 * set — GA4 and the Meta Pixel both start restricted and only switch on when
 * "Accept" is pressed (see lib/consent.ts).
 *
 * Accept and Reject are the same size and one tap each: refusing must be as
 * easy as agreeing, or the choice is not a real one.
 *
 * Bottom-anchored like InstallPrompt, which waits for this to be answered so
 * the two never stack. In the installed app it sits above the tab bar (see
 * .cookie-consent in globals.css). Mounted in the ROOT layout, unlike the
 * install prompt, because the tags it controls are in the root layout too —
 * /dashboard fires the purchase event.
 *
 * Renders nothing until mounted: the stored choice lives in localStorage, so
 * the server cannot know it, and rendering the banner on the server would
 * flash it at everyone who has already answered.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readConsent() === null);
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  const choose = (choice: ConsentChoice) => {
    saveConsent(choice);
    setOpen(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className="cookie-consent fixed inset-x-0 bottom-0 z-50 border-t border-brand-border bg-brand-card/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6">
        <p className="flex-1 text-sm leading-6 text-gray-300">
          <span className="font-semibold text-gray-100">Cookies for analytics and ads. </span>
          With your permission, we use Google Analytics and the Meta Pixel to see how the site is used and measure our
          adverts. Essential cookies for sign-in and settings are always on.{" "}
          <Link href="/cookie-policy" prefetch={false} className="font-medium text-brand underline">
            Cookie Policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("denied")} className="btn btn-ghost flex-1 justify-center text-sm sm:flex-none">
            Reject
          </button>
          <button type="button" onClick={() => choose("granted")} className="btn btn-primary flex-1 justify-center text-sm sm:flex-none">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/** The footer's way back into the choice. */
export function CookieSettingsLink() {
  return (
    <button type="button" onClick={reopenConsent} className="text-sm text-gray-400 hover:text-brand">
      Cookie settings
    </button>
  );
}
