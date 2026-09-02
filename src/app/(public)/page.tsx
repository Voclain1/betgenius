import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { PredictionsTable } from "@/components/PredictionsTable";
import { LeagueBadge } from "@/components/LeagueBadge";
import { LeagueNav } from "@/components/LeagueNav";
import { RecentResults } from "@/components/RecentResults";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { parseFeedDay, dayShowsOutcomes, type FeedDay } from "@/lib/categoryPredictions";
import { MatchLink } from "@/components/MatchLink";
import { HeroPick, type HeroPickData } from "@/components/HeroPick";
import { BetOfTheDayCard } from "@/components/BetOfTheDayCard";
import { getBetOfTheDay } from "@/lib/betOfTheDay";
import { getLeaguesWithPublishedPredictions, popularLeagues, getPublishedMatchIndex } from "@/lib/predictionScope";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { SITE_NAME } from "@/lib/seo";
import { leagueSlug } from "@/lib/slug";
import type { PredictionCategory } from "@/lib/enums";
import { lagosDayBounds } from "@/lib/lagosDate";
import { orderForDisplay, comparePredictionsForDisplay } from "@/lib/predictionOrdering";

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
 * The day's picks in one category, strongest first.
 *
 * The cap is applied AFTER ranking, not as a `take` on the query. Slicing in
 * the database would hand the ranking six arbitrary rows to sort among
 * themselves, so the homepage would show the six most recently published
 * picks in a nicer order rather than the six best picks — which is the whole
 * point of the ordering.
 */
async function fetchTopOfCategory(category: string, limit: number, day: FeedDay = "today") {
  const today = lagosDayBounds(day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0);
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: today.start, lt: today.end }, categories: { some: { category } } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
  return orderForDisplay(rows).slice(0, limit);
}

// Same caps as before — 6 featured, 3 genius — so every day renders the same
// shape of excerpt the homepage already had.
const fetchFeatured = (day: FeedDay) => fetchTopOfCategory("FEATURED", 6, day);
const fetchGeniusPreview = (day: FeedDay) => fetchTopOfCategory("GENIUS", 3, day);

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
    homeTeam: true, awayTeam: true, kickoff: true, leagueName: true, leagueApiId: true,
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

const CATEGORY_LINKS: { label: string; href: string }[] = [
  { label: "Banker", href: "/predictions/banker" },
  { label: "Today", href: "/predictions/today" },
  { label: "Premium", href: "/predictions/premium" },
  { label: "VIP", href: "/predictions/vip" },
  { label: "Multi Bets", href: "/multi-bets" },
];

export default async function HomePage({ searchParams }: { searchParams?: { date?: string } }) {
  // Reading searchParams does NOT change this page's render mode: it already
  // renders dynamically on every request because getServerSession below reads
  // cookies, which is why the `revalidate = 60` above never took effect.
  // Verified in production: Cache-Control is no-store and x-vercel-cache MISS.
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [featured, geniusPreview, session, leagues, matchIndex, heroPick, betOfTheDay] = await Promise.all([
    fetchFeatured(day),
    fetchGeniusPreview(day),
    getServerSession(authOptions),
    getLeaguesWithPublishedPredictions(),
    getPublishedMatchIndex(),
    fetchHeroPick(),
    getBetOfTheDay(),
  ]);
  const popular = popularLeagues(leagues);

  // A row can be cross-posted from a paywalled category into GENIUS — gate
  // per row on its own primary category (same as B1's league/team pages),
  // not on GENIUS itself (which is always publicly viewable), so a locked
  // VIP/PREMIUM pick never leaks through this homepage teaser.
  // The Featured excerpt renders through PredictionsTable, whose Result column
  // appears only when a row carries a settled outcome. Gate it by day so the
  // default homepage keeps precisely the columns it has today.
  const featuredRows = featured.map((r) => ({ ...r, outcome: showOutcomes ? r.outcome : null }));

  const genius = geniusPreview.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role);
    return canView ? { ...r, locked: false } : { ...r, pick: "LOCKED", confidence: null, locked: true };
  });

  return (
    <div className="space-y-10">
      {/* Two columns once there's a pick to show: the claim on the left, a
          real published pick as its evidence on the right. Collapses to the
          original single column when nothing public is available, so the hero
          never renders a hole. */}
      <section className="rounded-2xl bg-gradient-to-br from-brand/20 via-brand-card to-brand-bg p-6 md:p-10">
        <div className={`grid items-center gap-8 ${heroPick ? "lg:grid-cols-[1.3fr,1fr]" : ""}`}>
          <div>
            <h1 className="text-[26px] font-bold leading-[1.15] sm:text-3xl md:text-5xl">
              Football Predictions Today — Including Today&apos;s Banker
            </h1>
            <p className="mt-3 max-w-2xl text-gray-300 md:text-lg">
              Data-driven picks across every major league, each with a confidence rating and the reasoning behind it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/predictions/today" className="btn btn-primary">Today&apos;s tips</Link>
              <Link href="/pricing" className="btn btn-ghost">Go VIP</Link>
            </div>
          </div>
          {heroPick && <HeroPick pick={heroPick} />}
        </div>
      </section>



      <section className="space-y-6">
        {genius.length > 0 && (
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold">Genius tips</h2>
              {/* self-start so the control keeps its natural width in the stacked
                  mobile layout, matching Featured — which cannot stretch because
                  it shares its row with "View all". */}
              <div className="self-start">
                <FeedDayTabs basePath="/" active={day} />
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-sm">
                <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Match</th>
                    <th className="px-3 py-2">League</th>
                    <th className="px-3 py-2">Market / Pick</th>
                    <th className="px-3 py-2 text-right">Confidence</th>
                    <th className="px-3 py-2 text-right">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {genius.map((p) => {
                    const home = p.homeTeam ?? p.fixture?.homeTeam.name;
                    const away = p.awayTeam ?? p.fixture?.awayTeam.name;
                    const leagueName = p.leagueName ?? p.fixture?.league.name;
                    const kickoff = p.kickoff ?? p.fixture?.kickoff;
                    return (
                      <tr key={p.id} className="hover:bg-brand-card/50">
                        <td className="px-3 py-2">
                          <MatchLink homeTeam={home} awayTeam={away} kickoff={kickoff} />
                        </td>
                        <td className="px-3 py-2">
                          {leagueName ? (
                            <Link href={`/predictions/league/${leagueSlug(leagueName, p.leagueApiId)}`}>
                              <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                            </Link>
                          ) : (
                            <LeagueBadge leagueApiId={p.leagueApiId} leagueName={leagueName} showName={false} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-brand flex items-center gap-1">
                            {p.locked ? <><Lock size={14} /> Locked</> : p.pick}
                          </div>
                          <div className="text-xs text-gray-400">{p.market}</div>
                        </td>
                        <td className="px-3 py-2 text-right">{p.confidence != null ? `${p.confidence}%` : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {p.outcome !== "PENDING" ? (
                            <span className={`chip ${OUTCOME_STYLES[p.outcome] ?? "bg-brand-border"}`}>{p.outcome}</span>
                          ) : kickoff ? (
                            <span className="text-xs text-gray-400">
                              {new Date(kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Link href="/predictions/genius" className="btn btn-primary">See all Genius Tips</Link>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {CATEGORY_LINKS.map((c) => (
            <Link key={c.href} href={c.href} className="btn btn-ghost">
              {c.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Directly above Featured, and rendered only when a pick actually holds
          the slot — an empty "Bet of the Day" heading would advertise a
          promise the page is not keeping. */}
      {betOfTheDay && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Bet of the Day</h2>
            <Link href="/predictions/bet-of-the-day" className="text-sm text-brand hover:underline">
              Full reasoning →
            </Link>
          </div>
          <BetOfTheDayCard data={betOfTheDay} variant="hero" />
        </section>
      )}

      <section>
        {/* Stacks below sm. On one row at phone width the heading wrapped to two
            lines and "View all" broke across three, with the pills squeezed
            between them. The day control needs a full-width row of its own on a
            narrow screen. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold">Featured tips</h2>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            {/* The two excerpts share one ?date=, so both controls show the same
                active day. Repeated rather than hoisted because the sections are
                far apart on the page — a reader at Featured should not have to
                scroll back to the Genius header to change day. */}
            <FeedDayTabs basePath="/" active={day} />
            <Link href="/predictions/featured" className="whitespace-nowrap text-sm text-brand hover:underline">View all →</Link>
          </div>
        </div>
        {featured.length === 0 ? (
          <p className="text-gray-400">
            No featured tips published yet. Admins can publish tips from{" "}
            <Link href="/admin" className="underline">the dashboard</Link>.
          </p>
        ) : (
          <PredictionsTable rows={featuredRows} />
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Popular leagues</h2>
        <LeagueNav
          leagues={popular}
          empty={
            leagues.length > 0
              ? "No major-league predictions published yet — browse every league we cover further down this page."
              : "No leagues yet. Once tips are published, the leagues they cover appear here."
          }
        />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recent results</h2>
          <Link href="/livescores" className="text-sm text-brand hover:underline">Livescores →</Link>
        </div>
        <RecentResults linkIndex={matchIndex} />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Browse by league</h2>
          {leagues.length > 0 && <span className="text-sm text-gray-500">{leagues.length} leagues</span>}
        </div>
        <LeagueNav leagues={leagues} empty="No leagues yet. Once tips are published, the leagues they cover appear here." />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/livescores" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">LIVE</div>
          <div className="mt-1 text-lg font-semibold">Livescores</div>
          <p className="text-sm text-gray-400">In-play scores across every major league.</p>
        </Link>
        <Link href="/bet-builder" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">BUILD</div>
          <div className="mt-1 text-lg font-semibold">Bet builder</div>
          <p className="text-sm text-gray-400">Combine picks into a clear selection list.</p>
        </Link>
        <Link href="/statspad" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">STATS</div>
          <div className="mt-1 text-lg font-semibold">StatsPad</div>
          <p className="text-sm text-gray-400">Team form, xG, over/under trends, head-to-head.</p>
        </Link>
      </section>
    </div>
  );
}
