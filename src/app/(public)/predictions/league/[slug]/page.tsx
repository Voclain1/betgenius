import type { Metadata } from "next";
import { PredictionTimelineList } from "@/components/PredictionTimelineList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { RateCard } from "@/components/TrackRecordView";
import { LeagueStandingsTable } from "@/components/LeagueStandingsTable";
import { LeagueFixtures } from "@/components/LeagueFixtures";
import { LeagueResults } from "@/components/LeagueResults";
import { LeagueClubGrid } from "@/components/LeagueClubGrid";
import { CompetitionChampions, CompetitionMasthead, CompetitionStatsFacts, CompetitionTopPlayers, FeaturedMatches } from "@/components/CompetitionProfile";
import { SectionHead, TeamAbout } from "@/components/TeamProfile";
import { competitionStats, featuredMatches, seasonParagraph } from "@/lib/competitionProfile";
import { competitionInSentence } from "@/lib/teamProfile";
import { COMPETITION_HISTORY } from "@/lib/competitionHistory";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import {
  getPublishedByLeagueSlug,
  leagueDisplayName,
  getLeagueEnrichment,
  getLeagueClubs,
  getPublishedMatchIndexFor,
  getFixtureEventContext,
} from "@/lib/predictionScope";
import type { LeagueStandingRow, LeagueUpcomingFixture, LeaguePlayerStat } from "@/lib/enrichment";
import { matchKey, matchSlug } from "@/lib/slug";
import { FollowButton } from "@/components/FollowButton";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures, leagueSeo, researchedLeagueSeo, leagueIdFromSlug, fitMetadataTitle, fitMetaDescription } from "@/lib/seo";
import { AnswerSummary } from "@/components/AnswerSummary";
import { leagueSummary } from "@/lib/answerSummary";
import { AdLeaderboard, WithAdRail } from "@/components/ads/AdPlacements";
import type { PredictionCategory } from "@/lib/enums";
import { competitionHubContent } from "@/lib/competitionHubContent";
import { CompetitionHubLinks } from "@/components/CompetitionHubLinks";
import { CompetitionHubIntro } from "@/components/CompetitionHubIntro";

// LeagueResults shows the last 36h of finished fixtures; a match link resolves
// through matchKey, which is keyed on the kickoff's UTC day. A prediction for a
// fixture in that window therefore kicks off within these bounds of "now".
const RESULTS_LINK_LOOKBACK_MS = 72 * 60 * 60_000;
const RESULTS_LINK_LOOKAHEAD_MS = 48 * 60 * 60_000;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { rows } = await getPublishedByLeagueSlug(params.slug);

  if (rows.length === 0) {
    // No row to read leagueApiId off, so the id comes from the slug instead —
    // an empty Ligue 1 page still knows it is Ligue 1 and still titles itself
    // with the researched term rather than falling back to "League
    // predictions". Noindexed either way; the title is for the reader who
    // arrives on it from a link.
    const seo = researchedLeagueSeo(leagueIdFromSlug(params.slug));
    return {
      title: seo?.title || "League predictions",
      description: seo
        ? `No ${seo.phrase} are published today — check back soon for the next card in this competition.`
        : "No predictions published yet for this league — check back soon for our latest football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/league/${params.slug}` },
    };
  }

  const name = leagueDisplayName(rows[0].leagueName!, rows[0].leagueApiId);
  const seo = leagueSeo(rows[0].leagueApiId, name);
  return {
    title: fitMetadataTitle(seo.title),
    description: fitMetaDescription(`${rows.length} ${seo.phrase}. ${seo.blurb}`),
    alternates: { canonical: `/predictions/league/${params.slug}` },
  };
}

export default async function LeaguePage({ params }: { params: { slug: string } }) {
  const { rows, stat } = await getPublishedByLeagueSlug(params.slug);

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">League predictions</h1>
        <div className="card text-gray-400">No published predictions for this league yet.</div>
      </div>
    );
  }

  const name = leagueDisplayName(rows[0].leagueName!, rows[0].leagueApiId);
  const leagueApiId = rows[0].leagueApiId;
  const hubContent = competitionHubContent(leagueApiId);

  const [enrichment, session] = await Promise.all([
    getLeagueEnrichment(leagueApiId),
    getServerSession(authOptions),
  ]);
  const viewer = await getViewerEntitlement();
  const standings = (enrichment?.standingsJson as unknown as LeagueStandingRow[] | null) ?? null;
  // Fixtures already kicked off are dropped at read time too, so a cache the
  // refresh has not reached yet still never lists a past match as upcoming.
  const upcomingAll = ((enrichment?.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? null)?.filter((f) => new Date(f.date).getTime() > Date.now())
    .sort((a, b) => a.date.localeCompare(b.date)) ?? null;
  const upcoming = upcomingAll?.slice(0, 10) ?? null;
  // Only the fixtures this page can link: the upcoming list's own slugs, and
  // anything kicking off inside the recent-results window (LeagueResults keys
  // its links by matchKey, whose day is the kickoff's UTC day — hence the
  // margin either side of its 36h window). This used to be the global index,
  // i.e. every published prediction read, and then shipped to the client, on
  // every league page render.
  const now = Date.now();
  const matchIndex = await getPublishedMatchIndexFor({
    slugs: (upcomingAll ?? []).map((f) => matchSlug({ homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date })).filter((s): s is string => s !== null),
    kickoff: { gte: new Date(now - RESULTS_LINK_LOOKBACK_MS), lte: new Date(now + RESULTS_LINK_LOOKAHEAD_MS) },
  });
  const clubs = standings?.length ? await getLeagueClubs(standings) : [];
  const scorers = (enrichment?.topScorersJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const assists = (enrichment?.topAssistsJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const cards = (enrichment?.topCardsJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const catalogue = LEAGUE_CATALOGUE.find((l) => l.id === leagueApiId);
  const history = leagueApiId != null ? COMPETITION_HISTORY[leagueApiId] ?? null : null;
  const stats = competitionStats(standings);
  // A season label only where the season spans two years for certain (the
  // curated European competitions); elsewhere it could be a calendar year.
  const seasonLabel = history && enrichment?.season ? `${enrichment.season}/${String(enrichment.season + 1).slice(-2)}` : null;
  const about = [
    ...(history?.profile ?? []),
    ...[seasonParagraph({ name, stats, table: standings, scorers, pickCount: rows.length })].filter((p): p is string => !!p),
  ];
  // The upcoming list has no team ids, so its preview links match on the
  // name-derived slug — the values of the id-keyed index are those same slugs.
  const publishedSlugs = Object.values(matchIndex);
  const featured = featuredMatches(upcomingAll, standings, publishedSlugs, leagueApiId, name);
  const shaped = rows.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, viewer.tier, viewer.status, viewer.role);
    return canView
      ? r
      : { ...r, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true };
  });

  // One event per fixture, not per row — a fixture with several published
  // markets is still one match. url points at the match page; see the note on
  // sportsEventsForFixtures.
  const eventRows = rows
    .filter((r) => r.homeTeam && r.awayTeam)
    .map((r) => ({
      homeTeam: r.homeTeam!,
      awayTeam: r.awayTeam!,
      kickoff: r.kickoff,
      league: r.leagueName,
      leagueApiId: r.leagueApiId,
      homeTeamApiId: r.homeTeamApiId,
      awayTeamApiId: r.awayTeamApiId,
      category: r.category,
      market: r.market,
      pick: r.pick,
      confidence: r.confidence,
    }));

  // Venue, crests, competition badge and fixture status — one batched read for
  // every fixture on the page.
  const eventContext = await getFixtureEventContext(eventRows);

  const events = sportsEventsForFixtures(
    eventRows.map((f) => ({
      ...f,
      ...(eventContext.get(matchKey(f) ?? "") ?? {}),
      // Gated as an ANONYMOUS visitor, per row's own category — not against
      // `session`. The markup is cached and crawled, so it must describe what a
      // signed-out reader sees rather than whoever warmed the cache.
      publicPick: canViewCategory(f.category as PredictionCategory, undefined, undefined, undefined)
        ? { market: f.market, pick: f.pick, confidence: f.confidence }
        : null,
    })),
  );

  return (
    // Rail carries the 160x300 rather than the 600 — see AdRail on why one
    // unit per rail and why the tall one went to the match page.
    <WithAdRail unit="railHalf">
    <div className="space-y-8">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name, path: `/predictions/league/${params.slug}` },
          ]),
          ...events,
        ]}
      />
      <CompetitionMasthead
        name={hubContent?.heading ?? name}
        leagueApiId={leagueApiId}
        country={catalogue?.country && catalogue.country !== "World" ? catalogue.country : null}
        flagCode={catalogue && "flagCode" in catalogue ? (catalogue.flagCode as string) : null}
        seasonLabel={seasonLabel}
        stats={stats}
      >
        {leagueApiId != null && <FollowButton targetType="LEAGUE" targetKey={String(leagueApiId)} label={name} />}
      </CompetitionMasthead>

      {hubContent && <CompetitionHubIntro heading={hubContent.heading} intro={hubContent.intro} />}
      {/* The scoped record as a sentence. The RateCard beside the featured
          matches shows the same stat broken out; this is the version a reader
          (or an answer engine) can quote without assembling it. */}
      <AnswerSummary text={leagueSummary({ name, pickCount: rows.length, stat })} />

      <div className={featured.length ? "grid gap-6" : "max-w-sm"}>
        {featured.length > 0 && (
          <section aria-labelledby="featured">
            <SectionHead kicker="Coming up" title="Matches of the week" id="featured" />
            <FeaturedMatches matches={featured} />
          </section>
        )}
        <section aria-labelledby="our-record" className="max-w-sm">
          <SectionHead kicker="BetGenius" title="Our record" id="our-record" />
          <RateCard stat={stat} label={`All-time in ${name}`} big />
        </section>
      </div>

      <AdLeaderboard />

      {standings && standings.length > 0 && (
        <section aria-labelledby="standings">
          <SectionHead kicker="Table" title="Standings" id="standings" />
          <div className="overflow-hidden rounded-3xl border border-brand-border bg-brand-card p-4">
            <LeagueStandingsTable rows={standings} />
          </div>
        </section>
      )}

      {stats && (
        <section aria-labelledby="facts">
          <SectionHead kicker="Season so far" title="Stats and facts" id="facts" />
          <CompetitionStatsFacts stats={stats} />
        </section>
      )}

      <section aria-labelledby="upcoming">
        <SectionHead kicker="Fixtures" title="Upcoming fixtures" id="upcoming" />
        <LeagueFixtures
          upcoming={upcoming}
          league={{ id: leagueApiId ?? -1, name: rows[0].leagueName!, country: "" }}
          publishedSlugs={publishedSlugs}
        />
      </section>

      <section aria-labelledby="results">
        <SectionHead kicker="Results" title="Recent results" id="results" />
        <LeagueResults leagueApiId={leagueApiId} linkIndex={matchIndex} />
      </section>

      {/* Between two reference sections — settled results above, player
          leaderboards below. */}
      <AdLeaderboard />

      {/* Rendered once player stats have been fetched at all; before the first
          fetch there is nothing to caveat. */}
      {enrichment?.playersFetchedAt && (
        <section aria-labelledby="top-players">
          <SectionHead kicker="Players" title="Top players this season" id="top-players" />
          <CompetitionTopPlayers scorers={scorers} assists={assists} cards={cards} />
        </section>
      )}

      {history && (
        <section aria-labelledby="champions">
          <SectionHead kicker="All-time roll of honour" title="Title winners" id="champions" />
          <CompetitionChampions champions={history.champions} scope={history.scope} />
        </section>
      )}

      {clubs.length > 0 && (
        <section aria-labelledby="clubs">
          <SectionHead kicker="Clubs" title={`Clubs in ${name}`} id="clubs" />
          <LeagueClubGrid clubs={clubs} />
        </section>
      )}

      {/* Picks after the reference sections, as on team pages: short reasoning
          excerpts, and room under the view switch. */}
      <section aria-labelledby="predictions" className="space-y-4">
        <SectionHead kicker="Predictions" title={`${rows.length} published ${rows.length === 1 ? "pick" : "picks"}`} id="predictions" />
        <PredictionViewSwitch
          detailed={<PredictionTimelineList rows={shaped as any} view="detailed" reasoningExcerpt emptyUpcoming={`No upcoming ${name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
          compact={<PredictionTimelineList rows={shaped as any} view="compact" emptyUpcoming={`No upcoming ${name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
        />
      </section>

      {about.length > 0 && <TeamAbout name={competitionInSentence(name)} paragraphs={about} kicker="Competition profile" />}

      {hubContent && <CompetitionHubLinks competition={name} />}
    </div>
    </WithAdRail>
  );
}
