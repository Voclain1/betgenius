import type { Metadata } from "next";
import Link from "next/link";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { OddsCalculator } from "@/components/OddsCalculator";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Odds to Probability Calculator",
  description: "Turn decimal, fractional or American odds into the chance they imply, see a bookmaker's margin, and work out the fair probability of each outcome.",
  alternates: { canonical: "/odds-calculator" },
};

export default function OddsCalculatorPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Odds calculator", path: "/odds-calculator" }])]} />
      <CategoryMasthead
        kicker="Tools"
        title="Odds to probability calculator"
        blurb="See what a price really says before you stake: the chance it implies, the win rate it needs to break even, and how much margin the bookmaker has built into a market."
        stats={[]}
      />

      <OddsCalculator />

      <section aria-labelledby="reading-heading" className="space-y-3">
        <h2 id="reading-heading" className="text-xl font-black tracking-tight text-gray-100">Reading the numbers</h2>
        <p className="text-sm leading-7 text-gray-300">
          Implied chance is 1 divided by the decimal odds: 2.50 implies 40%. It is the price&apos;s break-even point, not a forecast, and every
          bookmaker market adds a margin on top of the real chances. A short price is a likely outcome, never a certain one.
        </p>
        <p className="text-sm leading-7 text-gray-300">
          The full explanation, with worked examples, is in{" "}
          <Link href="/guides/football-odds-and-implied-probability" className="font-semibold text-brand hover:underline">football odds and implied probability, explained</Link>.
          For several selections at once, the <Link href="/bet-builder" className="font-semibold text-brand hover:underline">bet builder</Link> multiplies the odds for you.
        </p>
      </section>

      <section aria-labelledby="responsible-heading" className="rounded-3xl border border-brand-border bg-brand-card p-5 sm:p-6">
        <h2 id="responsible-heading" className="text-lg font-black text-gray-100">Before you bet</h2>
        <p className="mt-2 text-sm leading-7 text-gray-300">
          This calculator describes prices; it does not predict results or tell you to bet. Stake only money you can afford to lose,
          set your limits in advance, and never chase losses. You must be 18 or over and gambling where it is legal for you.{" "}
          <Link href="/responsible-gambling" className="font-semibold text-brand hover:underline">Responsible gambling and support</Link>.
        </p>
      </section>
    </div>
  );
}
