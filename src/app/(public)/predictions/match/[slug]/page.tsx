import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { MatchInfoPanel } from "@/components/MatchInfoPanel";
import { MatchLiveStatus } from "@/components/MatchLiveStatus";
import { MatchFormComparison } from "@/components/MatchFormComparison";
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
import { getPublishedByMatchSlug, getMatchTeamDigests, getH2HMeetings, getFixtureDetail } from "@/lib/predictionScope";
import { teamSlug, h2hSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd, matchTitle, matchDescription } from "@/lib/seo";
import { assessMatchEvidence } from "@/lib/matchEvidence";
import type { PredictionCategory } from "@/lib/enums";

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

  const publicRow = rows.find((r) => canViewCategory(r.category as PredictionCategory, undefined, undefined, undefined)) ?? null;

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
      description: "No predictions published for this match — check back soon for AI-powered football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/match/${params.slug}` },
    };
  }

  const { evidence, publicTopPick } = await loadMatch(params.slug);

  return {
    title: matchTitle(match),
    description: matchDescription({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      leagueName: match.leagueName,
      kickoff: match.kickoff,
      topPick: publicTopPick,
      marketCount: rows.length,
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
  const { rows, match, digests, h2hMeetings } = await loadMatch(params.slug);

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
  // Gated per row on its own category, exactly as the league/team/category
  // pages do — a VIP market on an otherwise-free match stays visible as a
  // locked row rather than disappearing, so the reader can see the market
  // exists and what it would cost to read it.
  const shaped = rows.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role);
    return canView
      ? r
      : { ...r, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true };
  });

  // The one preview worth showing at the top: the highest-confidence row the
  // reader can actually read (rows are already confidence-ordered).
  const preview = shaped.find((r) => !("locked" in r && r.locked) && r.matchPreview)?.matchPreview ?? null;
  const lockedCount = shaped.filter((r) => "locked" in r && r.locked).length;
  const h2hPair = h2hSlug(match.homeTeam, match.awayTeam);
  const h2hLink = h2hPair ? `/predictions/h2h/${h2hPair}` : null;

  // The headline call and the key factors both come from the strongest row the
  // reader is entitled to see. Reusing `shaped` (not `rows`) is what keeps a
  // locked VIP pick from leaking into the verdict at the top of the page.
  const topRow = shaped.find((r) => !("locked" in r && r.locked)) ?? null;

  // Read from the cron-filled enrichment caches by loadMatch above — no
  // api-football call happens on this page.
  const { home: homeDigest, away: awayDigest, standings } = digests!;

  // Venue for the structured data, from the same cached row MatchInfoPanel
  // renders, so the markup can't describe a different ground than the page.
  const fixtureDetail = await getFixtureDetail(match.matchKey);
  const detail = (fixtureDetail?.detailJson as { venue?: string | null; city?: string | null } | null) ?? null;

  // Page-level freshness only. Per-section cache stamps were deliberately
  // removed from this app; this is the editorial published/updated line, which
  // is a different thing and is what dateModified below reports.
  const publishedAt = rows.reduce<Date | null>((a, r) => (r.publishedAt && (!a || r.publishedAt > a) ? r.publishedAt : a), null);

  return (
    <div className="space-y-6">
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
            url: `/predictions/match/${params.slug}`,
            venue: detail?.venue ?? null,
            city: detail?.city ?? null,
            datePublished: publishedAt,
            dateModified: rows.reduce<Date | null>((a, r) => (!a || r.publishedAt! > a ? r.publishedAt! : a), null) ?? publishedAt,
          }),
        ]}
      />

      <div className="space-y-2">
        {/* One natural phrase. "prediction" is what the page is and what the
            reader searched for; stacking "tips / preview / odds / H2H" after it
            would describe the same page four times. Team names stay linked
            inside the heading so the primary internal links are where a reader
            looks first. */}
        <h1 className="text-2xl font-bold md:text-3xl">
          <Link href={`/predictions/team/${teamSlug(match.homeTeam)}`} className="hover:underline">
            {match.homeTeam}
          </Link>{" "}
          <span className="text-gray-500">vs</span>{" "}
          <Link href={`/predictions/team/${teamSlug(match.awayTeam)}`} className="hover:underline">
            {match.awayTeam}
          </Link>{" "}
          <span className="text-gray-400">prediction</span>
        </h1>
        <MatchLiveStatus
          homeTeamApiId={match.homeTeamApiId}
          awayTeamApiId={match.awayTeamApiId}
          kickoff={match.kickoff.toISOString()}
        />
      </div>

      <MatchInfoPanel
        matchKey={match.matchKey}
        kickoff={match.kickoff}
        leagueName={match.leagueName}
        leagueApiId={match.leagueApiId}
      />

      <MatchFormComparison
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
      />

      {topRow && (
        <MatchVerdict
          market={topRow.market}
          pick={topRow.pick}
          confidence={topRow.confidence ?? 0}
          odds={topRow.odds}
          overUnder={topRow.overUnder}
        />
      )}

      {preview && (
        <section className="card space-y-2">
          <h2 className="section-heading">Match preview</h2>
          <Prose text={preview} />
        </section>
      )}

      {topRow && <KeyFactors analysisJson={topRow.analysisJson} />}

      <TeamNewsPanel
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeDigest={homeDigest}
        awayDigest={awayDigest}
      />

      <MatchStatsComparison
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeDigest={homeDigest}
        awayDigest={awayDigest}
      />

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
        meetings={h2hMeetings}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
        h2hLink={h2hLink}
      />

      <MatchTrackRecord leagueApiId={match.leagueApiId} leagueName={match.leagueName} />

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-heading">
            {rows.length} published {rows.length === 1 ? "market" : "markets"}
          </h2>
          {lockedCount > 0 && (
            <span className="text-xs text-gray-500">
              {lockedCount} locked — <Link href="/pricing" className="text-brand hover:underline">upgrade to unlock</Link>
            </span>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shaped.map((p) => (
            <PredictionCard key={p.id} p={p as any} hideMatchHeader />
          ))}
        </div>
      </div>

      <MatchPageFooterLinks
        leagueApiId={match.leagueApiId}
        leagueName={match.leagueName}
        currentSlug={params.slug}
        h2hMeetings={h2hMeetings}
        standings={standings}
        homeTeamApiId={match.homeTeamApiId}
        awayTeamApiId={match.awayTeamApiId}
      />

      {/* Page-level freshness, once, at the foot — the editorial published date,
          not the per-section cache stamps this app deliberately removed. */}
      {publishedAt && (
        <p className="text-[11px] text-gray-500">
          Published {publishedAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
          Form, team news and table context refresh automatically.
        </p>
      )}
    </div>
  );
}
