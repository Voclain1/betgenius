import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { RateCard } from "@/components/TrackRecordView";
import { LeagueStandingsTable } from "@/components/LeagueStandingsTable";
import { LeagueFixtures } from "@/components/LeagueFixtures";
import { LeagueResults } from "@/components/LeagueResults";
import { LeagueClubGrid } from "@/components/LeagueClubGrid";
import { LeaguePlayerStats } from "@/components/LeaguePlayerStats";
import {
  getPublishedByLeagueSlug,
  leagueDisplayName,
  getLeagueEnrichment,
  getLeagueClubs,
  getPublishedMatchIndex,
  getFixtureEventContext,
} from "@/lib/predictionScope";
import type { LeagueStandingRow, LeagueUpcomingFixture, LeaguePlayerStat } from "@/lib/enrichment";
import { matchKey } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures, leagueSeo, researchedLeagueSeo, leagueIdFromSlug, fixtureSample } from "@/lib/seo";
import { AnswerSummary } from "@/components/AnswerSummary";
import { leagueSummary } from "@/lib/answerSummary";
import type { PredictionCategory } from "@/lib/enums";

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
  const sample = fixtureSample(rows);

  return {
    title: seo.title,
    // The count is the page's own row count and the sample is its own leading
    // fixtures, so the description cannot claim more than the page shows. Only
    // the phrase and the closing sentence are per-league.
    description: `${rows.length} ${seo.phrase}${sample ? ` — including ${sample}` : ""}. ${seo.blurb}`,
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

  const [enrichment, matchIndex, session] = await Promise.all([
    getLeagueEnrichment(leagueApiId),
    getPublishedMatchIndex(),
    getServerSession(authOptions),
  ]);
  const standings = (enrichment?.standingsJson as unknown as LeagueStandingRow[] | null) ?? null;
  const upcoming = (enrichment?.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? null;
  const clubs = standings?.length ? await getLeagueClubs(standings) : [];
  const scorers = (enrichment?.topScorersJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const assists = (enrichment?.topAssistsJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const cards = (enrichment?.topCardsJson as unknown as LeaguePlayerStat[] | null) ?? [];
  // The upcoming list has no team ids, so its preview links match on the
  // name-derived slug — the values of the id-keyed index are those same slugs.
  const publishedSlugs = Object.values(matchIndex);
  const shaped = rows.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role);
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
    <div className="space-y-6">
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
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{name}</h1>
        {/* The scoped record as a sentence, above standings and fixtures. The
            RateCard below shows the same stat broken out; this is the version
            a reader (or an answer engine) can quote without assembling it. */}
        <AnswerSummary text={leagueSummary({ name, pickCount: rows.length, stat })} />
      </div>

      <div className="max-w-xs">
        <RateCard stat={stat} label={`All-time in ${name}`} big />
      </div>

      {standings && standings.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-xl font-semibold">Standings</h2>
          <LeagueStandingsTable rows={standings} />
        </div>
      )}

      <div>
        <h2 className="mb-3 text-xl font-semibold">Upcoming fixtures</h2>
        <LeagueFixtures
          upcoming={upcoming}
          league={{ id: leagueApiId ?? -1, name: rows[0].leagueName!, country: "" }}
          publishedSlugs={publishedSlugs}
        />
      </div>

      <div>
        <h2 className="mb-3 text-xl font-semibold">Recent results</h2>
        <LeagueResults leagueApiId={leagueApiId} linkIndex={matchIndex} />
      </div>

      {/* Rendered once player stats have been fetched at all. Individual
          boards can still be empty (season not started, cards lagging) and say
          so themselves; before the first fetch there is nothing to caveat. */}
      {enrichment?.playersFetchedAt && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Player leaderboards</h2>
          <LeaguePlayerStats scorers={scorers} assists={assists} cards={cards} />
        </div>
      )}

      {clubs.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Clubs in this league</h2>
          <LeagueClubGrid clubs={clubs} />
        </div>
      )}

      {/* Picks last because this list is unbounded — a league with 45 published
          predictions would otherwise push standings, fixtures and results so
          far down that the page's depth is unreachable. Everything above is
          fixed-height or collapsed. */}
      <div>
        <h2 className="mb-3 text-xl font-semibold">
          {rows.length} published {rows.length === 1 ? "pick" : "picks"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shaped.map((p) => (
            <PredictionCard key={p.id} p={p as any} />
          ))}
        </div>
      </div>
    </div>
  );
}
