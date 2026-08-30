import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo";
import { SOCIAL_CARD_IMAGE } from "@/lib/brandAssets";

export function trustMetadata(title: string, description: string, path: string): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    // `images` is repeated here rather than left to inherit from the root
    // layout: Next merges metadata per FIELD, not per key, so a page that
    // declares its own `openGraph` object replaces the layout's entirely and
    // would otherwise ship a card with no image at all.
    openGraph: {
      title: `${title} | BetGenius`,
      description,
      url,
      siteName: "BetGenius",
      type: "website",
      images: [SOCIAL_CARD_IMAGE],
    },
    // `summary` keeps the square 1024x1024 brand card unletterboxed — see
    // lib/brandAssets.ts.
    twitter: { card: "summary", title: `${title} | BetGenius`, description, images: [SOCIAL_CARD_IMAGE] },
  };
}
