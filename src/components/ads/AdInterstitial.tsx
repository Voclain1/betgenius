"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { sandboxFor } from "@/components/ads/AdUnit";
import { AD_FREE_ROUTES, INTERSTITIAL_FRAME_ID, adFrameSrc, adsAreCrossOrigin } from "@/lib/ads";

const STATE_KEY = "betgenius:interstitial";

/** Page views between interstitials: the landing page and two more, then one on the next link. */
export const INTERSTITIAL_EVERY_VIEWS = 3;
/** And never more often than this, however fast someone clicks through. */
export const INTERSTITIAL_MIN_GAP_MS = 3 * 60_000;
/** Seconds before "Continue" appears. */
export const INTERSTITIAL_COUNTDOWN_S = 5;

/**
 * Destinations an interstitial never stands in front of: the ad-free reader
 * routes, the product surfaces, and anything in the sign-up or payment flow,
 * where an ad between a reader and a purchase costs more than it earns.
 */
const NO_INTERSTITIAL_BEFORE = [...AD_FREE_ROUTES, "/admin", "/dashboard", "/account", "/checkout", "/api", "/ads"];

type State = { views: number; lastShownAt: number };

function readState(): State {
  try {
    const raw = window.sessionStorage.getItem(STATE_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<State>) : {};
    return { views: Number(s.views) || 0, lastShownAt: Number(s.lastShownAt) || 0 };
  } catch {
    return { views: 0, lastShownAt: 0 };
  }
}

function writeState(s: State) {
  try {
    window.sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: no interstitial can be scheduled, which is the safe failure.
  }
}

/** Pure: whether a click on `href` from `here` should be held for an interstitial. */
export function shouldInterrupt(state: State, now: number, here: URL, href: URL): boolean {
  if (href.origin !== here.origin) return false;
  if (href.pathname === here.pathname) return false; // same page, hash or query change
  if (NO_INTERSTITIAL_BEFORE.some((p) => href.pathname === p || href.pathname.startsWith(`${p}/`))) return false;
  if (state.views < INTERSTITIAL_EVERY_VIEWS) return false;
  return now - state.lastShownAt >= INTERSTITIAL_MIN_GAP_MS;
}

/**
 * The between-pages ad: a reader taps a link to another page on the site, a
 * full-screen panel shows Adsterra's Social Bar interstitial in a sandboxed
 * frame covering the screen (with a 300x250 underneath when the network has
 * nothing to show), and after a short countdown "Continue" takes them where
 * they were going.
 *
 * Frequency is capped twice — every INTERSTITIAL_EVERY_VIEWS page views and no
 * sooner than INTERSTITIAL_MIN_GAP_MS apart — and the count starts on the page
 * a reader lands on, so someone arriving from search never meets one first.
 * That is also what keeps it within Google's guidance on intrusive mobile
 * interstitials, which targets ads covering the page a searcher asked for.
 *
 * Paying VIP and Premium readers never see it. The session's tier is a
 * display-only snapshot (see src/lib/auth.ts), which is fine here: the worst
 * a stale one does is show or skip one ad.
 *
 * Mounted beside AdStickyMobile, by the reader layouts and pages that already
 * carry ads, so the ad-free routes stay ad-free in both directions: no
 * interstitial on them, and none in front of them.
 */
export function AdInterstitial() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [target, setTarget] = useState<string | null>(null);
  const [left, setLeft] = useState(INTERSTITIAL_COUNTDOWN_S);
  const continueRef = useRef<HTMLButtonElement>(null);

  const user = session?.user as { tier?: string; subStatus?: string } | undefined;
  const subscriber = !!user && user.tier !== "FREE" && user.subStatus === "ACTIVE";

  // One view per page the component is mounted on. A route change by any
  // other means (the back button) also closes a panel still open.
  useEffect(() => {
    const s = readState();
    writeState({ ...s, views: s.views + 1 });
    setTarget(null);
  }, [pathname]);

  useEffect(() => {
    // Until the session resolves we cannot tell a subscriber from anyone else.
    if (status === "loading" || subscriber) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.closest("[data-ad-unit]")) return;
      const href = new URL(a.href, window.location.href);
      if (!shouldInterrupt(readState(), Date.now(), new URL(window.location.href), href)) return;
      // Capture phase, before next/link's own handler, which stands down when
      // the click has already been prevented.
      e.preventDefault();
      writeState({ views: 0, lastShownAt: Date.now() });
      setLeft(INTERSTITIAL_COUNTDOWN_S);
      setTarget(href.pathname + href.search + href.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [status, subscriber]);

  useEffect(() => {
    if (!target || left <= 0) return;
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [target, left]);

  useEffect(() => {
    if (target && left <= 0) continueRef.current?.focus();
  }, [target, left]);

  // Prefetch while the ad shows, so the page is ready when they continue.
  useEffect(() => {
    if (target) router.prefetch(target);
  }, [target, router]);

  const proceed = useCallback(() => {
    if (!target) return;
    setTarget(null);
    router.push(target);
  }, [target, router]);

  // Lock the page behind the panel while it is open.
  useEffect(() => {
    if (!target) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [target]);

  if (!target) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Advertisement" className="fixed inset-0 z-[60] bg-brand-bg">
      {/* The frame takes the WHOLE screen, edge to edge: the Social Bar
          interstitial sizes itself to the frame, so every pixel given to our
          own chrome is a pixel taken from the creative. The label and the
          Continue control float over it instead of taking rows of their own.
          The 300x250 fallback sits centred underneath
          (src/app/ads/frame/route.ts). Sandboxed like every other unit. */}
      <iframe
        title="Advertisement"
        src={adFrameSrc(INTERSTITIAL_FRAME_ID)}
        sandbox={sandboxFor(adsAreCrossOrigin())}
        referrerPolicy="strict-origin"
        className="absolute inset-0 block h-full w-full border-0"
        style={{ colorScheme: "normal" }}
      />
      <div
        className="pointer-events-none absolute left-3 rounded-md bg-brand-bg px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        Ad
      </div>
      <div className="absolute inset-x-0 flex justify-center" style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
        {left > 0 ? (
          <p className="rounded-full bg-brand-bg px-4 py-2 text-sm font-semibold tabular-nums text-gray-300 shadow-lg" aria-live="polite">
            Continue in {left}s
          </p>
        ) : (
          <button ref={continueRef} type="button" onClick={proceed} className="btn btn-primary rounded-full px-6 py-3 text-sm font-bold shadow-lg">
            Continue to page →
          </button>
        )}
      </div>
    </div>
  );
}
