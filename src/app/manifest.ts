import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo";

/**
 * The PWA manifest, served at /manifest.webmanifest.
 *
 * Written as a route rather than a static public/manifest.json so the app name
 * comes from the same SITE_NAME constant the page titles and structured data
 * use — a manifest whose name has drifted from the site's is what a user sees
 * on their home screen forever after installing.
 *
 * This is the first half of the TWA prerequisite: Play Store packaging reads
 * `name`, `short_name`, `start_url`, `display` and the 512px maskable icon
 * straight out of this document, and refuses a manifest missing any of them.
 * The service worker (public/sw.js) is the other half.
 *
 * `background_color` and `theme_color` are what Android composites the splash
 * screen from — background behind, 512px icon centred, theme colour on the
 * status bar. There is no separate splash image to author on Android; getting
 * these two colours right IS the splash screen, which is why background_color
 * matches the app's own page background exactly (brand.bg in
 * tailwind.config.ts). A mismatch shows as a white flash between the splash
 * and the first paint.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Football tips & predictions`,
    short_name: SITE_NAME,
    description: "Football predictions with confidence ratings, livescores, fixtures, standings and a bet builder.",
    start_url: "/",
    // Everything under the origin is in scope; the service worker's navigation
    // handling assumes the same, so the two must not disagree.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0f14",
    theme_color: "#00c853",
    categories: ["sports", "news"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops these to its own shape, so they carry the safe-zone
      // padding the `any` icons deliberately do not.
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today's tips", short_name: "Today", url: "/predictions/today" },
      { name: "Livescores", short_name: "Live", url: "/livescores" },
      { name: "Fixtures", short_name: "Fixtures", url: "/fixtures" },
    ],
  };
}
