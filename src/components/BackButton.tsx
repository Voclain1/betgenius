"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Every destination reachable from the nav, plus the auth/account entry
 * points. These are the "you are already at a root" pages — a back button on
 * them would either be a no-op or send someone out of the site, so they don't
 * get one. Everything deeper (a match, a team, a league, pricing) does.
 *
 * Kept as an explicit set rather than a depth heuristic because depth doesn't
 * separate them: /predictions/today is a nav destination and
 * /predictions/match/x is not, and both are two segments below the root.
 */
const ROOT_PATHS = new Set([
  "/",
  "/predictions",
  "/predictions/today",
  "/predictions/genius",
  "/predictions/featured",
  "/predictions/banker",
  "/predictions/same-game-doubles",
  "/predictions/vip",
  "/predictions/premium",
  "/bet-builder",
  "/combos",
  "/track-record",
  "/livescores",
  "/fixtures",
  "/standings",
  "/statspad",
  "/login",
  "/register",
  "/dashboard",
  "/admin",
]);

function normalize(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/**
 * Where to land when there is no in-app history to pop — a page opened cold
 * from a search result or a shared link. Section root, not "/", so a match
 * page arrived at from Google backs out to the tips index rather than dumping
 * the visitor on the homepage.
 */
function fallbackHref(pathname: string) {
  if (pathname.startsWith("/predictions/")) return "/predictions";
  if (pathname.startsWith("/admin/")) return "/admin";
  return "/";
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Whether this session has navigated client-side at least once, which is
   * the only reliable signal that router.back() has somewhere of ours to go.
   * `window.history.length` counts entries from before the site was opened,
   * and `document.referrer` is frozen at the initial document load, so
   * neither answers the question after a client-side navigation.
   *
   * The component renders on every page (it decides to show nothing on root
   * pages, rather than being mounted conditionally), so this effect sees the
   * whole journey, not just the pages with a visible button.
   */
  const hasNavigated = useRef(false);
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== firstPath.current) hasNavigated.current = true;
  }, [pathname]);

  const current = normalize(pathname ?? "/");
  if (ROOT_PATHS.has(current)) return null;

  function onClick() {
    if (hasNavigated.current) router.back();
    else router.push(fallbackHref(current));
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Go back"
      // md:hidden — desktop already has the full nav bar visible and the
      // browser chrome's own back button in easy reach; this is for the
      // mobile bar. Sized to match the hamburger on the other end of the
      // same row so the header stays visually balanced.
      className="btn btn-ghost -ml-1 p-2 md:hidden"
    >
      <ChevronLeft size={20} />
    </button>
  );
}
