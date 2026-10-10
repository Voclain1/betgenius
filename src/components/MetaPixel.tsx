import Script from "next/script";

/**
 * Meta (Facebook) Pixel, for attributing ad traffic and conversions.
 *
 * Loaded `afterInteractive` from the body for the same reason as GA4 — see
 * Analytics.tsx: nothing on screen depends on it, so it must not compete with
 * the two pre-paint head scripts.
 *
 * WHY THE ID IS A LITERAL BUT THE TAG IS STILL GATED. The pixel id is public by
 * design (it ships in the page), so it lives here rather than in an env var
 * that could be forgotten on the next deployment. What must not happen is
 * preview deployments and `next dev` sessions firing PageViews into the same
 * pixel as real visitors — that would pollute ad attribution and audiences.
 * VERCEL_ENV is set by Vercel itself to "production" only on the production
 * deployment, so everywhere else this renders nothing.
 *
 * CLIENT-SIDE NAVIGATION. The stock snippet fires one PageView on load. App
 * Router navigations do not reload the document; fbevents.js listens to
 * history pushState itself and fires a PageView for each one, so nothing
 * extra is needed here.
 */

const META_PIXEL_ID = "4101746286793473";

export function MetaPixel() {
  if (process.env.VERCEL_ENV !== "production") return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
