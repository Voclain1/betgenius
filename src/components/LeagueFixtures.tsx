"use client";
// Client component because MatchRow's crest <img> carries an onError fallback,
// which a server component can't hand to it — the same constraint that makes
// LeagueNav and LeagueClubGrid client components.
import Link from "next/link";
import { DateGroupedMatches, EmptyState } from "@/components/MatchList";
import { matchSlug } from "@/lib/slug";
import type { LeagueUpcomingFixture } from "@/lib/enrichment";
import type { FixtureRow } from "@/lib/football/api-football";

/**
 * Adapts a cached upcoming fixture into the FixtureRow shape MatchRow renders,
 * so the league page's fixture list is the same component the Fixtures page
 * uses rather than a second list implementation.
 *
 * The cache stores only what its own panel needed (no team ids, no status),
 * so those are filled with what's true of an upcoming fixture: status "NS"
 * and no goals. Team ids are genuinely absent, which is why match-page links
 * below are resolved by name-slug rather than through the id-keyed link index.
 */
function toFixtureRow(f: LeagueUpcomingFixture, league: { id: number; name: string; country: string }): FixtureRow {
  return {
    fixture: { id: f.id, date: f.date, status: { short: "NS" } },
    league: { id: league.id, name: league.name, country: league.country, season: 0 },
    teams: {
      home: { id: -1, name: f.homeTeam, logo: f.homeLogo ?? undefined },
      away: { id: -1, name: f.awayTeam, logo: f.awayLogo ?? undefined },
    },
    goals: { home: null, away: null },
  };
}

/**
 * This league's upcoming fixtures, grouped by date.
 *
 * Source is LeagueEnrichmentCache.upcomingJson — the next fortnight's
 * not-yet-started fixtures, already refreshed on the same cron. Fixtures that
 * have a published prediction get a "Preview" link through to their match
 * page; the rest are listed plainly.
 */
export function LeagueFixtures({
  upcoming,
  league,
  publishedSlugs,
}: {
  upcoming: LeagueUpcomingFixture[] | null;
  league: { id: number; name: string; country: string };
  /** Match-page slugs that have a published prediction. A plain array rather than a Set so it crosses the server/client boundary unchanged. */
  publishedSlugs: string[];
}) {
  if (!upcoming?.length) {
    return <EmptyState>No upcoming fixtures listed for this league right now.</EmptyState>;
  }

  const groups = upcoming
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .reduce<{ date: string; label: string; rows: FixtureRow[] }[]>((acc, f) => {
      const row = toFixtureRow(f, league);
      const d = new Date(f.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const existing = acc.find((g) => g.date === key);
      if (existing) existing.rows.push(row);
      else acc.push({ date: key, label: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), rows: [row] });
      return acc;
    }, []);

  // Previews are matched by name-derived slug because the cached fixtures
  // carry no team ids — it inherits teamSlug's spelling-variant gap, and a
  // fixture whose names don't match a prediction's simply shows no link.
  const slugSet = new Set(publishedSlugs);
  const previews = upcoming
    .map((f) => ({ fixture: f, slug: matchSlug({ homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date }) }))
    .filter((p): p is { fixture: LeagueUpcomingFixture; slug: string } => p.slug !== null && slugSet.has(p.slug));

  return (
    <div className="space-y-4">
      <DateGroupedMatches groups={groups} />

      {previews.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Match previews</h3>
          <div className="flex flex-wrap gap-2">
            {previews.map((p) => (
              <Link
                key={p.fixture.id}
                href={`/predictions/match/${p.slug}`}
                className="chip border border-brand-border bg-brand-card hover:border-brand"
              >
                {p.fixture.homeTeam} vs {p.fixture.awayTeam} →
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
