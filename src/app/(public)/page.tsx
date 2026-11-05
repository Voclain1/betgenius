import { HomeCategoryNav } from "@/components/HomeCategoryNav";
import { HomepageExplainer } from "@/components/HomepageExplainer";
import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { PredictionsTable } from "@/components/PredictionsTable";
import { AdStickyMobile } from "@/components/ads/AdStickyMobile";
import { AdInterstitial } from "@/components/ads/AdInterstitial";
import { TopBanner } from "@/components/ads/TopBanner";
import { LeagueNav } from "@/components/LeagueNav";
import { RecentResults } from "@/components/RecentResults";
import { getRecentResults } from "@/lib/recentResultsSnapshot";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { parseFeedDay, dayShowsOutcomes, type FeedDay } from "@/lib/categoryPredictions";
import { HomeMasthead } from "@/components/HomeMasthead";
import { getHeroSlides } from "@/lib/heroSlides";
import { homeSummary, homeHeadline } from "@/lib/answerSummary";
import { BetOfTheDayCard } from "@/components/BetOfTheDayCard";
import { getHomepageBetOfTheDay } from "@/lib/betOfTheDay";
import { getLeaguesWithPublishedPredictions, popularLeagues, getPublishedMatchIndex, getFixtureEventContext } from "@/lib/predictionScope";
import { matchKey } from "@/lib/slug";
import { SITE_NAME, JsonLd, websiteJsonLd } from "@/lib/seo";
import { leagueSlug } from "@/lib/slug";
import { leaguePriorityRank, LEAGUE_PRIORITY_ORDER } from "@/lib/leagues";
import type { PredictionCategory } from "@/lib/enums";
import { lagosDayBounds } from "@/lib/lagosDate";
import {
  selectHomepageFeatured,
  selectHomepageGenius,
  featuredBarMessage,
  comboLegIds,
  isComboRow,
  HOMEPAGE_FEATURED_LIMIT,
} from "@/lib/homepageFeatured";
import { AdHalfBanner, AdLeaderboard, AdNativeBand, AdNativeCard, AdRectangle } from "@/components/ads/AdPlacements";
import { PremiumPanel } from "@/components/PremiumPanel";
import { SectionHead } from "@/components/TeamProfile";
import { LinkTile } from "@/components/LinkTile";
import { DayCompetitions } from "@/components/DayCompetitions";
import { selectDayCompetitions } from "@/lib/dayCompetitions";
import { TopMatches, type TopMatchCard } from "@/components/TopMatches";
import { getTopMatches, predictionSlug } from "@/lib/topMatches";
import { getLiveSnapshot } from "@/lib/liveSnapshot";
import { classifyStatus } from "@/lib/matchStatus";

export const revalidate = 60;

const BASE_METADATA: Metadata = {
  title: { absolute: `${SITE_NAME} — Football tips, predictions, livescores` },
  description: "Football predictions today across every major league — featured tips, livescores, fixtures, standings, a bet builder and StatsPad, all in one place.",
};

/**
 * A dated homepage is a browsing convenience, not a second landing page, so
 * ?date=yesterday|tomorrow is canonicalised back to "/" and left out of the
 * index. The per-day surfaces meant to be indexed are the category feeds,
 * which are self-canonical. Without this, two near-duplicate homepages would
 * compete with the real one.
 */
export function generateMetadata({ searchParams }: { searchParams?: { date?: string } }): Metadata {
  const day = parseFeedDay(searchParams?.date);
  if (day === "today") return { ...BASE_METADATA, alternates: { canonical: "/" } };
  return { ...BASE_METADATA, alternates: { canonical: "/" }, robots: { index: false, follow: true } };
}

/**
 * Every published pick in one category for the Lagos day being browsed.
 *
 * Unranked and uncapped: the homepage excerpts rank and cap it themselves
 * (src/lib/homepageFeatured.ts). Capping here with a `take` would hand the
 * ranking an arbitrary subset rather than the day's best picks.
 */
async function fetchCategoryDay(category: string, day: FeedDay) {
  const bounds = lagosDayBounds(day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0);
  return prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: bounds.start, lt: bounds.end }, categories: { some: { category } } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
}

/**
 * The day's homepage Featured picks, chosen by selectHomepageFeatured rather
 * than orderForDisplay: an outcome-blind ranking, so the same picks stay in
 * place from before kickoff through settlement, with single-market picks
 * ahead of any combo. See src/lib/homepageFeatured.ts.
 *
 * `published` is how many FEATURED rows the day has at all, which is what
 * separates "nothing published" from "nothing cleared the homepage bar" in
 * the empty state.
 *
 * Combo legs are loaded only when singles cannot fill the excerpt, since the
 * selector never looks at them otherwise.
 */
async function fetchFeatured(day: FeedDay) {
  const rows = await fetchCategoryDay("FEATURED", day);

  const singles = rows.filter((r) => !isComboRow(r)).length;
  const legs = await loadComboLegs(singles >= HOMEPAGE_FEATURED_LIMIT ? [] : rows);
  return { rows: selectHomepageFeatured(rows, legs), published: rows.length };
}

/** The legs behind any combos in `rows`, keyed by id. One query, or none when there are no combos. */
async function loadComboLegs(rows: Parameters<typeof comboLegIds>[0][]) {
  const legIds = rows.flatMap((r) => comboLegIds(r) ?? []);
  const legs = legIds.length
    ? await prisma.prediction.findMany({
        where: { id: { in: legIds } },
        select: {
          id: true, status: true, marketType: true, selection: true, confidence: true,
          contextComplete: true, homeTeamApiId: true, awayTeamApiId: true,
        },
      })
    : [];
  return new Map(legs.map((l) => [l.id, l]));
}

/**
 * The day's three homepage Genius picks: the same outcome-blind ranking as
 * Featured, so Yesterday's three do not change once results settle, and a
 * showcase of three different matches with no Over/Under 2.5 call in it.
 * Combo legs are loaded because a combo is judged by what its legs are.
 */
async function fetchGeniusPreview(day: FeedDay) {
  const rows = await fetchCategoryDay("GENIUS", day);
  return selectHomepageGenius(rows, await loadComboLegs(rows));
}

/**
 * The day's slate as counts — what the answer paragraph under the H1 states.
 *
 * Its own query rather than a derivation from the Featured/Genius excerpts
 * above: those are capped at six and three, so counting them would describe
 * the excerpt instead of the day. This counts every published pick whose
 * kickoff falls in the day being browsed, which is the same window the feeds
 * themselves use.
 *
 * Only headline competitions are named. leaguePriorityRank returns the length
 * of the priority list for anything unranked, so filtering on that keeps the
 * "led by" clause to leagues a reader recognises rather than whichever obscure
 * fixture happened to sort first.
 */
async function fetchDaySlate(day: FeedDay) {
  const bounds = lagosDayBounds(day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: bounds.start, lt: bounds.end } },
    select: { leagueName: true, leagueApiId: true },
  });

  const leagues = new Map<string, { name: string; leagueApiId: number | null }>();
  for (const r of rows) {
    if (!r.leagueName) continue;
    const key = leagueSlug(r.leagueName, r.leagueApiId);
    if (!leagues.has(key)) leagues.set(key, { name: r.leagueName, leagueApiId: r.leagueApiId });
  }

  const topLeagues = [...leagues.values()]
    .filter((l) => leaguePriorityRank(l.leagueApiId) < LEAGUE_PRIORITY_ORDER.length)
    .sort((a, b) => leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId))
    .slice(0, 3)
    .map((l) => l.name);

  // Counted rather than assumed. The answer paragraph names the banker only on
  // days one is actually tagged, and days with none are common enough that a
  // standing claim would be wrong regularly rather than rarely.
  const bankerCount = await prisma.prediction.count({
    where: {
      status: "PUBLISHED",
      kickoff: { gte: bounds.start, lt: bounds.end },
      categories: { some: { category: "BANKER" } },
    },
  });

  return { pickCount: rows.length, leagueCount: leagues.size, topLeagues, bankerCount, rows };
}

export default async function HomePage({ searchParams }: { searchParams?: { date?: string } }) {
  // Reading searchParams does NOT change this page's render mode: it already
  // renders dynamically on every request because getServerSession below reads
  // cookies, which is why the `revalidate = 60` above never took effect.
  // Verified in production: Cache-Control is no-store and x-vercel-cache MISS.
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [featured, geniusPreview, session, leagues, matchIndex, heroSlides, betOfTheDay, slate, recentResults] = await Promise.all([
    fetchFeatured(day),
    fetchGeniusPreview(day),
    getServerSession(authOptions),
    getLeaguesWithPublishedPredictions(),
    getPublishedMatchIndex(),
    // Today's top picks, fixed for the day once chosen (lib/heroSlides).
    getHeroSlides().catch(() => []),
    getHomepageBetOfTheDay(),
    fetchDaySlate(day),
    // Never throws: a failed read serves the last stored copy, or nothing.
    getRecentResults(),
  ]);
  // Crests for the Bet of the Day card: one batched read, only when a pick holds the slot.
  const botdContext = betOfTheDay ? (await getFixtureEventContext([betOfTheDay.row])).get(matchKey(betOfTheDay.row) ?? "") : undefined;
  const viewer = await getViewerEntitlement();
  // The day's biggest published games as score cards: today's, else
  // tomorrow's, else the section is not rendered (src/lib/topMatches.ts). Both reads are
  // shared copies, so this adds no provider calls per visitor.
  const topMatches = await getTopMatches(
    (await getLiveSnapshot().catch(() => null))?.rows ?? [],
    matchIndex,
  ).catch(() => ({ day: "today" as const, rows: [] }));
  // Only published matches are selected, so every card has a prediction page.
  const topCards: TopMatchCard[] = topMatches.rows.flatMap((r) => {
    const slug = predictionSlug(r, matchIndex);
    return slug ? [{ ...r, href: `/predictions/match/${slug}` }] : [];
  });
  const topLive = topCards.some((r) => classifyStatus(r.fixture.status.short) === "live");
  const popular = popularLeagues(leagues);
  const dayCompetitions = selectDayCompetitions(slate.rows, popular);

  // A row can be cross-posted from a paywalled category into GENIUS — gate
  // per row on its own primary category (same as B1's league/team pages),
  // not on GENIUS itself (which is always publicly viewable), so a locked
  // VIP/PREMIUM pick never leaks through this homepage teaser.
  // The Featured excerpt renders through PredictionsTable, whose Result column
  // appears only when a row carries a settled outcome. Gate it by day so the
  // default homepage keeps precisely the columns it has today.
  const featuredRows = featured.rows.map((r) => ({ ...r, outcome: showOutcomes ? r.outcome : null }));

  const genius = geniusPreview.map((r) => {
    // Fetched by its GENIUS tag, so GENIUS is a category it may present under.
    const category = presentedCategory(r.category, ["GENIUS"]);
    const canView = canViewCategory(category, viewer.tier, viewer.status, viewer.role);
    const outcome = showOutcomes ? r.outcome : null;
    return canView ? { ...r, category, outcome, locked: false } : { ...r, category, outcome, pick: "LOCKED", confidence: null, locked: true };
  });

  const ARROW = "whitespace-nowrap text-sm font-semibold text-brand hover:underline";

  return (
    <div className="home-discovery space-y-10">
      <JsonLd data={websiteJsonLd()} />
      {/* The top banner draws flush under the header, not here: this only
          reserves its place (src/lib/topBanner.ts). */}
      <TopBanner />
      {/* The day's highlights, first thing under the banner: small score
          cards (live minute and score, kickoff, or result) for the biggest
          games we have published a prediction for, each opening its
          prediction page. Kept tight to the hero so it never displaces it. */}
      <div className="space-y-5">
        {topCards.length > 0 && (
          <section aria-label={topMatches.day === "today" ? "Today's highlights" : "Tomorrow's highlights"}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
                {topLive && (
                  <span aria-hidden className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                )}
                {topMatches.day === "today" ? "Today's highlights" : "Tomorrow's highlights"}
              </span>
              <Link href="/livescores" className="whitespace-nowrap text-xs font-semibold text-gray-400 hover:text-brand">
                Livescores →
              </Link>
            </div>
            <TopMatches rows={topCards} />
          </section>
        )}
        {/* Two columns once there's a pick to show: the claim on the left, a
            real published pick as its evidence on the right. Collapses to the
            original single column when nothing public is available, so the hero
            never renders a hole. */}
        <HomeMasthead headline={homeHeadline({ day, bankerCount: slate.bankerCount })} summary={homeSummary({ day, ...slate })} heroSlides={heroSlides} />
      </div>

      {/* The shortcuts under the hero, in two groups: today's card, then the
          longer runs. The groups are told apart by a label and a rule, and the
          longer-run links by their brand outline, so the row can keep growing
          without one list of look-alike buttons. */}
      <HomeCategoryNav />

      {genius.length > 0 && (
        <section aria-labelledby="home-genius">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SectionHead kicker="Our strongest calls" title="Genius tips" id="home-genius" />
            {/* self-start so the control keeps its natural width in the stacked
                mobile layout, matching Featured. */}
            <div className="self-start sm:mb-4 sm:self-auto">
              <FeedDayTabs basePath="/" active={day} />
            </div>
          </div>
          {/* The same tip table as every feed (crests, Score column, rows
              that open the match), so the homepage never falls behind it. */}
          <PredictionsTable rows={genius as any} linkRows />
          <div className="mt-4">
            <Link href="/predictions/genius" className="btn btn-primary w-full justify-center sm:w-auto">See all Genius Tips</Link>
          </div>
        </section>
      )}

      {/* Directly above Featured, and rendered only when a pick actually holds
          the slot — an empty "Bet of the Day" heading would advertise a
          promise the page is not keeping. It stays through the rest of its
          kickoff day, in play and then with its result (getHomepageBetOfTheDay). */}
      {betOfTheDay && (
        <PremiumPanel
          kicker="One pick a day"
          title="Bet of the Day"
          id="home-botd"
          aside={
            <Link href="/predictions/bet-of-the-day" className={ARROW}>
              Full reasoning →
            </Link>
          }
          bare
        >
          <BetOfTheDayCard
            data={betOfTheDay}
            variant="hero"
            state={betOfTheDay.state}
            crests={{ home: botdContext?.homeTeamLogo, away: botdContext?.awayTeamLogo }}
          />
        </PremiumPanel>
      )}

      <section aria-labelledby="home-featured">
        {/* Stacks below sm. On one row at phone width the heading wrapped to two
            lines and "View all" broke across three, with the pills squeezed
            between them. The day control needs a full-width row of its own on a
            narrow screen. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHead kicker="Editor's selection" title="Featured tips" id="home-featured" />
          <div className="flex items-center justify-between gap-4 sm:mb-4 sm:justify-end">
            {/* The two excerpts share one ?date=, so both controls show the same
                active day. Repeated rather than hoisted because the sections are
                far apart on the page — a reader at Featured should not have to
                scroll back to the Genius header to change day. */}
            <FeedDayTabs basePath="/" active={day} />
            <Link href="/predictions/featured" className={ARROW}>View all →</Link>
          </div>
        </div>
        {/* Two different empty states. With nothing tagged FEATURED for the
            day, the original message. With FEATURED picks published but none
            eligible for this excerpt (see src/lib/homepageFeatured.ts), say so
            and point at the full feed, which still lists them. */}
        {featured.rows.length === 0 && featured.published === 0 ? (
          <p className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">
            No featured tips published yet. Admins can publish tips from{" "}
            <Link href="/admin" className="underline">the dashboard</Link>.
          </p>
        ) : featured.rows.length === 0 ? (
          <p className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">
            {featuredBarMessage(day)}{" "}
            <Link href="/predictions/featured" className="underline">Browse all Featured picks</Link>.
          </p>
        ) : (
          <PredictionsTable rows={featuredRows} linkRows />
        )}
      </section>

      {/* The competitions with tips on the day being browsed, headline ones
          first, ten at most; a quiet day is topped up to three from the
          competitions we publish most for (src/lib/dayCompetitions.ts). */}
      {dayCompetitions.length > 0 && (
        <PremiumPanel
          kicker={day === "today" ? "Playing today" : day === "tomorrow" ? "Playing tomorrow" : "Played yesterday"}
          title="Predictions by competition"
          id="home-competitions"
          aside={
            <Link href="#home-leagues" className={ARROW}>
              All leagues →
            </Link>
          }
          bare
        >
          <DayCompetitions items={dayCompetitions} dayWord={day} />
        </PremiumPanel>
      )}

      {/* The first in-content ad, and it is here rather than under
          the hero on purpose. Everything above this point is a pick or an
          argument for one — the hero pick, Genius, Bet of the Day, Featured —
          and a leaderboard among those would sit close enough to our own calls
          to read as part of them. "Predictions by competition" and "Recent results" are
          navigation and settled scores, so a band between them is unambiguous
          chrome. See the placement rule in AdPlacements.tsx. */}
      <AdLeaderboard />

      {/* Only when something has actually finished: an empty "no results"
          box is not worth the space it takes. */}
      {recentResults.length > 0 && (
        <PremiumPanel
          kicker="Final scores"
          title="Recent results"
          id="home-results"
          aside={
            <Link href="/livescores" className={ARROW}>
              Livescores →
            </Link>
          }
          bare
        >
          <RecentResults rows={recentResults} linkIndex={matchIndex} />
        </PremiumPanel>
      )}

      {/* Below the picks, every slot sits between navigation, results or
          product sections, never beside a call of ours. */}
      <AdNativeCard />

      <PremiumPanel
        kicker="Every competition"
        title="Browse by league"
        id="home-leagues"
        aside={leagues.length > 0 ? <span className="font-semibold text-gray-500">{leagues.length} leagues</span> : undefined}
        bare
      >
        <LeagueNav leagues={leagues} empty="No leagues yet. Once tips are published, the leagues they cover appear here." />
      </PremiumPanel>

      <AdRectangle />

      <PremiumPanel kicker="Tools" title="More from BetGenius" id="home-tools" bare>
        <div className="grid gap-4 md:grid-cols-3">
          <LinkTile href="/livescores" kicker="Live" title="Livescores" desc="In-play scores across every major league." />
          <LinkTile href="/bet-builder" kicker="Build" title="Bet builder" desc="Combine picks into a clear selection list." />
          <LinkTile href="/statspad" kicker="Stats" title="StatsPad" desc="Attack, defence, form and goal difference leaders by league." />
        </div>
      </PremiumPanel>

      <AdHalfBanner />

      <HomepageExplainer />

      {/* Last thing on the page, below every pick, every league list and the
          product cards. The Native Banner is the one unit whose whole design
          is to look like the content around it, so it is only ever given a
          position where the content around it is the footer. */}
      <AdNativeBand />
      <AdStickyMobile />
      <AdInterstitial />
    </div>
  );
}
