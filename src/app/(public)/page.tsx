import Link from "next/link";
import { HOME_CATEGORY_LINKS, HOME_PERIOD_LINKS } from "@/lib/homeCategoryLinks";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { PredictionsTable } from "@/components/PredictionsTable";
import { AdStickyMobile } from "@/components/ads/AdStickyMobile";
import { MarketChips } from "@/components/MarketChips";
import { LeagueNav } from "@/components/LeagueNav";
import { RecentResults } from "@/components/RecentResults";
import { getRecentResults } from "@/lib/recentResultsSnapshot";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { parseFeedDay, dayShowsOutcomes, type FeedDay } from "@/lib/categoryPredictions";
import { HeroPick, type HeroPickData } from "@/components/HeroPick";
import { AnswerSummary } from "@/components/AnswerSummary";
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
import { comparePredictionsForDisplay } from "@/lib/predictionOrdering";
import {
  selectHomepageFeatured,
  selectHomepageGenius,
  featuredBarMessage,
  comboLegIds,
  isComboRow,
  HOMEPAGE_FEATURED_LIMIT,
} from "@/lib/homepageFeatured";
import { AdLeaderboard, AdNativeBand } from "@/components/ads/AdPlacements";
import { PremiumPanel } from "@/components/PremiumPanel";
import { SectionHead } from "@/components/TeamProfile";
import { LinkTile } from "@/components/LinkTile";

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
 * The pick shown beside the hero headline.
 *
 * Chosen as the STRONGEST upcoming pick from a category any visitor can read
 * (FEATURED/GENIUS/TODAY are public per canViewCategory) — not the most
 * recent. A hero is an argument for the product, so it should lead with the
 * strongest call currently standing, and it must not be a locked row: a
 * headline promising football tips whose only example is padlocked argues
 * against itself.
 *
 * "Strongest" means the site-wide DISPLAY order — highest confidence first —
 * so the hero shows the same pick that leads the feeds beneath it. Using the
 * editorial (league-priority-first) rank here instead would make the hero the
 * one surface disagreeing with every list on the page.
 *
 * Falls back to the highest-confidence public pick regardless of kickoff when
 * nothing upcoming is published, and to nothing at all when there are no
 * public picks — the hero then renders its original single-column form.
 */
async function fetchHeroPick(): Promise<HeroPickData | null> {
  // Deliberately today, whatever day the excerpts below are showing. The hero
  // is the argument for the product, not part of the browsing surface.
  const today = lagosDayBounds(0);
  const base = {
    status: "PUBLISHED" as const,
    homeTeam: { not: null },
    awayTeam: { not: null },
    kickoff: { gte: today.start, lt: today.end },
    categories: { some: { category: { in: ["FEATURED", "GENIUS"] } } },
  };
  const select = {
    homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueName: true, leagueApiId: true,
    market: true, pick: true, confidence: true,
  };
  // `id` is selected only so the ranking has its stable tiebreaker; it is not
  // part of HeroPickData and never reaches the component.
  const rank = <T extends { id: string; leagueApiId: number | null; confidence: number }>(rows: T[]): T | null =>
    [...rows].sort(comparePredictionsForDisplay)[0] ?? null;

  const upcoming = await prisma.prediction.findMany({
    where: { ...base, kickoff: { gte: new Date(), lt: today.end } },
    select: { ...select, id: true },
  });
  const row = rank(upcoming) ?? rank(await prisma.prediction.findMany({ where: base, select: { ...select, id: true } }));
  return row ? ({ ...row, homeTeam: row.homeTeam!, awayTeam: row.awayTeam! } as HeroPickData) : null;
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

  return { pickCount: rows.length, leagueCount: leagues.size, topLeagues, bankerCount };
}

export default async function HomePage({ searchParams }: { searchParams?: { date?: string } }) {
  // Reading searchParams does NOT change this page's render mode: it already
  // renders dynamically on every request because getServerSession below reads
  // cookies, which is why the `revalidate = 60` above never took effect.
  // Verified in production: Cache-Control is no-store and x-vercel-cache MISS.
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [featured, geniusPreview, session, leagues, matchIndex, heroPick, betOfTheDay, slate, recentResults] = await Promise.all([
    fetchFeatured(day),
    fetchGeniusPreview(day),
    getServerSession(authOptions),
    getLeaguesWithPublishedPredictions(),
    getPublishedMatchIndex(),
    fetchHeroPick(),
    getHomepageBetOfTheDay(),
    fetchDaySlate(day),
    // Never throws: a failed read serves the last stored copy, or nothing.
    getRecentResults(),
  ]);
  // Crests for the Bet of the Day card: one batched read, only when a pick holds the slot.
  const botdContext = betOfTheDay ? (await getFixtureEventContext([betOfTheDay.row])).get(matchKey(betOfTheDay.row) ?? "") : undefined;
  const viewer = await getViewerEntitlement();
  const popular = popularLeagues(leagues);

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
    <div className="space-y-12">
      <JsonLd data={websiteJsonLd()} />
      {/* Two columns once there's a pick to show: the claim on the left, a
          real published pick as its evidence on the right. Collapses to the
          original single column when nothing public is available, so the hero
          never renders a hole. */}
      <section className="brand-surface relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.18),transparent)]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.10),transparent)]" />
        <div className={`relative grid items-center gap-8 p-5 sm:p-8 md:p-10 ${heroPick ? "lg:grid-cols-[1.3fr,1fr]" : ""}`}>
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-[3px] w-5 rounded-full bg-brand" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Football predictions</span>
            </div>
            {/* Built rather than written inline: the banker half of this
                headline is a claim about the day's card, and it is gated on
                the same count the paragraph below it uses. See homeHeadline. */}
            <h1 className="mt-3 text-[28px] font-black leading-[1.05] tracking-tight text-gray-100 sm:text-4xl md:text-5xl">
              {homeHeadline({ day, bankerCount: slate.bankerCount })}
            </h1>
            {/* Directly under the H1, before the pick card and everything
                below it: what is actually published right now, in counts and
                competitions. No percentage — /track-record owns the rate, and
                a second copy of it here would be free to drift. */}
            <div className="mt-4">
              <AnswerSummary text={homeSummary({ day, ...slate })} />
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400 md:text-base">
              {/* The markets named here are the ones actually published — see
                  the marketType mix in the corpus — so the line reinforces
                  what a reader searches for without promising a market this
                  site has never produced. */}
              Data-driven football predictions across every major league — banker picks, match winner, double chance, over/under and combo bets — each with a confidence rating and the reasoning behind it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/predictions/today" className="btn btn-primary">Today&apos;s tips</Link>
              <Link href="/pricing" className="btn btn-ghost">Go VIP</Link>
            </div>
          </div>
          {heroPick && <HeroPick pick={heroPick} />}
        </div>
      </section>

      {/* The shortcuts under the hero, in two groups: today's card, then the
          longer runs. The groups are told apart by a label and a rule, and the
          longer-run links by their brand outline, so the row can keep growing
          without one list of look-alike buttons. */}
      <nav aria-label="Prediction categories" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">Today</span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {HOME_CATEGORY_LINKS.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="rounded-full border border-brand-border bg-brand-card px-4 py-2 text-sm font-bold text-gray-100 transition hover:border-brand hover:text-brand"
                >
                  {c.label}
                </Link>
              ))}
            </div>
            {/* Today's tips by market, directly under the Today buttons: one
                slim line of small chips (MarketChips), so it costs a single
                row and never pushes Genius or Featured down by more. */}
            <MarketChips />
          </div>
        </div>
        <span aria-hidden className="h-px w-full bg-brand-border lg:h-8 lg:w-px" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">Longer runs</span>
          <div className="flex flex-wrap gap-2">
            {HOME_PERIOD_LINKS.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand transition hover:bg-brand hover:text-on-brand"
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

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

      <PremiumPanel kicker="Where we publish most" title="Popular leagues" id="home-popular" bare>
        <LeagueNav
          leagues={popular}
          empty={
            leagues.length > 0
              ? "No major-league predictions published yet — browse every league we cover further down this page."
              : "No leagues yet. Once tips are published, the leagues they cover appear here."
          }
        />
      </PremiumPanel>

      {/* The homepage's one in-content ad, and it is here rather than under
          the hero on purpose. Everything above this point is a pick or an
          argument for one — the hero pick, Genius, Bet of the Day, Featured —
          and a leaderboard among those would sit close enough to our own calls
          to read as part of them. "Popular leagues" and "Recent results" are
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

      <PremiumPanel
        kicker="Every competition"
        title="Browse by league"
        id="home-leagues"
        aside={leagues.length > 0 ? <span className="font-semibold text-gray-500">{leagues.length} leagues</span> : undefined}
        bare
      >
        <LeagueNav leagues={leagues} empty="No leagues yet. Once tips are published, the leagues they cover appear here." />
      </PremiumPanel>

      <PremiumPanel kicker="Tools" title="More from BetGenius" id="home-tools" bare>
        <div className="grid gap-4 md:grid-cols-3">
          <LinkTile href="/livescores" kicker="Live" title="Livescores" desc="In-play scores across every major league." />
          <LinkTile href="/bet-builder" kicker="Build" title="Bet builder" desc="Combine picks into a clear selection list." />
          <LinkTile href="/statspad" kicker="Stats" title="StatsPad" desc="Attack, defence, form and goal difference leaders by league." />
        </div>
      </PremiumPanel>

      {/* Last thing on the page, below every pick, every league list and the
          product cards. The Native Banner is the one unit whose whole design
          is to look like the content around it, so it is only ever given a
          position where the content around it is the footer. */}
      <AdNativeBand />
      <AdStickyMobile />
    </div>
  );
}
