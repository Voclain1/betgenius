import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { RateCard } from "@/components/TrackRecordView";
import { getPublishedByLeagueSlug, leagueDisplayName } from "@/lib/predictionScope";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd } from "@/lib/seo";
import type { PredictionCategory } from "@/lib/enums";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { rows } = await getPublishedByLeagueSlug(params.slug);

  if (rows.length === 0) {
    return {
      title: "League predictions",
      description: "No predictions published yet for this league — check back soon for AI-powered football predictions.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/league/${params.slug}` },
    };
  }

  const name = leagueDisplayName(rows[0].leagueName!, rows[0].leagueApiId);
  const sample = rows
    .slice(0, 3)
    .map((r) => (r.homeTeam ? `${r.homeTeam} vs ${r.awayTeam}` : null))
    .filter(Boolean)
    .join(", ");

  return {
    title: name,
    description: `${rows.length} published ${name} predictions${sample ? ` — including ${sample}` : ""}. AI-powered football predictions updated daily.`,
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

  const session = await getServerSession(authOptions);
  const shaped = rows.map((r) => {
    const canView = canViewCategory(r.category as PredictionCategory, session?.user.tier, session?.user.subStatus, session?.user.role);
    return canView
      ? r
      : { ...r, pick: "LOCKED", reasoning: "Subscribe to unlock this tip and full reasoning.", matchPreview: null, confidence: null, odds: null, locked: true };
  });

  const events = rows
    .filter((r) => r.homeTeam && r.awayTeam)
    .map((r) => sportsEventJsonLd({ homeTeam: r.homeTeam!, awayTeam: r.awayTeam!, kickoff: r.kickoff, league: r.leagueName }));

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
      <div>
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="text-sm text-gray-400">{rows.length} published picks</p>
      </div>

      <div className="max-w-xs">
        <RateCard stat={stat} label={`All-time in ${name}`} big />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shaped.map((p) => (
          <PredictionCard key={p.id} p={p as any} />
        ))}
      </div>
    </div>
  );
}
