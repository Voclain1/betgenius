/**
 * Asserts every rule the install banner enforces.
 *
 * The banner's failure modes are all "shown when it should not have been", and
 * those are invisible in a screenshot of a working case — a banner that appears
 * correctly on Android tells you nothing about whether it also appears inside
 * the installed app. So the decision is pure (src/lib/installPrompt.ts) and
 * every gate is asserted here, including the negative cases a browser test
 * cannot practically reach (an iPadOS user agent reporting itself as a Mac, a
 * matchMedia that throws).
 *
 * Run: npx tsx scripts/check-install-prompt.ts
 */
import {
  PAGEVIEWS_BEFORE_PROMPT,
  SECONDS_BEFORE_PROMPT,
  hasEngaged,
  isDismissedThisSession,
  isIosDevice,
  nextPageviewCount,
  isRunningStandalone,
  resolveInstallPrompt,
} from "../src/lib/installPrompt";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

// Minimal window stand-ins. `matchMedia` answers true only for the modes given.
const win = (opts: { modes?: string[]; iosStandalone?: boolean; noMatchMedia?: boolean; throws?: boolean } = {}) => ({
  ...(opts.noMatchMedia
    ? {}
    : {
        matchMedia: (q: string) => {
          if (opts.throws) throw new Error("matchMedia unsupported");
          return { matches: (opts.modes ?? []).some((m) => q.includes(m)) };
        },
      }),
  navigator: opts.iosStandalone === undefined ? {} : { standalone: opts.iosStandalone },
});

console.log("standalone detection — the banner must never show inside the installed app:");
eq("browser tab is not standalone", isRunningStandalone(win({ modes: ["browser"] })), false);
eq("display-mode: standalone is detected", isRunningStandalone(win({ modes: ["standalone"] })), true);
eq("display-mode: minimal-ui is detected", isRunningStandalone(win({ modes: ["minimal-ui"] })), true);
eq("display-mode: fullscreen is detected", isRunningStandalone(win({ modes: ["fullscreen"] })), true);
// iOS Safari implements no display-mode query at all, so this is the ONLY
// signal available there. Without it an installed iOS app keeps telling its
// user to install it.
eq("iOS navigator.standalone is detected", isRunningStandalone(win({ iosStandalone: true, modes: [] })), true);
eq("iOS navigator.standalone false is not standalone", isRunningStandalone(win({ iosStandalone: false, modes: [] })), false);
eq("a window without matchMedia does not crash", isRunningStandalone(win({ noMatchMedia: true })), false);
eq("a throwing matchMedia does not crash", isRunningStandalone(win({ throws: true })), false);

console.log("\niOS detection — including the iPadOS desktop-UA trap:");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD13 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const MAC = IPAD13;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
eq("iPhone is iOS", isIosDevice(IPHONE), true);
eq("Android is not iOS", isIosDevice(ANDROID), false);
// The two below share a byte-identical user agent and differ only in touch
// points. A UA-only check calls both "Mac" and shows an iPad a native install
// button that can never fire.
eq("iPadOS 13+ (desktop UA, touch) is iOS", isIosDevice(IPAD13, 5), true);
eq("a real Mac (same UA, no touch) is not iOS", isIosDevice(MAC, 0), false);

console.log("\ndismissal — scoped to the visit, not to a fixed window:");
// The key lives in sessionStorage, so "has the dismissal expired" is not a
// question this function answers any more — the browser answers it by dropping
// the key when the session ends. Presence is the whole test, which is why the
// old boundary/clock-skew cases are gone rather than merely relaxed.
eq("no stored value is not dismissed", isDismissedThisSession(null), false);
eq("an empty string is not dismissed", isDismissedThisSession(""), false);
eq("the written marker is a dismissal", isDismissedThisSession("1"), true);
// Anything we did not write fails towards SHOWING the banner. Cheap now: the
// worst case is one extra banner in one visit, where the 14-day version would
// have wrongly suppressed for a fortnight.
eq("a stale epoch timestamp is not a dismissal", isDismissedThisSession("1788451939128"), false);
eq("garbage is not a dismissal", isDismissedThisSession("not-a-marker"), false);
eq("zero is not a dismissal", isDismissedThisSession("0"), false);

console.log("\npageview counting — counts navigations, not effect runs:");
eq("a first view counts", nextPageviewCount({ storedCount: null, storedPath: null, path: "/" }), 1);
// The case that made a single dev page-load reach the threshold: React
// re-running the effect on the SAME path must not count again.
eq("a remount on the same path does NOT count again", nextPageviewCount({ storedCount: "1", storedPath: "/", path: "/" }), 1);
eq("a real navigation counts", nextPageviewCount({ storedCount: "1", storedPath: "/", path: "/fixtures" }), 2);
eq("returning to an earlier path still counts", nextPageviewCount({ storedCount: "2", storedPath: "/fixtures", path: "/" }), 3);
eq("a corrupt count restarts at 1", nextPageviewCount({ storedCount: "banana", storedPath: "/", path: "/" }), 1);
eq("a missing path with a count still advances", nextPageviewCount({ storedCount: "3", storedPath: null, path: "/" }), 4);

console.log("\nengagement — never on arrival, either signal suffices:");
eq("first page, zero seconds: not engaged", hasEngaged({ pageviews: 1, secondsOnPage: 0 }), false);
eq("first page, 39s: not engaged", hasEngaged({ pageviews: 1, secondsOnPage: SECONDS_BEFORE_PROMPT - 1 }), false);
eq("second page immediately: engaged", hasEngaged({ pageviews: PAGEVIEWS_BEFORE_PROMPT, secondsOnPage: 0 }), true);
eq("one page but 40s dwell: engaged", hasEngaged({ pageviews: 1, secondsOnPage: SECONDS_BEFORE_PROMPT }), true);

console.log("\nthe combined decision:");
const base = { standalone: false, dismissedThisSession: false, engaged: true, isIos: false, canPromptNatively: true };
eq("Android with a captured event shows the native banner", resolveInstallPrompt(base), "native");
eq("iOS shows the manual instructions", resolveInstallPrompt({ ...base, isIos: true, canPromptNatively: false }), "ios");
// The case that makes the iOS branch device-keyed rather than event-keyed: a
// Chrome user whose event has not arrived must see nothing, not Safari's
// Share-sheet copy.
eq("desktop Chrome with no event yet shows nothing", resolveInstallPrompt({ ...base, canPromptNatively: false }), null);
eq("installed app shows nothing even when engaged", resolveInstallPrompt({ ...base, standalone: true }), null);
eq("installed iOS app shows nothing", resolveInstallPrompt({ ...base, standalone: true, isIos: true, canPromptNatively: false }), null);
eq("a dismissal shows nothing for the rest of the visit", resolveInstallPrompt({ ...base, dismissedThisSession: true }), null);
// The whole point of the change: a dismissal does NOT carry into a new visit.
// sessionStorage is empty on a fresh session, so this input is false again and
// the reader is eligible — still behind the engagement gate asserted above.
eq("a new visit is eligible again once engaged", resolveInstallPrompt({ ...base, dismissedThisSession: false }), "native");
eq("a new visit is still gated on engagement", resolveInstallPrompt({ ...base, dismissedThisSession: false, engaged: false }), null);
// An install is the one answer that outlives the session.
eq("an install still outranks a fresh session", resolveInstallPrompt({ ...base, dismissedThisSession: false, knownInstalled: true }), null);
// A recorded appinstalled outlives the event and the component instance. The
// iOS case is the one that needs it: navigator.standalone is false in the
// Safari TAB, so without this someone who has just added the app to their home
// screen is told to add it again on their next page.
eq("a recorded install shows nothing", resolveInstallPrompt({ ...base, knownInstalled: true }), null);
eq("a recorded install suppresses the iOS branch too", resolveInstallPrompt({ ...base, knownInstalled: true, isIos: true, canPromptNatively: false }), null);
eq("an unengaged visitor shows nothing", resolveInstallPrompt({ ...base, engaged: false }), null);
eq("unengaged beats a captured event", resolveInstallPrompt({ ...base, engaged: false, canPromptNatively: true }), null);
// standalone must win over every other input, including a capturable event.
eq("standalone beats everything", resolveInstallPrompt({ standalone: true, dismissedThisSession: false, engaged: true, isIos: true, canPromptNatively: true }), null);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
