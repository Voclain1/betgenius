import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { PredictionViewSwitch } from "@/components/PredictionViewSwitch";
import {
  CATEGORY_SLUGS as SLUGS,
  CATEGORY_NAMES as NAMES,
  CATEGORY_BLURBS as BLURBS,
  CATEGORY_CHIP_LABELS,
  getCategoryPredictions,
  parseFeedDay,
  dayShowsOutcomes,
  feedDayHref,
} from "@/lib/categoryPredictions";
import { FeedDayTabs } from "@/components/FeedDayTabs";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { getCategoryTrackRecord } from "@/lib/trackRecord";
import { AnswerSummary } from "@/components/AnswerSummary";
import { categorySummary } from "@/lib/answerSummary";
import { JsonLd, breadcrumbJsonLd, sportsEventsForFixtures, fixtureSample } from "@/lib/seo";
import { getFixtureEventContext } from "@/lib/predictionScope";
import { FollowButton } from "@/components/FollowButton";
import { TodayPredictionsEvidence, TodayPredictionsGuide } from "@/components/TodayPredictionsGuide";
import { BankerPredictionsEvidence, BankerPredictionsIntro } from "@/components/BankerPredictionsGuide";
import { matchKey } from "@/lib/slug";
import { lagosDayLabel } from "@/lib/lagosDate";
import { FeedResults } from "@/components/FeedResults";
import { PaidFeedCover, PaidResultsCover } from "@/components/PaidFeedCover";
import { PREMIUM_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR } from "@/lib/geniusCuration";
import { firstResultsDay } from "@/lib/feedResults";
import { MarketChips } from "@/components/MarketChips";

const DAY_OFFSETS = { yesterday: -1, today: 0, tomorrow: 1 } as const;

export async function generateMetadata(
  { params, searchParams }: { params: { category: string }; searchParams?: { date?: string } },
): Promise<Metadata> {
  const cat = SLUGS[params.category];
  if (!cat) return {};
  // Same resolved day as the page body, so cache() serves ONE query for both.
  const day = parseFeedDay(searchParams?.date);
  const name = NAMES[cat];
  // Only categories with a term behind them get one. VIP has measured demand
  // (720/mo, KD 50) and "banker" is a real, searched football-betting word;
  // Featured, Genius and Premium showed near-zero volume, so they keep their
  // plain product names rather than being bent around a keyword nobody types.
  const seoTitle = cat === "TODAY" ? "Football Predictions Today"
    : cat === "VIP" ? "VIP Predictions"
    : cat === "BANKER" ? (day === "yesterday" ? "Yesterday's Banker Predictions" : day === "tomorrow" ? "Banker Predictions Tomorrow" : "Banker Predictions Today")
    // Grounded in the term readers actually search, same approach as the
    // homepage hero: "Combo Bet Predictions", not the bare category name.
    : cat === "SAME_GAME_DOUBLE" ? "Combo Bet Predictions"
    // The two lines the feed holds are the searched terms; "Goals" alone is not.
    : cat === "GOALS" ? "Over 1.5 & Over 2.5 Goals Predictions"
    : name;
  const seoPhrase = cat === "TODAY" ? "today's predictions"
    : cat === "VIP" ? "VIP predictions"
    : cat === "BANKER" ? "banker predictions"
    : cat === "SAME_GAME_DOUBLE" ? "combo bet predictions — two picks on the same match"
    : cat === "GOALS" ? "over 1.5 and over 2.5 goals predictions"
    : name.toLowerCase();
  const emptyDescription = cat === "TODAY"
    ? "Today's predictions are not published yet — check back soon for our latest football picks."
    : `No ${seoPhrase} published yet — check back soon for our latest football predictions.`;
  const rows = await getCategoryPredictions(cat, day);

  // Thin/empty content shouldn't claim a rich, specific title as if it had
  // real picks to show — and search engines shouldn't index a page with
  // nothing on it yet.
  if (rows.length === 0) {
    return {
      title: seoTitle,
      description: emptyDescription,
      robots: { index: false, follow: true },
      alternates: { canonical: feedDayHref(params.category, day) },
    };
  }

  // A paid feed's matches are for members: none are named in its description.
  const sample = cat === "VIP" || cat === "PREMIUM" ? null : fixtureSample(
    rows.map((r) => ({
      homeTeam: r.homeTeam ?? r.fixture?.homeTeam?.name,
      awayTeam: r.awayTeam ?? r.fixture?.awayTeam?.name,
    })),
  );

  return {
    title: seoTitle,
    description: cat === "BANKER"
      ? `${rows.length} banker ${rows.length === 1 ? "prediction" : "predictions"} for ${day}. Sign up free to see the picks and reasoning. Review the selection method and past results.`
      : `${rows.length} ${day === "yesterday" ? "settled " : day === "tomorrow" ? "upcoming " : cat === "TODAY" ? "of " : "live "}${seoPhrase}${sample ? ` — including ${sample}` : ""}. Football predictions with confidence ratings, updated daily.`,
    // Relative query states change meaning every day: yesterday's URL becomes a
    // different slate after midnight. Keep them available for users and links,
    // but do not let search engines retain them as unstable landing pages.
    // The clean/default feed remains the indexable search destination.
    robots: day === "today" ? undefined : { index: false, follow: true },
    alternates: { canonical: feedDayHref(params.category, day) },
  };
}

export default async function CategoryPage(
  { params, searchParams }: { params: { category: string }; searchParams?: { date?: string } },
) {
  const cat = SLUGS[params.category];
  if (!cat) return notFound();
  const day = parseFeedDay(searchParams?.date);
  const showOutcomes = dayShowsOutcomes(day);
  const dateLabel = lagosDayLabel(DAY_OFFSETS[day]);

  const session = await getServerSession(authOptions);
  const viewer = await getViewerEntitlement();
  const canView = canViewCategory(cat, viewer.tier, viewer.status, viewer.role);

  const rows = await getCategoryPredictions(cat, day);

  const needsRegistration = !canView && cat === "BANKER" && !session?.user;
  // VIP and PREMIUM, for a reader who cannot see them: every day, yesterday
  // included, shows a subscribe cover instead of the list, and no match,
  // league, kickoff or pick reaches the markup. The past-results section is
  // members-only too (PaidResultsCover); the masthead's win rate stays.
  const paidFeed = cat === "VIP" || cat === "PREMIUM";
  const paidCovered = paidFeed && !canView && rows.length > 0;
  const lockReason = needsRegistration
    ? "Sign up free to unlock this tip and full reasoning."
    : "Subscribe to VIP or Premium to unlock this tip and full reasoning.";

  // Badge reflects the feed being browsed, not necessarily the tip's stored
  // primary category — a tip can be cross-posted into multiple feeds.
  const shaped = rows.map((r) =>
    canView
      // showOutcomes is the ONLY day-dependent branch here. The gating below is
      // identical on all three days by construction — there is no second path.
      ? { ...r, category: cat, outcome: showOutcomes ? r.outcome : null }
      : {
          ...r,
          category: cat,
          outcome: showOutcomes ? r.outcome : null,
          pick: "LOCKED",
          reasoning: lockReason,
          matchPreview: null,
          confidence: null,
          odds: null,
          overUnder: null,
          locked: true,
          unlockHref: needsRegistration ? "/register" : "/pricing",
        },
  );

  const slug = params.category;
  // TODAY's shared blurb says "every match happening today", which is the one
  // line that stops being true on the yesterday/tomorrow tabs. Every other
  // category describes what it selects, not when.
  const blurb = cat === "TODAY" && day !== "today" ? "Every match on that day's card." : BLURBS[cat];

  // The masthead's numbers, all read from the rows listed below (or the feed's
  // settled record, gated on sample size). A locked feed shows no confidence:
  // the number would describe picks the reader cannot see.
  const record = await getCategoryTrackRecord(cat);
  const competitions = new Set(rows.map((r) => r.leagueApiId ?? r.leagueName ?? r.fixture?.league?.name).filter((v) => v != null)).size;
  const topConfidence = canView ? Math.max(0, ...rows.map((r) => r.confidence ?? 0)) : 0;
  const stats: { label: string; value: string; accent?: boolean }[] = [
    { label: shaped.length === 1 ? "Pick" : "Picks", value: String(shaped.length) },
    { label: competitions === 1 ? "Competition" : "Competitions", value: String(competitions) },
  ];
  if (topConfidence > 0) stats.push({ label: "Top confidence", value: `${topConfidence}%` });
  if (record?.rate != null) stats.push({ label: "Win rate", value: `${Math.round(record.rate * 100)}%`, accent: true });
  // url points at the match page, so the SportsEvent resolves to the one page
  // that collects every market for the fixture rather than to a feed — and one
  // event per fixture, since this feed lists a row per market.
  // None for a paid feed: this markup describes what a signed-out reader sees,
  // and a signed-out reader does not see a paid feed's matches.
  const eventRows = (paidFeed ? [] : rows)
    .map((r) => {
      const home = r.homeTeam ?? r.fixture?.homeTeam?.name;
      const away = r.awayTeam ?? r.fixture?.awayTeam?.name;
      if (!home || !away) return null;
      return {
        homeTeam: home,
        awayTeam: away,
        kickoff: r.kickoff ?? r.fixture?.kickoff ?? null,
        league: r.leagueName ?? r.fixture?.league?.name,
        leagueApiId: r.leagueApiId,
        homeTeamApiId: r.homeTeamApiId,
        awayTeamApiId: r.awayTeamApiId,
        market: r.market,
        pick: r.pick,
        confidence: r.confidence,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // Venue, crests, competition badge and fixture status for the markup — the
  // fields the feeds have never carried. One batched read for the whole page.
  const eventContext = await getFixtureEventContext(eventRows);

  // Gated as an ANONYMOUS visitor, not as the current session. This markup is
  // rendered into a page that is cached and crawled, so it must describe what a
  // signed-out reader sees; resolving it against `canView` would put a VIP pick
  // into the HTML of a page a subscriber happened to warm the cache for.
  const publiclyReadable = canViewCategory(cat, undefined, undefined, undefined);

  const events = sportsEventsForFixtures(
    eventRows.map((f) => ({
      ...f,
      ...(eventContext.get(matchKey(f) ?? "") ?? {}),
      publicPick: publiclyReadable ? { market: f.market, pick: f.pick, confidence: f.confidence } : null,
    })),
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: NAMES[cat], path: `/predictions/${slug}` },
          ]),
          ...events,
        ]}
      />
      <CategoryMasthead
        kicker="Predictions"
        title={cat === "TODAY" ? "Football predictions today" : cat === "BANKER" ? (day === "yesterday" ? "Yesterday's banker predictions" : day === "tomorrow" ? "Banker predictions tomorrow" : "Banker predictions today") : NAMES[cat]}
        blurb={blurb}
        dateLabel={`${dateLabel} · West Africa Time`}
        stats={stats}
        actions={
          <>
            <FollowButton targetType="CATEGORY" targetKey={cat} label={`${NAMES[cat]} tips`} />
            {!canView && (cat === "VIP" || cat === "PREMIUM") && (
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-black text-on-brand transition hover:bg-brand-dark">
                Unlock {cat === "VIP" ? "VIP" : "Premium"}
              </Link>
            )}
            {needsRegistration && (
              <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-black text-on-brand transition hover:bg-brand-dark">
                Sign up free
              </Link>
            )}
          </>
        }
      />

      {/* Above the day filter and the grid: the count the header used to carry,
          as a sentence that says what this feed is and how many picks are in
          it for the day being browsed. */}
      <AnswerSummary
        text={categorySummary({
          name: NAMES[cat],
          // TODAY's shared blurb says "every match happening today", which is
          // the one line that stops being true on the yesterday/tomorrow tabs.
          // Every other category describes what it selects, not when.
          blurb,
          pickCount: shaped.length,
          day,
        })}
      />

      {/* The broad free feeds point on to the market pages, one compact line. */}
      {(cat === "TODAY" || cat === "FEATURED" || cat === "GENIUS") && <MarketChips />}

      {/* Ads are IN the feed now, between groups of picks, rather than in a
          single band under it — see feedAdPositions in src/lib/ads.ts for the
          counts and AdPlacements.tsx for the rule they follow. The foot band
          is gone rather than kept: three insertions plus a fourth underneath
          would be four ads on one feed. */}
      {cat === "TODAY" ? (
        <>
          <FeedDayTabs basePath={`/predictions/${slug}`} active={day} />
          <TodayPredictionsGuide dateLabel={dateLabel} />
          <CategoryPredictionsList category={cat} rows={shaped as any} withAds />
        </>
      ) : (
        // Every other feed offers Detailed (the card grid) and Compact (the
        // Today table). Both are rendered here, on the server, from the same
        // shaped rows; the client switch only chooses which one to mount.
        paidCovered ? (
          <div className="space-y-4">
            <FeedDayTabs basePath={`/predictions/${slug}`} active={day} />
            <PaidFeedCover
              tier={cat === "PREMIUM" ? "Premium" : "VIP"}
              count={shaped.length}
              floor={cat === "PREMIUM" ? PREMIUM_CONFIDENCE_FLOOR : VIP_CONFIDENCE_FLOOR}
              dayWord={day}
              signedIn={!!session?.user}
              path={feedDayHref(slug, day)}
            />
          </div>
        ) : (
        <PredictionViewSwitch
          tabs={<FeedDayTabs basePath={`/predictions/${slug}`} active={day} />}
          intro={cat === "BANKER" ? <BankerPredictionsIntro /> : null}
          detailed={<CategoryPredictionsList category={cat} rows={shaped as any} withAds view="detailed" />}
          compact={<CategoryPredictionsList category={cat} rows={shaped as any} withAds view="compact" />}
        />
        )
      )}

      {cat === "BANKER" && <BankerPredictionsEvidence />}
      {cat === "TODAY" && <TodayPredictionsEvidence />}

      {/* The feed's own track record, last on the page: a list of past days,
          each read only when a reader opens it (src/lib/feedResults.ts). */}
      {paidFeed && !canView ? (
        <PaidResultsCover tier={cat === "PREMIUM" ? "Premium" : "VIP"} signedIn={!!session?.user} />
      ) : (cat === "VIP" || cat === "PREMIUM" || cat === "BANKER") && (
        <FeedResults
          category={cat}
          name={CATEGORY_CHIP_LABELS[cat]}
          firstDay={firstResultsDay()}
          unlockHref={cat === "BANKER" ? "/register" : "/pricing"}
          unlockLabel={cat === "BANKER" ? "Sign up free to see the picks" : `Unlock ${CATEGORY_CHIP_LABELS[cat]}`}
        />
      )}
    </div>
  );
}
