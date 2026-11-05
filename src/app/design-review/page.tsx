import { HomepageExplainer } from "@/components/HomepageExplainer";
import { BetOfTheDayCard } from "@/components/BetOfTheDayCard";
import { PremiumPanel } from "@/components/PremiumPanel";
import { DayCompetitions } from "@/components/DayCompetitions";
import { RecentResults } from "@/components/RecentResults";
import { LeagueNav } from "@/components/LeagueNav";
import { LinkTile } from "@/components/LinkTile";
import { leagueSlug } from "@/lib/slug";
import { TopMatches, type TopMatchCard } from "@/components/TopMatches";
import PredictionsIndex from "@/app/(public)/predictions/page";
import { HomeCategoryNav } from "@/components/HomeCategoryNav";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DesignReviewAppMode } from "@/components/DesignReviewAppMode";
import { Nav } from "@/components/Nav";
import { DiscoveryShell } from "@/components/DiscoveryShell";
import { HomeMasthead } from "@/components/HomeMasthead";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PredictionsTable } from "@/components/PredictionsTable";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { SectionHead } from "@/components/TeamProfile";
import { SiteFooter } from "@/components/SiteFooter";
import { AppTabBar } from "@/components/AppTabBar";
import type { HeroSlideData } from "@/lib/heroSlides";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Design review",
  robots: { index: false, follow: false },
};

/** Explicit opt-in, no production credentials or database queries. These are design fixtures, never tips. */
export default function DesignReview({
  searchParams,
}: {
  searchParams?: { view?: string; device?: string; app?: string };
}) {
  if (process.env.DESIGN_REVIEW_ENABLED !== "1") notFound();
  const view = ["home", "categories", "today", "genius"].includes(
    searchParams?.view ?? "",
  )
    ? searchParams!.view!
    : "home";
  if (searchParams?.device === "phone")
    return (
      <main className="review-phone">
        <div className="mb-4 text-center text-sm text-gray-400">
          Mobile app review · 390px viewport · Sample content
        </div>
        <iframe
          title="Mobile app design review"
          src={`/design-review?view=${view}&app=1`}
          className="mx-auto block h-[844px] w-full max-w-[390px] rounded-3xl border border-brand-border"
        />
      </main>
    );
  const names = [
    ["Arsenal", "Chelsea", 42, 49, 39, "Premier League", "Arsenal or Draw", 78],
    [
      "Liverpool",
      "Manchester City",
      40,
      50,
      39,
      "Premier League",
      "Both Teams to Score",
      76,
    ],
    [
      "AC Milan",
      "Juventus",
      489,
      496,
      2,
      "UEFA Champions League",
      "Over 1.5 Goals",
      74,
    ],
    [
      "AZ Alkmaar",
      "Juventus",
      201,
      496,
      3,
      "UEFA Europa League",
      "Juventus or Draw",
      73,
    ],
    [
      "Sturm Graz",
      "Celje",
      637,
      647,
      3,
      "UEFA Europa League",
      "Both Teams to Score: No",
      71,
    ],
    [
      "SC Braga",
      "Aarhus",
      217,
      419,
      848,
      "UEFA Europa Conference League",
      "Over 2.5 Goals",
      70,
    ],
  ] as const;
  const rows = names.map(
    (
      [
        homeTeam,
        awayTeam,
        homeTeamApiId,
        awayTeamApiId,
        leagueApiId,
        leagueName,
        pick,
        confidence,
      ],
      i,
    ) => ({
      id: `design-${i}`,
      category: "GENIUS",
      homeTeam,
      awayTeam,
      homeTeamApiId,
      awayTeamApiId,
      leagueApiId,
      leagueName,
      pick,
      confidence,
      market:
        i === 0
          ? "Double Chance"
          : i === 1
            ? "Both Teams to Score"
            : "Total Goals",
      kickoff: new Date("2026-11-05T20:00:00Z"),
      reasoning:
        "Sample reasoning for design review. Compare recent form, home and away performance and the available match evidence before assessing the selection.",
      overUnder: "Over 2.5 Goals",
      outcome: null,
      finalHomeScore: null,
      finalAwayScore: null,
    }),
  );
  const slides: HeroSlideData[] = rows.slice(0, 3);
  const highlights: TopMatchCard[] = rows.slice(0, 4).map((r, i) => ({
    fixture: {
      id: i + 1,
      date: r.kickoff.toISOString(),
      status: { short: "NS" },
    },
    league: {
      id: r.leagueApiId,
      name: r.leagueName,
      country: r.leagueApiId === 39 ? "England" : "World",
      season: 2026,
    },
    teams: {
      home: { id: r.homeTeamApiId, name: r.homeTeam },
      away: { id: r.awayTeamApiId, name: r.awayTeam },
    },
    goals: { home: null, away: null },
    href: "/predictions/today",
  }));
  const sampleLeagues = [
    ...new Map(
      highlights.map((r) => [
        r.league.id,
        {
          slug: leagueSlug(r.league.name, r.league.id),
          name: r.league.name,
          short: r.league.id === 39 ? "Premier League" : "Champions League",
          country: r.league.country,
          leagueApiId: r.league.id,
          count: rows.filter((p) => p.leagueApiId === r.league.id).length,
          crest: null,
        },
      ]),
    ).values(),
  ];
  const sampleResults = highlights
    .slice(0, 3)
    .map((r, i) => ({
      ...r,
      fixture: { ...r.fixture, status: { short: "FT" } },
      goals: { home: [2, 1, 3][i], away: [1, 1, 0][i] },
    }));
  const tabs = (
    <nav aria-label="Review screens" className="review-tabs">
      {["home", "categories", "today", "genius"].map((v) => (
        <Link
          key={v}
          href={`/design-review?view=${v}`}
          aria-current={view === v ? "page" : undefined}
        >
          {v === "home"
            ? "Homepage"
            : v === "categories"
              ? "Categories"
              : v === "today"
                ? "Today's feed"
                : "Detailed feed"}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      {searchParams?.app === "1" && <DesignReviewAppMode />}
      <div className="review-notice">
        DESIGN REVIEW · Sample fixtures and ratings · Nothing here is a live
        recommendation
      </div>
      <Nav />
      <main className="public-main mx-auto max-w-[1280px] px-4 py-6 lg:px-6">
        <DiscoveryShell
          reviewPath={
            view === "home"
              ? "/"
              : view === "categories"
                ? "/predictions"
                : `/predictions/${view}`
          }
        >
          {tabs}
          {view === "home" ? (
            <div className="home-discovery space-y-10">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="font-semibold uppercase tracking-widest">
                  Your football, in focus
                </span>
                <span>Thursday, 5 November · WAT</span>
              </div>
              <TopMatches rows={highlights} />
              <HomeMasthead
                headline="Football Predictions Today — Including Today's Banker"
                summary="Explore today's football predictions across the major competitions. Every settled result — win or lose — is published on our track record."
                heroSlides={slides}
              />
              <HomeCategoryNav />
              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <SectionHead
                    kicker="Our strongest calls"
                    title="Genius tips"
                  />
                  <FeedDayTabs basePath="/" active="today" />
                </div>
                <PredictionsTable rows={rows.slice(0, 3)} linkRows />
              </section>
              <PremiumPanel
                kicker="One pick. The full perspective."
                title="Bet of the Day"
                id="home-botd"
                bare
                aside={
                  <Link
                    href="/predictions/bet-of-the-day"
                    className="text-brand"
                  >
                    Full reasoning ↗
                  </Link>
                }
              >
                <BetOfTheDayCard
                  variant="hero"
                  state="LIVE"
                  data={{
                    row: {
                      ...rows[0],
                      marketType: "DOUBLE_CHANCE",
                      selection: null,
                      matchPreview: null,
                      outcome: "PENDING",
                      betOfDayPinnedAt: null,
                    },
                    gate: null,
                    odds: null,
                    oddsFetchedAt: null,
                  }}
                />
              </PremiumPanel>
              <section>
                <div className="flex items-end justify-between">
                  <SectionHead
                    kicker="Editor's selection"
                    title="Featured tips"
                  />
                  <Link
                    href="/predictions/featured"
                    className="mb-4 text-sm font-semibold text-brand"
                  >
                    View all →
                  </Link>
                </div>
                <PredictionsTable rows={rows} linkRows />
              </section>
              <PremiumPanel
                kicker="Playing today"
                title="Predictions by competition"
                id="home-competitions"
                bare
                aside={
                  <Link href="#home-leagues" className="text-brand">
                    All leagues ↗
                  </Link>
                }
              >
                <DayCompetitions items={sampleLeagues} dayWord="today" />
              </PremiumPanel>
              <div className="review-ad">
                ADVERTISEMENT · RESERVED PLACEMENT
              </div>
              <PremiumPanel
                kicker="Final scores"
                title="Recent results"
                id="home-results"
                bare
                aside={
                  <Link href="/livescores" className="text-brand">
                    Livescores ↗
                  </Link>
                }
              >
                <RecentResults rows={sampleResults} />
              </PremiumPanel>
              <div className="review-ad">
                ADVERTISEMENT · RESERVED PLACEMENT
              </div>
              <PremiumPanel
                kicker="Every competition"
                title="Browse by league"
                id="home-leagues"
                bare
              >
                <LeagueNav leagues={sampleLeagues} empty="Sample leagues" />
              </PremiumPanel>
              <div className="review-ad">
                ADVERTISEMENT · RESERVED PLACEMENT
              </div>
              <PremiumPanel
                kicker="Beyond the prediction"
                title="More from BetGenius"
                id="home-tools"
                bare
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <LinkTile
                    href="/livescores"
                    kicker="Live"
                    title="Livescores"
                    desc="In-play scores across every major league."
                  />
                  <LinkTile
                    href="/bet-builder"
                    kicker="Build"
                    title="Bet builder"
                    desc="Combine picks into a clear selection list."
                  />
                  <LinkTile
                    href="/statspad"
                    kicker="Stats"
                    title="StatsPad"
                    desc="Attack, defence, form and goal difference leaders by league."
                  />
                </div>
              </PremiumPanel>
              <div className="review-ad">
                ADVERTISEMENT · RESERVED PLACEMENT
              </div>
              <HomepageExplainer />
              <div className="review-ad">
                ADVERTISEMENT · RESERVED PLACEMENT
              </div>
            </div>
          ) : view === "categories" ? (
            <PredictionsIndex />
          ) : (
            <div className="space-y-6">
              <CategoryMasthead
                kicker="Predictions"
                title={
                  view === "today"
                    ? "Football predictions today"
                    : "Genius tips"
                }
                blurb={
                  view === "today"
                    ? "Every published selection on today's card. Find the match, compare the market and read the reasoning."
                    : "Our highest-scoring picks of the day, ranked by confidence."
                }
                dateLabel="Thursday, 5 November · West Africa Time"
                stats={[
                  { label: "Picks", value: "6" },
                  { label: "Competitions", value: String(new Set(rows.map(row => row.leagueApiId)).size) },
                  { label: "Top confidence", value: "78%", accent: true },
                ]}
                actions={
                  <Link href="/login" className="btn btn-ghost">
                    Follow these tips
                  </Link>
                }
              />
              {view === "today" ? (
                <>
                  <FeedDayTabs basePath="/predictions/today" active="today" />
                  <PredictionsTable rows={rows} linkRows />
                </>
              ) : (
                <PredictionViewSwitch
                  tabs={
                    <FeedDayTabs
                      basePath="/predictions/genius"
                      active="today"
                    />
                  }
                  detailed={
                    <CategoryPredictionsList rows={rows} view="detailed" />
                  }
                  compact={
                    <CategoryPredictionsList
                      rows={rows}
                      view="compact"
                      linkRows
                    />
                  }
                />
              )}
            </div>
          )}
        </DiscoveryShell>
      </main>
      <SiteFooter />
      <AppTabBar />
    </>
  );
}
