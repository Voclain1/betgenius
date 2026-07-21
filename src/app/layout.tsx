import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Football tips, predictions, livescores`,
    template: `%s | ${SITE_NAME}`,
  },
  description: "AI-powered football predictions, tips, livescores, fixtures and stats.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
