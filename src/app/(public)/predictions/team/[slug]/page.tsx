import Link from "next/link";
import { PredictionTimelineList } from "@/components/PredictionTimelineList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { RateCard } from "@/components/TrackRecordView";
import { TeamEnrichmentPanel } from "@/components/TeamEnrichmentPanel";
import { TeamSquad } from "@/components/TeamSquad";
import { getPublishedByTeamSlug, getOpponentsForTeamSlug, getTeamEnrichment, getFixtureEventContext } from "@/lib/predictionScope";
import type { SquadPlayer } from "@/lib/enrichment";
import { teamSlug, matchKey } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures, fitMetaDescription } from "@/lib/seo";
import { AnswerSummary } from "@/components/AnswerSummary";
import { AdLeaderboard } from "@/components/ads/AdPlacements";
import { teamSummary } from "@/lib/answerSummary";
import type { PredictionCategory } from "@/lib/enums";
import { FollowButton } from "@/components/FollowButton";
import { NextMatchCard, SectionHead, TeamAbout, TeamCompetitions, TeamFixtureList, TeamHonours, TeamMasthead, TeamTopPlayers } from "@/components/TeamProfile";
import { TeamTabs } from "@/components/TeamTabs";
import { clubHonours, clubHonoursAsOf } from "@/lib/clubHonours";
import { buildTeamAbout, getTeamProfile } from "@/lib/teamProfile";
import type { TeamCoach, TeamFixtureSummary } from "@/lib/enrichment";
import { absoluteUrl } from "@/lib/seo";

/** The row set can mix two spellings that happen to slug the same, or (rarely) one team's home games and another same-slugged team's away games; picks whichever stored name actually matches `slug` for display. */
function resolveTeamName(rows: { homeTeam: string | null; awayTeam: string | null }[], slug: string): string {
  for (const r of rows) {
    if (r.homeTeam && teamSlug(r.homeTeam) === slug) return r.homeTeam;
    if (r.awayTeam && teamSlug(r.awayTeam) === slug) return r.awayTeam;
  }
  return slug;
}

/** Same matching as resolveTeamName, but for the API id feeding TeamEnrichmentPanel — most recent row wins if spellings/ids ever disagree. */
function resolveTeamApiId(rows: { homeTeam: string | null; awayTeam: string | null; homeTeamApiId: number | null; awayTeamApiId: number | null }[], slug: string): number | null {
  for (const r of rows) {
    if (r.homeTeam && teamSlug(r.homeTeam) === slug && r.homeTeamApiId != null) return r.homeTeamApiId;
    if (r.awayTeam && teamSlug(r.awayTeam) === slug && r.awayTeamApiId != null) return r.awayTeamApiId;
  }
  return null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { rows } = await getPublishedByTeamSlug(params.slug);

  if (rows.length === 0) {
    return {
      title: "Team predictions",
      description: "No predictions published yet for this team — check back soon for our latest football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/team/${params.slug}` },
    };
  }

  const name = resolveTeamName(rows, params.slug);
  return {
    title: name,
    description: fitMetaDescription(`${rows.length} published ${name} football predictions with match analysis, confidence ratings and settled results.`),
    alternates: { canonical: `/predictions/team/${params.slug}` },
  };
}

export default async function TeamPage({ params }: { params: { slug: string } }) {
  const { rows, stat } = await getPublishedByTeamSlug(params.slug);

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Team predictions</h1>
        <div className="card text-gray-400">No published predictions for this team yet.</div>
      </div>
    );
  }

  const name = resolveTeamName(rows, params.slug);
  const teamApiId = resolveTeamApiId(rows, params.slug);
  const opponents = await getOpponentsForTeamSlug(params.slug);
  const [enrichment, profile] = await Promise.all([getTeamEnrichment(teamApiId), getTeamProfile(teamApiId)]);
  const squad = (enrichment?.squadJson as unknown as SquadPlayer[] | null) ?? [];
  const coach = (enrichment?.coachJson as unknown as TeamCoach | null) ?? null;
  const about = buildTeamAbout({
    name,
    profile,
    venue: { name: enrichment?.venueName ?? null, city: enrichment?.venueCity ?? null, capacity: enrichment?.venueCapacity ?? null },
    coach,
    lastFixtures: (enrichment?.lastFixtures as unknown as TeamFixtureSummary[] | null) ?? null,
    squad,
    pickCount: rows.length,
  });

  const honours = clubHonours(teamApiId, name);
  const hasPlayerStats = squad.some((p) => p.stats && p.stats.appearances > 0);
  const tabs = [
    ...(profile?.upcoming.length ? [{ id: "fixtures", label: "Fixtures", content: <TeamFixtureList fixtures={profile.upcoming} teamApiId={teamApiId} /> }] : []),
    ...(squad.length ? [{ id: "squad", label: `Squad (${squad.length})`, content: <TeamSquad squad={squad} /> }] : []),
    ...(hasPlayerStats ? [{ id: "top", label: "Top players", content: <TeamTopPlayers squad={squad} /> }] : []),
  ];

  // The club itself as structured data, beside the events: name, crest,
  // ground, coach and the competitions it plays in, all from stored facts.
  const teamJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name,
    sport: "Soccer",
    url: absoluteUrl(`/predictions/team/${params.slug}`),
    ...(teamApiId != null ? { logo: `https://media.api-sports.io/football/teams/${teamApiId}.png` } : {}),
    ...(about.length ? { description: about[0] } : {}),
    ...(enrichment?.venueName
      ? { location: { "@type": "Place", name: enrichment.venueName, ...(enrichment.venueCity ? { address: enrichment.venueCity } : {}) } }
      : {}),
    ...(coach ? { coach: { "@type": "Person", name: coach.name } } : {}),
    ...(profile?.competitions.length
      ? { memberOf: profile.competitions.map((c) => ({ "@type": "SportsOrganization", name: c.name, ...(c.href ? { url: absoluteUrl(c.href) } : {}) })) }
      : {}),
  };

  const session = await getServerSession(authOptions);
  const viewer = await getViewerEntitlement();
  const shaped = rows.map((row) => {
    const r = { ...row, category: presentedCategory(row.category, row.categories) };
    const canView = canViewCategory(r.category, viewer.tier, viewer.status, viewer.role);
    return canView
      ? r
      : { ...r, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true };
  });

  // One event per fixture, not per row — the same fixture listed under two
  // markets is one match. See the note on sportsEventsForFixtures.
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
      category: presentedCategory(r.category, r.categories),
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
    <div className="space-y-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name, path: `/predictions/team/${params.slug}` },
          ]),
          ...events,
          teamJsonLd,
        ]}
      />

      <TeamMasthead name={name} teamApiId={teamApiId} country={profile?.country ?? null} flagCode={profile?.flagCode ?? null} standing={profile?.standing ?? null}>
        {teamApiId != null && <FollowButton targetType="TEAM" targetKey={String(teamApiId)} label={name} />}
      </TeamMasthead>

      {/* Answers "what is this site's record on this team" in one line. */}
      <AnswerSummary text={teamSummary({ name, pickCount: rows.length, stat })} />

      {profile?.nextMatch && (
        <section aria-labelledby="next-match" className="max-w-2xl">
          <SectionHead kicker="Fixture" title="Next match" id="next-match" />
          <NextMatchCard match={profile.nextMatch} />
        </section>
      )}

      {honours && (
        <section aria-labelledby="honours">
          <SectionHead kicker="Trophy cabinet" title="Major honours" id="honours" />
          <TeamHonours honours={honours} asOf={clubHonoursAsOf(teamApiId, name)} />
        </section>
      )}

      {enrichment && (
        <section aria-labelledby="form">
          <SectionHead kicker="Form" title="Form and club facts" id="form" />
          <TeamEnrichmentPanel teamApiId={teamApiId} />
        </section>
      )}

      <AdLeaderboard />


      {/* Reference sections in tabs: everything is in the HTML, one shown at a time. */}
      {tabs.length > 0 && (
        <section aria-labelledby="team-sections">
          <SectionHead kicker="Season" title="Fixtures and players" id="team-sections" />
          <TeamTabs tabs={tabs} />
        </section>
      )}

      {profile && profile.competitions.length > 0 && (
        <section aria-labelledby="competitions">
          <SectionHead kicker="This season" title="Competitions" id="competitions" />
          <TeamCompetitions competitions={profile.competitions} />
        </section>
      )}

      {/* Predictions sit after the reference sections. Cards show a short
          excerpt of the reasoning; the switch gets its own breathing room. */}
      <section aria-labelledby="our-record" className="max-w-sm">
        <SectionHead kicker="BetGenius" title="Our record" id="our-record" />
        <RateCard stat={stat} label={`All-time for ${name}`} big />
      </section>

      <section aria-labelledby="predictions" className="space-y-4">
        <SectionHead kicker="Predictions" title={`${name} predictions`} id="predictions" />
        <PredictionViewSwitch
          detailed={<PredictionTimelineList rows={shaped as any} view="detailed" reasoningExcerpt emptyUpcoming={`No upcoming ${name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
          compact={<PredictionTimelineList rows={shaped as any} view="compact" emptyUpcoming={`No upcoming ${name} picks yet. New predictions are published as bookmakers open their markets, usually a day or two before kickoff.`} />}
        />
      </section>


      {about.length > 0 && <TeamAbout name={name} paragraphs={about} />}

      {/* Opponents this team has published picks against — each one is a
          pairing with a head-to-head record worth reading. Rendered only when
          there's at least one, rather than as an empty shell. */}
      {opponents.length > 0 && (
        <section aria-labelledby="h2h">
          <SectionHead kicker="Rivals" title="Head-to-head records" id="h2h" />
          <div className="flex flex-wrap gap-2">
            {opponents.map((o) => (
              <Link
                key={o.h2hSlug}
                href={`/predictions/h2h/${o.h2hSlug}`}
                className="chip flex items-center gap-1.5 border border-brand-border bg-brand-card hover:border-brand"
              >
                <span>vs {o.name}</span>
                <span className="text-xs text-gray-500">{o.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
