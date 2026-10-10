/** Offline checks for the cookie-consent gate on GA4 and the Meta Pixel. No network or database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSENT_STORAGE_KEY, applyConsentToTags, parseConsent } from "../src/lib/consent";

const code = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Only the two real answers count; anything else means "not asked yet".
assert.equal(parseConsent("granted"), "granted");
assert.equal(parseConsent("denied"), "denied");
assert.equal(parseConsent(null), null);
assert.equal(parseConsent("yes"), null);

// A choice reaches both tags, and either may be missing.
const calls: unknown[][] = [];
const w = { gtag: (...a: unknown[]) => calls.push(["gtag", ...a]), fbq: (...a: unknown[]) => calls.push(["fbq", ...a]) } as any;
applyConsentToTags("granted", w);
applyConsentToTags("denied", w);
assert.deepEqual(calls, [
  ["gtag", "consent", "update", { analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" }],
  ["fbq", "consent", "grant"],
  ["gtag", "consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }],
  ["fbq", "consent", "revoke"],
]);
assert.doesNotThrow(() => applyConsentToTags("granted", {} as any));

// Both tags start restricted unless the stored answer is exactly "granted",
// and set that BEFORE they initialise.
const ga = code("src/components/Analytics.tsx");
assert.match(ga, /CONSENT_STORAGE_KEY/);
assert.match(ga, /bgConsent === 'granted' \? 'granted' : 'denied'/);
assert.ok(ga.indexOf("gtag('consent', 'default'") < ga.indexOf("gtag('config'"), "GA consent default precedes config");

const meta = code("src/components/MetaPixel.tsx");
assert.match(meta, /!== 'granted'\) fbq\('consent', 'revoke'\)/);
assert.ok(meta.indexOf("fbq('consent', 'revoke')") < meta.indexOf("fbq('init'"), "Meta revoke precedes init");
assert.doesNotMatch(meta, /<noscript>/, "no noscript pixel: without JavaScript there is no banner, so no consent");

// The banner is mounted site-wide and the install prompt waits for it.
assert.match(code("src/app/layout.tsx"), /<CookieConsent \/>/);
assert.match(code("src/components/InstallPrompt.tsx"), /if \(!mode \|\| !consentAnswered\) return null/);
assert.match(code("src/components/SiteFooter.tsx"), /<CookieSettingsLink \/>/);
assert.equal(CONSENT_STORAGE_KEY, "bg_consent_v1");

console.log("Consent checks passed: parsing, tag updates, restricted defaults, banner wiring.");
