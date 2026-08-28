import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo";

export function trustMetadata(title: string, description: string, path: string): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${title} | BetGenius`, description, url, siteName: "BetGenius", type: "website" },
    twitter: { card: "summary", title: `${title} | BetGenius`, description },
  };
}
