import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { MatchInfoPanel } from "@/components/MatchInfoPanel";
import { MatchLiveStatus } from "@/components/MatchLiveStatus";
import { MatchFormComparison } from "@/components/MatchFormComparison";
import { getPublishedByMatchSlug } from "@/lib/predictionScope";
import { teamSlug, h2hSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd } from "@/lib/seo";
import type { PredictionCategory } from "@/lib/enums";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { rows, match } = await getPublishedByMatchSlug(params.slug);

  if (!match) {
    return {
      title: "Match predictions",
      description: "No predictions published for this match — check back soon for AI-powered football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/match/${params.slug}` },
    };
  }

  const title = `${match.homeTeam} vs ${match.awayTeam}`;
  const markets = [...new Set(rows.map((r) => r.market))].join(", ");

  return {
    title,
    description: `${rows.length} published prediction${rows.length === 1 ? "" : "s"} for ${title}${match.leagueName ? ` (${match.leagueName})` : ""} — ${markets}. AI-powered picks with confidence and full reasoning.`,
    alternates: { canonical: `/predictions/match/${params.slug}` },
  };
}

export default async function MatchPage({ params }: { params: { slug: string } }) {
  const { rows, match } = await getPublishedByMatchSlug(params.slug);

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
          }),
        ]}
      />

      <div className="space-y-2">
        <h1 className="text-2xl font-bold md:text-3xl">
          <Link href={`/predictions/team/${teamSlug(match.homeTeam)}`} className="hover:underline">
            {match.homeTeam}
          </Link>{" "}
          <span className="text-gray-500">vs</span>{" "}
          <Link href={`/predictions/team/${teamSlug(match.awayTeam)}`} className="hover:underline">
            {match.awayTeam}
          </Link>
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

      {preview && <p className="text-sm text-gray-300 whitespace-pre-wrap">{preview}</p>}

      {h2hLink && (
        <Link href={h2hLink} className="btn btn-ghost w-full justify-center text-sm sm:w-auto">
          View full head-to-head →
        </Link>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">
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

    </div>
  );
}
