import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SITE_NAME, SITE_URL, JsonLd, organizationJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Football tips, predictions, livescores`,
    template: `%s | ${SITE_NAME}`,
  },
  description: "Football predictions, tips, livescores, fixtures and stats.",
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
