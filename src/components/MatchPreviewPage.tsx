import Link from "next/link";
import { PremiumPanel } from "@/components/PremiumPanel";
import { MatchMasthead } from "@/components/MatchMasthead";
import { MatchRecentResults } from "@/components/MatchRecentResults";
import { MatchFormGoals } from "@/components/matchcentre/MatchFormGoals";
import { MatchStatsComparison } from "@/components/MatchStatsComparison";
import { MatchStandingsContext } from "@/components/MatchStandingsContext";
import { MatchH2HSummary } from "@/components/MatchH2HSummary";
import { MatchSectionNav } from "@/components/MatchSectionNav";
import { MatchPageFooterLinks } from "@/components/MatchPageFooterLinks";
import { EditorialAttribution } from "@/components/EditorialAttribution";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd, matchPreviewDescription } from "@/lib/seo";
import { buildMatchFacts, isMatchFactsEmpty } from "@/lib/matchFacts";
import { identityDigest } from "@/lib/predictionExplanation";
import { formSource, h2hWindow, tableContext } from "@/lib/matchCentre";
import { getFixtureDetail, getFixtureEventContext, getH2HMeetings, getLeagueEnrichment, getMatchTeamDigests, getTeamFixtureHistories } from "@/lib/predictionScope";
import { matchKey } from "@/lib/slug";
import { DEFAULT_TIMEZONE } from "@/lib/personalization";
import type { PreviewFixture } from "@/lib/matchPreview";

/**
 * A genuine match page for an upcoming fixture before any prediction exists.
 *
 * Shows only data that is cached and verifiable: kickoff, competition, venue
 * and round when known, recent results, the league table, head-to-head and
 * venue splits. There is deliberately no pick, confidence, market, odds,
 * lineup, injury or editorial text on this page, and no draft or paid row is
 * read to build it. When a pick is published the same URL renders the full
 * prediction page instead.
 */
export async function MatchPreviewPage({ fixture, slug, evidenceUpdatedAt }: { fixture: PreviewFixture; slug: string; evidenceUpdatedAt: Date | null }) {
  const { homeTeamApiId, awayTeamApiId, homeTeam, awayTeam, kickoff, leagueApiId, leagueName } = fixture;
  const key = matchKey({ homeTeamApiId, awayTeamApiId, kickoff });
  const [digests, h2hMeetings, leagueCache, histories, detailRow, context] = await Promise.all([
    getMatchTeamDigests(homeTeamApiId, awayTeamApiId, leagueApiId),
    getH2HMeetings(homeTeamApiId, awayTeamApiId),
    getLeagueEnrichment(leagueApiId),
    getTeamFixtureHistories([homeTeamApiId, awayTeamApiId]),
    getFixtureDetail(key),
    getFixtureEventContext([{ homeTeamApiId, awayTeamApiId, kickoff, leagueApiId }]),
  ]);
  const eventContext = context.get(key ?? "");
  const detail = (detailRow?.detailJson as { venue?: string | null; city?: string | null; round?: string | null } | null) ?? null;
  const homeDigest = identityDigest(digests.home, homeTeamApiId);
  const awayDigest = identityDigest(digests.away, awayTeamApiId);
  const source = formSource({
    homeHistory: histories.get(homeTeamApiId), awayHistory: histories.get(awayTeamApiId),
    homeTeamApiId, awayTeamApiId, homeTeam, awayTeam, kickoff, leagueApiId, leagueName,
  });
  const hasForm = !!(homeDigest?.last5.length || awayDigest?.last5.length);
  const hasFormGoals = source.ALL.home.length > 0 || source.ALL.away.length > 0;
  const hasStats = !isMatchFactsEmpty(buildMatchFacts(homeDigest, awayDigest));
  const hasTable = tableContext(digests.standings, homeTeamApiId, awayTeamApiId).kind === "table";
  const hasH2H = h2hWindow(h2hMeetings, homeTeamApiId, awayTeamApiId, 10, kickoff).played > 0;
  const season = leagueCache?.season ? `${leagueCache.season}/${String(leagueCache.season + 1).slice(-2)}` : null;
  const sections = [
    ...(hasForm ? [{ id: "form", label: "Recent form" }] : []),
    ...(hasFormGoals ? [{ id: "form-goals", label: "Form & goals" }] : []),
    ...(hasStats ? [{ id: "stats", label: "Statistics" }] : []),
    ...(hasTable ? [{ id: "table-context", label: "Table" }] : []),
    ...(hasH2H ? [{ id: "h2h", label: "H2H" }] : []),
  ];
  const stamp = evidenceUpdatedAt
    ? evidenceUpdatedAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) + " WAT" : null;

  return (
    <div className="space-y-8 [&_[id]]:scroll-mt-36">
      <JsonLd data={[
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Predictions", path: "/predictions" },
          { name: `${homeTeam} vs ${awayTeam}`, path: `/predictions/match/${slug}` },
        ]),
        sportsEventJsonLd({
          homeTeam, awayTeam, kickoff, league: leagueName, leagueApiId,
          leagueLogo: eventContext?.leagueLogo ?? null, homeTeamApiId, awayTeamApiId,
          homeTeamLogo: eventContext?.homeTeamLogo ?? null, awayTeamLogo: eventContext?.awayTeamLogo ?? null,
          statusShort: "NS", venue: detail?.venue ?? null, city: detail?.city ?? null,
          description: matchPreviewDescription({ homeTeam, awayTeam, leagueName, kickoff }),
          url: `/predictions/match/${slug}`,
        }),
      ]} />

      <MatchMasthead
        homeTeam={homeTeam} awayTeam={awayTeam} homeTeamApiId={homeTeamApiId} awayTeamApiId={awayTeamApiId}
        kickoff={kickoff} leagueName={leagueName} leagueApiId={leagueApiId}
        round={detail?.round ?? fixture.round} venue={detail?.venue} city={detail?.city}
        finalScore={null} statusCode={null} halftime={null} localKickoff={null} season={season} headingSuffix="match preview"
      >
        <div className="flex justify-center"><EditorialAttribution /></div>
      </MatchMasthead>

      <PremiumPanel kicker="Prediction" title="Prediction not published yet" id="status">
        <p className="text-sm leading-relaxed text-gray-300">
          We have not published a prediction for {homeTeam} vs {awayTeam}. Until we do, this page shows the
          recent results, league position and head-to-head record behind the fixture. If a prediction is
          published it will appear on this same page.
          {" "}<Link href="/predictions/today" className="text-brand hover:underline">See today&apos;s predictions →</Link>
        </p>
      </PremiumPanel>

      {sections.length > 0 && <MatchSectionNav sections={sections} />}

      <MatchRecentResults home={homeDigest} away={awayDigest} homeTeam={homeTeam} awayTeam={awayTeam}
        homeHistory={histories.get(homeTeamApiId)} awayHistory={histories.get(awayTeamApiId)} />
      <MatchFormGoals source={source} homeTeam={homeTeam} awayTeam={awayTeam} homeTeamApiId={homeTeamApiId}
        awayTeamApiId={awayTeamApiId} leagueName={leagueName} timeZone={DEFAULT_TIMEZONE} />
      <MatchStatsComparison homeTeam={homeTeam} awayTeam={awayTeam} homeDigest={homeDigest} awayDigest={awayDigest} />
      <MatchStandingsContext standings={digests.standings} homeTeamApiId={homeTeamApiId} awayTeamApiId={awayTeamApiId}
        leagueName={leagueName} leagueApiId={leagueApiId} homeTeam={homeTeam} awayTeam={awayTeam} season={leagueCache?.season ?? null} />
      <MatchH2HSummary meetings={h2hMeetings} homeTeam={homeTeam} awayTeam={awayTeam} homeTeamApiId={homeTeamApiId}
        awayTeamApiId={awayTeamApiId} h2hLink={null} kickoff={kickoff} timeZone={DEFAULT_TIMEZONE} />

      <MatchPageFooterLinks leagueApiId={leagueApiId} leagueName={leagueName} currentSlug={slug} h2hMeetings={h2hMeetings}
        standings={digests.standings} homeTeamApiId={homeTeamApiId} awayTeamApiId={awayTeamApiId} pathways={[]} />

      <section aria-labelledby="data-sources" className="space-y-2 border-t border-brand-border pt-6 text-xs leading-relaxed text-gray-500">
        <h2 id="data-sources" className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">About this data</h2>
        <p>Form, table and head-to-head figures come from cached match records{stamp ? <>, last refreshed {stamp}</> : null}. Lineups, injuries and
          team news are not shown until they are confirmed. Kickoff times can change.</p>
      </section>
    </div>
  );
}
