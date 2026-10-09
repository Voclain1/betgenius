import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { LinkTile } from "@/components/LinkTile";
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
  { slug: "goals", name: "Goals", desc: CATEGORY_BLURBS.GOALS },
  { slug: "vip", name: "VIP", desc: CATEGORY_BLURBS.VIP },
  { slug: "premium", name: "Premium", desc: CATEGORY_BLURBS.PREMIUM },
];

const evidenceLinks = [
  { href: "/track-record", name: "Track record", desc: "Review settled predictions, including both wins and losses." },
  { href: "/methodology", name: "How predictions are assessed", desc: "Understand the evidence, confidence ratings and limitations behind a pick." },
  { href: "/fixtures", name: "Football fixtures", desc: "Browse matches by date and open the prediction where one has been published." },
  { href: "/responsible-gambling", name: "Responsible gambling", desc: "Use predictions as information, never as a guarantee of an outcome." },
];

const marketHubs = [
  {
    href: "/predictions/over-2-5-goals",
    name: "Over 2.5 Goals predictions",
    desc: "Matches assessed for at least three total goals, with the supporting evidence and settled record.",
  },
  {
    href: "/predictions/btts",
    name: "BTTS predictions",
    desc: "Both Teams to Score Yes and No picks, with match evidence and the settled market record.",
  },
  {
    href: "/predictions/double-chance",
    name: "Double Chance predictions",
    desc: "Home-or-Draw, Away-or-Draw and Home-or-Away picks with supporting evidence and settled results.",
  },
];

export default function PredictionsIndex() {
  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Predictions", path: "/predictions" }])} />
      <CategoryMasthead
        kicker="Predictions"
        title="Football predictions and betting tips"
        blurb={
          <>
            Start with today&apos;s full card or browse a focused selection below. Each published football prediction names its market and pick, shows a confidence rating where public, and explains the match evidence behind the assessment.
            <span className="mt-2 block text-sm text-gray-400">
              Predictions are statistical assessments, not promises. Results remain uncertain, so review the reasoning and public record before making your own decision.
            </span>
          </>
        }
        stats={[]}
      />

      <PremiumPanel kicker="Categories" title="Browse predictions by category" id="prediction-categories" bare>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <LinkTile key={c.slug} href={`/predictions/${c.slug}`} title={c.name} desc={c.desc} />
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Markets" title="Browse predictions by market" id="prediction-markets" bare>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {marketHubs.map((market) => (
            <LinkTile key={market.href} href={market.href} title={market.name} desc={market.desc} />
          ))}
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Reading a pick" title="How to use a BetGenius prediction" id="using-predictions">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm leading-7 text-gray-300">
              Read the market and pick first, then compare the stated confidence with the supporting form, head-to-head history, standings, team news and other match context available on the page. Confidence describes the strength of the assessment; it does not remove football&apos;s uncertainty.
            </p>
            <p className="text-sm leading-7 text-gray-300">
              For a broader view, move from a match to its league or team page. Those pages connect current fixtures with standings, recent form and previously published predictions, helping you assess a pick in context rather than in isolation.
            </p>
          </div>
          <div className="space-y-3 border-t border-brand-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">What you can verify</h3>
            <p className="text-sm leading-7 text-gray-300">
              BetGenius keeps settled results visible and explains its editorial standard. Check the track record for sample sizes and outcomes, then read the methodology for what the model considers and where the available data may be incomplete.
            </p>
            <p className="text-sm leading-7 text-gray-300">
              No prediction guarantees winnings. Only adults aged 18 or older should participate in betting, and nobody should stake money they cannot afford to lose.
            </p>
          </div>
        </div>
      </PremiumPanel>

      <PremiumPanel kicker="Evidence" title="Explore the evidence" id="prediction-evidence" bare>
        <div className="grid gap-4 sm:grid-cols-2">
          {evidenceLinks.map((item) => (
            <LinkTile key={item.href} href={item.href} title={item.name} desc={item.desc} />
          ))}
        </div>
      </PremiumPanel>
    </div>
  );
}
