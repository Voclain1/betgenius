import Link from "next/link";
import { getPublishedMatchIndex, getLeagueEnrichment } from "@/lib/predictionScope";
import { matchKey, teamSlug, leagueSlug } from "@/lib/slug";
import type { LeagueUpcomingFixture, LeagueStandingRow } from "@/lib/enrichment";
import type { H2HMeeting } from "@/lib/h2h";

/**
 * Onward links from a match page.
 *
 * Every link here is verified to land somewhere with content before it is
 * rendered. getPublishedMatchIndex is the existing matchKey → slug map of
 * fixtures that actually have a published page (it already backs the same
 * decision in the livescores and fixtures feeds), and team links are only
 * offered for teams that appear in the standings we hold. A link into an empty
 * page is worse than no link — for the reader first, and for crawl budget
 * second.
 *
 * This is not a link farm bolted on for SEO. Each block answers a question a
 * reader on this page plausibly has next: how did the last meeting go, what
 * else is on in this league, and does this site's record justify the
 * confidence figure it just showed me.
 */

const MAX_PREVIOUS = 3;
const MAX_SAME_LEAGUE = 4;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
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
  const [index, league] = await Promise.all([getPublishedMatchIndex(), getLeagueEnrichment(leagueApiId)]);

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
  const upcoming = ((league?.upcomingJson as unknown as LeagueUpcomingFixture[] | null) ?? [])
    .map((f) => {
      // upcomingJson carries no team ids, so the index is keyed by name-derived
      // slug comparison instead — matching the same way the fixtures feed does.
      const entry = Object.entries(index).find(([, slug]) => slug.startsWith(`${teamSlug(f.homeTeam)}-vs-${teamSlug(f.awayTeam)}-`));
      return entry && entry[1] !== currentSlug ? { f, slug: entry[1] } : null;
    })
    .filter((x): x is { f: LeagueUpcomingFixture; slug: string } => x !== null)
    .slice(0, MAX_SAME_LEAGUE);

  // Teams from the table around this fixture, excluding the two playing (they
  // are already linked from the H1).
  const nearby = (standings ?? [])
    .filter((r) => r.teamId !== homeTeamApiId && r.teamId !== awayTeamApiId && r.played > 0)
    .slice(0, 6);

  if (previous.length === 0 && upcoming.length === 0 && nearby.length === 0) return null;

  return (
    <section className="card space-y-4">
      <h2 className="section-heading">More from BetGenius</h2>

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
              <Link key={r.teamId} href={`/predictions/team/${teamSlug(r.teamName)}`} className="text-sm text-gray-400 hover:text-brand hover:underline">
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
    </section>
  );
}
