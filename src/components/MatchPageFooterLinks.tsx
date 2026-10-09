import Link from "next/link";
import { getPublishedMatchIndexFor, getLeagueEnrichment, getPublishedTeamIndexFor, publishedTeamHref } from "@/lib/predictionScope";
import { matchKey, teamSlug, leagueSlug } from "@/lib/slug";
import type { LeagueUpcomingFixture, LeagueStandingRow } from "@/lib/enrichment";
import type { H2HMeeting } from "@/lib/h2h";
import { PremiumPanel } from "@/components/PremiumPanel";

/**
 * Onward links from a match page.
 *
 * Every link here is verified to land somewhere with content before it is
 * rendered. getPublishedMatchIndexFor is the existing matchKey → slug map of
 * fixtures that actually have a published page (the same rule backs the
 * livescores and fixtures feeds), and team links are offered only for teams
 * that getPublishedTeamIndexFor says have a published prediction —
 * appearing in the standings was never enough, since a team page with no picks
 * renders empty and noindex. A link into an empty page is worse than no link —
 * for the reader first, and for crawl budget second.
 *
 * This is not a link farm bolted on for SEO. Each block answers a question a
 * reader on this page plausibly has next: how did the last meeting go, what
 * else is on in this league, and does this site's record justify the
 * confidence figure it just showed me.
 */

const MAX_PREVIOUS = 3;
const MAX_SAME_LEAGUE = 4;

/** The match-slug prefix an upcoming fixture's page would carry, from names alone. */
function upcomingSlugPrefix(f: LeagueUpcomingFixture): string {
  return `${teamSlug(f.homeTeam)}-vs-${teamSlug(f.awayTeam)}-`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

export async function MatchPageFooterLinks({
  leagueApiId,
  leagueName,
  currentSlug,
  h2hMeetings,
  standings,
  homeTeamApiId,
  awayTeamApiId,
}: {
  leagueApiId: number | null;
  leagueName: string | null;
  currentSlug: string;
  h2hMeetings: H2HMeeting[];
  standings: LeagueStandingRow[] | null;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
}) {
  const league = await getLeagueEnrichment(leagueApiId);
  const upcomingFixtures = (league?.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? [];
  const tableRows = (standings ?? []).filter((r) => r.teamId !== homeTeamApiId && r.teamId !== awayTeamApiId && r.played > 0);

  // Both lookups are bounded to what this footer can link: the teams in the
  // past meetings, the upcoming fixtures' name pairs and the clubs from the
  // table — one query each. They used to read every published prediction on
  // every match page render, which is the most-crawled template on the site.
  const [index, publishedTeams] = await Promise.all([
    getPublishedMatchIndexFor({
      teamIds: h2hMeetings.flatMap((m) => [m.homeTeamApiId, m.awayTeamApiId]).filter((id): id is number => id != null),
      slugPrefixes: upcomingFixtures.map((f) => upcomingSlugPrefix(f)),
    }),
    getPublishedTeamIndexFor(tableRows.map((r) => ({ teamId: r.teamId, teamName: r.teamName }))),
  ]);

  // Past meetings that have a published page of their own. The h2h list is
  // already on the page above; this turns the ones we wrote about into links.
  const previous = h2hMeetings
    .map((m) => {
      const key = matchKey({ homeTeamApiId: m.homeTeamApiId, awayTeamApiId: m.awayTeamApiId, kickoff: m.date });
      const slug = key ? index[key] : null;
      return slug && slug !== currentSlug ? { m, slug } : null;
    })
    .filter((x): x is { m: H2HMeeting; slug: string } => x !== null)
    .slice(0, MAX_PREVIOUS);

  // Other fixtures in this league that already have a page.
  const upcoming = upcomingFixtures
    .map((f) => {
      // upcomingJson carries no team ids, so the index is keyed by name-derived
      // slug comparison instead — matching the same way the fixtures feed does.
      const entry = Object.entries(index).find(([, slug]) => slug.startsWith(upcomingSlugPrefix(f)));
      return entry && entry[1] !== currentSlug ? { f, slug: entry[1] } : null;
    })
    .filter((x): x is { f: LeagueUpcomingFixture; slug: string } => x !== null)
    .slice(0, MAX_SAME_LEAGUE);

  // Teams from the table around this fixture, excluding the two playing (they
  // are already linked from the H1) and any club we have not published a pick
  // on — the slug comes from that club's own published rows, not from the
  // table's spelling, so a name variant can't send the reader to an empty page.
  const nearby = tableRows
    .map((r) => {
      const slug = publishedTeamHref(publishedTeams, r.teamId, r.teamName);
      return slug ? { ...r, slug } : null;
    })
    .filter((r): r is LeagueStandingRow & { slug: string } => r !== null)
    .slice(0, 6);

  if (previous.length === 0 && upcoming.length === 0 && nearby.length === 0) return null;

  return (
    <PremiumPanel kicker="Explore" title="More from BetGenius" id="more">
      <div className="space-y-5">

      {previous.length > 0 && (
        <Section title="Our previous calls on this fixture">
          <ul className="space-y-1">
            {previous.map(({ m, slug }) => (
              <li key={m.fixtureApiId}>
                <Link href={`/predictions/match/${slug}`} className="text-sm text-brand hover:underline">
                  {m.homeTeam} {m.homeGoals}-{m.awayGoals} {m.awayTeam}
                </Link>
                <span className="ml-2 text-xs text-gray-500">{m.date.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {upcoming.length > 0 && leagueName && (
        <Section title={`Other ${leagueName} predictions`}>
          <ul className="space-y-1">
            {upcoming.map(({ f, slug }) => (
              <li key={f.id}>
                <Link href={`/predictions/match/${slug}`} className="text-sm text-brand hover:underline">
                  {f.homeTeam} vs {f.awayTeam}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {nearby.length > 0 && (
        <Section title="Teams around them in the table">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {nearby.map((r) => (
              <Link key={r.teamId} href={`/predictions/team/${r.slug}`} className="text-sm text-gray-400 hover:text-brand hover:underline">
                {r.teamName}
              </Link>
            ))}
          </div>
        </Section>
      )}

      {leagueName && (
        <Link href={`/predictions/league/${leagueSlug(leagueName, leagueApiId)}`} className="inline-block text-sm text-brand hover:underline">
          All {leagueName} predictions →
        </Link>
      )}
      </div>
    </PremiumPanel>
  );
}
