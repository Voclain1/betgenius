/**
 * Decision logic for the home-screen install banner.
 *
 * Pure functions, no DOM and no React, so every rule the banner enforces can be
 * asserted directly (see scripts/check-install-prompt.ts) rather than only
 * observed by driving a browser. The component in
 * src/components/InstallPrompt.tsx owns the events and the rendering; this file
 * owns the question "should it be on screen at all".
 *
 * Three rules, and the order matters — each is a hard gate before the next:
 *
 *   1. NEVER when already installed. A banner asking someone to install the app
 *      they are currently using inside the app is the worst version of this
 *      feature. Checked two ways because the platforms disagree: the
 *      display-mode media query (Android/desktop) and navigator.standalone
 *      (iOS, which supports no such query).
 *   2. NEVER again for the rest of THIS VISIT once dismissed. Dismissal stops
 *      the nagging within a sitting without permanently closing the door: the
 *      next visit is a fresh ask.
 *   3. ONLY after real engagement. Not on arrival.
 */

/**
 * sessionStorage key marking the banner dismissed for this visit.
 *
 * DELIBERATELY sessionStorage, not localStorage. A dismissal is scoped to the
 * visit: it stops the banner following someone around while they read four
 * pages in one sitting, and it expires when that sitting does, so a returning
 * reader is eligible to be asked again. The browser owns the definition of "the
 * visit" — sessionStorage is cleared when the tab goes — which is a more honest
 * boundary than any duration this file could invent.
 *
 * It shares its lifetime with PAGEVIEW_KEY below, and that pairing is what
 * makes a new visit safe rather than annoying: the counter resets alongside the
 * dismissal, so the returning reader still has to clear the engagement gate
 * before anything appears. They can never land on the banner.
 *
 * The value is only ever "1" — presence is the whole signal. Nothing here needs
 * a timestamp now that the browser decides when the key disappears.
 */
export const DISMISS_KEY = "betgenius:install-prompt-dismissed";

/**
 * The previous localStorage key, holding an epoch-ms dismissal timestamp under
 * a 14-day window. Kept here ONLY so the component can delete it: it is written
 * into real browsers already, and without this it would sit in visitors'
 * storage forever with nothing left that reads it.
 */
export const LEGACY_DISMISS_KEY = "betgenius:install-prompt-dismissed-at";

/** sessionStorage key holding this session's page-view count. */
export const PAGEVIEW_KEY = "betgenius:pageviews";

/**
 * sessionStorage key holding the path the counter last credited.
 *
 * The counter must count PAGE VIEWS, and a component remount is not one. React
 * remounts for several reasons that have nothing to do with the reader moving:
 * StrictMode deliberately double-invokes effects (React 18), and a Suspense or
 * error boundary can tear down and rebuild a subtree on the same page.
 *
 * Without this the engagement gate is reachable without engaging — measured in
 * `next dev`, a single load of "/" left the counter on 2, which is the
 * threshold, so the banner would have been eligible on the very first page.
 * Production does not double-invoke, so this was not a live defect, but the
 * gate should hold because the counting is right rather than because one
 * environment happens not to trip it.
 */
export const PAGEVIEW_PATH_KEY = "betgenius:pageviews-last-path";

/**
 * The counter's next value for `path`, given what is already stored.
 *
 * Returns the unchanged count when this path was the one last credited, so
 * repeated effect runs on a single page are idempotent while a genuine
 * navigation still counts.
 */
export function nextPageviewCount(input: {
  storedCount: string | null;
  storedPath: string | null;
  path: string;
}): number {
  const current = Number(input.storedCount);
  const count = Number.isFinite(current) && current > 0 ? current : 0;
  if (input.storedPath === input.path && count > 0) return count;
  return count + 1;
}

/**
 * localStorage key set once the app has been installed from this browser.
 *
 * The `appinstalled` event fires ONCE, and only in the tab that was open at the
 * time. Remembering it only in component state is not enough: the reader who
 * installs and then carries on browsing gets a fresh mount on their next
 * navigation, with no event to tell it what just happened.
 *
 * On Android that is usually masked — Chrome stops firing beforeinstallprompt
 * once the app is installed, so there is nothing left to show. On iOS nothing
 * masks it: that branch is keyed off the DEVICE, and `navigator.standalone` is
 * false in the Safari TAB (it is only true inside the launched app), so someone
 * who had just added the app to their home screen would be told to add it again
 * on their very next page. This key is what closes that.
 */
export const INSTALLED_KEY = "betgenius:install-prompt-installed";

/**
 * Engagement gates. EITHER is enough — they catch different visitors.
 *
 * A reader who lands on the homepage and clicks straight into a match page is
 * engaged after two views but perhaps twenty seconds. A reader who lands on one
 * long match page and stays is engaged without navigating at all. Requiring
 * both would silently exclude the second, which on a tips site is the more
 * interested visitor.
 */
export const PAGEVIEWS_BEFORE_PROMPT = 2;
export const SECONDS_BEFORE_PROMPT = 40;

/**
 * True when the page is running as an installed app rather than in a browser tab.
 *
 * `display-mode: standalone` covers Android, desktop Chrome/Edge and anything
 * honouring the manifest. `navigator.standalone` is the iOS-only equivalent:
 * Safari implements no display-mode query, so without this an installed iOS app
 * would keep showing "Add to Home Screen" instructions to someone who already
 * had. `minimal-ui` and `fullscreen` are included because a manifest change to
 * either must not silently switch the banner back on.
 */
export function isRunningStandalone(win: {
  matchMedia?: (query: string) => { matches: boolean };
  // Deliberately `unknown` rather than `{ standalone?: boolean }`: the real
  // Navigator type has no `standalone` (it is a non-standard Safari extension),
  // so a structural type naming it shares no properties with Navigator and the
  // real `window` fails to satisfy it. Narrowed at the use site instead.
  navigator?: unknown;
}): boolean {
  const nav = win.navigator as { standalone?: boolean } | undefined;
  if (nav?.standalone === true) return true;
  // Hoisted: narrowing `win.matchMedia` does not survive into the callback below.
  const matchMedia = win.matchMedia;
  if (typeof matchMedia !== "function") return false;
  return ["standalone", "minimal-ui", "fullscreen"].some((mode) => {
    try {
      return matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
}

/**
 * iOS, including iPadOS 13+.
 *
 * The second test is not defensive padding: since iPadOS 13 an iPad reports a
 * desktop "Macintosh" user agent, so a UA-only check treats every iPad as a Mac
 * and shows it a beforeinstallprompt banner that can never fire. Touch points
 * are what separate an iPad from a real Mac, and a Mac reports 0.
 */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Whether the banner was dismissed during THIS visit.
 *
 * Presence is the entire test — there is no window to be inside or outside of,
 * because the browser clears the key when the session ends. That removes the
 * clock arithmetic the previous 14-day version needed, and with it the
 * boundary, corrupt-timestamp and clock-moved-backwards cases it had to defend
 * against: a value that is not the one we wrote is not a dismissal.
 *
 * Failing towards SHOWING the banner on an unrecognised value is the right
 * direction here for the same reason as before — a corrupted key must not be
 * able to suppress the feature — and it is now a much cheaper mistake, since
 * the worst case is one extra banner in one visit rather than a fortnight of
 * wrongly suppressed ones.
 */
export function isDismissedThisSession(raw: string | null): boolean {
  return raw === "1";
}

/** Engagement gate — either signal is sufficient. See the note on the constants. */
export function hasEngaged(input: { pageviews: number; secondsOnPage: number }): boolean {
  return input.pageviews >= PAGEVIEWS_BEFORE_PROMPT || input.secondsOnPage >= SECONDS_BEFORE_PROMPT;
}

/** What the banner should render, or null for nothing at all. */
export type InstallPromptMode = "native" | "ios";

/**
 * The whole decision in one place.
 *
 * `canPromptNatively` is whether a beforeinstallprompt event was captured. On
 * iOS it never will be, which is exactly why the iOS branch is keyed off the
 * device rather than off the absence of the event — a Chrome user who simply
 * has not triggered the event yet must not be shown Safari's Share-sheet
 * instructions.
 */
export function resolveInstallPrompt(input: {
  standalone: boolean;
  /**
   * A previously recorded `appinstalled` on this origin — see INSTALLED_KEY.
   * Unlike `dismissedThisSession` this one is permanent: installing is a
   * different answer from "not now", and it does not expire with the visit.
   */
  knownInstalled?: boolean;
  /** Dismissed during this visit — see DISMISS_KEY. Expires with the session. */
  dismissedThisSession: boolean;
  engaged: boolean;
  isIos: boolean;
  canPromptNatively: boolean;
}): InstallPromptMode | null {
  if (input.standalone || input.knownInstalled || input.dismissedThisSession || !input.engaged) return null;
  if (input.canPromptNatively) return "native";
  if (input.isIos) return "ios";
  return null;
}

/**
 * True when the page is running inside the Android TWA rather than a plain
 * installed PWA.
 *
 * A Trusted Web Activity launches the origin from a native Android container,
 * and the only signal that distinguishes it from a home-screen PWA is the
 * referrer: Android sets `android-app://<package>` on the launch navigation.
 * `display-mode: standalone` matches in BOTH cases, so it cannot tell them
 * apart — which is why this exists separately rather than as another branch of
 * isRunningStandalone.
 *
 * INFORMATIONAL ONLY. The app chrome is deliberately identical for a TWA and a
 * home-screen PWA: they are the same app to the person using it, and forking
 * the navigation on packaging would mean two layouts to keep in step for no
 * user-visible reason. This is exposed so the distinction is *available* (an
 * analytics dimension, a Play-Store-only affordance later) without anything
 * currently depending on it.
 *
 * The referrer is only set on the LAUNCH navigation. A client-side route change
 * does not clear it (Next does not touch document.referrer), but a full page
 * reload deeper in the app will, so this is a best-effort signal and nothing
 * load-bearing may be built on its absence.
 *
 * MUST stay self-contained — see the note on APP_SHELL_INIT_SCRIPT in
 * src/lib/appShell.ts, which embeds this function's own source.
 */
export function isTrustedWebActivity(doc: { referrer?: string }): boolean {
  return typeof doc.referrer === "string" && doc.referrer.startsWith("android-app://");
}
