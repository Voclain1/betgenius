// Shared SEO building blocks — per-page <title>/description patterns and
// schema.org JSON-LD builders. Reused across the current dynamic route
// (/predictions/[category]) and meant to be reused by the upcoming B1/B2
// programmatic pages (/predictions/[league], /teams/[team], /fixtures/[id])
// rather than each route reinventing this.

import { SOCIAL_CARD } from "@/lib/brandAssets";

export const SITE_NAME = "BetGenius";
export const SITE_URL = (process.env.NEXTAUTH_URL || "https://betgenius-iota.vercel.app").replace(/\/$/, "");

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function pageTitle(title: string): string {
  return `${title} | ${SITE_NAME}`;
}

export type BreadcrumbItem = { name: string; path: string };

/** schema.org BreadcrumbList JSON-LD for category/league pages. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Renders one or more JSON-LD objects as <script> tags. */
export function JsonLd({ data }: { data: object | object[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, i) => (
        // eslint-disable-next-line react/no-danger
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Match page title / description
// ---------------------------------------------------------------------------

/**
 * Kickoff formatted for a title — "17 Aug 2026".
 *
 * The date is not decoration. matchSlug is day-scoped (src/lib/slug.ts), so the
 * same two teams produce a distinct URL every time they meet; without the date
 * in the title, this season's page and last season's compete with each other
 * under identical text.
 *
 * Always UTC, matching the slug's own day derivation — a title that disagreed
 * with the URL's date would be worse than no date at all.
 */
export function titleDate(kickoff: Date | string | null): string | null {
  if (!kickoff) return null;
  const d = new Date(kickoff);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * "Casa Pia vs Benfica prediction, 17 Aug 2026".
 *
 * Deliberately one natural phrase rather than a keyword string. "prediction"
 * earns its place because it is what the page is and what the reader searched
 * for; piling on "tips", "preview", "betting odds", "H2H" would describe the
 * same page four times and read as spam to both a person and a parser. The
 * league is appended by Next's title template, not repeated here.
 */
export function matchTitle(input: { homeTeam: string; awayTeam: string; kickoff: Date | string | null }): string {
  const base = `${input.homeTeam} vs ${input.awayTeam} prediction`;
  const date = titleDate(input.kickoff);
  return date ? `${base}, ${date}` : base;
}

/**
 * Meta description led by the actual call.
 *
 * The previous description ("N published predictions for X vs Y — Match Winner,
 * Over/Under, with confidence and full reasoning.") described
 * the PAGE. This describes the ANSWER, which is what a searcher is deciding
 * whether to click. Falls back to the shape of the page when no readable pick
 * exists — a locked-only fixture must not leak its pick into a meta tag.
 */
export function matchDescription(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName?: string | null;
  kickoff: Date | string | null;
  /** The highest-confidence pick the public may see, or null when every row is gated. */
  topPick?: { market: string; pick: string; confidence: number } | null;
  marketCount: number;
}): string {
  const fixture = `${input.homeTeam} vs ${input.awayTeam}`;
  const date = titleDate(input.kickoff);
  const where = [input.leagueName, date].filter(Boolean).join(", ");

  if (input.topPick) {
    const { market, pick, confidence } = input.topPick;
    const extra =
      input.marketCount > 1 ? ` Plus ${input.marketCount - 1} more market${input.marketCount === 2 ? "" : "s"}, form, team news and head-to-head.` : "";
    return `${fixture}${where ? ` (${where})` : ""}: we back ${pick} — ${market} at ${confidence}% confidence.${extra}`;
  }

  return `${fixture}${where ? ` (${where})` : ""} — prediction, recent form, team news, head-to-head and league table context.`;
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

/**
 * schema.org SportsEvent for one fixture.
 *
 * Enriched rather than replaced: venue and city are already cached per fixture
 * (FixtureDetailCache), and eventStatus/startDate are already known, so this
 * describes the event properly instead of asserting only the two team names.
 *
 * No Article or FAQPage alongside it, deliberately. Google restricted FAQ rich
 * results to government and health sites in 2023, and generic Article markup
 * earns no rich result outside news/blog surfaces — adding either would be
 * markup nobody consumes, with manual-action exposure if the content ever read
 * as padding. This is here for entity understanding, not for a rich snippet.
 */
export function sportsEventJsonLd(input: {
  homeTeam: string;
  awayTeam: string;
  kickoff: string | Date | null;
  league?: string | null;
  url?: string;
  venue?: string | null;
  city?: string | null;
  datePublished?: Date | string | null;
  dateModified?: Date | string | null;
}) {
  const kickoffDate = input.kickoff ? new Date(input.kickoff) : null;
  const iso = (d: Date | string | null | undefined) => {
    if (!d) return null;
    const v = new Date(d);
    return isNaN(v.getTime()) ? null : v.toISOString();
  };

  const startDate = kickoffDate && !isNaN(kickoffDate.getTime()) ? kickoffDate.toISOString() : null;
  const published = iso(input.datePublished);
  const modified = iso(input.dateModified);

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${input.homeTeam} vs ${input.awayTeam}`,
    ...(startDate ? { startDate } : {}),
    // schema.org's eventStatus vocabulary has no "completed" value — only
    // Scheduled/Cancelled/Postponed/Rescheduled/MovedOnline. EventScheduled is
    // therefore the accurate value both before and after kickoff, and there is
    // no honest way to express "this has been played" here, so nothing tries to.
    eventStatus: "https://schema.org/EventScheduled",
    ...(input.league ? { superEvent: { "@type": "SportsEvent", name: input.league } } : {}),
    homeTeam: { "@type": "SportsTeam", name: input.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: input.awayTeam },
    // Venue comes from the same cached row the match info panel renders, so the
    // markup and the visible page cannot disagree.
    ...(input.venue
      ? {
          location: {
            "@type": "Place",
            name: input.venue,
            ...(input.city ? { address: { "@type": "PostalAddress", addressLocality: input.city } } : {}),
          },
        }
      : {}),
    ...(input.url ? { url: absoluteUrl(input.url) } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
  };
}

/**
 * schema.org Organization for the site itself, emitted once from the root
 * layout. Helps a crawler treat BetGenius as an entity rather than a bag of
 * pages; no rich result is expected or claimed.
 */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    // Absolute, because consumers of JSON-LD do not resolve against the
    // document the way Next resolves openGraph paths against metadataBase.
    logo: absoluteUrl(SOCIAL_CARD),
    description: "Football predictions grounded in verified match data, with a published settled-results record.",
  };
}
