import { getLeagueEnrichment } from "@/lib/predictionScope";
import type { LeaguePlayerStat } from "@/lib/enrichment";
import type { TeamDigest } from "@/lib/ai/digest";

/**
 * Leading scorers and assisters from the league leaderboards, for the two
 * sides in this fixture.
 *
 * These are SEASON STATISTICS, not a team sheet. Nothing in api-football's
 * leaderboards says who is fit, who is in form, or who will start, and this
 * panel is careful never to imply otherwise — the heading, the caption and the
 * absence of any "expected lineup" framing all exist for that reason. A reader
 * should come away knowing who has carried a team's goals this season, which is
 * a real and checkable fact, and nothing more.
 *
 * The one availability claim made here is a conservative one: where a listed
 * player's name matches an entry in that team's absence list EXACTLY, they are
 * flagged as out. Fuzzy matching is deliberately not attempted — the
 * leaderboards and the injury feed abbreviate names differently ("T. Ayari" vs
 * "Taha Ayari"), and a near-match that guessed wrong would either invent an
 * absence or clear a player who is actually out. An unmatched player is shown
 * with no availability claim at all, which is the honest default.
 *
 * Read entirely from LeagueEnrichmentCache, which the cron already fills. No
 * api-football call, no AI.
 */

const PLAYERS_PER_TEAM = 4;

type KeyPlayerRow = { name: string; goals: number | null; assists: number | null; absent: string | null };

/**
 * Merge the goals and assists boards for one team so a player appears once
 * carrying both numbers, then flag exact matches against the absence list.
 */
function rowsForTeam(
  teamApiId: number | null,
  scorers: LeaguePlayerStat[],
  assists: LeaguePlayerStat[],
  digest: TeamDigest | null,
): KeyPlayerRow[] {
  if (teamApiId == null) return [];

  const byName = new Map<string, { name: string; goals: number | null; assists: number | null }>();
  for (const s of scorers) {
    if (s.teamId !== teamApiId) continue;
    byName.set(s.name, { name: s.name, goals: s.value, assists: null });
  }
  for (const a of assists) {
    if (a.teamId !== teamApiId) continue;
    const existing = byName.get(a.name);
    if (existing) existing.assists = a.value;
    else byName.set(a.name, { name: a.name, goals: null, assists: a.value });
  }

  // Exact, case-insensitive, whitespace-trimmed. See the note above on why this
  // is not fuzzy.
  const absences = new Map((digest?.availability ?? []).map((e) => [e.player.trim().toLowerCase(), e]));

  return [...byName.values()]
    .sort((x, y) => (y.goals ?? 0) - (x.goals ?? 0) || (y.assists ?? 0) - (x.assists ?? 0))
    .slice(0, PLAYERS_PER_TEAM)
    .map((p) => {
      const hit = absences.get(p.name.trim().toLowerCase());
      return { ...p, absent: hit ? (hit.kind === "suspension" ? "Suspended" : hit.reason || "Out") : null };
    });
}

function TeamColumn({ name, rows }: { name: string; rows: KeyPlayerRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">{name}</h3>
      <ul className="space-y-1">
        {rows.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-gray-300">
              {p.name}
              {p.absent && <span className="ml-2 text-[10px] text-red-300/80">{p.absent}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gray-500">
              {p.goals != null && `${p.goals}G`}
              {p.goals != null && p.assists != null && " · "}
              {p.assists != null && `${p.assists}A`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function MatchKeyPlayers({
  leagueApiId,
  homeTeam,
  awayTeam,
  homeTeamApiId,
  awayTeamApiId,
  homeDigest,
  awayDigest,
}: {
  leagueApiId: number | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  homeDigest: TeamDigest | null;
  awayDigest: TeamDigest | null;
}) {
  const league = await getLeagueEnrichment(leagueApiId);
  // playersFetchedAt is the leaderboards' own freshness flag, separate from
  // fetchedAt — see the model comment in schema.prisma.
  if (!league?.playersFetchedAt) return null;

  const scorers = (league.topScorersJson as unknown as LeaguePlayerStat[] | null) ?? [];
  const assists = (league.topAssistsJson as unknown as LeaguePlayerStat[] | null) ?? [];
  if (scorers.length === 0 && assists.length === 0) return null;

  const home = rowsForTeam(homeTeamApiId, scorers, assists, homeDigest);
  const away = rowsForTeam(awayTeamApiId, scorers, assists, awayDigest);
  if (home.length === 0 && away.length === 0) return null;

  return (
    <section className="card space-y-3">
      <h2 className="section-heading">Key players this season</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamColumn name={homeTeam} rows={home} />
        <TeamColumn name={awayTeam} rows={away} />
      </div>
      {/* States the limit of the claim rather than leaving the reader to assume
          a team sheet. */}
      <p className="text-[11px] text-gray-500">
        League scoring and assist totals for this season — not a predicted lineup. Availability is only shown where team news
        names the same player.
      </p>
    </section>
  );
}
