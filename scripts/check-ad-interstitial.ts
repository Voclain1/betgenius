// Frequency and destination rules for the between-pages ad
// (src/components/ads/AdInterstitial.tsx). Pure; no browser needed.
import assert from "node:assert/strict";
import { shouldInterrupt, INTERSTITIAL_EVERY_VIEWS, INTERSTITIAL_MIN_GAP_MS } from "../src/components/ads/AdInterstitial";
import { AD_FREE_ROUTES } from "../src/lib/ads";

const here = new URL("https://betgenius.ng/predictions/today");
const to = (path: string) => new URL(path, here);
const now = 10 * INTERSTITIAL_MIN_GAP_MS;
const due = { views: INTERSTITIAL_EVERY_VIEWS, lastShownAt: 0 };

assert.equal(shouldInterrupt(due, now, here, to("/predictions/league/premier-league")), true, "due: internal page");
assert.equal(shouldInterrupt({ views: 1, lastShownAt: 0 }, now, here, to("/standings")), false, "never on the landing page's first click");
assert.equal(shouldInterrupt({ views: INTERSTITIAL_EVERY_VIEWS - 1, lastShownAt: 0 }, now, here, to("/standings")), false, "not before the view count");
assert.equal(shouldInterrupt({ ...due, lastShownAt: now - INTERSTITIAL_MIN_GAP_MS + 1000 }, now, here, to("/standings")), false, "not inside the time gap");
assert.equal(shouldInterrupt(due, now, here, to("https://example.com/x")), false, "external links untouched");
assert.equal(shouldInterrupt(due, now, here, to("/predictions/today#markets")), false, "same page untouched");
for (const p of [...AD_FREE_ROUTES, "/admin/predictions", "/dashboard", "/checkout/vip"])
  assert.equal(shouldInterrupt(due, now, here, to(p)), false, `never before ${p}`);

console.log("Ad interstitial: frequency cap, landing-page grace, time gap, external/same-page links and ad-free destinations passed");
