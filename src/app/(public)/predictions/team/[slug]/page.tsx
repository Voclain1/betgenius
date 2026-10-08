import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { PredictionCard } from "@/components/PredictionCard";
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
import { NextMatchCard, SectionHead, TeamAbout, TeamCompetitions, TeamMasthead } from "@/components/TeamProfile";
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

      <div className={profile?.nextMatch ? "grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "max-w-sm"}>
        {profile?.nextMatch && (
          <section aria-labelledby="next-match">
            <SectionHead kicker="Fixture" title="Next match" id="next-match" />
            <NextMatchCard match={profile.nextMatch} />
          </section>
        )}
        <section aria-labelledby="our-record">
          <SectionHead kicker="BetGenius" title="Our record" id="our-record" />
          <RateCard stat={stat} label={`All-time for ${name}`} big />
        </section>
      </div>

      {enrichment && (
        <section aria-labelledby="form">
          <SectionHead kicker="Form" title="Form and club facts" id="form" />
          <TeamEnrichmentPanel teamApiId={teamApiId} />
        </section>
      )}

      <AdLeaderboard />

      <section aria-labelledby="predictions">
        <SectionHead kicker="Predictions" title={`${name} predictions`} id="predictions" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shaped.map((p) => (
            <PredictionCard key={p.id} p={p as any} />
          ))}
        </div>
      </section>

      {profile && profile.competitions.length > 0 && (
        <section aria-labelledby="competitions">
          <SectionHead kicker="This season" title="Competitions" id="competitions" />
          <TeamCompetitions competitions={profile.competitions} />
        </section>
      )}

      {about.length > 0 && <TeamAbout name={name} paragraphs={about} />}

      {squad.length > 0 && (
        <section aria-labelledby="squad">
          <SectionHead kicker="Players" title={`Squad (${squad.length})`} id="squad" />
          <TeamSquad squad={squad} />
        </section>
      )}

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
