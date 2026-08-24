import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SITE_NAME, SITE_URL, JsonLd, organizationJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Football tips, predictions, livescores`,
    template: `%s | ${SITE_NAME}`,
  },
  description: "Football predictions, tips, livescores, fixtures and stats.",
  // Next serves the manifest from src/app/manifest.ts at this path; naming it
  // explicitly is what puts the <link rel="manifest"> in the document head,
  // which is what makes the app installable at all.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }],
    // iOS reads only this one — it ignores the manifest's icon list entirely.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // iOS has no manifest support, so standalone display and the status-bar
    // treatment have to be declared separately here. `title` is what shows
    // under the icon on an iOS home screen.
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
};

/**
 * `themeColor` belongs on the viewport export, not on metadata — Next 14 warns
 * and drops it otherwise. It tints the Android status bar in standalone mode
 * and must match the manifest's `theme_color`.
 *
 * `viewportFit: "cover"` is what lets the app paint into the notch area on an
 * installed iOS home-screen app; without it a standalone launch renders with
 * letterboxed bars.
 */
export const viewport: Viewport = {
  themeColor: "#00c853",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Emitted once site-wide so BetGenius is understood as an entity
            rather than a set of unrelated pages. No rich result is expected
            from this — see the note on sportsEventJsonLd in src/lib/seo.tsx
            about why no Article or FAQPage markup is emitted anywhere. */}
        <JsonLd data={organizationJsonLd()} />
        <ServiceWorkerRegistration />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
