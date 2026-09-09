import { NextResponse, type NextRequest } from "next/server";
import withAuth from "next-auth/middleware";
import { SESSION_COOKIE_NAME } from "@/lib/authCookies";

/**
 * Two unrelated jobs, kept apart deliberately.
 *
 * 1. THE ADS HOSTNAME SERVES ONE ROUTE AND NOTHING ELSE.
 *
 *    The ad frame is served from its own host (ads.betgenius.ng) so the Same
 *    Origin Policy, rather than a sandbox flag, is what keeps third-party ad
 *    code away from the site — see the ADS_ORIGIN note in src/lib/ads.ts. That
 *    host points at this same deployment, which means without this gate the
 *    ENTIRE site would also answer on it: a second, crawlable copy of every
 *    page, a second origin people could log in on, and a duplicate of the
 *    whole app competing with itself in search.
 *
 *    So anything on that host outside /ads/ is a 404. The check is on the Host
 *    header rather than on a rewrite rule because this deployment cannot know
 *    which domains point at it until a request arrives.
 *
 * 2. /admin AND /dashboard STILL REQUIRE A SESSION.
 *
 *    That was previously the whole of this file, as a bare re-export of
 *    next-auth's middleware with a matcher naming those two trees. It cannot
 *    stay a bare re-export now: the matcher has to widen to every path for the
 *    host check above, and next-auth's middleware protects everything it runs
 *    on. Widening the matcher on the re-export would therefore put the entire
 *    public site behind a login. So auth is invoked explicitly, for exactly
 *    the two prefixes it covered before, and every other path returns
 *    NextResponse.next() untouched.
 */

const PROTECTED = /^\/(admin|dashboard)(\/|$)/;

/**
 * The hostname the ad frame is served from, derived from the same env var the
 * client builds frame URLs with, so the gate and the URLs cannot disagree.
 * Unset (local dev, previews without the domain) disables the gate entirely
 * and the app behaves exactly as it did before.
 */
const ADS_HOST = (() => {
  const origin = process.env.NEXT_PUBLIC_ADS_ORIGIN ?? "";
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
})();

/**
 * next-auth's middleware, called only for the two protected trees.
 *
 * THE COOKIE NAME MUST BE PASSED IN. `withAuth` reads the session with
 * getToken(), which runs in the Edge runtime, never sees authOptions, and
 * otherwise falls back to NextAuth's DEFAULT cookie name. The session cookie
 * is named `__Host-next-auth.session-token`, so without this the middleware
 * looks for a cookie that is never set: sign-in works, the cookie is issued,
 * and then every /admin and /dashboard request redirects the signed-in user
 * straight back to the login page. Verified in production — that is exactly
 * what happened before this argument was added.
 */
const requireSession = withAuth({
  cookies: { sessionToken: { name: SESSION_COOKIE_NAME } },
}) as unknown as (req: NextRequest) => Promise<NextResponse> | NextResponse;

export default function middleware(req: NextRequest) {
  // `host` carries the port in dev; compare against the configured host as-is.
  const host = req.headers.get("host");

  if (ADS_HOST && host === ADS_HOST) {
    if (req.nextUrl.pathname.startsWith("/ads/")) return NextResponse.next();
    // Deliberately a plain 404 rather than a redirect to www: a redirect would
    // make the ads host a working entry point to the site, which is the thing
    // being prevented.
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
    });
  }

  if (PROTECTED.test(req.nextUrl.pathname)) return requireSession(req);

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next's own assets and images. The host gate has to see
   * every request; the auth branch above is what keeps the widened matcher
   * from changing who can read the public site.
   *
   * robots.txt and sitemap.xml are deliberately NOT excluded. They are the two
   * files whose whole purpose is to tell a crawler what to index, and leaving
   * them ungated served a robots.txt reading "Allow: /" on the ads hostname.
   * Running middleware over them costs a pass-through on www and 404s them on
   * the ads host, which is what should happen there.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|images/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|webmanifest)$).*)",
  ],
};
