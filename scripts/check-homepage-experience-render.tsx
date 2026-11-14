/**
 * Sprint 07 — the homepage's account actions for every kind of reader
 * (render tier).
 *
 * The page is cached and identical for everyone; who is reading is known only
 * in the browser, from the session. This renders the two small client pieces
 * for each reader and reads the markup:
 *   - signed out, or session not yet loaded: "Go VIP" and one "Join free" line;
 *   - signed in, free: no join line, links to the dashboard and saved
 *     predictions, "Go VIP" still offered;
 *   - active VIP or Premium: no "Go VIP", still a way back to their things;
 *   - a VIP plan that is expired, pending or cancelled is not treated as paid;
 *   - nothing says AI, nothing promises a result, the line is one quiet <p>
 *     with a fixed minimum height (no layout jump when the session resolves),
 *     and each link is at least 36px tall.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-homepage-experience-render.tsx
 */
import "./lib/reactCacheShim";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionProvider } from "next-auth/react";
import { HomeAccountLine, HomeUpgradeButton } from "../src/components/HomeAccountActions";
import { HomeLink } from "../src/components/HomeLink";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && got !== undefined ? ` — ${String(got).slice(0, 260)}` : ""}`);
};
const expires = "2099-01-01T00:00:00.000Z";
const as = (user: Record<string, unknown> | null) => {
  const html = renderToStaticMarkup(
    <SessionProvider session={user ? ({ user: { id: "u", email: "reader@example.com", name: "Reader", role: "USER", tier: "FREE", subStatus: "ACTIVE", ...user }, expires } as any) : null} refetchOnWindowFocus={false}>
      <div id="hero"><HomeUpgradeButton /><HomeAccountLine /></div>
    </SessionProvider>,
  );
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
};

console.log("\nsigned out (also what a signed-in reader sees until the session loads)");
const out = as(null);
check("Go VIP is offered", out.text.includes("Go VIP") && out.html.includes('href="/pricing"'), out.html);
check("one line: what a free account does, and 'Join free' to /register", out.text.includes("Save picks and follow teams with a free account.") && out.html.includes('href="/register"') && /Join free/.test(out.text), out.text);
check("no dashboard link is shown to a visitor", !out.html.includes('href="/dashboard"'));

console.log("\nsigned in, free");
const free = as({ tier: "FREE", subStatus: "ACTIVE" });
check("welcome back, with the dashboard and saved predictions", free.text.includes("Welcome back") && free.html.includes('href="/dashboard"') && free.html.includes('href="/dashboard/saved"'), free.text);
check("the join line is gone", !/Join free|free account/.test(free.text), free.text);
check("Go VIP is still offered to a free reader", free.text.includes("Go VIP"));

console.log("\npaid readers");
for (const tier of ["VIP", "PREMIUM"]) {
  const paid = as({ tier, subStatus: "ACTIVE" });
  check(`${tier} (active): no Go VIP, still a way back to their things`, !paid.text.includes("Go VIP") && paid.html.includes('href="/dashboard"') && paid.html.includes('href="/dashboard/saved"'), paid.text);
}
for (const subStatus of ["EXPIRED", "PENDING", "CANCELLED", "PAST_DUE"]) {
  check(`a VIP plan that is ${subStatus} is not treated as paid: Go VIP stays`, as({ tier: "VIP", subStatus }).text.includes("Go VIP"));
}
check("a malformed session (no tier) is treated as free", as({ tier: undefined, subStatus: undefined }).text.includes("Go VIP"));

console.log("\nthe line is quiet, stable and accessible");
for (const [name, v] of [["signed out", out], ["free", free], ["VIP", as({ tier: "VIP", subStatus: "ACTIVE" })]] as const) {
  check(`${name}: a single <p> with a fixed minimum height (two lines on a phone), so nothing moves when the session resolves`, (v.html.match(/<p\b/g) ?? []).length === 1 && /<p class="[^"]*\bmin-h-\[3\.25rem\][^"]*\bsm:min-h-9\b/.test(v.html), v.html);
  check(`${name}: every link is at least 36px tall`, [...v.html.matchAll(/<a [^>]*class="([^"]*)"/g)].filter((m) => !m[1].includes("btn")).every((m) => /\bmin-h-9\b/.test(m[1])));
  check(`${name}: no AI wording, no promised result, no urgency`, !/\bAI\b|guarantee|sure win|hurry|limited time|don't miss/i.test(v.text), v.text);
}

console.log("\nHomeLink");
const link = renderToStaticMarkup(<HomeLink target="today" placement="hero" href="/predictions/today" className="btn btn-primary">Today&apos;s tips</HomeLink>);
check("renders an ordinary link to the same destination, same classes", link === '<a class="btn btn-primary" href="/predictions/today">Today&#x27;s tips</a>', link);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
