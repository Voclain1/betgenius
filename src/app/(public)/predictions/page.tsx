import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { CATEGORY_BLURBS } from "@/lib/categoryPredictions";

export const metadata: Metadata = {
  title: "Football Predictions & Betting Tips",
  description: "Browse football predictions by category — Featured, Genius, Today's picks, Banker, VIP and Premium tips.",
  // Self-canonical, like the category feeds this page links to.
  alternates: { canonical: "/predictions" },
};

// Descriptions come from CATEGORY_BLURBS, the single copy of this copy — the
// feeds' own answer paragraphs quote the same strings, so a card here and the
// page it links to can't describe the category differently.
const cats = [
  { slug: "featured", name: "Featured tips", desc: CATEGORY_BLURBS.FEATURED },
  { slug: "genius", name: "Genius tips", desc: CATEGORY_BLURBS.GENIUS },
  { slug: "today", name: "Today's predictions", desc: CATEGORY_BLURBS.TODAY },
  { slug: "banker", name: "Banker", desc: CATEGORY_BLURBS.BANKER },
  { slug: "vip", name: "VIP", desc: CATEGORY_BLURBS.VIP },
  { slug: "premium", name: "Premium", desc: CATEGORY_BLURBS.PREMIUM },
];

export default function PredictionsIndex() {
  return (
    <div className="space-y-6">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Predictions", path: "/predictions" }])} />
      <h1 className="text-2xl font-bold">Predictions</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <Link key={c.slug} href={`/predictions/${c.slug}`} className="card hover:border-brand">
            <div className="text-lg font-semibold">{c.name}</div>
            <p className="text-sm text-gray-400">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
