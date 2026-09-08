/**
 * The Adsterra inventory, as data.
 *
 * WHY THIS IS A MODULE AND NOT SEVEN PASTED SCRIPT TAGS.
 *
 * The tags Adsterra hands you cannot be pasted twice into one document. Every
 * banner unit is configured by assigning to a BARE GLOBAL called `atOptions`
 * and then loading `invoke.js`, which reads that global when it runs. Two units
 * on one page therefore race: whichever `atOptions` assignment ran last is the
 * one BOTH invoke.js loads observe, so a 728x90 and a 300x250 on the same page
 * render as two copies of the same unit — or, when the sizes disagree with the
 * slot, as one blank box. It fails silently and it fails in production, not in
 * a build.
 *
 * The fix is not to serialise the loads, which is fragile and still racy under
 * React's concurrent rendering. It is to give each unit its own global scope:
 * every banner below is loaded in its own iframe, whose document is served by
 * src/app/ads/frame/route.ts, so `atOptions` is a global of THAT frame's
 * window and nothing else on the page can see or clobber it. The frame is also
 * what keeps third-party ad JS off our main thread and out of our origin — it
 * is sandboxed onto an opaque origin, so the ad script cannot reach our
 * cookies, our storage or our DOM.
 *
 * The Native Banner is the exception and is described on its own entry.
 *
 * DIMENSIONS ARE LOAD-BEARING. Every `width`/`height` here is used twice: once
 * inside the frame as the `atOptions` the network is configured with, and once
 * outside it as the reserved box the slot paints before anything loads. That is
 * what makes these units cost zero Cumulative Layout Shift — the space is the
 * right size from the first paint, whether the ad ever fills it or not. The two
 * uses must not be allowed to drift apart, so they read from this one record;
 * scripts/check-ad-placement.ts asserts they still do.
 */

/** A fixed-size banner: `atOptions` + invoke.js, isolated in its own frame. */
export type IframeAdUnit = {
  kind: "iframe";
  /** Stable slot name used in markup (`data-ad-unit`) and by the guard script. */
  id: string;
  /** Adsterra's unit key. Also forms the invoke.js path — see invokeUrl(). */
  key: string;
  width: number;
  height: number;
};

/**
 * The Native Banner: a different product on a different domain, and the only
 * unit here that is NOT configured through `atOptions`. It takes its key from
 * the script URL and renders into a container div the script finds by id, so
 * two native units could coexist on one page without racing. It is still
 * isolated the same way as the banners — not because it has to be, but because
 * its height is decided by the network at fill time, and an inline unit whose
 * height is not knowable in advance is exactly the thing that produces layout
 * shift. Inside a frame the reflow happens in a document whose size the page
 * has already committed to. `reservedHeight` is that committed size.
 */
export type NativeAdUnit = {
  kind: "native";
  id: string;
  src: string;
  containerId: string;
  reservedHeight: number;
};

export type AdUnitSpec = IframeAdUnit | NativeAdUnit;

/** Where invoke.js lives for a banner unit. The key is both config and path. */
export const invokeUrl = (key: string) => `https://www.highrevenueformat.com/${key}/invoke.js`;

export const AD_UNITS = {
  /** Desktop leaderboard. Paired with `mobileBanner` — see AdLeaderboard. */
  leaderboard: { kind: "iframe", id: "leaderboard", key: "13ccca55cf87531dcaaf795858c1c59d", width: 728, height: 90 },
  /** The desktop leaderboard's phone-width counterpart. */
  mobileBanner: { kind: "iframe", id: "mobileBanner", key: "01e84c263f11415b40a6817907ca26ee", width: 320, height: 50 },
  /** Half-banner. Fits the utility pages' narrower content, where 728 is too wide to sit centred without looking like a hole. */
  banner468: { kind: "iframe", id: "banner468", key: "a214c5704f8459bd244292e041012ff4", width: 468, height: 60 },
  /** Medium rectangle. The one unit that fits BOTH a desktop content column and a 320px phone, so it needs no breakpoint pair. */
  rectangle: { kind: "iframe", id: "rectangle", key: "07841b7c8a97975b2ee81ba1f047778e", width: 300, height: 250 },
  /** Wide skyscraper. Rail only — see AdRail for why only one page has a rail. */
  skyscraper: { kind: "iframe", id: "skyscraper", key: "39c708bae801deace4de60a7177a0550", width: 160, height: 600 },
  /** Half skyscraper, the rail's second position. */
  railHalf: { kind: "iframe", id: "railHalf", key: "acf9a6de51f6e93e3a5291590ae74029", width: 160, height: 300 },
  native: {
    kind: "native",
    id: "native",
    src: "https://pl31242917.profitableratecpmnetwork.com/2463c1f140540acd180dc7d9d58170a0/invoke.js",
    containerId: "container-2463c1f140540acd180dc7d9d58170a0",
    // PROVISIONAL — NOT YET MEASURED AGAINST A REAL FILL.
    //
    // Every other number in this file is exact: the banner sizes come from the
    // unit configuration itself, so the reserved box cannot disagree with the
    // creative. This one cannot work that way, because the Native Banner has
    // no declared size — the network decides its height at fill time from the
    // number of cards it returns and the width it is given.
    //
    // 300 is a placeholder chosen to be roughly right for the two widths this
    // unit is placed at (a ~768px content column, and a phone). It has been
    // verified only in the sense that the slot reserves the space and does not
    // shift the page. It has NOT been checked against a filled native unit.
    //
    // WHY IT IS STILL UNMEASURED NOW THAT WE ARE LIVE. The integration itself
    // is confirmed working: on the first cold load after deploy, the 728x90 in
    // this exact sandbox filled with a real creative — 42KB of ad DOM, two
    // images and 32 links inside the frame. But an ad network fills a fraction
    // of requests and frequency-caps a client that asks repeatedly, so every
    // automated run after that first one came back empty, and the native unit
    // never happened to fill during a run that could measure it. Hammering it
    // to force a fill is what gets a publisher flagged for invalid traffic,
    // which is not a trade worth making for one number.
    //
    // TO CORRECT IT: open a page carrying the native band in a NORMAL browser
    // (not an automated one, and ideally not one that has just loaded the site
    // repeatedly) and wait for the fill. The measurement has to be taken
    // INSIDE the frame — the sandbox puts it on an opaque origin, so reaching
    // in from the page with .contentDocument returns null. In DevTools, switch
    // the console's context dropdown to the "/ads/frame?unit=native" frame and
    // run:
    //
    //   document.getElementById(
    //     "container-2463c1f140540acd180dc7d9d58170a0",
    //   ).getBoundingClientRect().height
    //
    // Take the tallest across desktop and phone, round up, put it here, and
    // replace this comment with the measurement. Too small and the unit is
    // clipped; too large and the page carries dead space under every fill.
    reservedHeight: 300,
  },
} as const satisfies Record<string, AdUnitSpec>;

export type AdUnitId = keyof typeof AD_UNITS;

/**
 * Routes that must never carry an ad, as path prefixes.
 *
 * These are not a performance or taste judgement. Three separate reasons are
 * mixed in here deliberately, and each is stated so the list cannot be pruned
 * by someone who only knows one of them:
 *
 *  1. TRUST AND LEGAL SURFACE (/about, /privacy-policy, /terms,
 *     /responsible-gambling and the rest). These pages exist to be believed.
 *     A responsible-gambling page framed by a paid banner argues against
 *     itself, and a privacy policy running third-party ad JS is a worse
 *     document than one that does not.
 *  2. AFFILIATE CONFUSION (/bet-builder, /multi-bets, /bookmakers). These
 *     flows carry real "Join" buttons pointing at real bookmaker accounts. An
 *     ad creative beside one of those is a click the reader did not mean to
 *     make, and it is not a risk worth any CPM.
 *  3. CONVERSION AND ACCOUNT SURFACE (/pricing, /login, /register,
 *     /free-ticket, /dashboard, /admin). Nothing competes with the thing the
 *     page is asking for.
 *
 * /track-record sits under (1) rather than (3): it is the page that backs
 * every claim the rest of the site makes.
 *
 * NOT YET LISTED, AND MUST BE ADDED WHEN IT SHIPS: /bookmakers. That page is
 * still in development at the time of writing, and the guard below rejects an
 * entry for a route that does not exist — an entry protecting a page that is
 * not there reads as coverage while providing none. It belongs under (2) the
 * moment it lands: it is a directory of bookmakers whose whole purpose is
 * affiliate "Join" buttons, which is the single worst place on this site for
 * an ad creative to appear.
 *
 * Enforced by scripts/check-ad-placement.ts, which walks the route tree and
 * fails if any of these paths reaches an ad component through its page or any
 * layout above it.
 */
export const AD_FREE_ROUTES = [
  "/about",
  "/affiliate-disclosure",
  "/betting-disclaimer",
  "/bet-builder",
  "/contact",
  "/cookie-policy",
  "/editorial-policy",
  "/free-ticket",
  "/login",
  "/methodology",
  "/multi-bets",
  "/pricing",
  "/privacy-policy",
  "/register",
  "/responsible-gambling",
  "/terms",
  "/track-record",
] as const;
