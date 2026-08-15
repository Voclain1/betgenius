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
import { getLeaguesWithPublishedPredictions, popularLeagues } from "@/lib/predictionScope";
import { OUTCOME_STYLES } from "@/lib/outcomeStyles";
import { SITE_NAME } from "@/lib/seo";
import { leagueSlug, teamSlug } from "@/lib/slug";
import type { PredictionCategory } from "@/lib/enums";

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — Football tips, predictions, livescores` },
  description: "AI-powered football predictions across every major league — featured tips, livescores, fixtures, standings, a bet builder and StatsPad, all in one place.",
};

async function fetchFeatured() {
  return prisma.prediction.findMany({
    where: { status: "PUBLISHED", categories: { some: { category: "FEATURED" } } },
    orderBy: { publishedAt: "desc" },
    take: 6,
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
}

// Same shape as fetchFeatured — just GENIUS, capped at 3 for the homepage excerpt.
async function fetchGeniusPreview() {
  return prisma.prediction.findMany({
    where: { status: "PUBLISHED", categories: { some: { category: "GENIUS" } } },
    orderBy: { publishedAt: "desc" },
    take: 3,
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
}

const CATEGORY_LINKS: { label: string; slug: string }[] = [
  { label: "Banker", slug: "banker" },
  { label: "Today", slug: "today" },
  { label: "Premium", slug: "premium" },
  { label: "VIP", slug: "vip" },
];

export default async function HomePage() {
  const [featured, geniusPreview, session, leagues] = await Promise.all([
    fetchFeatured(),
    fetchGeniusPreview(),
    getServerSession(authOptions),
    getLeaguesWithPublishedPredictions(),
  ]);
  const popular = popularLeagues(leagues);

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
      <section className="rounded-2xl bg-gradient-to-br from-brand/20 via-brand-card to-brand-bg p-8 md:p-12">
        <h1 className="text-3xl font-bold md:text-5xl">
          Football tips, powered by <span className="text-brand">AI</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-gray-300 md:text-lg">
          Data-driven picks across every major league. Livescores, fixtures, standings, a bet builder and StatsPad — all in one place.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/predictions/today" className="btn btn-primary">Today's tips</Link>
          <Link href="/pricing" className="btn btn-ghost">Go VIP</Link>
        </div>
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
        <RecentResults />
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
                          {home && away ? (
                            <>
                              <Link href={`/predictions/team/${teamSlug(home)}`} className="hover:underline">{home}</Link>{" "}
                              <span className="text-gray-500">vs</span>{" "}
                              <Link href={`/predictions/team/${teamSlug(away)}`} className="hover:underline">{away}</Link>
                            </>
                          ) : (
                            "—"
                          )}
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
            <Link key={c.slug} href={`/predictions/${c.slug}`} className="btn btn-ghost">
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
          <p className="text-sm text-gray-400">Combine picks, compute your accumulator odds instantly.</p>
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
