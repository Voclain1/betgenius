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
import { MatchLink } from "@/components/MatchLink";
import { HeroPick, type HeroPickData } from "@/components/HeroPick";
import { getLeaguesWithPublishedPredictions, popularLeagues, getPublishedMatchIndex } from "@/lib/predictionScope";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { SITE_NAME } from "@/lib/seo";
import { leagueSlug } from "@/lib/slug";
import type { PredictionCategory } from "@/lib/enums";
import { lagosTodayBounds } from "@/lib/lagosDate";
import { orderForDisplay, compareByEditorialRank } from "@/lib/predictionOrdering";

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — Football tips, predictions, livescores` },
  description: "Football predictions across every major league — featured tips, livescores, fixtures, standings, a bet builder and StatsPad, all in one place.",
};

/**
 * The day's picks in one category, strongest first.
 *
 * The cap is applied AFTER ranking, not as a `take` on the query. Slicing in
 * the database would hand the ranking six arbitrary rows to sort among
 * themselves, so the homepage would show the six most recently published
 * picks in a nicer order rather than the six best picks — which is the whole
 * point of the ordering.
 */
async function fetchTopOfCategory(category: string, limit: number) {
  const today = lagosTodayBounds();
  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: today.start, lt: today.end }, categories: { some: { category } } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
  return orderForDisplay(rows).slice(0, limit);
}

const fetchFeatured = () => fetchTopOfCategory("FEATURED", 6);
const fetchGeniusPreview = () => fetchTopOfCategory("GENIUS", 3);

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
 * "Strongest" is the site-wide editorial rank (league priority, then
 * confidence), not confidence alone: an 88% pick in the Premier League is a
 * better shop window than a 91% pick in the Latvian Virsliga, and the hero
 * should not be the one surface that disagrees with every list below it.
 *
 * Falls back to the highest-confidence public pick regardless of kickoff when
 * nothing upcoming is published, and to nothing at all when there are no
 * public picks — the hero then renders its original single-column form.
 */
async function fetchHeroPick(): Promise<HeroPickData | null> {
  const today = lagosTodayBounds();
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
    [...rows].sort(compareByEditorialRank)[0] ?? null;

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
  { label: "Combos", href: "/combos" },
];

export default async function HomePage() {
  const [featured, geniusPreview, session, leagues, matchIndex, heroPick, trackRecord] = await Promise.all([
    fetchFeatured(),
    fetchGeniusPreview(),
    getServerSession(authOptions),
    getLeaguesWithPublishedPredictions(),
    getPublishedMatchIndex(),
    fetchHeroPick(),
    getTrackRecordData(),
  ]);
  const popular = popularLeagues(leagues);

  // Same all-time sample gate the track-record page applies to itself — below
  // it, no rate is shown rather than one built on too few settled tips.
  const headline = trackRecord.windows[90].headline;
  const heroStat =
    trackRecord.totalSettledAllTime >= MIN_SETTLED_SAMPLE_SIZE && headline.rate != null
      ? { rate: Math.round(headline.rate * 100), settled: headline.decided }
      : null;

  // A row can be cross-posted from a paywalled category into GENIUS — gate
  // per row on its own primary category (same as B1's league/team pages),
  // not on GENIUS itself (which is always publicly viewable), so a locked
  // VIP/PREMIUM pick never leaks through this homepage teaser.
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
            {/* The headline sells what a reader actually gets — a call, a
                confidence figure and the reasoning — rather than the
                technology that produces it. How the picks are made is
                disclosed in the footer of every page and in full at
                /methodology; it is just no longer the pitch. */}
            <h1 className="text-3xl font-bold md:text-5xl">
              Football tips, <span className="text-brand">backed by the numbers</span>.
            </h1>
            <p className="mt-3 max-w-2xl text-gray-300 md:text-lg">
              Data-driven picks across every major league, each with a confidence rating and the reasoning behind it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/predictions/today" className="btn btn-primary">Today&apos;s tips</Link>
              <Link href="/pricing" className="btn btn-ghost">Go VIP</Link>
            </div>
          </div>
          {heroPick && <HeroPick pick={heroPick} trackRecord={heroStat} />}
        </div>
      </section>



      <section className="space-y-6">
        {genius.length > 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Genius tips</h2>
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

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Featured tips</h2>
          <Link href="/predictions/featured" className="text-sm text-brand hover:underline">View all →</Link>
        </div>
        {featured.length === 0 ? (
          <p className="text-gray-400">
            No featured tips published yet. Admins can publish tips from{" "}
            <Link href="/admin" className="underline">the dashboard</Link>.
          </p>
        ) : (
          <PredictionsTable rows={featured} />
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
