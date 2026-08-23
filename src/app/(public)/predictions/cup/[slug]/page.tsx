import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CupRounds } from "@/components/CupRounds";
import { LeagueClubGrid } from "@/components/LeagueClubGrid";
import { TopScorersLeaderboard } from "@/components/LeaguePlayerStats";
import { getCupPageData, cupBySlug } from "@/lib/cups";
import { getPublishedMatchIndex } from "@/lib/predictionScope";
import { leagueLogoUrl } from "@/lib/leagues";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const cup = cupBySlug(params.slug);
  if (!cup) return { title: "Cup competition", robots: { index: false, follow: false } };
  return {
    title: `${cup.name} fixtures, results and top scorers`,
    description: `${cup.name} knockout rounds, participating clubs, results, fixtures and top scorers.`,
    alternates: { canonical: `/predictions/cup/${cup.slug}` },
  };
}

export default async function CupPage({ params, searchParams }: { params: { slug: string }; searchParams: { season?: string } }) {
  const requestedSeason = /^\d{4}$/.test(searchParams.season ?? "") ? Number(searchParams.season) : undefined;
  const [data, matchIndex] = await Promise.all([getCupPageData(params.slug, requestedSeason), getPublishedMatchIndex()]);
  if (!data) notFound();

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={leagueLogoUrl(data.cup.id)} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">{data.cup.country} · Cup</p>
          <h1 className="text-3xl font-bold">{data.cup.name}</h1>
          <p className="text-sm text-gray-400">{data.season}/{String(data.season + 1).slice(-2)} · {data.cup.scopeNote}</p>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-xl font-semibold">Fixtures and results</h2><p className="text-sm text-gray-400">Browse the knockout competition round by round.</p></div>
          <span className="chip bg-brand-card text-gray-300">{data.fixtures.length} matches</span>
        </div>
        <CupRounds rounds={data.rounds} fixtures={data.fixtures} linkIndex={matchIndex} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2"><h2 className="text-xl font-semibold">Participating teams</h2><span className="text-sm text-gray-400">{data.clubs.length} clubs</span></div>
        <LeagueClubGrid clubs={data.clubs} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Top scorers</h2>
        <TopScorersLeaderboard scorers={data.scorers} />
      </section>
    </div>
  );
}
