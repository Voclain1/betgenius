import type { Metadata } from "next";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { canViewCategory, presentedCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { getStraightWinPredictions } from "@/lib/marketPredictions";
import { dayShowsOutcomes, feedDayHref, parseFeedDay } from "@/lib/categoryPredictions";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { lagosDayLabel } from "@/lib/lagosDate";
import { StraightWinPredictionsEvidence, StraightWinPredictionsGuide } from "@/components/StraightWinPredictionsGuide";
import { JsonLd, breadcrumbJsonLd, fixtureSample, sportsEventsForFixtures } from "@/lib/seo";
import { MarketChips } from "@/components/MarketChips";

const PATH = "/predictions/straight-wins";

export async function generateMetadata({ searchParams }: { searchParams?: { date?: string } }): Promise<Metadata> {
  const day = parseFeedDay(searchParams?.date);
  const rows = await getStraightWinPredictions(day);
  const sample = fixtureSample(rows.map((row) => ({
    homeTeam: row.homeTeam ?? row.fixture?.homeTeam?.name,
    awayTeam: row.awayTeam ?? row.fixture?.awayTeam?.name,
  })));
  return {
    title: `Straight Win Predictions ${day[0].toUpperCase()}${day.slice(1)}`,
    description: rows.length
      ? `${rows.length} straight win predictions for ${day}${sample ? `, including ${sample}` : ""}. Home win and away win picks with match evidence.`
      : `No straight win predictions are published for ${day}. Browse another day or explore the other prediction markets.`,
    robots: rows.length === 0 || day !== "today" ? { index: false, follow: true } : undefined,
    alternates: { canonical: feedDayHref("straight-wins", day) },
  };
}

export default async function StraightWinsPage({ searchParams }: { searchParams?: { date?: string } }) {
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [rows, session, viewer] = await Promise.all([
    getStraightWinPredictions(day),
    getServerSession(authOptions),
    getViewerEntitlement(),
  ]);

  const shaped = rows.map((row) => {
    const categories = row.categories.map((item) => item.category as PredictionCategory);
    const gateCategory = categories.find((category) => canViewCategory(category, viewer.tier, viewer.status, viewer.role))
      ?? presentedCategory(row.category, categories);
    const canView = canViewCategory(gateCategory, viewer.tier, viewer.status, viewer.role);
    // The chip shows a free category whenever the row has one (presentedCategory).
    const category = presentedCategory(row.category, categories);
    if (canView) return { ...row, category, outcome: showOutcomes ? row.outcome : null };
    const needsRegistration = gateCategory === "BANKER" && !session?.user;
    return {
      ...row,
      category,
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
      || canViewCategory(presentedCategory(row.category, categories));
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
          { name: "Straight Wins", path: PATH },
        ]),
        ...sportsEventsForFixtures(eventRows),
      ]} />
      <CategoryMasthead
        kicker="Market guide"
        title={`Straight win predictions ${day}`}
        blurb={<>{rows.length} straight win {rows.length === 1 ? "pick is" : "picks are"} published for the chosen day.</>}
        dateLabel={`${lagosDayLabel(({ yesterday: -1, today: 0, tomorrow: 1 } as const)[day])} · West Africa Time`}
        stats={[
          { label: rows.length === 1 ? "Pick" : "Picks", value: String(rows.length) },
          { label: "Competitions", value: String(new Set(rows.map((r) => r.leagueApiId ?? r.leagueName)).size) },
        ]}
      />
      <MarketChips active="STRAIGHT_WIN" />
      <PredictionViewSwitch
        tabs={<FeedDayTabs basePath={PATH} active={day} />}
        intro=<StraightWinPredictionsGuide />
        detailed={<CategoryPredictionsList category="FEATURED" rows={shaped as any} withAds view="detailed" />}
        compact={<CategoryPredictionsList category="FEATURED" rows={shaped as any} withAds view="compact" />}
      />
      <StraightWinPredictionsEvidence />
    </div>
  );
}
