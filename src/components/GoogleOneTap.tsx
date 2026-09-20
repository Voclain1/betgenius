"use client";

import { useEffect, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  GIS_SCRIPT_SRC,
  ONE_TAP_DISMISSED_KEY,
  dismissedRecently,
  oneTapSupported,
  shouldInitializeOneTap,
} from "@/lib/googleOneTap";

/**
 * Google One Tap for signed-out visitors.
 *
 * WHAT THIS DOES NOT DO: it does not read the visitor's Chrome account, their
 * email, or anything else about them. It loads Google Identity Services and
 * asks it to consider prompting. Everything shown is rendered and controlled
 * by Google in its own frame, positioned top-right by the browser/GIS — this
 * component never sees an identity unless the visitor actively chooses one,
 * and then only as a signed token it immediately hands to the server to verify.
 *
 * The token goes to NextAuth's one-tap provider, which verifies the signature,
 * audience, issuer and expiry before anything is read from it. Nothing here
 * trusts the credential; this file's whole job is to obtain it and pass it on.
 *
 * DEGRADES TO NOTHING. No document, cookies disabled, script blocked, GIS
 * unavailable, mobile browser that declines to show it — every one of those
 * paths ends with no prompt and no error. The ordinary "Continue with Google"
 * button on /login and /register is the fallback in all of them, which is why
 * this is allowed to be strictly best-effort.
 */

type CredentialResponse = { credential?: string };

type GsiNotification = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          prompt: (listener?: (n: GsiNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

function loadGis(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(!!window.google?.accounts?.id), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    // A blocked script (ad blocker, offline, CSP) resolves false rather than
    // rejecting — there is nothing to recover from and nothing to report.
    script.addEventListener("load", () => resolve(!!window.google?.accounts?.id), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

export function GoogleOneTap() {
  const { status } = useSession();
  const pathname = usePathname();
  // One initialization per page load. GIS is a global singleton; calling
  // initialize() again on every navigation re-registers the callback and can
  // re-prompt someone who just closed it.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (typeof window === "undefined") return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    let dismissed = false;
    try {
      dismissed = dismissedRecently(window.localStorage.getItem(ONE_TAP_DISMISSED_KEY));
    } catch {
      // Blocked storage: treat as not dismissed. Google's own cool-down still
      // applies on top, so this cannot become a nag.
      dismissed = false;
    }

    const eligible = shouldInitializeOneTap({
      status,
      pathname,
      configured: !!clientId,
      supported: oneTapSupported({
        hasDocument: typeof document !== "undefined",
        cookieEnabled: typeof navigator !== "undefined" && navigator.cookieEnabled !== false,
      }),
      dismissed,
    });
    // Returns WITHOUT loading the script. A signed-in user never fetches GIS at
    // all — the gate is not merely "do not show", it is "do not participate".
    if (!eligible) return;

    startedRef.current = true;
    let cancelled = false;

    void (async () => {
      const ready = await loadGis();
      if (cancelled || !ready) return;
      const id = window.google?.accounts?.id;
      if (!id) return;

      try {
        id.initialize({
          client_id: clientId,
          // FedCM is the browser-mediated path Chrome is moving to, and is
          // required for the prompt to keep working as third-party cookies go
          // away. It also puts placement and dismissal under the browser rather
          // than under us, which is the behaviour large sites show.
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: true,
          auto_select: false,
          callback: async (response: CredentialResponse) => {
            if (!response?.credential) return;
            // redirect:false so a failed sign-in (e.g. the email belongs to a
            // password account) leaves the visitor where they are instead of
            // bouncing them to an error page they did not ask for.
            const result = await signIn("google-one-tap", { credential: response.credential, redirect: false });
            if (result?.ok) {
              // Full reload rather than router.refresh(): the session cookie
              // was just set, and a reload is what makes every server component
              // on the page re-render as the signed-in user.
              window.location.reload();
            } else {
              // The most likely refusal by far is the account-linking policy:
              // this email already has a password account. Send them to the
              // page that explains it, the same destination the Google button's
              // equivalent failure uses.
              window.location.href = "/login?error=account-exists";
            }
          },
        });

        id.prompt((notification) => {
          // Google declined to show it, or the visitor closed it. Both are a
          // "no" worth remembering, so the prompt does not reappear on the next
          // page view. Google applies its own cool-down too; this is ours.
          const closed =
            notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.() || notification?.isDismissedMoment?.();
          if (!closed) return;
          try {
            window.localStorage.setItem(ONE_TAP_DISMISSED_KEY, String(Date.now()));
          } catch {
            /* storage blocked — Google's own suppression still applies */
          }
        });
      } catch {
        // GIS threw (misconfigured origin, unsupported environment). Nothing to
        // show and nothing to recover: the ordinary button still works.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, pathname]);

  // Renders nothing. The prompt is Google's own UI, injected and positioned by
  // GIS; there is no element of ours for it to attach to.
  return null;
}
