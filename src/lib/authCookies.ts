/**
 * The session cookie's name, in one place, because it is read in two.
 *
 * WHY THIS MODULE EXISTS AS ITS OWN FILE. NextAuth resolves the cookie name
 * from `authOptions` when it SETS the cookie, and the middleware resolves it
 * again — independently — when it READS one, because `withAuth` runs in the
 * Edge runtime and never sees `authOptions`. Derive the name in both places
 * and they can disagree; when they do, sign-in succeeds and sets a cookie the
 * middleware then cannot find, so every protected route redirects a
 * signed-in user back to the login page. That is exactly what happened when
 * the `__Host-` prefix was introduced in authOptions alone.
 *
 * So it lives here and both import it. This file must stay free of any
 * dependency — no Prisma, no bcrypt, nothing Node-only — because middleware
 * imports it and the Edge runtime would reject the bundle.
 *
 * See the long note in src/lib/auth.ts for why the prefix is `__Host-`, and
 * why it is conditional rather than hard-coded.
 */

/** Mirrors NextAuth's own rule: an https deployment means secure cookies. */
export const useSecureAuthCookies = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

/**
 * `__Host-` in production, plain in local http development. The prefix
 * requires the Secure flag, and a Secure cookie is not stored over http, so
 * the name has to track the same signal that decides the flag.
 */
export const SESSION_COOKIE_NAME = useSecureAuthCookies
  ? "__Host-next-auth.session-token"
  : "next-auth.session-token";
