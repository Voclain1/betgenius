import Link from "next/link";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { Prose } from "@/components/Prose";
import type { Metadata } from "next";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { PredictionCard, type PredictionRow } from "@/components/PredictionCard";
import type { MarketConfirmation } from "@/components/MarketConfirmedBadge";
import { canViewCategory } from "@/lib/access";
import { trustMetadata } from "@/lib/trustMetadata";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd, matchDescription } from "@/lib/seo";
import { matchSlug, matchKey } from "@/lib/slug";
import { getFixtureEventContext } from "@/lib/predictionScope";

// Funnel landing page: one free pick, one upgrade CTA, nothing else. Linked
// from the WhatsApp Channel and social bios, deliberately absent from Nav.
//
// Same 60s revalidate as /predictions/bet-of-the-day — this is the other
// single-pick page, and a link posted to a channel gets its traffic in bursts.
export const revalidate = 60;

/**
 * The single pick this page exists to show.
 *
 * Prediction has NO tier column — the schema's only `tier` is User.tier
 * (SubscriptionTier: FREE | VIP | PREMIUM), which describes the reader, not
 * the pick. What gates a prediction is its PredictionCategory, evaluated by
 * canViewCategory() in src/lib/access.ts, and GENIUS is one of the categories
 * that returns true for a signed-out visitor. So "the free tier" here means
 * `categories: { some: { category: "GENIUS" } }`.
 *
 * Read through the `categories` link table rather than the scalar `category`
 * column: a tip can be cross-posted into several feeds, and the scalar only
 * holds the primary one, so filtering on it would miss GENIUS tips whose
 * primary tag is something else.
 *
 * Not reusing getCategoryPredictions() (src/lib/categoryPredictions.ts): that
 * one is bounded to a single Lagos calendar day, and this page wants the next
 * upcoming pick whenever it is — a channel link posted at 11pm should not land
 * on an empty page because today's card has finished.
 *
 * `kickoff: { gte: now }` is what keeps a settled or in-progress match off the
 * page, per the fallback rule: no stale pick, ever.
 *
 * cache() so generateMetadata and the body share one query per render.
 */
const getFreeTicket = cache(async () => {
  return prisma.prediction.findFirst({
    where: {
      status: "PUBLISHED",
      categories: { some: { category: "GENIUS" } },
      kickoff: { gte: new Date() },
    },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
});

const TITLE = "Free Betting Tip Today";

export async function generateMetadata(): Promise<Metadata> {
  const row = await getFreeTicket();

  // Empty state gets noindex, matching /predictions/bet-of-the-day and
  // /predictions/[category]: a page with no pick on it should not be indexed
  // under a title promising one. The social preview still renders — OG tags
  // are unaffected by robots — so a link already posted to a channel does not
  // suddenly unfurl as a blank card.
  if (!row) {
    return {
      ...trustMetadata(TITLE, "Our next free football tip is not published yet — check back shortly.", "/free-ticket"),
      robots: { index: false, follow: true },
    };
  }

  const fixture = row.homeTeam ?? row.fixture?.homeTeam.name
    ? `${row.homeTeam ?? row.fixture?.homeTeam.name} vs ${row.awayTeam ?? row.fixture?.awayTeam.name}`
    : null;

  // Written for a WhatsApp/social unfurl, where the description is often the
  // only thing read before the tap: the actual call first, then the reason to
  // open it. Safe to print the pick because GENIUS is ungated (see below) —
  // a locked pick must never reach a meta tag.
  return trustMetadata(
    TITLE,
    `${fixture ? `${fixture}: ` : ""}our free tip is ${row.pick} — ${row.market} at ${row.confidence}% confidence, with the full reasoning. One free pick, updated as new tips publish.`,
    "/free-ticket",
  );
}

const BLURB = "One free pick from our next fixture, with the reasoning behind it. No account needed.";

export default async function FreeTicketPage() {
  const row = await getFreeTicket();

  // Defensive, not decorative: this page prints the pick unlocked, so it must
  // agree with the one function that decides who may see a category. If GENIUS
  // is ever moved behind a subscription, this stops the page leaking picks
  // instead of quietly continuing to publish them.
  const isPublic = canViewCategory("GENIUS");

  if (!row || !isPublic) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <CategoryMasthead kicker="Free tip" title="Today's free ticket" blurb={BLURB} stats={[]} />
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm leading-relaxed text-gray-400">
          No free tip is live right now — check back soon. New picks publish through the day, or browse{" "}
          <Link href="/predictions/today" className="font-semibold text-brand hover:underline">today&apos;s predictions</Link>.
        </div>
        <UpgradeCta />
      </div>
    );
  }

  const home = row.homeTeam ?? row.fixture?.homeTeam.name ?? null;
  const away = row.awayTeam ?? row.fixture?.awayTeam.name ?? null;
  const kickoff = row.kickoff ?? row.fixture?.kickoff ?? null;
  const slug = matchSlug({ homeTeam: home, awayTeam: away, kickoff });

  // Venue, crests, competition badge and fixture status for the markup.
  const eventKey = matchKey({ homeTeamApiId: row.homeTeamApiId, awayTeamApiId: row.awayTeamApiId, kickoff });
  const context = (
    await getFixtureEventContext([
      { homeTeamApiId: row.homeTeamApiId, awayTeamApiId: row.awayTeamApiId, kickoff, leagueApiId: row.leagueApiId },
    ])
  ).get(eventKey ?? "");

  // Badge the card GENIUS — the feed this pick is being shown from — the same
  // way /predictions/[category] overrides `category` to the feed being browsed.
  //
  // marketConfirmation is a Json column, so Prisma types it JsonValue and it
  // needs narrowing to reach PredictionRow. The other two call sites cast the
  // whole row `as any`; narrowing the one Json field keeps the rest of the
  // shape actually type-checked.
  const shaped: PredictionRow = {
    ...row,
    category: "GENIUS",
    marketConfirmation: (row.marketConfirmation ?? null) as MarketConfirmation | null,
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Free tip", path: "/free-ticket" },
          ]),
          ...(home && away
            ? [
                sportsEventJsonLd({
                  homeTeam: home,
                  awayTeam: away,
                  kickoff,
                  league: row.leagueName,
                  leagueApiId: row.leagueApiId,
                  homeTeamApiId: row.homeTeamApiId,
                  awayTeamApiId: row.awayTeamApiId,
                  ...context,
                  // `isPublic` above is the SAME canViewCategory("GENIUS")
                  // check that lets this page print the pick unlocked, so the
                  // markup and the visible page can never disagree about
                  // whether the call is readable.
                  description: matchDescription({
                    homeTeam: home,
                    awayTeam: away,
                    leagueName: row.leagueName,
                    kickoff,
                    topPick: isPublic ? { market: row.market, pick: row.pick, confidence: row.confidence } : null,
                    marketCount: 1,
                  }),
                  ...(slug ? { url: `/predictions/match/${slug}` } : {}),
                }),
              ]
            : []),
        ]}
      />

      <CategoryMasthead
        kicker="Free tip"
        title="Today's free ticket"
        blurb={BLURB}
        stats={[{ label: "Confidence", value: `${row.confidence}%`, accent: true }]}
      />

      <PremiumPanel kicker="The pick" title={home && away ? `${home} vs ${away}` : "Free tip"} id="free-pick" bare>
        <PredictionCard p={shaped} />
      </PremiumPanel>

      {row.matchPreview && (
        <PremiumPanel kicker="Context" title="Match preview" id="free-preview">
          <Prose text={row.matchPreview} />
        </PremiumPanel>
      )}

      <UpgradeCta />
    </div>
  );
}

/** Shown in both states — the fallback is still funnel traffic worth converting. */
function UpgradeCta() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card p-6 text-center sm:p-8">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-60 w-60 -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.18),transparent)]" />
      <div className="relative space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">VIP</div>
        <h2 className="text-2xl font-black tracking-tight text-gray-100">Want more tips like this?</h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-gray-300">
          VIP unlocks our full daily card — every market, every fixture, with the reasoning and confidence on each pick.
        </p>
        <Link href="/pricing" className="btn btn-primary">Upgrade to VIP</Link>
        <p className="text-xs text-gray-400">
          18+ only. Predictions are analysis, not guarantees — see our{" "}
          <Link href="/betting-disclaimer" className="text-brand hover:underline">betting disclaimer</Link>.
        </p>
      </div>
    </section>
  );
}
