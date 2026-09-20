/**
 * Asserts Google One Tap's eligibility gates and, more importantly, its
 * security boundary.
 *
 * TWO CLASSES OF FAILURE, both invisible in a working demo:
 *
 *   UX — a signed-in user being shown a sign-in prompt, or the prompt fighting
 *   the Google button on /login. Nobody notices these in the happy path
 *   because the happy path is a signed-out visitor on the homepage.
 *
 *   SECURITY — accepting a credential that was not verified. A One Tap token
 *   arrives in a request body, so it arrives from an attacker as readily as
 *   from Google, and it is base64 rather than a secret. Trusting the decoded
 *   payload is a total account takeover of every user on the site. The
 *   authorize() assertions below run the REAL provider against a stubbed
 *   database and a stubbed verifier, so "rejects an unverified credential" is
 *   demonstrated rather than asserted about the source.
 *
 * Run: npx tsx scripts/check-google-one-tap.ts
 */
export {};

import { readFileSync } from "node:fs";
import {
  ONE_TAP_DISMISS_COOLDOWN_MS,
  ONE_TAP_EXCLUDED_PATHS,
  dismissedRecently,
  isExcludedPath,
  oneTapSupported,
  shouldInitializeOneTap,
  type SessionStatus,
} from "../src/lib/googleOneTap";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), Object.is(actual, expected) ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const read = (path: string) => readFileSync(path, "utf8");

/** A signed-out visitor on the homepage in a capable browser. */
const base = {
  status: "unauthenticated" as SessionStatus,
  pathname: "/",
  supported: true,
  configured: true,
  dismissed: false,
};

console.log("a signed-out visitor on a public page is eligible:");
eq("the homepage qualifies", shouldInitializeOneTap(base), true);
eq("a predictions page qualifies", shouldInitializeOneTap({ ...base, pathname: "/predictions/today" }), true);

console.log("\nSIGNED-IN users never initialize it:");
// The single most visible way this can be wrong. The component returns before
// loading Google's script at all, so a signed-in user does not even fetch it.
eq("an authenticated visitor is refused", shouldInitializeOneTap({ ...base, status: "authenticated" }), false);
eq("...on every path", shouldInitializeOneTap({ ...base, status: "authenticated", pathname: "/predictions" }), false);
// "loading" is a THIRD state, not a synonym for signed-out. NextAuth reports it
// briefly on first paint; collapsing it into unauthenticated flashes the prompt
// at signed-in users on every cold load.
eq("a still-loading session is refused", shouldInitializeOneTap({ ...base, status: "loading" }), false);
check(
  "only 'unauthenticated' is ever eligible",
  (["authenticated", "loading"] as SessionStatus[]).every((status) => !shouldInitializeOneTap({ ...base, status })),
);

console.log("\nit stays off the pages that already have a Google button:");
for (const path of ["/login", "/register"]) {
  eq(`${path} is excluded`, shouldInitializeOneTap({ ...base, pathname: path }), false);
  eq(`${path} is recognised as excluded`, isExcludedPath(path), true);
}
eq("a sub-path of an excluded page is excluded too", isExcludedPath("/login/callback"), true);
eq("a page merely starting with the same letters is not", isExcludedPath("/loginhelp"), false);
eq("an ordinary page is not excluded", isExcludedPath("/predictions"), false);
check("the excluded list names login and register", ONE_TAP_EXCLUDED_PATHS.includes("/login") && ONE_TAP_EXCLUDED_PATHS.includes("/register"));

console.log("\nunsupported and unconfigured environments degrade cleanly:");
// Never an error, always "no prompt". The ordinary button is the fallback.
eq("no client id means no prompt", shouldInitializeOneTap({ ...base, configured: false }), false);
eq("an unsupported environment means no prompt", shouldInitializeOneTap({ ...base, supported: false }), false);
eq("a server render has no document", oneTapSupported({ hasDocument: false, cookieEnabled: true }), false);
eq("cookies disabled is unsupported", oneTapSupported({ hasDocument: true, cookieEnabled: false }), false);
eq("a normal browser is supported", oneTapSupported({ hasDocument: true, cookieEnabled: true }), true);

console.log("\ndismissal is respected and not re-asked aggressively:");
const NOW = Date.parse("2026-09-20T12:00:00Z");
eq("a dismissed visitor sees nothing", shouldInitializeOneTap({ ...base, dismissed: true }), false);
eq("a dismissal an hour ago still suppresses", dismissedRecently(String(NOW - 60 * 60_000), NOW), true);
eq("a dismissal a day ago still suppresses", dismissedRecently(String(NOW - 24 * 60 * 60_000), NOW), true);
eq("a dismissal past the cooldown does not", dismissedRecently(String(NOW - ONE_TAP_DISMISS_COOLDOWN_MS - 1), NOW), false);
check("the cooldown is at least a day", ONE_TAP_DISMISS_COOLDOWN_MS >= 24 * 60 * 60 * 1000, `${ONE_TAP_DISMISS_COOLDOWN_MS}ms`);
// Storage that cannot be read or trusted must not suppress the feature
// permanently, nor become a nag.
eq("no stored dismissal reads as not dismissed", dismissedRecently(null, NOW), false);
eq("a junk value reads as not dismissed", dismissedRecently("yesterday", NOW), false);
eq("a future timestamp does not suppress forever", dismissedRecently(String(NOW + 60_000), NOW), false);

console.log("\nthe component never reads the visitor's account:");
const component = read("src/components/GoogleOneTap.tsx");
// The URL lives in the lib beside the other One Tap constants; the component
// imports it rather than writing its own.
check("the official GIS client URL is used", read("src/lib/googleOneTap.ts").includes("accounts.google.com/gsi/client"));
check("the component imports it rather than hard-coding one", component.includes("GIS_SCRIPT_SRC"));
check("it uses the FedCM prompt path", component.includes("use_fedcm_for_prompt"));
check("it does not auto-select an account", /auto_select:\s*false/.test(component));
// It must hand the credential straight to the server, never inspect it.
check("it passes the credential to NextAuth", /signIn\(["']google-one-tap["']/.test(component));
check("it never decodes the token client-side", !/atob\(|jwtDecode|JSON\.parse\(.*credential/.test(component));
// Compared against the CALL site, not the function declaration — loadGis is
// defined at the top of the file, so comparing against the definition would
// pass no matter where the gate sat.
check(
  "the gate returns before the script is ever fetched",
  component.indexOf("if (!eligible) return") < component.indexOf("await loadGis()"),
  `gate@${component.indexOf("if (!eligible) return")} call@${component.indexOf("await loadGis()")}`,
);

console.log("\n--- the credential bridge, run for real against stubs ---");

/** Replaces a module in the require cache before the provider imports it. */
function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

type DbUser = { id: string; email: string; name: string | null; role: string; passwordHash: string | null };
let users: DbUser[] = [];
let createdUsers: any[] = [];
let accountUpserts: any[] = [];
/** What the (stubbed) verifier will say. The real one is exercised separately below. */
let verification: any = { ok: false, reason: "invalid" };

const prismaStub = {
  user: {
    findUnique: ({ where }: any) => Promise.resolve(users.find((u) => u.email === where.email || u.id === where.id) ?? null),
    create: ({ data }: any) => {
      createdUsers.push(data);
      const row = { id: `new-${createdUsers.length}`, email: data.email, name: data.name ?? null, role: "USER", passwordHash: null };
      users.push(row);
      return Promise.resolve(row);
    },
  },
  account: { upsert: (args: any) => { accountUpserts.push(args); return Promise.resolve({}); } },
  subscription: { findUnique: () => Promise.resolve(null) },
};

stub("../src/lib/prisma", { prisma: prismaStub });
stub("../src/lib/googleIdToken", { verifyGoogleIdToken: () => Promise.resolve(verification) });

const { authOptions, GOOGLE_ONE_TAP_PROVIDER } = require("../src/lib/auth");

/**
 * THE TRAP THIS NAVIGATES. next-auth v4's CredentialsProvider does NOT spread
 * your options: it returns a fixed template — always `id: "credentials"` — with
 * your options hung off `.options`, and merges them later in parseProviders
 * (next-auth/core/lib/providers.js), which takes `userOptions.id` as the real
 * id. So the runtime provider IS "google-one-tap", but the raw array entry
 * reports "credentials", and BOTH credentials providers look identical here.
 *
 * Selecting on `p.id` therefore silently picks the password provider and tests
 * the wrong thing entirely — it would have "passed" while asserting nothing
 * about One Tap.
 */
const oneTap = authOptions.providers.find((p: any) => (p.options?.id ?? p.id) === GOOGLE_ONE_TAP_PROVIDER);
check("the one-tap provider is registered", !!oneTap);
check("...and is distinct from the password provider", authOptions.providers.filter((p: any) => p.type === "credentials").length === 2);
// If this ever becomes true, next-auth changed its merge and the id below
// would need revisiting.
check("v4 still hangs user options off .options", oneTap?.options?.id === GOOGLE_ONE_TAP_PROVIDER, JSON.stringify(oneTap?.id));
const authorizeFn = oneTap?.options?.authorize ?? oneTap?.authorize;
const authorize = (credential: string) => authorizeFn({ credential }, {} as any);

const reset = () => {
  users = [];
  createdUsers = [];
  accountUpserts = [];
};

async function main() {
  console.log("\nan UNVERIFIED credential is rejected outright:");
  // Every one of these is a real rejection path in lib/googleIdToken. The
  // provider must not distinguish them to the caller, and must not proceed.
  for (const reason of ["invalid", "unverified-email", "no-email", "unconfigured"]) {
    reset();
    users = [{ id: "u1", email: "someone@example.com", name: "Someone", role: "USER", passwordHash: null }];
    verification = { ok: false, reason };
    const result = await authorize("forged.token.here");
    eq(`a "${reason}" credential signs nobody in`, result, null);
    eq(`..."${reason}" creates no user`, createdUsers.length, 0);
    eq(`..."${reason}" writes no account link`, accountUpserts.length, 0);
  }

  console.log("\nan existing Google account signs in without duplication:");
  reset();
  users = [{ id: "u-google", email: "g@example.com", name: "G", role: "USER", passwordHash: null }];
  verification = { ok: true, identity: { sub: "google-sub-1", email: "g@example.com", name: "G", picture: null } };
  const signedIn = await authorize("valid");
  eq("the existing user is returned", signedIn?.id, "u-google");
  eq("no duplicate user is created", createdUsers.length, 0);
  eq("exactly one user row still exists", users.length, 1);
  // The link row is what keeps the ordinary Google button working for them.
  eq("the account link is upserted", accountUpserts.length, 1);
  eq("...under the google provider", accountUpserts[0].where.provider_providerAccountId.provider, "google");
  eq("...keyed by Google's stable sub", accountUpserts[0].where.provider_providerAccountId.providerAccountId, "google-sub-1");

  console.log("\na PASSWORD account's email is refused, as the policy requires:");
  reset();
  users = [{ id: "u-pw", email: "pw@example.com", name: "PW", role: "USER", passwordHash: "$2a$10$hash" }];
  verification = { ok: true, identity: { sub: "google-sub-2", email: "pw@example.com", name: "PW", picture: null } };
  const collision = await authorize("valid");
  // Silently merging here would let anyone holding a Google token for that
  // address walk into the password account behind it.
  eq("the sign-in is refused", collision, null);
  eq("no user is created", createdUsers.length, 0);
  eq("no account link is written", accountUpserts.length, 0);
  eq("the password account is untouched", users.length, 1);

  console.log("\na brand-new visitor gets one properly-shaped account:");
  reset();
  verification = { ok: true, identity: { sub: "google-sub-3", email: "new@example.com", name: "New", picture: "https://x/y.png" } };
  const created = await authorize("valid");
  eq("they are signed in", created?.email, "new@example.com");
  eq("exactly one user is created", createdUsers.length, 1);
  eq("...with the verified email", createdUsers[0].email, "new@example.com");
  eq("...marked email-verified", createdUsers[0].emailVerified instanceof Date, true);
  eq("...with a FREE subscription row", createdUsers[0].subscription?.create?.tier, "FREE");
  // Without this link the user could never use the ordinary Google button
  // again — locked out by the feature that signed them up.
  eq("an account link is written", accountUpserts.length, 1);
  eq("...so the OAuth button will find them later", accountUpserts[0].create.provider, "google");

  console.log("\nsigning in twice does not create a second account:");
  reset();
  verification = { ok: true, identity: { sub: "google-sub-4", email: "twice@example.com", name: "T", picture: null } };
  const first = await authorize("valid");
  const second = await authorize("valid");
  eq("both sign-ins resolve to the same user", first?.id, second?.id);
  eq("only one user was created", createdUsers.length, 1);
  eq("only one user row exists", users.length, 1);

  console.log("\nthe linking policy is stated in the callback too:");
  const authSource = read("src/lib/auth.ts");
  check("the signIn callback covers both Google paths", /account\?\.provider === "google" \|\| account\?\.provider === GOOGLE_ONE_TAP_PROVIDER/.test(authSource));
  check("dangerous email account linking is still not enabled", !/allowDangerousEmailAccountLinking:\s*true/.test(authSource));

  console.log("\nverification happens server-side, on every claim that matters:");
  const verifier = read("src/lib/googleIdToken.ts");
  check("it uses Google's official library", verifier.includes("google-auth-library"));
  check("it verifies the signature via verifyIdToken", verifier.includes("verifyIdToken"));
  check("it pins the audience", /audience/.test(verifier) && /payload\.aud !== audience/.test(verifier));
  check("it checks the issuer", /payload\.iss/.test(verifier) && verifier.includes("accounts.google.com"));
  check("it checks expiry", /payload\.exp/.test(verifier));
  check("it requires a verified email", /email_verified !== true/.test(verifier));
  // The whole point: no decoded payload is trusted without the above.
  //
  // Asserted against CODE. The file's own header spells out the attack it
  // prevents — `JSON.parse(atob(token.split(".")[1]))` — and a scan of the raw
  // source reads that warning as the very thing it warns about.
  const verifierCode = verifier.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("it never hand-decodes the token", !/atob\(|Buffer\.from\([^)]*base64/.test(verifierCode), verifierCode.match(/.{0,50}atob.{0,50}/)?.[0]);
  check("the library is a declared dependency", JSON.parse(read("package.json")).dependencies["google-auth-library"] !== undefined);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
