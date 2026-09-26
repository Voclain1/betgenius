import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { getDoubleChancePredictions } from "@/lib/marketPredictions";
import { dayShowsOutcomes, feedDayHref, parseFeedDay } from "@/lib/categoryPredictions";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { DoubleChancePredictionsEvidence, DoubleChancePredictionsGuide } from "@/components/DoubleChancePredictionsGuide";
import { JsonLd, breadcrumbJsonLd, fixtureSample, sportsEventsForFixtures } from "@/lib/seo";

const PATH = "/predictions/double-chance";

export async function generateMetadata({ searchParams }: { searchParams?: { date?: string } }): Promise<Metadata> {
  const day = parseFeedDay(searchParams?.date);
  const rows = await getDoubleChancePredictions(day);
  const sample = fixtureSample(rows.map((row) => ({
    homeTeam: row.homeTeam ?? row.fixture?.homeTeam?.name,
    awayTeam: row.awayTeam ?? row.fixture?.awayTeam?.name,
  })));
  return {
    title: "Double Chance Predictions Today",
    description: rows.length
      ? `${rows.length} Double Chance predictions${sample ? `, including ${sample}` : ""}. Home-or-Draw, Away-or-Draw and Home-or-Away picks with match evidence.`
      : "No Double Chance predictions are published yet — check back for the latest football picks.",
    robots: rows.length === 0 || day !== "today" ? { index: false, follow: true } : undefined,
    alternates: { canonical: feedDayHref("double-chance", day) },
  };
}

export default async function DoubleChancePage({ searchParams }: { searchParams?: { date?: string } }) {
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [rows, session, viewer] = await Promise.all([
    getDoubleChancePredictions(day),
    getServerSession(authOptions),
    getViewerEntitlement(),
  ]);

  const shaped = rows.map((row) => {
    const categories = row.categories.map((item) => item.category as PredictionCategory);
    const gateCategory = categories.find((category) => canViewCategory(category, viewer.tier, viewer.status, viewer.role))
      ?? (row.category as PredictionCategory);
    const canView = canViewCategory(gateCategory, viewer.tier, viewer.status, viewer.role);
    if (canView) return { ...row, outcome: showOutcomes ? row.outcome : null };
    const needsRegistration = gateCategory === "BANKER" && !session?.user;
    return {
      ...row,
      outcome: showOutcomes ? row.outcome : null,
      pick: "LOCKED",
      reasoning: needsRegistration
        ? "Sign up free to unlock this tip and full reasoning."
        : "Subscribe to VIP or Premium to unlock this tip and full reasoning.",
      matchPreview: null,
      confidence: null,
      odds: null,
      locked: true,
    };
  });

  const eventRows = rows.map((row) => {
    const homeTeam = row.homeTeam ?? row.fixture?.homeTeam?.name;
    const awayTeam = row.awayTeam ?? row.fixture?.awayTeam?.name;
    if (!homeTeam || !awayTeam) return null;
    const categories = row.categories.map((item) => item.category as PredictionCategory);
    const publiclyReadable = categories.some((category) => canViewCategory(category))
      || canViewCategory(row.category as PredictionCategory);
    return {
      homeTeam,
      awayTeam,
      kickoff: row.kickoff ?? row.fixture?.kickoff ?? null,
      league: row.leagueName ?? row.fixture?.league?.name,
      leagueApiId: row.leagueApiId,
      homeTeamApiId: row.homeTeamApiId,
      awayTeamApiId: row.awayTeamApiId,
      market: row.market,
      pick: row.pick,
      confidence: row.confidence,
      publicPick: publiclyReadable ? { market: row.market, pick: row.pick, confidence: row.confidence } : null,
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <div className="space-y-6">
      <JsonLd data={[
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Predictions", path: "/predictions" },
          { name: "Double Chance", path: PATH },
        ]),
        ...sportsEventsForFixtures(eventRows),
      ]} />
      <div>
        <h1 className="text-2xl font-bold">Double Chance predictions today</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
          {rows.length} Double Chance {rows.length === 1 ? "pick is" : "picks are"} published for the chosen day.
        </p>
      </div>
      <FeedDayTabs basePath={PATH} active={day} />
      <DoubleChancePredictionsGuide />
      <CategoryPredictionsList category="FEATURED" rows={shaped as any} withAds />
      <DoubleChancePredictionsEvidence />
    </div>
  );
}
