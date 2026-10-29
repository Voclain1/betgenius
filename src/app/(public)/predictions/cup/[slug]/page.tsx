import type { Metadata } from "next";
import { PredictionTimelineList } from "@/components/PredictionTimelineList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { notFound } from "next/navigation";
import { CupRounds } from "@/components/CupRounds";
import { LeagueClubGrid } from "@/components/LeagueClubGrid";
import { LeagueStandingsTable } from "@/components/LeagueStandingsTable";
import { getCupPageData, cupBySlug } from "@/lib/cups";
import { getPublishedMatchIndex } from "@/lib/predictionScope";
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
import { CompetitionChampions, CompetitionMasthead, CompetitionStatsFacts, CompetitionTopPlayers, FeaturedMatches } from "@/components/CompetitionProfile";
import { SectionHead, TeamAbout } from "@/components/TeamProfile";
import { competitionStats, featuredMatches, seasonParagraph } from "@/lib/competitionProfile";
import { competitionInSentence } from "@/lib/teamProfile";
import { COMPETITION_HISTORY } from "@/lib/competitionHistory";
import { tabOfStatus } from "@/lib/matchStatus";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const cup = cupBySlug(params.slug);
  if (!cup) return { title: "Cup competition", robots: { index: false, follow: false } };
  if (cup.slug === "danish-cup") {
    return {
      title: "Danish Cup Games, Fixtures & Results",
      description: "Browse Danish Cup games by round, with scheduled fixtures, available scores and participating teams. Open a match prediction where one has been published.",
      alternates: { canonical: `/predictions/cup/${cup.slug}` },
    };
  }
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
  const danishCup = data.cup.slug === "danish-cup";
  const finishedCount = danishCup ? data.fixtures.filter((fixture) => tabOfStatus(fixture.fixture.status.short) === "finished").length : 0;
  const upcomingCount = danishCup ? data.fixtures.filter((fixture) => tabOfStatus(fixture.fixture.status.short) === "upcoming" && new Date(fixture.fixture.date).getTime() > Date.now()).length : 0;
  // Only targeted top-tier competition hubs add prediction/proof data. Other
  // cup pages retain their previous query profile.
  const [scoped, viewer] = hubContent
    ? await Promise.all([getPublishedByLeagueSlug(leagueSlug(cup.name, cup.id)), getViewerEntitlement()])
    : [null, null] as const;
  const shaped = scoped && viewer ? scoped.rows.map((r) => ({ ...r, category: presentedCategory(r.category, r.categories) })).map((row) => canViewCategory(row.category, viewer.tier, viewer.status, viewer.role)
    ? row
    : { ...row, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true }) : [];

  const history = COMPETITION_HISTORY[data.cup.id] ?? null;
  const stats = data.cup.capabilities.standings ? competitionStats(data.standings) : null;
  // The cup's own fixture list, shaped like a league's upcoming list so the
  // same featured-match selection applies (the week's biggest by table position).
  const upcomingCup = data.fixtures
    .filter((f) => f.fixture.status.short === "NS")
    .map((f) => ({
      id: f.fixture.id,
      date: f.fixture.date,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeLogo: f.teams.home.logo ?? null,
      awayLogo: f.teams.away.logo ?? null,
      homeId: f.teams.home.id,
      awayId: f.teams.away.id,
    }));
  const featured = featuredMatches(upcomingCup, data.standings, Object.values(matchIndex), data.cup.id, data.cup.name);
  const about = [
    ...(history?.profile ?? []),
    ...[seasonParagraph({ name: data.cup.name, stats, table: data.standings, scorers: data.scorers, pickCount: scoped?.rows.length ?? 0 })].filter((p): p is string => !!p),
  ];

  return (
    <div className="space-y-8">
      <JsonLd data={breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Predictions", path: "/predictions" },
        { name: data.cup.name, path: `/predictions/cup/${data.cup.slug}` },
      ])} />
      <CompetitionMasthead
        name={danishCup ? "Danish Cup fixtures and results" : hubContent?.heading ?? data.cup.name}
        leagueApiId={data.cup.id}
        country={data.cup.country}
        flagCode={null}
        seasonLabel={`${data.season}/${String(data.season + 1).slice(-2)}`}
        stats={stats}
      >
        <p className="text-sm text-gray-400">{data.cup.scopeNote}</p>
      </CompetitionMasthead>

      {hubContent && <CompetitionHubIntro heading={hubContent.heading} intro={hubContent.intro} />}

      {danishCup && (
        <section aria-labelledby="danish-cup-games" className="max-w-3xl space-y-3">
          <h2 id="danish-cup-games" className="text-lg font-semibold">Danish Cup games this season</h2>
          <p className="text-sm leading-7 text-gray-300">
            The available {data.season}/{String(data.season + 1).slice(-2)} match list contains {finishedCount} finished {finishedCount === 1 ? "match" : "matches"} and {upcomingCount} upcoming {upcomingCount === 1 ? "fixture" : "fixtures"}.
            {" "}Choose a round below to review its games and scores. These counts reflect the data currently available here; postponed games and fixtures awaiting a result are not counted as finished.
          </p>
          <p className="text-sm leading-7 text-gray-300">
            FT marks a finished game. FT (AET) means it finished after extra time, and FT (Pens) means a penalty shootout was played.
            {" "}Match links open a BetGenius prediction where one has been published; the fixture list also includes games without a prediction.
          </p>
          <a href="#rounds" className="inline-block text-sm font-semibold text-brand hover:underline">Browse Danish Cup fixtures and results</a>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="featured">
          <SectionHead kicker="Coming up" title="Matches of the week" id="featured" />
          <FeaturedMatches matches={featured} />
        </section>
      )}

      {data.cup.capabilities.standings && data.standings.length > 0 && (
        <section aria-labelledby="standings">
          <SectionHead kicker="Table" title="Standings" id="standings" />
          <div className="overflow-hidden rounded-3xl border border-brand-border bg-brand-card p-4">
            <LeagueStandingsTable rows={data.standings} />
          </div>
        </section>
      )}

      {stats && (
        <section aria-labelledby="facts">
          <SectionHead kicker="Season so far" title="Stats and facts" id="facts" />
          <CompetitionStatsFacts stats={stats} />
        </section>
      )}

      <section aria-labelledby="rounds" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionHead kicker="Rounds" title="Fixtures and results" id="rounds" />
          <span className="mb-4 text-sm font-semibold text-gray-400">{data.fixtures.length} matches</span>
        </div>
        <CupRounds rounds={data.rounds} fixtures={data.fixtures} linkIndex={matchIndex} />
      </section>

      {data.cup.capabilities.playerStats && (
        <section aria-labelledby="top-players">
          <SectionHead kicker="Players" title="Top players this season" id="top-players" />
          <CompetitionTopPlayers scorers={data.scorers} assists={[]} />
        </section>
      )}

      {history && (
        <section aria-labelledby="champions">
          <SectionHead kicker="All-time roll of honour" title="Winners" id="champions" />
          <CompetitionChampions champions={history.champions} scope={history.scope} />
        </section>
      )}

      <section aria-labelledby="clubs">
        <SectionHead kicker="Clubs" title={`Participating teams (${data.clubs.length})`} id="clubs" />
        <LeagueClubGrid clubs={data.clubs} />
      </section>

      {hubContent && (
        <section aria-labelledby="predictions" className="space-y-4">
          <SectionHead kicker="Predictions" title={`Published ${data.cup.name} picks`} id="predictions" />
          {scoped && <div className="max-w-sm"><RateCard stat={scoped.stat} label={`All-time in ${data.cup.name}`} big /></div>}
          {shaped.length > 0 ? (
            <PredictionViewSwitch
              detailed={<PredictionTimelineList rows={shaped as any} view="detailed" reasoningExcerpt emptyUpcoming={`No upcoming ${data.cup.name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
              compact={<PredictionTimelineList rows={shaped as any} view="compact" emptyUpcoming={`No upcoming ${data.cup.name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
            />
          ) : <div className="card text-sm text-gray-400">No {data.cup.name} predictions are published yet.</div>}
        </section>
      )}

      {about.length > 0 && <TeamAbout name={competitionInSentence(data.cup.name)} paragraphs={about} kicker="Competition profile" />}

      {hubContent && <CompetitionHubLinks competition={data.cup.name} />}
    </div>
  );
}
