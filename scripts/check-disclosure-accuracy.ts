/**
 * Asserts the trust pages still describe what the site actually loads.
 *
 * WHY THIS EXISTS. The cookie and privacy policies made specific, factual,
 * checkable claims — "the current application does not include a Google
 * Analytics tag", "no non-essential analytics or advertising tag is active" —
 * and both had already stopped being true. Advertising shipped first and the
 * policies were never touched, so for a while the site told readers no
 * advertising technology was active while third-party ad frames were setting
 * cookies on betgenius.ng. Analytics would have done it again.
 *
 * That is a worse failure than a stale comment. These pages exist to be
 * believed, they are what a regulator or a reader checks, and nothing about
 * shipping a tag makes anyone open them.
 *
 * So the rule is mechanical: if the code loads a tracking technology, the
 * disclosure pages must not deny it, and must name it. What the pages SAY
 * about consent is a legal judgement this script has no opinion on — it only
 * checks that the description matches the build.
 *
 * Run: npx tsx scripts/check-disclosure-accuracy.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => (existsSync(join(ROOT, ...p)) ? readFileSync(join(ROOT, ...p), "utf8") : "");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const layout = read("src", "app", "layout.tsx");
const cookiePolicy = read("src", "app", "(public)", "cookie-policy", "page.tsx");
const privacyPolicy = read("src", "app", "(public)", "privacy-policy", "page.tsx");

// What the build actually does, read from the build rather than assumed.
const analyticsWired = layout.includes("<Analytics />") && existsSync(join(ROOT, "src", "components", "Analytics.tsx"));
const adsWired = existsSync(join(ROOT, "src", "components", "ads", "AdPlacements.tsx")) &&
  read("src", "components", "ads", "AdPlacements.tsx").includes("AdFrame");

console.log("\nWhat the build loads");
check("analytics tag is wired into the layout", analyticsWired, analyticsWired ? "Analytics.tsx rendered" : "not present");
check("advertising is wired", adsWired, adsWired ? "ad placements render frames" : "not present");

/** Claims that must not survive once the corresponding tag ships. */
const CONTRADICTIONS: { when: boolean; phrases: string[]; what: string }[] = [
  {
    when: analyticsWired,
    what: "analytics",
    phrases: [
      "does not include a Google Analytics tag",
      "does not include a Google Analytics or Google AdSense tag",
    ],
  },
  {
    when: adsWired,
    what: "advertising",
    phrases: [
      "no non-essential analytics or advertising tag is active",
      "does not include a Google AdSense tag. If advertising is introduced",
    ],
  },
];

console.log("\nDisclosure pages do not deny what ships");
for (const page of [
  ["cookie policy", cookiePolicy],
  ["privacy policy", privacyPolicy],
] as const) {
  for (const rule of CONTRADICTIONS) {
    if (!rule.when) continue;
    const found = rule.phrases.filter((p) => page[1].includes(p));
    check(
      `${page[0]} makes no stale ${rule.what} claim`,
      found.length === 0,
      found.length ? `still says: "${found[0]}"` : "",
    );
  }
}

console.log("\nDisclosure pages name what ships");
if (analyticsWired) {
  check("cookie policy names Google Analytics", /Google Analytics/i.test(cookiePolicy));
  check("privacy policy names Google Analytics", /Google Analytics/i.test(privacyPolicy));
}
if (adsWired) {
  // Named rather than described vaguely: a reader cannot check their own
  // cookies against "a third-party partner".
  check("cookie policy names the ad network", /Adsterra/i.test(cookiePolicy));
  check("privacy policy names the ad network", /Adsterra/i.test(privacyPolicy));
}

console.log(`\n${failures === 0 ? "OK" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
