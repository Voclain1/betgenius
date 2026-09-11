import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { CATEGORY_BLURBS } from "@/lib/categoryPredictions";

export const metadata: Metadata = {
  title: "Football Predictions & Betting Tips",
  description: "Browse today's football predictions by category, with confidence ratings, match reasoning and a public record of settled results.",
  // Self-canonical, like the category feeds this page links to.
  alternates: { canonical: "/predictions" },
};

// Descriptions come from CATEGORY_BLURBS, the single copy of this copy — the
// feeds' own answer paragraphs quote the same strings, so a card here and the
// page it links to can't describe the category differently.
const cats = [
  { slug: "today", name: "Today's predictions", desc: CATEGORY_BLURBS.TODAY },
  { slug: "featured", name: "Featured tips", desc: CATEGORY_BLURBS.FEATURED },
  { slug: "genius", name: "Genius tips", desc: CATEGORY_BLURBS.GENIUS },
  { slug: "banker", name: "Banker", desc: CATEGORY_BLURBS.BANKER },
  { slug: "bet-of-the-day", name: "Bet of the Day", desc: CATEGORY_BLURBS.BET_OF_THE_DAY },
  { slug: "combo-bets", name: "Combo Bet predictions", desc: CATEGORY_BLURBS.SAME_GAME_DOUBLE },
  { slug: "vip", name: "VIP", desc: CATEGORY_BLURBS.VIP },
  { slug: "premium", name: "Premium", desc: CATEGORY_BLURBS.PREMIUM },
];

const evidenceLinks = [
  { href: "/track-record", name: "Track record", desc: "Review settled predictions, including both wins and losses." },
  { href: "/methodology", name: "How predictions are assessed", desc: "Understand the evidence, confidence ratings and limitations behind a pick." },
  { href: "/fixtures", name: "Football fixtures", desc: "Browse matches by date and open the prediction where one has been published." },
  { href: "/responsible-gambling", name: "Responsible gambling", desc: "Use predictions as information, never as a guarantee of an outcome." },
];

export default function PredictionsIndex() {
  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Predictions", path: "/predictions" }])} />
      <header className="max-w-3xl space-y-3">
        <h1 className="text-2xl font-bold md:text-3xl">Football predictions and betting tips</h1>
        <p className="text-gray-300">
          Start with today&apos;s full card or browse a focused selection below. Each published football prediction names its market and pick, shows a confidence rating where public, and explains the match evidence behind the assessment.
        </p>
        <p className="text-sm text-gray-400">
          Predictions are statistical assessments, not promises. Results remain uncertain, so review the reasoning and public record before making your own decision.
        </p>
      </header>

      <section aria-labelledby="prediction-categories">
        <h2 id="prediction-categories" className="mb-4 text-xl font-semibold">Browse predictions by category</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <Link key={c.slug} href={`/predictions/${c.slug}`} className="card hover:border-brand">
              <div className="text-lg font-semibold">{c.name}</div>
              <p className="text-sm text-gray-400">{c.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="using-predictions" className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="card space-y-3">
          <h2 id="using-predictions" className="text-xl font-semibold">How to use a BetGenius prediction</h2>
          <p className="text-sm leading-6 text-gray-300">
            Read the market and pick first, then compare the stated confidence with the supporting form, head-to-head history, standings, team news and other match context available on the page. Confidence describes the strength of the assessment; it does not remove football&apos;s uncertainty.
          </p>
          <p className="text-sm leading-6 text-gray-300">
            For a broader view, move from a match to its league or team page. Those pages connect current fixtures with standings, recent form and previously published predictions, helping you assess a pick in context rather than in isolation.
          </p>
        </div>
        <div className="card space-y-3">
          <h2 className="text-xl font-semibold">What you can verify</h2>
          <p className="text-sm leading-6 text-gray-300">
            BetGenius keeps settled results visible and explains its editorial standard. Check the track record for sample sizes and outcomes, then read the methodology for what the model considers and where the available data may be incomplete.
          </p>
          <p className="text-sm leading-6 text-gray-300">
            No prediction guarantees winnings. Only adults aged 18 or older should participate in betting, and nobody should stake money they cannot afford to lose.
          </p>
        </div>
      </section>

      <section aria-labelledby="prediction-evidence">
        <h2 id="prediction-evidence" className="mb-4 text-xl font-semibold">Explore the evidence</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {evidenceLinks.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-xl border border-brand-border bg-brand-card p-4 hover:border-brand">
              <div className="font-semibold">{item.name}</div>
              <p className="mt-1 text-sm text-gray-400">{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
