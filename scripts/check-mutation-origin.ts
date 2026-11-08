/**
 * Asserts the CSRF origin check accepts the site's own requests as they
 * really arrive in production, and still rejects other sites.
 *
 * WHY THIS EXISTS. The check used to compare Origin with req.nextUrl.origin.
 * Behind Caddy, the standalone server builds nextUrl from HOSTNAME/PORT
 * (0.0.0.0:3000), so every follow, push subscription and notification
 * preference change on www.betgenius.ng failed with "Invalid origin".
 */
import { NextRequest } from "next/server";
import { hasValidMutationOrigin } from "../src/lib/requestSecurity";

let failed = 0;
function expect(name: string, actual: boolean, wanted: boolean) {
  if (actual !== wanted) { failed++; console.error(`FAIL ${name}: got ${actual}, wanted ${wanted}`); }
  else console.log(`ok   ${name}`);
}

// What the standalone server hands a route handler behind Caddy.
function req(headers: Record<string, string>) {
  return new NextRequest("https://0.0.0.0:3000/api/follows", { method: "POST", headers });
}
const proxied = { host: "www.betgenius.ng", "x-forwarded-host": "www.betgenius.ng", "x-forwarded-proto": "https" };

expect("same site behind proxy", hasValidMutationOrigin(req({ ...proxied, origin: "https://www.betgenius.ng" })), true);
expect("apex served directly", hasValidMutationOrigin(req({ host: "betgenius.ng", origin: "https://betgenius.ng" })), true);
expect("other site", hasValidMutationOrigin(req({ ...proxied, origin: "https://evil.example" })), false);
expect("lookalike suffix", hasValidMutationOrigin(req({ ...proxied, origin: "https://www.betgenius.ng.evil.example" })), false);
expect("sibling subdomain", hasValidMutationOrigin(req({ ...proxied, origin: "https://ads.betgenius.ng" })), false);
expect("null origin", hasValidMutationOrigin(req({ ...proxied, origin: "null" })), false);
expect("non-http scheme", hasValidMutationOrigin(req({ ...proxied, origin: "chrome-extension://www.betgenius.ng" })), false);
expect("local dev", hasValidMutationOrigin(new NextRequest("http://localhost:3000/api/follows", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } })), true);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("mutation origin check: all passed");
