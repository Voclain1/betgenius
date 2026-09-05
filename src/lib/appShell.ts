/**
 * Runtime context for the navigation chrome: browser tab vs installed app.
 *
 * This file owns WHERE the answer is written and WHAT the app chrome is. It
 * deliberately owns none of the detection — that lives in
 * src/lib/installPrompt.ts, is already covered by
 * scripts/check-install-prompt.ts, and is embedded here by reference rather
 * than restated. See APP_SHELL_INIT_SCRIPT.
 *
 * NOTHING about the pages changes in app context. Every route, every data
 * source and every page body is identical in both; only the chrome around them
 * differs, and it differs by CSS keyed off one attribute on <html>.
 */
import { isRunningStandalone, isTrustedWebActivity } from "@/lib/installPrompt";

/**
 * Set to "true" on <html> when the page is running as an installed app.
 *
 * An attribute on the document element rather than React state, because the
 * chrome has to be right in the FIRST PAINT. A useEffect answer arrives after
 * hydration, which would show the website's top nav for a frame every time the
 * app is opened and then swap it — the flash of wrong chrome that makes a PWA
 * feel like a bookmark. CSS keyed off an attribute set by a blocking script has
 * no such frame, and it costs no JavaScript on the render path at all.
 *
 * Same technique, and the same reason, as THEME_INIT_SCRIPT in src/lib/theme.ts.
 */
export const STANDALONE_ATTR = "data-standalone";

/**
 * Set to "twa" or "pwa" alongside STANDALONE_ATTR when installed; absent in a
 * browser tab. Informational — see isTrustedWebActivity. No CSS or component
 * currently branches on it, by design.
 */
export const APP_SHELL_ATTR = "data-app-shell";

/**
 * The pre-paint script, built from the DETECTION FUNCTIONS THEMSELVES.
 *
 * `isRunningStandalone.toString()` embeds the exact, already-tested
 * implementation rather than a second copy of its rules written out for the
 * inline script. That is the whole point: a hand-written duplicate of the
 * display-mode list and the navigator.standalone branch is precisely the thing
 * that drifts the day someone adds a fourth display mode to one of the two.
 * There is only one implementation here, and it is the one the unit tests
 * already assert against.
 *
 * THE CONSTRAINT THIS BUYS, AND ITS PRICE: both embedded functions must stay
 * SELF-CONTAINED — parameters and literals only, no imports, no module-scope
 * constants, no helpers. A stringified function carries its source, not its
 * closure, so a reference to anything outside itself becomes a ReferenceError
 * inside this script and the app silently renders web chrome forever. Both are
 * written that way today and both carry a comment saying so, and
 * scripts/check-app-shell.ts evaluates this exact string against stand-in
 * windows so the guarantee is asserted rather than trusted.
 *
 * Wrapped in try/catch and an IIFE: this runs before anything else on every
 * page, so a throw here would take the document with it. Failing silently means
 * failing to web chrome, which is the correct direction — the site works
 * either way, and the browser experience is the one that must never break.
 */
export const APP_SHELL_INIT_SCRIPT = `(function(){try{
var standalone=${isRunningStandalone.toString()};
var twa=${isTrustedWebActivity.toString()};
if(standalone(window)){
var e=document.documentElement;
e.setAttribute(${JSON.stringify(STANDALONE_ATTR)},"true");
e.setAttribute(${JSON.stringify(APP_SHELL_ATTR)},twa(document)?"twa":"pwa");
}
}catch(e){}})();`;

/** One destination in the installed app's bottom tab bar. */
export type AppTab = {
  href: string;
  label: string;
  /** Icon name from lucide-react — resolved in the component, not here, so this stays a plain data module. */
  icon: "sparkles" | "radio" | "calendar" | "layers" | "user";
  /**
   * Paths that light this tab up. Prefix-matched, longest wins, so
   * /predictions/match/x lights "Tips" without Tips also claiming /livescores.
   */
  match: string[];
};

/**
 * The five tabs, chosen from what the codebase already says is primary rather
 * than from a general sense of what betting apps have:
 *
 *   TIPS, LIVE, FIXTURES — the same three subjects as the `shortcuts` already
 *   declared in src/app/manifest.ts. That list was written for precisely this
 *   context (long-press the installed icon) and is the closest thing the
 *   project has to a stated app-context priority, so the tab bar agrees with it
 *   instead of inventing a competing ranking.
 *
 *   The SUBJECTS match; one destination deliberately does not. The manifest's
 *   "Today's tips" shortcut points at /predictions/today, and this tab points
 *   at the /predictions index. That is not drift: a shortcut is a jump to one
 *   specific thing, whereas a tab is a section the reader lives in and returns
 *   to. See the note on the Tips entry below.
 *
 *   BUILDER — from PRIMARY_LINKS in Nav.tsx, and the only interactive tool on
 *   the site. A tool is app-shaped in a way a list of articles is not.
 *
 *   ACCOUNT — subscription state is what gates half the product, so the way to
 *   see and fix it cannot be three taps into a drawer.
 *
 * Track Record is NOT here, and that is the one deliberate departure from the
 * top nav's PRIMARY_LINKS. It is the page that convinces a first-time visitor
 * the site is honest — a read-once trust artifact, heavily web-oriented — and
 * a tab is for what someone opens repeatedly having ALREADY been convinced. It
 * stays one tap away in the top bar's menu, and in the footer.
 *
 * Five is the ceiling, not a target: below ~64px a tab's label wraps and its
 * tap target drops under the 44px minimum.
 */
export const APP_TABS: AppTab[] = [
  // The SECTION index, not a category within it. This tab stays lit across the
  // whole /predictions subtree (see `match`), so landing it on one category
  // would light "Tips" while the reader browses VIP or Genius having never been
  // offered the choice — the destination and the highlight would describe
  // different things. /predictions lists every category, so the tap and the
  // highlight agree.
  { href: "/predictions", label: "Tips", icon: "sparkles", match: ["/predictions"] },
  { href: "/livescores", label: "Live", icon: "radio", match: ["/livescores"] },
  { href: "/fixtures", label: "Fixtures", icon: "calendar", match: ["/fixtures"] },
  { href: "/bet-builder", label: "Builder", icon: "layers", match: ["/bet-builder"] },
  // Resolved to /login for a signed-out visitor by the component — the tab is
  // "your account", and sending someone to a dashboard that redirects is a
  // worse answer than sending them to the sign-in they actually need.
  { href: "/dashboard", label: "Account", icon: "user", match: ["/dashboard", "/login", "/register", "/pricing"] },
];

/**
 * The tab whose section `pathname` belongs to, or null when the current page
 * sits under none of them (a legal page, /standings, /statspad).
 *
 * Longest prefix wins so the tabs cannot both claim a path, and a null result
 * is a real answer rather than a fallback to the first tab: highlighting "Tips"
 * while someone reads the cookie policy would be a lie about where they are.
 *
 * Pure, so scripts/check-app-shell.ts can assert the whole matrix.
 */
export function activeTab(pathname: string, tabs: AppTab[] = APP_TABS): AppTab | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  let best: { tab: AppTab; length: number } | null = null;
  for (const tab of tabs) {
    for (const prefix of tab.match) {
      // Segment-boundary check, not a bare startsWith: "/fixtures" must not
      // light up for a hypothetical "/fixtures-archive".
      if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
      if (!best || prefix.length > best.length) best = { tab, length: prefix.length };
    }
  }
  return best?.tab ?? null;
}
