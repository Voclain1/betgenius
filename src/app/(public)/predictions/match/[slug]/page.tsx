import { MatchLineups } from "@/components/MatchLineups";
import { MatchOddsPanel } from "@/components/MatchOddsPanel";
import type { FixtureOdds } from "@/lib/odds";
import { cupSupports } from "@/lib/cupConfig";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FollowButton } from "@/components/FollowButton";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { PredictionCard } from "@/components/PredictionCard";
import { MatchMasthead } from "@/components/MatchMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { MatchRecentResults } from "@/components/MatchRecentResults";
import { MatchSectionNav } from "@/components/MatchSectionNav";
import { parseStoredContext } from "@/lib/ai/context";
import { evidenceClaimIssues } from "@/lib/ai/evidenceClaims";
import { assertCompetitionStage } from "@/lib/ai/competitionStage";
import { parseAnalysis } from "@/lib/predictionAnalysis";
import { buildMatchFacts, isMatchFactsEmpty, teamNewsState } from "@/lib/matchFacts";
import { MatchVerdict } from "@/components/MatchVerdict";
import { KeyFactors } from "@/components/KeyFactors";
import { TeamNewsPanel } from "@/components/TeamNewsPanel";
import { MatchStatsComparison } from "@/components/MatchStatsComparison";
import { MatchStandingsContext } from "@/components/MatchStandingsContext";
import { MatchH2HSummary } from "@/components/MatchH2HSummary";
import { MatchKeyPlayers } from "@/components/MatchKeyPlayers";
import { Prose } from "@/components/Prose";
import { MatchPageFooterLinks } from "@/components/MatchPageFooterLinks";
import { MatchTrackRecord } from "@/components/MatchTrackRecord";
import { marketPathways } from "@/lib/contextualLinks";
import { getPublishedByMatchSlug, getMatchTeamDigests, getH2HMeetings, getFixtureDetail, getFixtureEventContext, getMatchEditorialEvidence, getTeamMatchEnrichment, getLeagueEnrichment, getMatchOdds } from "@/lib/predictionScope";
import { h2hSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd, matchTitle, matchDescription } from "@/lib/seo";
import { assessMatchEvidence } from "@/lib/matchEvidence";
import type { PredictionCategory } from "@/lib/enums";
import { AdNativeBand, AdRectangle, WithAdRail } from "@/components/ads/AdPlacements";
import { EditorialAttribution } from "@/components/EditorialAttribution";

/**
 * Everything both generateMetadata and the page body need, assembled once.
 *
 * Next runs generateMetadata and the component separately, so without this the
 * indexability decision and the rendered page could be computed from two
 * different reads. Every underlying getter is React-cache()d, so calling this
 * twice per request costs one set of queries.
 *
 * The `publicTopPick` here is resolved as an ANONYMOUS visitor, deliberately:
 * metadata is one document per URL, served to crawlers and logged-out readers
 * alike, so a VIP-gated pick must never reach a meta description.
 */
async function loadMatch(slug: string) {
  const { rows, match } = await getPublishedByMatchSlug(slug);
  if (!match) return { rows, match: null as null, evidence: null, publicTopPick: null, digests: null, h2hMeetings: [] as never[] };

  const [digests, h2hMeetings] = await Promise.all([
    getMatchTeamDigests(match.homeTeamApiId, match.awayTeamApiId, match.leagueApiId),
    getH2HMeetings(match.homeTeamApiId, match.awayTeamApiId),
  ]);

  const publicRow = rows.find((r) => canViewCategory(presentedCategory(r.category, r.categories), undefined, undefined, undefined)) ?? null;

  const evidence = assessMatchEvidence({
    homeDigest: digests.home,
    awayDigest: digests.away,
    standings: digests.standings,
    homeTeamApiId: match.homeTeamApiId,
    awayTeamApiId: match.awayTeamApiId,
    h2hMeetings,
    matchPreview: rows.find((r) => r.matchPreview)?.matchPreview ?? null,
    analysisJson: rows.find((r) => r.analysisJson)?.analysisJson ?? null,
  });

  return {
    rows,
    match,
    evidence,
    digests,
    h2hMeetings,
    publicTopPick: publicRow ? { market: publicRow.market, pick: publicRow.pick, confidence: publicRow.confidence } : null,
  };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { rows, match } = await loadMatch(params.slug);

  if (!match) {
    return {
      title: "Match predictions",
      description: "No predictions published for this match — check back soon for our latest football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/match/${params.slug}` },
    };
  }

  const { evidence, publicTopPick } = await loadMatch(params.slug);
  const settled = rows.find((row) => row.finalHomeScore != null && row.finalAwayScore != null);

  return {
    title: matchTitle(match),
    description: matchDescription({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      leagueName: match.leagueName,
      kickoff: match.kickoff,
      topPick: publicTopPick,
      marketCount: rows.length,
      finalScore: settled ? { home: settled.finalHomeScore!, away: settled.finalAwayScore! } : null,
    }),
    alternates: { canonical: `/predictions/match/${params.slug}` },
    // Evidence-gated indexing. A page below the bar still renders in full and
    // still passes link equity (follow) — it just doesn't ask to rank until it
    // carries enough verified content to be worth ranking. See
    // src/lib/matchEvidence.ts for the signals and the threshold.
    ...(evidence && !evidence.substantive ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function MatchPage({ params }: { params: { slug: string } }) {
  const { rows, match, digests, h2hMeetings, publicTopPick } = await loadMatch(params.slug);

  if (!match) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Match predictions</h1>
        <div className="card text-gray-400">
          No published predictions for this match.{" "}
          <Link href="/predictions/today" className="text-brand hover:underline">
            See today&apos;s tips →
          </Link>
        </div>
      </div>
    );
  }

  const session = await getServerSession(authOptions);
  const viewer = await getViewerEntitlement();
  // Gated per row on its own category, exactly as the league/team/category
  // pages do — a VIP market on an otherwise-free match stays visible as a
  // locked row rather than disappearing, so the reader can see the market
  // exists and what it would cost to read it.
  const editorialRows = await getMatchEditorialEvidence(params.slug);
  const editorialById = new Map(editorialRows.map(r => [r.id, r.aiJob]));
  const reviewIds = new Set<string>();
  const shaped = rows.map((row) => {
    const r = { ...row, category: presentedCategory(row.category, row.categories) };
    const canView = canViewCategory(r.category, viewer.tier, viewer.status, viewer.role);
    const digest = parseStoredContext(editorialById.get(r.id)?.context);
    // Compare prose against its stored generation evidence, never a newer cache.
    let invalid = false;
    if (digest && canView) {
      const text = [r.matchPreview, r.reasoning, ...(parseAnalysis(r.analysisJson)?.keyFactors ?? [])].filter(Boolean).join("\n");
      invalid = evidenceClaimIssues(digest, text).length > 0;
      try { if (digest.fixture.round) assertCompetitionStage(digest.fixture, { matchPreview: r.matchPreview ?? undefined, keyFactors: parseAnalysis(r.analysisJson)?.keyFactors, predictions: [{ reasoning: r.reasoning }] }); } catch { invalid = true; }
    }
    if (invalid) reviewIds.add(r.id);
    return canView
      ? invalid ? { ...r, matchPreview: null, analysisJson: null, reasoning: "The original analysis contains an evidence conflict and is withheld for review. The published pick and settlement are preserved." } : r
      : { ...r, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true };
  });

  // The one preview worth showing at the top: the highest-confidence row the
  // reader can actually read (rows are already confidence-ordered).
  const preview = shaped.find((r) => !("locked" in r && r.locked) && r.matchPreview)?.matchPreview ?? null;

  // A settled row carries the match's final score; the masthead shows it in
  // place of the kickoff time without waiting on the live feed.
  const settled = rows.find((r) => r.finalHomeScore != null && r.finalAwayScore != null);
  const finalScore = settled ? { home: settled.finalHomeScore!, away: settled.finalAwayScore! } : null;
  const lockedCount = shaped.filter((r) => "locked" in r && r.locked).length;
  const h2hPair = h2hSlug(match.homeTeam, match.awayTeam);
  const h2hLink = h2hPair ? `/predictions/h2h/${h2hPair}` : null;

  // The headline call and the key factors both come from the strongest row the
  // reader is entitled to see. Reusing `shaped` (not `rows`) is what keeps a
  // locked VIP pick from leaking into the verdict at the top of the page.
  const topRow = shaped.find((r) => !("locked" in r && r.locked)) ?? null;

  // Read from the cron-filled enrichment caches by loadMatch above — no
  // api-football call happens on this page.
  const { home: currentHomeDigest, away: currentAwayDigest, standings } = digests!;
  const highlightedJob = topRow ? editorialById.get(topRow.id) : null;
  const original = parseStoredContext(highlightedJob?.context);
  const homeDigest = original?.teams.home ?? currentHomeDigest;
  const awayDigest = original?.teams.away ?? currentAwayDigest;
  const evidenceMeetings = original ? original.h2h?.meetings ?? [] : h2hMeetings;
  const hasForm = !!(homeDigest?.last5.length || awayDigest?.last5.length);
  const hasNews = teamNewsState(currentHomeDigest).kind !== "unavailable" || teamNewsState(currentAwayDigest).kind !== "unavailable";
  const hasStats = !isMatchFactsEmpty(buildMatchFacts(homeDigest, awayDigest));
  const [homeCache, awayCache, leagueCache] = await Promise.all([
    getTeamMatchEnrichment(match.homeTeamApiId), getTeamMatchEnrichment(match.awayTeamApiId), getLeagueEnrichment(match.leagueApiId),
  ]);
  const stamp = (date: Date | null | undefined) => date ? date.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) + " WAT" : "not available";
  const sections = [
    ...(topRow ? [{ id: "verdict", label: "Verdict" }] : []),
    ...(preview ? [{ id: "preview", label: "Preview" }] : []),
    ...(topRow && parseAnalysis(topRow.analysisJson) ? [{ id: "key-factors", label: "Key factors" }] : []),
    ...(hasForm ? [{ id: "form", label: "Recent form" }] : []),
    ...(hasNews ? [{ id: "team-news", label: "Team news" }] : []),
    ...(hasStats ? [{ id: "stats", label: "Statistics" }] : []),
    ...(evidenceMeetings.length && match.homeTeamApiId != null && match.awayTeamApiId != null ? [{ id: "h2h", label: "H2H" }] : []),
    { id: "lineups", label: "Lineups" },
    { id: "odds", label: "Odds" },
    { id: "markets", label: "Published picks" },
  ];

  // Venue for the structured data, from the same cached row the masthead
  // renders, so the markup can't describe a different ground than the page.
  const [fixtureDetail, oddsCache] = await Promise.all([getFixtureDetail(match.matchKey), getMatchOdds(match.matchKey)]);
  const detail = (fixtureDetail?.detailJson as { venue?: string | null; city?: string | null; round?: string | null; referee?: string | null; lineups?: unknown } | null) ?? null;

  // Crests, competition badge and ingested fixture status for the structured
  // data. Venue is NOT taken from here — `detail` above is already the correct,
  // fixture-specific source on this page, and this read only fills the fields
  // the match page never had.
  const eventContext = (
    await getFixtureEventContext([
      { homeTeamApiId: match.homeTeamApiId, awayTeamApiId: match.awayTeamApiId, kickoff: match.kickoff, leagueApiId: match.leagueApiId },
    ])
  ).get(match.matchKey ?? "");

  // Publication time is distinct from the original evidence and cache-fetch
  // timestamps above. A refreshed cache does not create an editorial update.
  const publishedAt = rows.reduce<Date | null>((a, r) => (r.publishedAt && (!a || r.publishedAt > a) ? r.publishedAt : a), null);

  return (
    // The one page on the site deep enough to carry a rail. See AdRail for the
    // width arithmetic and for why it only exists at xl and above.
    <WithAdRail unit="skyscraper">
    <div className="space-y-8 [&_[id]]:scroll-mt-36">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: `${match.homeTeam} vs ${match.awayTeam}`, path: `/predictions/match/${params.slug}` },
          ]),
          sportsEventJsonLd({
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            kickoff: match.kickoff,
            league: match.leagueName,
            leagueApiId: match.leagueApiId,
            leagueLogo: eventContext?.leagueLogo ?? null,
            homeTeamApiId: match.homeTeamApiId,
            awayTeamApiId: match.awayTeamApiId,
            homeTeamLogo: eventContext?.homeTeamLogo ?? null,
            awayTeamLogo: eventContext?.awayTeamLogo ?? null,
            statusShort: eventContext?.statusShort ?? null,
            // The SAME string the meta description carries, built from the
            // SAME anonymously-resolved publicTopPick that loadMatch computes
            // for generateMetadata. JSON-LD is served to crawlers and
            // signed-out readers alike, so it must never see a pick the meta
            // tag would refuse to print — reusing publicTopPick rather than
            // re-deriving one is what guarantees that.
            description: matchDescription({
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              leagueName: match.leagueName,
              kickoff: match.kickoff,
              topPick: publicTopPick,
              marketCount: rows.length,
            }),
            url: `/predictions/match/${params.slug}`,
            venue: detail?.venue ?? null,
            city: detail?.city ?? null,
            datePublished: publishedAt,
            dateModified: rows.reduce<Date | null>((a, r) => (!a || r.publishedAt! > a ? r.publishedAt! : a), null) ?? publishedAt,
          }),
        ]}
      />

      <MatchMasthead
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        kickoff={match.kickoff}
        leagueName={match.leagueName}
        leagueApiId={match.leagueApiId}
        round={detail?.round}
        venue={detail?.venue}
        city={detail?.city}
        referee={detail?.referee}
        finalScore={finalScore}
        follow={
          <>
            {match.homeTeamApiId != null && <FollowButton targetType="TEAM" targetKey={String(match.homeTeamApiId)} label={match.homeTeam} subject={match.homeTeam} />}
            {match.awayTeamApiId != null && <FollowButton targetType="TEAM" targetKey={String(match.awayTeamApiId)} label={match.awayTeam} subject={match.awayTeam} />}
            {rows[0] && <FollowButton targetType="PREDICTION" targetKey={rows[0].id} label={`${match.homeTeam} vs ${match.awayTeam}`} subject="this match" />}
          </>
        }
      >
        <div className="flex justify-center">
          <EditorialAttribution />
        </div>
      </MatchMasthead>

      <MatchSectionNav sections={sections} />
      {reviewIds.size > 0 && <div role="note" className="rounded-2xl border border-orange-500/40 p-4 text-sm text-orange-200">An evidence conflict was detected in the original analysis. Affected prose is withheld for review; published picks and outcomes are retained. This is not a revised prediction.</div>}

      {topRow && (
        <MatchVerdict
          market={topRow.market}
          pick={topRow.pick}
          confidence={topRow.confidence ?? 0}
          overUnder={topRow.overUnder}
        />
      )}

      {preview && (
        <PremiumPanel kicker="Preview" title="Match preview" id="preview">
          <Prose text={preview} />
        </PremiumPanel>
      )}

      {/* After the verdict and preview rather than straight under the
          masthead: the call is what the reader came for, so it sits as close
          to the top as the page allows, and the ad is its own full-width
          block between two panels, never inside a prediction card. */}
      <AdRectangle />

      {topRow && <KeyFactors analysisJson={topRow.analysisJson} />}

      <MatchRecentResults
        home={homeDigest}
        away={awayDigest}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
      />

      <TeamNewsPanel
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeDigest={currentHomeDigest}
        awayDigest={currentAwayDigest}
      />

      <MatchStatsComparison
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeDigest={homeDigest}
        awayDigest={awayDigest}
      />

      {/* Mid-content, and deliberately here rather than a section earlier or
          later. The verdict and the key factors are well above, the
          published-markets grid is at the foot, and both of this band's
          neighbours — the stats comparison above, key players below — are
          reference data rather than a call of ours. */}
      <AdRectangle />

      <MatchKeyPlayers
        leagueApiId={match.leagueApiId}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        homeDigest={homeDigest}
        awayDigest={awayDigest}
      />

      <MatchStandingsContext
        standings={standings}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        leagueName={match.leagueName}
        leagueApiId={match.leagueApiId}
      />

      <MatchH2HSummary
        meetings={evidenceMeetings}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        h2hLink={h2hLink}
      />

      <MatchLineups raw={detail?.lineups} fixtureApiId={fixtureDetail?.fixtureApiId ?? null} homeId={match.homeTeamApiId} awayId={match.awayTeamApiId} kickoff={match.kickoff} supported={cupSupports(match.leagueApiId, "lineups")} />
      <MatchOddsPanel odds={fixtureDetail?.fixtureApiId != null && oddsCache?.fixtureApiId === fixtureDetail.fixtureApiId ? oddsCache?.oddsJson as unknown as FixtureOdds ?? null : null} fetchedAt={oddsCache?.fetchedAt ?? null} kickoff={match.kickoff} />

      <MatchTrackRecord leagueApiId={match.leagueApiId} leagueName={match.leagueName} />

      <PremiumPanel
        bare
        kicker="Predictions"
        title={`${rows.length} published ${rows.length === 1 ? "market" : "markets"}`}
        id="markets"
        aside={
          lockedCount > 0 && (
            <span className="font-medium text-gray-500">
              {lockedCount} locked — <Link href="/pricing" className="text-brand hover:underline">upgrade to unlock</Link>
            </span>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shaped.map((p) => (
            <PredictionCard key={p.id} p={p as any} hideMatchHeader />
          ))}
        </div>
      </PremiumPanel>

      <MatchPageFooterLinks
        leagueApiId={match.leagueApiId}
        leagueName={match.leagueName}
        currentSlug={params.slug}
        h2hMeetings={h2hMeetings}
        standings={standings}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        // From picks an anonymous reader can see: the page is cached and
        // crawled, and a link must not reveal a locked pick's market.
        pathways={marketPathways(rows.filter((r) => canViewCategory(presentedCategory(r.category, r.categories), undefined, undefined, undefined)))}
      />

      {/* Evidence and cache timestamps, then publication time, at the foot:
          reference for anyone checking the page, not something to read before
          the verdict. Editorial publication remains separate from both. */}
      <section aria-labelledby="data-sources" className="space-y-2 border-t border-brand-border pt-6 text-xs leading-relaxed text-gray-500">
        <h2 id="data-sources" className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">About this data</h2>
        <p>
        {original && highlightedJob ? <>Highlighted prediction evidence recorded {highlightedJob.createdAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })} WAT. Recent form, statistics and H2H above use that original evidence.</> : <>Original prediction evidence is unavailable. Recent form, statistics and H2H above describe the latest cached context, which may differ from what was known before kickoff.</>}
        {" "}Team news, player totals, standings and performance records may refresh separately. Published analysis is not automatically rewritten when those figures change.</p>
        <p>Team context last fetched: {match.homeTeam}: {stamp(homeCache?.fetchedAt)}; {match.awayTeam}: {stamp(awayCache?.fetchedAt)}. Table cache last fetched: {stamp(leagueCache?.fetchedAt)}. A fetch time does not confirm that every underlying item changed.</p>
        {finalScore && <section aria-labelledby="completed-match-context" className="space-y-2 pt-2"><h2 id="completed-match-context" className="text-sm font-bold text-gray-300">Completed match: published prediction record</h2><p>This match has finished. The published call is retained for review; <Link href="/predictions/today" className="text-brand underline">see today’s predictions</Link>.</p></section>}
      </section>
      {publishedAt && (
        <p className="text-[11px] text-gray-500">
          Published {publishedAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
          The original prediction is retained; supporting context is labelled separately above.
        </p>
      )}

      {/* Foot of the page, below the footer links. Same reasoning as the
          homepage: the Native Banner only ever goes where the surrounding
          content is chrome. */}
      <AdNativeBand />
    </div>
    </WithAdRail>
  );
}
