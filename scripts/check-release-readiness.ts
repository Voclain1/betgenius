import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeAuthReturn, authPageHref } from "../src/lib/authReturn";
import {
  checkoutAnalytics,
  paymentProviderName,
} from "../src/lib/checkoutAnalytics";
import { PLAN_PRICING } from "../src/lib/pricing";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (v: unknown) => {
  assert.ok(v);
  checks++;
};
for (const value of [
  undefined,
  null,
  "",
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/\\\\evil.test",
  "/\nevil.test",
  "/%2fevil.test",
  "/%5cevil.test",
  "javascript:alert(1)",
])
  eq(safeAuthReturn(value), "/dashboard");
for (const value of [
  "/pricing#plan-vip",
  "/pricing#plan-premium",
  "/dashboard/preferences",
  "/dashboard/saved?filter=won",
  "/predictions?d_team=A%20B",
]) {
  eq(safeAuthReturn(value), value);
  eq(
    new URL(safeAuthReturn(value), "https://www.betgenius.ng").origin,
    "https://www.betgenius.ng",
  );
  eq(
    decodeURIComponent(
      authPageHref("/register", value).split("callbackUrl=")[1],
    ),
    value,
  );
}
eq(authPageHref("/login", "//evil.test"), "/login");
eq(authPageHref("/register", "/dashboard"), "/register");
for (const tier of ["VIP", "PREMIUM"] as const) {
  for (const method of ["PAYSTACK", "KORAPAY", "FLUTTERWAVE", "BANK"]) {
    const e = checkoutAnalytics(tier, method);
    eq(e.currency, "NGN");
    eq(e.value, PLAN_PRICING[tier].ngn);
    eq(e.items[0].item_id, tier);
    eq(e.payment_type, method.toLowerCase());
  }
  const e = checkoutAnalytics(tier, "USDT");
  eq(e.payment_type, "usdt");
  ok(!("currency" in e));
  ok(!("value" in e));
  ok(!("price" in e.items[0]));
  eq(e.items[0].quantity, 1);
}
eq(paymentProviderName("flutterwave"), "Flutterwave");
eq(paymentProviderName("korapay"), "Korapay");
eq(paymentProviderName("paystack"), "Paystack");
for (const provider of ["<script>", "unknown", "", null, undefined]) {
  eq(paymentProviderName(provider), "Your payment provider");
}
const read = (p: string) => readFileSync(p, "utf8");
const pricing = read("src/app/(public)/pricing/page.tsx"),
  login = read("src/app/(public)/login/page.tsx"),
  register = read("src/app/(public)/register/page.tsx"),
  confirmation = read("src/components/PaymentConfirmation.tsx");
ok(pricing.includes("/pricing#plan-${tier.toLowerCase()}"));
ok(login.includes("safeAuthReturn(requested)"));
ok(login.includes('authPageHref("/register", callbackUrl)'));
ok(register.includes("router.push(callbackUrl)"));
ok(register.includes("GoogleSignInButton callbackUrl={callbackUrl}"));
for (const source of [login, register]) {
  ok(source.includes('aria-label="Email"'));
  ok(source.includes('aria-label="Password"'));
}
ok(confirmation.includes("measured.current === reference"));
ok(confirmation.includes("try { if (sessionStorage.getItem(key)) return; }"));
ok(!confirmation.includes('"Paystack declined this payment'));
// Preserve existing authorization, publication and price policies; none are rewritten by this suite.
console.log(
  `Release readiness: ${checks} safe-return, currency, provider-copy and wiring assertions passed`,
);
