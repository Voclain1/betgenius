// Shared SEO building blocks — per-page <title>/description patterns and
// schema.org JSON-LD builders. Reused across the current dynamic route
// (/predictions/[category]) and meant to be reused by the upcoming B1/B2
// programmatic pages (/predictions/[league], /teams/[team], /fixtures/[id])
// rather than each route reinventing this.

import { SOCIAL_CARD } from "@/lib/brandAssets";
import { schemaEventStatus } from "@/lib/matchStatus";
import { matchSlug, teamSlug } from "@/lib/slug";

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

/**
 * "Toulouse vs Lille, Monaco vs Marseille, Rennes vs Le Mans" for a meta
 * description — at most `limit` DISTINCT fixtures.
 *
 * The feeds list a row per published MARKET, so the first three rows of a
 * league or category page are routinely three markets on ONE fixture. Taking
 * `.slice(0, 3)` off them produced descriptions that read "including Aston
 * Villa vs Arsenal, Aston Villa vs Arsenal, Aston Villa vs Arsenal" — the same
 * per-market/per-fixture confusion sportsEventsForFixtures already fixes for
 * the JSON-LD on these same pages, still live in the text a searcher reads.
 *
 * Deduped on the label itself rather than on a slug: this is presentation, the
 * label is what the reader sees, and two rows that print identically are a
 * repetition here whatever their underlying ids say.
 */
export function fixtureSample(
  rows: { homeTeam?: string | null; awayTeam?: string | null }[],
  limit = 3,
): string {
  const labels: string[] = [];
  for (const row of rows) {
    if (!row.homeTeam || !row.awayTeam) continue;
    const label = `${row.homeTeam} vs ${row.awayTeam}`;
    if (labels.includes(label)) continue;
    labels.push(label);
    if (labels.length === limit) break;
  }
  return labels.join(", ");
}

// ---------------------------------------------------------------------------
// League page title / description
// ---------------------------------------------------------------------------

export type LeagueSeo = {
  /** <title>, before Next appends the "| BetGenius" template. */
  title: string;
  /** The searched phrase, lowercased, to sit inside a sentence in the description. */
  phrase: string;
  /** What this page holds, in this competition's own terms. Deliberately different per league. */
  blurb: string;
};

/**
 * Per-league title and meta phrasing, keyed by API-Football league id.
 *
 * Each league gets the term people actually search FOR IT, rather than one
 * pattern stamped across all of them. "EPL predictions" is the English top
 * flight's real query and nobody abbreviates Ligue 1, so the two cannot share
 * a rule; before this, only league 39 had a term at all and every other league
 * page titled itself with the bare competition name.
 *
 * Volume and difficulty from keyword research, and the ORDER BELOW IS THAT
 * RATIO, not prestige:
 *
 *   Ligue 1      4,400/mo  KD 43   best volume-to-difficulty of the five
 *   Serie A      3,600/mo  KD 44
 *   Bundesliga   2,400/mo  KD 50
 *   La Liga      2,400/mo  KD 61
 *   EPL          6,600/mo  KD 68   highest volume, hardest to win
 *
 * EPL is last deliberately. It is the biggest term and the one this site is
 * least likely to rank for, so it gets no more weight here than the leagues
 * that are actually winnable — which is the whole point of not assuming the
 * Premier League is the priority.
 *
 * A league with no researched term is NOT given an invented one. It falls
 * through to `${name} Predictions`, which is accurate and still an improvement
 * on the bare name, and claims no keyword nobody was measured searching.
 */
const LEAGUE_SEO: Record<number, LeagueSeo> = {
  61: {
    title: "Ligue 1 Predictions",
    phrase: "Ligue 1 predictions",
    blurb: "French top-flight picks, with the Ligue 1 table, the fixtures still to come and how the last round finished on the same page.",
  },
  135: {
    title: "Serie A Predictions",
    phrase: "Serie A predictions",
    blurb: "Italian Serie A picks, alongside the current standings, upcoming fixtures and recent results.",
  },
  78: {
    title: "Bundesliga Predictions",
    phrase: "Bundesliga predictions",
    blurb: "German Bundesliga picks, with the table, the coming fixture list and the latest results in one place.",
  },
  140: {
    title: "La Liga Predictions",
    phrase: "La Liga predictions",
    blurb: "Spanish La Liga picks, next to the standings, the fixtures ahead and the results just gone.",
  },
  39: {
    title: "EPL Predictions — Premier League",
    phrase: "EPL predictions",
    blurb: "Premier League picks, with the English top-flight table, upcoming fixtures and recent results beside them.",
  },
};

/**
 * The researched term for a league, or null when none was measured.
 *
 * Separate from leagueSeo() below because a caller with no league NAME to fall
 * back on — the empty-page branch, which has no published row to read one off
 * — must be able to tell "researched" from "unknown". Handing that caller a
 * generic built from an empty name produces the literal title " Predictions".
 */
export function researchedLeagueSeo(leagueApiId: number | null | undefined): LeagueSeo | null {
  return leagueApiId != null ? LEAGUE_SEO[leagueApiId] ?? null : null;
}

/** The researched term for a league, or an honest generic built from its name. */
export function leagueSeo(leagueApiId: number | null | undefined, name: string): LeagueSeo {
  return (
    researchedLeagueSeo(leagueApiId) ?? {
      title: `${name} Predictions`,
      phrase: `${name} predictions`,
      blurb: "Each pick names its market, its confidence rating and the reasoning behind it.",
    }
  );
}

/**
 * The API-Football id encoded in a league slug, or null.
 *
 * leagueSlug() appends the id to the slugified name, so a page with no
 * published rows — and therefore no row to read leagueApiId off — can still
 * resolve which competition it is and title itself accordingly.
 */
export function leagueIdFromSlug(slug: string): number | null {
  const match = /-(\d+)$/.exec(slug);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

/**
 * How long after kickoff a football match is asserted to end, in minutes.
 *
 * A deliberate fixed estimate — 90 minutes of regulation plus a typical
 * quarter-hour of stoppage and the interval — NOT a live value. Nothing here
 * reads a real full-time whistle, and nothing should: endDate is emitted at
 * render time for a page that is cached and crawled hours later, so a
 * "current" value would be wrong for most of the requests that see it. An
 * openly approximate end time is the honest thing to publish, and it is what
 * lets a consumer bound the event instead of treating it as open-ended.
 *
 * Extra time and penalties are not modelled. They apply to a small minority of
 * fixtures and only ever extend the match, so the estimate errs short rather
 * than claiming a match had finished while it was still being played.
 */
const MATCH_DURATION_MINUTES = 105;

/** One side of a fixture, as much of it as the caller could resolve. */
export type EventTeamInput = {
  name: string;
  /** API-Football team id — the stable identity behind the free-text name. */
  apiId?: number | null;
  /** Crest URL, from Team.logo or TeamEnrichmentCache.crestUrl. */
  logo?: string | null;
};

/**
 * A team as a SportsTeam node, reused verbatim for homeTeam/awayTeam AND for
 * the performer array, so the same club is one entity in the graph rather than
 * two differently-shaped descriptions of itself.
 *
 * `@id` is minted from the API-Football id, not from the display name. The
 * name is free text on Prediction and has known spelling variants (see
 * teamSlug in src/lib/slug.ts) — keying the entity on it would split one club
 * into several. A site-scoped fragment IRI is the standard JSON-LD shape for
 * an entity that has no page of its own guaranteed to exist; a club with no
 * id simply gets no `@id` rather than an invented one.
 */
function sportsTeamNode(team: EventTeamInput) {
  return {
    "@type": "SportsTeam",
    ...(team.apiId != null ? { "@id": `${SITE_URL}/#team-${team.apiId}` } : {}),
    name: team.name,
    ...(team.logo ? { logo: team.logo } : {}),
  };
}

/**
 * schema.org SportsEvent for one fixture.
 *
 * Enriched rather than replaced: venue and city are already cached per fixture
 * (FixtureDetailCache), and eventStatus/startDate are already known, so this
 * describes the event properly instead of asserting only the two team names.
 *
 * Every field here is fed from data the site already holds and already renders
 * — crests, venues, league names, kickoff times, the published description.
 * Nothing is synthesised to fill a slot: a field with no real value behind it
 * is omitted, because markup that asserts something the page cannot support is
 * worse than markup that says less.
 *
 * `offers` is permanently absent, deliberately. It describes buying admission
 * to the event, and this site sells no tickets — the odds, the affiliate links
 * and the subscription are all offers on something else entirely, and mapping
 * any of them here would be a false claim about the match.
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
  /** Street address of the ground, when the venue came from the home team's cached record. */
  address?: string | null;
  /** API-Football id and crest for each side, when resolved. */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  /** League id/crest, for the organizer node and the image fallback. */
  leagueApiId?: number | null;
  leagueLogo?: string | null;
  /**
   * The page's own description. Callers MUST pass the same gated string the
   * meta description uses (matchDescription with an anonymously-resolved
   * topPick) — never a pick a signed-in reader can see but a crawler cannot.
   */
  description?: string | null;
  /** API-Football status short code (Fixture.status), when the fixture is ingested. */
  statusShort?: string | null;
  datePublished?: Date | string | null;
  dateModified?: Date | string | null;
}) {
  const kickoffDate = input.kickoff ? new Date(input.kickoff) : null;
  const iso = (d: Date | string | null | undefined) => {
    if (!d) return null;
    const v = new Date(d);
    return isNaN(v.getTime()) ? null : v.toISOString();
  };

  const start = kickoffDate && !isNaN(kickoffDate.getTime()) ? kickoffDate : null;
  const startDate = start ? start.toISOString() : null;
  // Derived here rather than asked of every caller: an end time that is always
  // startDate + a constant has exactly one correct value, and letting six call
  // sites each compute it is six chances to disagree.
  const endDate = start ? new Date(start.getTime() + MATCH_DURATION_MINUTES * 60_000).toISOString() : null;
  const published = iso(input.datePublished);
  const modified = iso(input.dateModified);

  const home = sportsTeamNode({ name: input.homeTeam, apiId: input.homeTeamApiId, logo: input.homeTeamLogo });
  const away = sportsTeamNode({ name: input.awayTeam, apiId: input.awayTeamApiId, logo: input.awayTeamLogo });

  // Crests first — they are the artwork that actually depicts THIS fixture —
  // then the competition badge, then the site's own social card. The last one
  // is a real, correctly-sized image rather than a placeholder, so the field is
  // never emitted empty and never points at something that will 404.
  const crests = [input.homeTeamLogo, input.awayTeamLogo].filter((u): u is string => Boolean(u));
  const image = crests.length > 0 ? crests : input.leagueLogo ? [input.leagueLogo] : [absoluteUrl(SOCIAL_CARD)];

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${input.homeTeam} vs ${input.awayTeam}`,
    ...(input.description ? { description: input.description } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    // Real fixture status where the fixture is ingested, EventScheduled where
    // it isn't. See schemaEventStatus in src/lib/matchStatus.ts for why a
    // finished match is still, correctly, EventScheduled.
    eventStatus: schemaEventStatus(input.statusShort),
    image,
    ...(input.league ? { superEvent: { "@type": "SportsEvent", name: input.league } } : {}),
    homeTeam: home,
    awayTeam: away,
    // The same two nodes again. Both clubs perform in the fixture, and reusing
    // the objects rather than rebuilding them is what guarantees the performer
    // entry and the homeTeam entry are the same entity down to the `@id`.
    performer: [home, away],
    // An approximation, and only that: this is the COMPETITION, not the
    // federation that runs it. Resolving a real governing body would need an
    // entity source the site does not have, and inventing one would be worse
    // than naming the competition a reader would recognise.
    ...(input.league
      ? {
          organizer: {
            "@type": "SportsOrganization",
            ...(input.leagueApiId != null ? { "@id": `${SITE_URL}/#league-${input.leagueApiId}` } : {}),
            name: input.league,
            ...(input.leagueLogo ? { logo: input.leagueLogo } : {}),
          },
        }
      : {}),
    // Venue comes from the same cached row the match info panel renders, so the
    // markup and the visible page cannot disagree.
    ...(input.venue
      ? {
          location: {
            "@type": "Place",
            name: input.venue,
            ...(input.city || input.address
              ? {
                  address: {
                    "@type": "PostalAddress",
                    ...(input.address ? { streetAddress: input.address } : {}),
                    ...(input.city ? { addressLocality: input.city } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(input.url ? { url: absoluteUrl(input.url) } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
  };
}

/**
 * One SportsEvent per FIXTURE for a feed page, from rows that are per MARKET.
 *
 * The feeds (category, league, team) list a row per published market, so a
 * fixture with Match Winner, Over/Under and BTTS published used to emit three
 * SportsEvent objects with the same name, the same startDate and the same
 * `url` — three claims that the same event is three events. Aston Villa vs
 * Arsenal, carrying several markets, was the case that surfaced it.
 *
 * Keyed by matchSlug, which is the fixture identity the match page itself
 * resolves against (day-grained, so the same pairing in a later round is
 * correctly a different event). Rows with no kickoff produce no slug and so no
 * URL; they still dedupe, on the team pair alone, because two markets on an
 * undated fixture are still one fixture.
 *
 * First row wins for the fixture's IDENTITY. Callers pass rows in display
 * order, so the surviving event is the one whose fixture leads the page. The
 * market count and the readable pick behind the description are aggregated
 * across the whole group rather than taken from that first row, because "how
 * many markets are published on this fixture" is a property of the group.
 */
export type FixtureEventRow = {
  homeTeam: string;
  awayTeam: string;
  kickoff: Date | string | null;
  league?: string | null;
  leagueApiId?: number | null;
  leagueLogo?: string | null;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  venue?: string | null;
  city?: string | null;
  address?: string | null;
  statusShort?: string | null;
  /**
   * The pick a SIGNED-OUT visitor may read from this row, or null when the row
   * is gated. Resolved by the caller with the same canViewCategory(cat) call
   * its own locking uses, so there is exactly one gate — this function never
   * decides visibility, it only consumes the decision.
   */
  publicPick?: { market: string; pick: string; confidence: number } | null;
};

export function sportsEventsForFixtures(fixtures: FixtureEventRow[]) {
  const order: string[] = [];
  const groups = new Map<string, { first: FixtureEventRow; slug: string | null; markets: number; publicPick: FixtureEventRow["publicPick"] }>();

  for (const f of fixtures) {
    const slug = matchSlug(f);
    const key = slug ?? `${teamSlug(f.homeTeam)}-vs-${teamSlug(f.awayTeam)}`;
    const group = groups.get(key);
    if (!group) {
      order.push(key);
      groups.set(key, { first: f, slug, markets: 1, publicPick: f.publicPick ?? null });
      continue;
    }
    group.markets += 1;
    // Rows arrive confidence-ordered, so the first readable one in the group is
    // the strongest pick a crawler is entitled to see — the same rule the match
    // page's publicTopPick follows.
    if (!group.publicPick && f.publicPick) group.publicPick = f.publicPick;
  }

  return order.map((key) => {
    const { first, slug, markets, publicPick } = groups.get(key)!;
    return sportsEventJsonLd({
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      kickoff: first.kickoff,
      league: first.league,
      leagueApiId: first.leagueApiId,
      leagueLogo: first.leagueLogo,
      homeTeamApiId: first.homeTeamApiId,
      awayTeamApiId: first.awayTeamApiId,
      homeTeamLogo: first.homeTeamLogo,
      awayTeamLogo: first.awayTeamLogo,
      venue: first.venue,
      city: first.city,
      address: first.address,
      statusShort: first.statusShort,
      description: matchDescription({
        homeTeam: first.homeTeam,
        awayTeam: first.awayTeam,
        leagueName: first.league,
        kickoff: first.kickoff,
        topPick: publicPick,
        marketCount: markets,
      }),
      ...(slug ? { url: `/predictions/match/${slug}` } : {}),
    });
  });
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
