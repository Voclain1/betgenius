import Script from "next/script";

/**
 * Google Analytics 4.
 *
 * WHY `afterInteractive` AND NOT THE RAW TAG IN <head>. The snippet Google
 * hands you is `<script async>` in the document head. This layout already has
 * two head scripts, and both are there for a reason no other placement can
 * satisfy: they must run BEFORE first paint or the page flashes the wrong
 * theme. Analytics is the opposite — nothing on screen depends on it, and a
 * measurement call competing with the first paint is main-thread time spent
 * on something the reader cannot see. `afterInteractive` loads it once the
 * page is usable, which is Next's documented placement for exactly this tag.
 *
 * WHY THE ID COMES FROM THE ENVIRONMENT. A measurement ID is not a secret —
 * it ships in the client HTML by definition — so this is not about hiding it.
 * It is about WHERE the tag runs. Hard-coding it would send every preview
 * deployment and every `next dev` session on someone's laptop into the same
 * property as production, and that traffic is indistinguishable from real
 * readers once it lands. The variable is set on Production only, so previews
 * and local development render nothing at all.
 *
 * Unset therefore means NO TAG, deliberately. If analytics stops reporting,
 * check that NEXT_PUBLIC_ADS_ORIGIN's neighbour NEXT_PUBLIC_GA_ID is still
 * present in the Production environment before looking anywhere else.
 *
 * THE ADS HOSTNAME NEVER RENDERS THIS. ads.betgenius.ng points at this same
 * deployment, but src/middleware.ts 404s everything on it outside /ads/, and
 * /ads/frame is a route handler that never mounts this layout. So the ad
 * frame's document carries no analytics — which is correct twice over: it is
 * not a page anyone reads, and its traffic would otherwise double-count every
 * pageview that happens to carry an ad slot.
 *
 * CLIENT-SIDE NAVIGATION. This is the stock snippet, which fires one
 * `page_view` on load. App Router route changes do not reload the document,
 * so they are picked up by GA4's Enhanced Measurement "page changes based on
 * browser history events" setting rather than by anything here. That setting
 * is on by default; if in-app navigations ever stop appearing in reports,
 * that toggle is the thing to check, not this file.
 */

const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

/**
 * A GA4 measurement ID, and nothing else, may reach the inline script below.
 * The value is interpolated into executable JavaScript, so it is validated
 * rather than trusted: an environment variable is a weaker guarantee than a
 * literal, and "it is only ever set by us" is exactly the assumption that
 * stops being true later.
 */
const VALID_GA_ID = /^G-[A-Z0-9]+$/;

export function Analytics() {
  if (!GA_ID) return null;

  if (!VALID_GA_ID.test(GA_ID)) {
    // Loud in the build log, silent on the page: a malformed id means no
    // measurement, never a broken script tag in front of readers.
    console.warn(`[analytics] NEXT_PUBLIC_GA_ID is not a GA4 measurement id: ${JSON.stringify(GA_ID)} — no tag rendered`);
    return null;
  }

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
