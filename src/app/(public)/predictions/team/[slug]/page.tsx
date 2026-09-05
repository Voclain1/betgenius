import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { RateCard } from "@/components/TrackRecordView";
import { TeamEnrichmentPanel } from "@/components/TeamEnrichmentPanel";
import { TeamSquad } from "@/components/TeamSquad";
import { getPublishedByTeamSlug, getOpponentsForTeamSlug, getTeamEnrichment, getFixtureEventContext } from "@/lib/predictionScope";
import type { SquadPlayer } from "@/lib/enrichment";
import { teamSlug, matchKey } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures } from "@/lib/seo";
import { AnswerSummary } from "@/components/AnswerSummary";
import { teamSummary } from "@/lib/answerSummary";
import type { PredictionCategory } from "@/lib/enums";

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
  const sample = rows
    .slice(0, 3)
    .map((r) => (r.homeTeam ? `${r.homeTeam} vs ${r.awayTeam}` : null))
    .filter(Boolean)
    .join(", ");

  return {
    title: name,
    description: `${rows.length} published ${name} predictions${sample ? ` — including ${sample}` : ""}. Football predictions with confidence ratings, updated daily.`,
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
  const enrichment = await getTeamEnrichment(teamApiId);
  const squad = (enrichment?.squadJson as unknown as SquadPlayer[] | null) ?? [];

  const session = await getServerSession(authOptions);
  const shaped = rows.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role);
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
            { name, path: `/predictions/team/${params.slug}` },
          ]),
          ...events,
        ]}
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{name}</h1>
        {/* Answers "what is this site's record on this team" in one line,
            above the form panel and the RateCard that break it down. */}
        <AnswerSummary text={teamSummary({ name, pickCount: rows.length, stat })} />
      </div>

      <TeamEnrichmentPanel teamApiId={teamApiId} />

      <div className="max-w-xs">
        <RateCard stat={stat} label={`All-time for ${name}`} big />
      </div>

      {squad.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">
            Squad <span className="text-sm font-normal text-gray-500">({squad.length})</span>
          </h2>
          <TeamSquad squad={squad} />
        </div>
      )}

      {/* Opponents this team has published picks against — each one is a
          pairing with a head-to-head record worth reading. Rendered only when
          there's at least one, rather than as an empty shell. */}
      {opponents.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Head-to-head records</h2>
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
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shaped.map((p) => (
          <PredictionCard key={p.id} p={p as any} />
        ))}
      </div>
    </div>
  );
}
