/**
 * Asserts the session cookie still satisfies the `__Host-` prefix rules.
 *
 * WHY THIS EXISTS. The session cookie is named `__Host-next-auth.session-token`
 * in production so that no subdomain — the ad frame's ads.betgenius.ng in
 * particular — can set a `.betgenius.ng` cookie of the same name and shadow
 * it. See the long note in src/lib/auth.ts.
 *
 * The prefix is enforced by the BROWSER, not by us, and it is all-or-nothing:
 * a `__Host-` cookie that is not Secure, or is not Path=/, or carries any
 * Domain attribute, is rejected outright. Not downgraded — dropped. Which
 * means the failure mode of getting this wrong is not "slightly less secure",
 * it is "nobody can sign in, on every browser, immediately", with a sign-in
 * that appears to succeed and then lands back on the login page.
 *
 * Nothing in the type system stops someone adding `domain` to those options,
 * and no unit test would notice: the config would still be valid NextAuth.
 * So the rules are asserted here against the real authOptions object.
 *
 * The conditional name is asserted too. `__Host-` requires Secure, and Secure
 * cookies are not stored over plain http, so a hard-coded prefix would break
 * sign-in on http://localhost while looking perfectly correct in review.
 *
 * Run: npx tsx scripts/check-auth-cookies.ts
 */
export {};

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * authOptions reads NEXTAUTH_URL at module scope, so the module is re-imported
 * under each environment rather than imported once. `resetModules` is what
 * makes the second import actually re-evaluate.
 */
async function loadAuthOptions(nextAuthUrl: string) {
  const previous = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = nextAuthUrl;
  // A fresh module registry per load; tsx/CJS interop means delete-from-cache
  // is the portable way to do this.
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${require("node:path").sep}src${require("node:path").sep}lib${require("node:path").sep}auth.`)) {
      delete require.cache[key];
    }
  }
  const mod = require("../src/lib/auth");
  process.env.NEXTAUTH_URL = previous;
  return mod.authOptions as import("next-auth").NextAuthOptions;
}

async function main() {
  console.log("\nProduction (https)");
  const prod = await loadAuthOptions("https://www.betgenius.ng");
  const session = prod.cookies?.sessionToken;
  const opts = session?.options as Record<string, unknown> | undefined;

  check("a session cookie is configured at all", !!session, session?.name ?? "none");
  check(
    "the name carries the __Host- prefix",
    session?.name === "__Host-next-auth.session-token",
    session?.name,
  );
  // The three rules a browser enforces before it will accept the prefix.
  check("__Host- requires Secure", opts?.secure === true, `secure=${String(opts?.secure)}`);
  check("__Host- requires Path=/", opts?.path === "/", `path=${String(opts?.path)}`);
  check(
    "__Host- forbids a Domain attribute",
    !("domain" in (opts ?? {})),
    "domain" in (opts ?? {}) ? `domain=${String(opts?.domain)} — the browser will DROP this cookie` : "absent",
  );
  // Not part of the prefix, but the properties the cookie had before and must
  // keep: it is a session credential.
  check("still httpOnly", opts?.httpOnly === true);
  check("still sameSite lax", opts?.sameSite === "lax");

  console.log("\nLocal development (http)");
  const dev = await loadAuthOptions("http://localhost:3000");
  const devSession = dev.cookies?.sessionToken;
  const devOpts = devSession?.options as Record<string, unknown> | undefined;

  // The prefix must NOT be used here: a Secure cookie is not stored over http,
  // so a __Host- name locally is a sign-in that silently never completes.
  check(
    "no __Host- prefix over http",
    devSession?.name === "next-auth.session-token",
    devSession?.name,
  );
  check("not Secure over http", devOpts?.secure === false, `secure=${String(devOpts?.secure)}`);

  console.log(`\n${failures === 0 ? "OK" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
