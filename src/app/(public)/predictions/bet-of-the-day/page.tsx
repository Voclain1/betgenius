import Link from "next/link";
import type { Metadata } from "next";
import { BetOfTheDayCard } from "@/components/BetOfTheDayCard";
import { getBetOfTheDay } from "@/lib/betOfTheDay";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd } from "@/lib/seo";
import { matchSlug } from "@/lib/slug";

/**
 * The dedicated Bet of the Day page.
 *
 * A STATIC segment, which is what makes it take precedence over the sibling
 * [category] route — "bet-of-the-day" is registered in CATEGORY_SLUGS, so the
 * generic feed would otherwise answer this URL and render the pick as a
 * one-row card grid with no price on it. This page exists specifically to show
 * the price, the book count and the market's implied probability, which the
 * generic category page has no concept of.
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const data = await getBetOfTheDay();
  if (!data) {
    return {
      title: "Bet of the Day",
      description: "Today's Bet of the Day has not been selected yet — check back shortly.",
      robots: { index: false, follow: true },
      alternates: { canonical: "/predictions/bet-of-the-day" },
    };
  }
  const { row, gate } = data;
  const price = gate?.price != null ? ` at ${gate.price.toFixed(2)}` : "";
  return {
    title: "Bet of the Day",
    description: `Bet of the Day: ${row.pick} — ${row.market}${price} for ${row.homeTeam} vs ${row.awayTeam}. ${row.confidence}% confidence with the full reasoning.`,
    alternates: { canonical: "/predictions/bet-of-the-day" },
  };
}

export default async function BetOfTheDayPage() {
  const data = await getBetOfTheDay();

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Bet of the Day</h1>
        <div className="card text-gray-400">
          No Bet of the Day is selected right now. One pick a day is chosen from the strongest published tips at a
          genuine market price — check back shortly, or browse{" "}
          <Link href="/predictions/today" className="text-brand hover:underline">
            today&apos;s tips
          </Link>
          .
        </div>
      </div>
    );
  }

  const { row } = data;
  const slug = matchSlug({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff });

  return (
    <div className="space-y-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: "Bet of the Day", path: "/predictions/bet-of-the-day" },
          ]),
          ...(row.homeTeam && row.awayTeam
            ? [
                sportsEventJsonLd({
                  homeTeam: row.homeTeam,
                  awayTeam: row.awayTeam,
                  kickoff: row.kickoff,
                  league: row.leagueName,
                  ...(slug ? { url: `/predictions/match/${slug}` } : {}),
                }),
              ]
            : []),
        ]}
      />

      <div>
        <h1 className="text-2xl font-bold">Bet of the Day</h1>
        <p className="text-sm text-gray-400">
          One pick a day — the strongest call we have at a price worth taking, not the shortest-priced favourite.
        </p>
      </div>

      <BetOfTheDayCard data={data} variant="page" />

      {row.matchPreview && (
        <div className="card space-y-2">
          <h2 className="text-sm uppercase text-gray-400">Match preview</h2>
          <p className="text-sm leading-relaxed text-gray-300">{row.matchPreview}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/predictions/today" className="btn btn-ghost">
          Today&apos;s tips
        </Link>
        <Link href="/track-record" className="btn btn-ghost">
          Track record
        </Link>
      </div>
    </div>
  );
}
