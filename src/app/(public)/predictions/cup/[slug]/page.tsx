import type { Metadata } from "next";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { notFound } from "next/navigation";
import { CupRounds } from "@/components/CupRounds";
import { LeagueClubGrid } from "@/components/LeagueClubGrid";
import { TopScorersLeaderboard } from "@/components/LeaguePlayerStats";
import { LeagueStandingsTable } from "@/components/LeagueStandingsTable";
import { getCupPageData, cupBySlug } from "@/lib/cups";
import { getPublishedMatchIndex } from "@/lib/predictionScope";
import { leagueLogoUrl } from "@/lib/leagues";
import { fitMetadataTitleWithSuffix, fitMetaDescription } from "@/lib/seo";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { getPublishedByLeagueSlug } from "@/lib/predictionScope";
import { leagueSlug } from "@/lib/slug";
import { competitionHubContent } from "@/lib/competitionHubContent";
import { CompetitionHubLinks } from "@/components/CompetitionHubLinks";
import { RateCard } from "@/components/TrackRecordView";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { canViewCategory, presentedCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { CompetitionHubIntro } from "@/components/CompetitionHubIntro";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const cup = cupBySlug(params.slug);
  if (!cup) return { title: "Cup competition", robots: { index: false, follow: false } };
  const hubContent = competitionHubContent(cup.id);
  if (hubContent?.metadataTitle && hubContent.metadataDescription) {
    return {
      title: hubContent.metadataTitle,
      description: hubContent.metadataDescription,
      alternates: { canonical: `/predictions/cup/${cup.slug}` },
    };
  }
  return {
    title: fitMetadataTitleWithSuffix(cup.name, "fixtures and results"),
    description: fitMetaDescription(`${cup.name} knockout rounds, participating clubs, results, fixtures and top scorers.`),
    alternates: { canonical: `/predictions/cup/${cup.slug}` },
  };
}

export default async function CupPage({ params, searchParams }: { params: { slug: string }; searchParams: { season?: string } }) {
  const requestedSeason = /^\d{4}$/.test(searchParams.season ?? "") ? Number(searchParams.season) : undefined;
  const cup = cupBySlug(params.slug);
  if (!cup) notFound();
  const [data, matchIndex] = await Promise.all([getCupPageData(params.slug, requestedSeason), getPublishedMatchIndex()]);
  if (!data) notFound();
  const hubContent = competitionHubContent(data.cup.id);
  // Only targeted top-tier competition hubs add prediction/proof data. Other
  // cup pages retain their previous query profile.
  const [scoped, viewer] = hubContent
    ? await Promise.all([getPublishedByLeagueSlug(leagueSlug(cup.name, cup.id)), getViewerEntitlement()])
    : [null, null] as const;
  const shaped = scoped && viewer ? scoped.rows.map((r) => ({ ...r, category: presentedCategory(r.category, r.categories) })).map((row) => canViewCategory(row.category, viewer.tier, viewer.status, viewer.role)
    ? row
    : { ...row, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true }) : [];

  return (
    <div className="space-y-8">
      <JsonLd data={breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Predictions", path: "/predictions" },
        { name: data.cup.name, path: `/predictions/cup/${data.cup.slug}` },
      ])} />
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={leagueLogoUrl(data.cup.id)} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">{data.cup.country} · Cup</p>
          <h1 className="text-3xl font-bold">{hubContent?.heading ?? data.cup.name}</h1>
          <p className="text-sm text-gray-400">{data.season}/{String(data.season + 1).slice(-2)} · {data.cup.scopeNote}</p>
        </div>
      </header>

      {hubContent && <CompetitionHubIntro heading={hubContent.heading} intro={hubContent.intro} />}

      {hubContent && (
        <section className="space-y-3" aria-labelledby="competition-picks-heading">
          <h2 id="competition-picks-heading" className="text-xl font-semibold">Published {data.cup.name} picks</h2>
          {scoped && <div className="max-w-xs"><RateCard stat={scoped.stat} label={`All-time in ${data.cup.name}`} big /></div>}
          {shaped.length > 0 ? (
            <PredictionViewSwitch
              detailed={<CategoryPredictionsList rows={shaped as any} view="detailed" />}
              compact={<CategoryPredictionsList rows={shaped as any} view="compact" />}
            />
          ) : <div className="card text-sm text-gray-400">No {data.cup.name} predictions are published yet.</div>}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-xl font-semibold">Fixtures and results</h2><p className="text-sm text-gray-400">Browse the knockout competition round by round.</p></div>
          <span className="chip bg-brand-card text-gray-300">{data.fixtures.length} matches</span>
        </div>
        <CupRounds rounds={data.rounds} fixtures={data.fixtures} linkIndex={matchIndex} />
      </section>

      {data.cup.capabilities.standings && data.standings.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-xl font-semibold">Standings</h2>
          <LeagueStandingsTable rows={data.standings} />
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2"><h2 className="text-xl font-semibold">Participating teams</h2><span className="text-sm text-gray-400">{data.clubs.length} clubs</span></div>
        <LeagueClubGrid clubs={data.clubs} />
      </section>

      {data.cup.capabilities.playerStats && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Top scorers</h2>
          <TopScorersLeaderboard scorers={data.scorers} />
        </section>
      )}

      {hubContent && <CompetitionHubLinks competition={data.cup.name} />}
    </div>
  );
}
