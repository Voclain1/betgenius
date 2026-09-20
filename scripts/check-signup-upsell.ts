/**
 * Asserts who sees the post-signup plan modal.
 *
 * The dangerous direction here is showing it to the wrong person: every
 * existing FREE account on the day this deploys, or a customer who has just
 * paid. Both are invisible in a screenshot of the working case — a modal that
 * appears correctly for a new signup tells you nothing about who else got one.
 * So the decision is pure (src/lib/signupUpsell.ts) and the negatives are
 * asserted here, one by one.
 *
 * It also pins the things that must not be duplicated: the plan copy and the
 * prices come from lib/pricing, and the modal pays through the existing
 * initialize endpoint rather than any logic of its own.
 *
 * Run: npx tsx scripts/check-signup-upsell.ts
 */
import { readFileSync } from "node:fs";
import {
  SIGNUP_UPSELL_WINDOW_MS,
  isNewSignup,
  shouldShowSignupUpsell,
  signupUpsellKey,
} from "../src/lib/signupUpsell";
import { PLAN_PRICING, PLAN_TIERS } from "../src/lib/pricing";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const read = (path: string) => readFileSync(path, "utf8");

const NOW = Date.parse("2026-09-20T12:00:00Z");
const minutesAgo = (m: number) => NOW - m * 60_000;
const daysAgo = (d: number) => NOW - d * 24 * 60 * 60_000;

/** A brand-new, unpaid account. Each case below changes one fact. */
const fresh = { createdAt: minutesAgo(1), tier: "FREE", paid: false, now: NOW };

console.log("a new credentials signup is offered a plan:");
// /api/register creates the User and a FREE/ACTIVE Subscription, then the page
// signs in and pushes to /dashboard — so the account is seconds old on arrival.
eq("an account created a minute ago is new", isNewSignup(fresh), true);
eq("...and the modal is shown", shouldShowSignupUpsell({ ...fresh, dismissed: false }), true);
// A FREE subscription row with status ACTIVE is what registration creates. It
// must not read as "paid" — that row is the free tier, not a purchase.
eq("a FREE/ACTIVE registration row is not paid access", shouldShowSignupUpsell({ ...fresh, tier: "FREE", paid: false, dismissed: false }), true);

console.log("\na first-time Google signup is offered one too:");
// The adapter creates the User inside the OAuth callback and leaves no
// Subscription row at all, so tier resolves to FREE via the jwt fallback.
// createdAt is written identically by both paths, which is the whole reason
// this works without the app being on the OAuth path.
eq("a Google-created account with no subscription row is new", isNewSignup({ createdAt: minutesAgo(2), tier: "FREE", paid: false, now: NOW }), true);
eq("...and is shown the modal", shouldShowSignupUpsell({ createdAt: minutesAgo(2), tier: "FREE", paid: false, dismissed: false, now: NOW }), true);

console.log("\na REPEAT Google login is not a signup:");
// The case a "did they arrive from the OAuth callback?" check gets wrong every
// single time. The account is old; only the session is new.
eq("an account created 90 days ago is not new", isNewSignup({ createdAt: daysAgo(90), tier: "FREE", paid: false, now: NOW }), false);
eq("...and sees nothing", shouldShowSignupUpsell({ createdAt: daysAgo(90), tier: "FREE", paid: false, dismissed: false, now: NOW }), false);
eq("nor is one created yesterday", isNewSignup({ createdAt: daysAgo(2), tier: "FREE", paid: false, now: NOW }), false);

console.log("\nexisting FREE accounts are not swept up by the deploy:");
// The failure that would hit the entire user base at once. Every historical
// account is far outside the window, so the day this ships is uneventful.
for (const days of [1.1, 7, 30, 180, 400]) {
  eq(`an account ${days} days old is not treated as new`, isNewSignup({ createdAt: daysAgo(days), tier: "FREE", paid: false, now: NOW }), false);
}
// The boundary itself, from both sides.
eq("just inside the window is new", isNewSignup({ createdAt: NOW - SIGNUP_UPSELL_WINDOW_MS + 1000, tier: "FREE", paid: false, now: NOW }), true);
eq("exactly at the window is not", isNewSignup({ createdAt: NOW - SIGNUP_UPSELL_WINDOW_MS, tier: "FREE", paid: false, now: NOW }), false);
eq("just outside the window is not", isNewSignup({ createdAt: NOW - SIGNUP_UPSELL_WINDOW_MS - 1, tier: "FREE", paid: false, now: NOW }), false);
// The window must stay far below the age of the youngest historical account.
check("the window is short enough to be safe on deploy", SIGNUP_UPSELL_WINDOW_MS <= 7 * 24 * 60 * 60 * 1000, `${SIGNUP_UPSELL_WINDOW_MS}ms`);
check("...and long enough to survive a distracted signup", SIGNUP_UPSELL_WINDOW_MS >= 60 * 60 * 1000);

console.log("\npaid users are NEVER offered a plan:");
// The mistake that costs trust rather than a click: selling someone what they
// already own, minutes after they bought it.
eq("a VIP who paid straight after registering sees nothing", shouldShowSignupUpsell({ createdAt: minutesAgo(1), tier: "VIP", paid: true, dismissed: false, now: NOW }), false);
eq("a PREMIUM who paid straight after registering sees nothing", shouldShowSignupUpsell({ createdAt: minutesAgo(1), tier: "PREMIUM", paid: true, dismissed: false, now: NOW }), false);
eq("paid beats the freshest possible account", isNewSignup({ createdAt: NOW, tier: "VIP", paid: true, now: NOW }), false);
// `paid` is the authority, not the tier string — an expired ACTIVE VIP row
// resolves to unpaid upstream, and that resolution is what this must follow.
eq("an expired paid tier that resolved to unpaid is still eligible", shouldShowSignupUpsell({ createdAt: minutesAgo(1), tier: "FREE", paid: false, dismissed: false, now: NOW }), true);

console.log("\ndismissal persists, and is per user:");
eq("a dismissed modal stays closed", shouldShowSignupUpsell({ ...fresh, dismissed: true }), false);
eq("...even for an account created seconds ago", shouldShowSignupUpsell({ createdAt: NOW, tier: "FREE", paid: false, dismissed: true, now: NOW }), false);
// Keyed by user id: a shared browser must not let one person's dismissal
// silence the offer for the next person who signs up on it.
check("the storage key is per user", signupUpsellKey("user-a") !== signupUpsellKey("user-b"));
check("the key is stable for one user", signupUpsellKey("user-a") === signupUpsellKey("user-a"));
check("the key is namespaced", signupUpsellKey("u").startsWith("betgenius:"));

console.log("\nmalformed inputs fail closed:");
eq("an unparseable createdAt is not new", isNewSignup({ createdAt: "not-a-date", tier: "FREE", paid: false, now: NOW }), false);
// Clock skew between app and database. The row demonstrably did not exist long
// ago, so this is treated as brand new rather than rejected.
eq("a future createdAt is treated as brand new", isNewSignup({ createdAt: NOW + 60_000, tier: "FREE", paid: false, now: NOW }), true);
eq("an ISO string works as well as a number", isNewSignup({ createdAt: new Date(minutesAgo(5)).toISOString(), tier: "FREE", paid: false, now: NOW }), true);
eq("a Date works too", isNewSignup({ createdAt: new Date(minutesAgo(5)), tier: "FREE", paid: false, now: NOW }), true);

console.log("\nprices and plan copy are NOT duplicated:");
const modal = read("src/components/SignupUpsellModal.tsx");
const pricingPage = read("src/app/(public)/pricing/page.tsx");
check("the modal imports the shared price table", /from "@\/lib\/pricing"/.test(modal));
check("the modal renders the shared tier list", /PLAN_TIERS/.test(modal));
check("the pricing page renders the same tier list", /PLAN_TIERS/.test(pricingPage));
// No literal price may appear in either surface — that is what "single source
// of truth" has to mean to survive a price change.
for (const [label, source] of [["modal", modal], ["pricing page", pricingPage]] as const) {
  check(`the ${label} hard-codes no naira amount`, !/20[,_]?000|50[,_]?000/.test(source));
  check(`the ${label} hard-codes no dollar amount`, !/\$\s?(15|35)\b/.test(source));
}
eq("both tiers are offered", PLAN_TIERS.length, 2);
check("the offered tiers are VIP and PREMIUM", PLAN_TIERS.map((t) => t.id).join(",") === "VIP,PREMIUM");
for (const t of PLAN_TIERS) {
  check(`${t.id} has a price in the shared table`, PLAN_PRICING[t.id].ngn > 0 && PLAN_PRICING[t.id].usd > 0);
  check(`${t.id} has a short benefit list for the modal`, t.headline.length >= 2 && t.headline.length <= 4, String(t.headline.length));
}

console.log("\nthe CTA uses the existing server-priced checkout:");
check("the modal posts to the existing initialize endpoint", modal.includes("/api/subscription/initialize"));
check("...exactly as the pricing page does", pricingPage.includes("/api/subscription/initialize"));
// Tier only. An amount in the body is how a visitor names their own price.
check("the modal sends the tier alone", /body:\s*JSON\.stringify\(\{\s*tier:\s*selected\s*\}\)/.test(modal));
check("the modal follows the returned authorization_url", modal.includes("authorization_url"));
// Asserted against CODE, not prose. Both files explain in comments why the
// amount is server-derived and why the redirect goes to Paystack, and a naive
// source scan reads those explanations as violations of the rules they describe.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const modalCode = stripComments(modal);
check("the modal names no amount in code", !/amount/i.test(modalCode), modalCode.match(/.{0,40}amount.{0,40}/i)?.[0]);
// No parallel payment path: the only Paystack contact is following the URL the
// server returned, which is the existing flow.
check("the modal calls no Paystack API of its own", !/paystack/i.test(modalCode), modalCode.match(/.{0,40}paystack.{0,40}/i)?.[0]);
check("30-day wording is present", /30[- ]day/i.test(modal));

console.log("\nthe modal is mounted where both signup paths land:");
const dashboard = read("src/app/dashboard/page.tsx");
check("the dashboard mounts it", dashboard.includes("<SignupUpsellModal"));
// Eligibility is decided server-side; a client that decided its own would
// believe anyone with devtools.
check("createdAt comes from the database, not the session", /prisma\.user\.findUnique[\s\S]{0,120}createdAt/.test(dashboard));
check("paid status comes from the resolved entitlement", /paid=\{hasActivePaidAccess\(sub\)\}/.test(dashboard));
// And nobody is force-redirected to /pricing.
check("no redirect to /pricing was added", !/redirect\(["']\/pricing/.test(dashboard));

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
if (failures) process.exitCode = 1;
