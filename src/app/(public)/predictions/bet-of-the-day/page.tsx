import Link from "next/link";
import type { Metadata } from "next";
import { BetOfTheDayCard } from "@/components/BetOfTheDayCard";
import { getBetOfTheDay } from "@/lib/betOfTheDay";
import { betOfTheDayState, isCurrentBetOfTheDay } from "@/lib/betOfTheDayStatus";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd, matchDescription } from "@/lib/seo";
import { matchSlug, matchKey } from "@/lib/slug";
import { getFixtureEventContext } from "@/lib/predictionScope";
import { canViewCategory } from "@/lib/access";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { LinkTile } from "@/components/LinkTile";
import { Prose } from "@/components/Prose";

const BLURB = "One pick a day — the strongest call we have at a price worth taking, not the shortest-priced favourite.";

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
  if (!isCurrentBetOfTheDay(row)) {
    // A finished pick is history, not a recommendation to index.
    return {
      title: "Bet of the Day",
      description: "The latest Bet of the Day is no longer active — the next pick appears here once it is selected.",
      robots: { index: false, follow: true },
      alternates: { canonical: "/predictions/bet-of-the-day" },
    };
  }
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
      <div className="space-y-8">
        <CategoryMasthead kicker="One pick a day" title="Bet of the Day" blurb={BLURB} stats={[]} />
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm leading-relaxed text-gray-400">
          No Bet of the Day is selected right now. One pick a day is chosen from the strongest published tips at a
          genuine market price — check back shortly, or browse{" "}
          <Link href="/predictions/today" className="font-semibold text-brand hover:underline">
            today&apos;s tips
          </Link>
          .
        </div>
      </div>
    );
  }

  const { row } = data;
  const state = betOfTheDayState(row);
  const live = state === "LIVE";
  const slug = matchSlug({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoff: row.kickoff });

  // Venue, crests, competition badge and fixture status for the markup.
  const key = matchKey(row);
  const context = (await getFixtureEventContext([row])).get(key ?? "");

  // BET_OF_THE_DAY is ungated by design (see canViewCategory), but the check is
  // made rather than assumed: if the category is ever moved behind a
  // subscription, the description falls back to the pickless variant instead of
  // continuing to print the call into crawlable markup.
  const publicPick = canViewCategory("BET_OF_THE_DAY")
    ? { market: row.market, pick: row.pick, confidence: row.confidence }
    : null;

  return (
    <div className="space-y-8">
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
                  leagueApiId: row.leagueApiId,
                  homeTeamApiId: row.homeTeamApiId,
                  awayTeamApiId: row.awayTeamApiId,
                  ...context,
                  description: matchDescription({
                    homeTeam: row.homeTeam,
                    awayTeam: row.awayTeam,
                    leagueName: row.leagueName,
                    kickoff: row.kickoff,
                    topPick: publicPick,
                    marketCount: 1,
                  }),
                  ...(slug ? { url: `/predictions/match/${slug}` } : {}),
                }),
              ]
            : []),
        ]}
      />

      <CategoryMasthead
        kicker="One pick a day"
        title="Bet of the Day"
        blurb={BLURB}
        stats={[
          { label: "Confidence", value: `${row.confidence}%`, accent: true },
          ...(live && data.gate?.price != null ? [{ label: "Best odds", value: data.gate.price.toFixed(2) }] : []),
          ...(state === "SETTLED" ? [{ label: "Result", value: row.outcome.charAt(0) + row.outcome.slice(1).toLowerCase() }] : []),
        ]}
      />

      {!live && (
        <p className="rounded-3xl border border-brand-border bg-brand-card p-5 text-sm leading-relaxed text-gray-300">
          {state === "SETTLED"
            ? `The latest Bet of the Day has finished — result: ${row.outcome}. `
            : "The latest Bet of the Day has kicked off, so it is no longer an active recommendation. Its result appears here once settled. "}
          The next pick appears here as soon as it is selected.
        </p>
      )}

      <PremiumPanel kicker={live ? "Today's pick" : "Latest pick"} title={`${row.homeTeam} vs ${row.awayTeam}`} id="botd-pick" bare>
        <BetOfTheDayCard data={data} variant="page" inactive={!live} />
      </PremiumPanel>

      {row.matchPreview && (
        <PremiumPanel kicker="Context" title="Match preview" id="botd-preview">
          <Prose text={row.matchPreview} />
        </PremiumPanel>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <LinkTile href="/predictions/today" title="Today's tips" desc="Every published prediction for today's matches." />
        <LinkTile href="/track-record" title="Track record" desc="Settled results, wins and losses alike." />
      </div>
    </div>
  );
}
