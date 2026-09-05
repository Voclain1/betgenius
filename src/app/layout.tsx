import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SITE_NAME, SITE_URL, JsonLd, organizationJsonLd } from "@/lib/seo";
import { SOCIAL_CARD_IMAGE } from "@/lib/brandAssets";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { APP_SHELL_INIT_SCRIPT } from "@/lib/appShell";

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
  // All supplied artwork from the brand pack, checked in verbatim.
  //
  // favicon.ico is listed first and is the only multi-size entry: it carries
  // 16, 32 and 48 in one file, and it is what Windows/pinned-tab surfaces and
  // older browsers pick up. The PNGs follow for everything that prefers them —
  // a browser takes the best match for the size it needs, so listing 16/32/48
  // separately is what stops a 48px tab bar downsampling the 32.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    // iOS reads only this one — it ignores the manifest's icon list entirely.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // The site-wide social card. Per-page metadata (see lib/trustMetadata.ts and
  // the route-level exports) overrides title/description/url but inherits this
  // image, so a page that sets no image of its own still previews as the brand
  // rather than as a bare link.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — Football tips, predictions, livescores`,
    description: "Football predictions, tips, livescores, fixtures and stats.",
    images: [SOCIAL_CARD_IMAGE],
  },
  twitter: {
    // `summary`, not `summary_large_image`: the pack's social artwork is a
    // 1024x1024 square, which a large-image card would letterbox.
    card: "summary",
    title: `${SITE_NAME} — Football tips, predictions, livescores`,
    description: "Football predictions, tips, livescores, fixtures and stats.",
    images: [SOCIAL_CARD_IMAGE],
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
  // Two entries so the browser chrome matches the rendered page in both
  // themes. A single value would leave the address bar showing the dark green
  // over a light page.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0f14" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script below sets data-theme on <html>
    // before React hydrates, so the server-rendered markup for this element
    // legitimately differs from the client's. The warning would be noise.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint to prevent a flash of the wrong theme —
            see THEME_INIT_SCRIPT for why React cannot do this job. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Same pre-paint reasoning, for the other thing the document has to
            know before it renders: whether this is a browser tab or the
            installed app. Marks <html> so the chrome in globals.css resolves on
            the first paint instead of swapping after hydration. Detection is
            not restated here — the script embeds the tested functions from
            src/lib/installPrompt.ts. See APP_SHELL_INIT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: APP_SHELL_INIT_SCRIPT }} />
      </head>
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
