import type { Metadata } from "next";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { canViewCategory, presentedCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { getOver25Predictions } from "@/lib/marketPredictions";
import { dayShowsOutcomes, feedDayHref, parseFeedDay } from "@/lib/categoryPredictions";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { lagosDayLabel } from "@/lib/lagosDate";
import { Over25PredictionsEvidence, Over25PredictionsGuide } from "@/components/Over25PredictionsGuide";
import { JsonLd, breadcrumbJsonLd, fixtureSample, sportsEventsForFixtures } from "@/lib/seo";

const PATH = "/predictions/over-2-5-goals";

export async function generateMetadata({ searchParams }: { searchParams?: { date?: string } }): Promise<Metadata> {
  const day = parseFeedDay(searchParams?.date);
  const rows = await getOver25Predictions(day);
  const sample = fixtureSample(rows.map((r) => ({
    homeTeam: r.homeTeam ?? r.fixture?.homeTeam?.name,
    awayTeam: r.awayTeam ?? r.fixture?.awayTeam?.name,
  })));
  return {
    title: "Over 2.5 Goals Predictions Today",
    description: rows.length
      ? `${rows.length} Over 2.5 Goals predictions${sample ? `, including ${sample}` : ""}. Read the match evidence and confidence rating for every pick.`
      : "No Over 2.5 Goals predictions are published yet — check back for the latest football picks.",
    robots: rows.length === 0 || day !== "today" ? { index: false, follow: true } : undefined,
    alternates: { canonical: feedDayHref("over-2-5-goals", day) },
  };
}

export default async function Over25GoalsPage({ searchParams }: { searchParams?: { date?: string } }) {
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const [rows, session, viewer] = await Promise.all([
    getOver25Predictions(day),
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
  const publicEvents = sportsEventsForFixtures(eventRows);

  return (
    <div className="space-y-6">
      <JsonLd data={[
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Predictions", path: "/predictions" },
          { name: "Over 2.5 Goals", path: PATH },
        ]),
        ...publicEvents,
      ]} />
      <CategoryMasthead
        kicker="Market guide"
        title="Over 2.5 Goals predictions today"
        blurb={<>{rows.length} {rows.length === 1 ? "match" : "matches"} currently meet this market selection for the chosen day.</>}
        dateLabel={`${lagosDayLabel(({ yesterday: -1, today: 0, tomorrow: 1 } as const)[day])} · West Africa Time`}
        stats={[
          { label: rows.length === 1 ? "Pick" : "Picks", value: String(rows.length) },
          { label: "Competitions", value: String(new Set(rows.map((r) => r.leagueApiId ?? r.leagueName)).size) },
        ]}
      />
      <PredictionViewSwitch
        tabs={<FeedDayTabs basePath={PATH} active={day} />}
        intro=<Over25PredictionsGuide />
        detailed={<CategoryPredictionsList category="FEATURED" rows={shaped as any} withAds view="detailed" />}
        compact={<CategoryPredictionsList category="FEATURED" rows={shaped as any} withAds view="compact" />}
      />
      <Over25PredictionsEvidence />
    </div>
  );
}
