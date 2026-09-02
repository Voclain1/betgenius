import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import {
  CATEGORY_SLUGS as SLUGS,
  CATEGORY_NAMES as NAMES,
  getCategoryPredictions,
  parseFeedDay,
  dayShowsOutcomes,
  feedDayHref,
} from "@/lib/categoryPredictions";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures } from "@/lib/seo";

export async function generateMetadata(
  { params, searchParams }: { params: { category: string }; searchParams?: { date?: string } },
): Promise<Metadata> {
  const cat = SLUGS[params.category];
  if (!cat) return {};
  // Same resolved day as the page body, so cache() serves ONE query for both.
  const day = parseFeedDay(searchParams?.date);
  const name = NAMES[cat];
  const seoTitle = cat === "TODAY" ? "Today's Predictions"
    : cat === "VIP" ? "VIP Predictions"
    // Grounded in the term readers actually search, same approach as the
    // homepage hero: "Combo Bet Predictions", not the bare category name.
    : cat === "SAME_GAME_DOUBLE" ? "Combo Bet Predictions"
    : name;
  const seoPhrase = cat === "TODAY" ? "today's predictions"
    : cat === "VIP" ? "VIP predictions"
    : cat === "SAME_GAME_DOUBLE" ? "combo bet predictions — two picks on the same match"
    : name.toLowerCase();
  const emptyDescription = cat === "TODAY"
    ? "Today's predictions are not published yet — check back soon for our latest football picks."
    : `No ${seoPhrase} published yet — check back soon for our latest football predictions.`;
  const rows = await getCategoryPredictions(cat, day);

  // Thin/empty content shouldn't claim a rich, specific title as if it had
  // real picks to show — and search engines shouldn't index a page with
  // nothing on it yet.
  if (rows.length === 0) {
    return {
      title: seoTitle,
      description: emptyDescription,
      robots: { index: false, follow: true },
      alternates: { canonical: feedDayHref(params.category, day) },
    };
  }

  const sample = rows
    .slice(0, 3)
    .map((r) => (r.homeTeam ? `${r.homeTeam} vs ${r.awayTeam}` : r.fixture ? `${r.fixture.homeTeam?.name} vs ${r.fixture.awayTeam?.name}` : null))
    .filter(Boolean)
    .join(", ");

  return {
    title: seoTitle,
    description: `${rows.length} ${day === "yesterday" ? "settled " : day === "tomorrow" ? "upcoming " : cat === "TODAY" ? "of " : "live "}${seoPhrase}${sample ? ` — including ${sample}` : ""}. Football predictions with confidence ratings, updated daily.`,
    // Each day is self-canonical: yesterday's results and tomorrow's card are
    // different content, and pointing them at today's URL would claim otherwise.
    alternates: { canonical: feedDayHref(params.category, day) },
  };
}

export default async function CategoryPage(
  { params, searchParams }: { params: { category: string }; searchParams?: { date?: string } },
) {
  const cat = SLUGS[params.category];
  if (!cat) return notFound();
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);

  const session = await getServerSession(authOptions);
  const canView = canViewCategory(cat, session?.user.tier, session?.user.subStatus, session?.user.role);

  const rows = await getCategoryPredictions(cat, day);

  const needsRegistration = !canView && cat === "BANKER" && !session?.user;
  const lockReason = needsRegistration
    ? "Sign up free to unlock this tip and full reasoning."
    : "Subscribe to VIP or Premium to unlock this tip and full reasoning.";

  // Badge reflects the feed being browsed, not necessarily the tip's stored
  // primary category — a tip can be cross-posted into multiple feeds.
  const shaped = rows.map((r) =>
    canView
      // showOutcomes is the ONLY day-dependent branch here. The gating below is
      // identical on all three days by construction — there is no second path.
      ? { ...r, category: cat, outcome: showOutcomes ? r.outcome : null }
      : {
          ...r,
          category: cat,
          outcome: showOutcomes ? r.outcome : null,
          pick: "LOCKED",
          reasoning: lockReason,
          matchPreview: null,
          confidence: null,
          odds: null,
          locked: true,
        },
  );

  const slug = params.category;
  // url points at the match page, so the SportsEvent resolves to the one page
  // that collects every market for the fixture rather than to a feed — and one
  // event per fixture, since this feed lists a row per market.
  const events = sportsEventsForFixtures(
    rows
      .map((r) => {
        const home = r.homeTeam ?? r.fixture?.homeTeam?.name;
        const away = r.awayTeam ?? r.fixture?.awayTeam?.name;
        if (!home || !away) return null;
        return {
          homeTeam: home,
          awayTeam: away,
          kickoff: r.kickoff ?? r.fixture?.kickoff ?? null,
          league: r.leagueName ?? r.fixture?.league?.name,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  );

  return (
    <div className="space-y-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: NAMES[cat], path: `/predictions/${slug}` },
          ]),
          ...events,
        ]}
      />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{NAMES[cat]}</h1>
          <p className="text-sm text-gray-400">
            {shaped.length}{" "}
            {day === "yesterday" ? "settled picks" : day === "tomorrow" ? "picks for tomorrow" : "live picks"}
          </p>
        </div>
        {!canView && (cat === "VIP" || cat === "PREMIUM") && (
          <Link href="/pricing" className="btn btn-primary">Unlock {cat === "VIP" ? "VIP" : "Premium"}</Link>
        )}
        {needsRegistration && (
          <Link href="/register" className="btn btn-primary">Sign up free</Link>
        )}
      </div>

      <FeedDayTabs basePath={`/predictions/${slug}`} active={day} />

      <CategoryPredictionsList category={cat} rows={shaped as any} />
    </div>
  );
}
