// Shared SEO building blocks — per-page <title>/description patterns and
// schema.org JSON-LD builders. Reused across the current dynamic route
// (/predictions/[category]) and meant to be reused by the upcoming B1/B2
// programmatic pages (/predictions/[league], /teams/[team], /fixtures/[id])
// rather than each route reinventing this.

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

/** schema.org SportsEvent JSON-LD for one fixture/prediction. */
export function sportsEventJsonLd(input: {
  homeTeam: string;
  awayTeam: string;
  kickoff: string | Date | null;
  league?: string | null;
  url?: string;
}) {
  const kickoffDate = input.kickoff ? new Date(input.kickoff) : null;
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${input.homeTeam} vs ${input.awayTeam}`,
    ...(kickoffDate && !isNaN(kickoffDate.getTime()) ? { startDate: kickoffDate.toISOString() } : {}),
    ...(input.league ? { superEvent: { "@type": "SportsEvent", name: input.league } } : {}),
    homeTeam: { "@type": "SportsTeam", name: input.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: input.awayTeam },
    ...(input.url ? { url: absoluteUrl(input.url) } : {}),
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
