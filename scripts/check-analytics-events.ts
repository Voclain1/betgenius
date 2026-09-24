/** Offline checks for GA4 conversion-event boundaries. No network or database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trackEvent } from "../src/lib/clientAnalytics";

const root = process.cwd();
const code = (path: string) => readFileSync(join(root, path), "utf8");

// The wrapper must be harmless during SSR/local builds without a GA tag.
assert.doesNotThrow(() => trackEvent("sign_up", { method: "email" }));

const calls: unknown[][] = [];
(globalThis as any).window = { gtag: (...args: unknown[]) => calls.push(args) };
trackEvent("begin_checkout", { currency: "NGN", value: 5000 });
assert.deepEqual(calls, [["event", "begin_checkout", { currency: "NGN", value: 5000 }]]);
delete (globalThis as any).window;

const register = code("src/app/(public)/register/page.tsx");
assert.ok(register.indexOf('trackEvent("sign_up"') > register.indexOf("if (!res.ok)"), "email sign_up follows a successful response");
assert.match(register, /trackEvent\("sign_up", \{ method: "email" \}\)/);

const auth = code("src/lib/auth.ts");
const oauth = code("src/components/SignupConfirmation.tsx");
assert.match(auth, /if \(isNewUser\).*pendingSignUpMethod = "google"/);
assert.match(auth, /trigger === "update".*pendingSignUpMethod/);
assert.match(oauth, /trackEvent\("sign_up", \{ method \}\)/);
assert.match(oauth, /void update\(\)/);

const pricing = code("src/app/(public)/pricing/page.tsx");
assert.ok(pricing.indexOf('trackEvent("begin_checkout"') > pricing.indexOf("if (!res.ok)"), "checkout event follows successful initialization");
assert.match(pricing, /currency: "NGN"/);
assert.match(pricing, /items: \[\{ item_id: tier/);

const payment = code("src/components/PaymentConfirmation.tsx");
assert.match(payment, /if \(!activated \|\| !reference \|\| !tier \|\| !value\) return/);
assert.match(payment, /trackEvent\("purchase"/);
assert.match(payment, /transaction_id: reference/);
assert.match(payment, /sessionStorage\.getItem\(key\)/);
assert.match(payment, /sessionStorage\.setItem\(key, "1"\)/);

console.log("Analytics event checks passed: email sign-up, new Google sign-up, checkout and confirmed purchase.");
