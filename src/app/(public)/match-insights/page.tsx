import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { INSIGHT_TYPE_LABELS, type InsightEvidence, type InsightType } from "@/lib/insights";
import { FollowButton } from "@/components/FollowButton";
import { matchSlug } from "@/lib/slug";
import { formatRelativeTime } from "@/lib/time";

export const metadata: Metadata = {
  title: "Match Insights — verified football trends",
  description: "Verified team streaks and recent-match trends for upcoming fixtures, calculated from completed matches.",
  alternates: { canonical: "/match-insights" },
};

const MATCHES_PER_PAGE = 12;

const SCOPE_LABELS: Record<InsightEvidence["scope"], string> = {
  ALL: "All competitions",
  HOME: "Home matches",
  AWAY: "Away matches",
  COMPETITION: "This competition",
};

function kickoffLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) + " WAT";
}

function matchDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}

type SearchParams = { league?: string; type?: string; page?: string };

export default async function MatchInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const now = new Date();
  const league = /^\d+$/.test(searchParams.league ?? "") ? Number(searchParams.league) : undefined;
  const type = searchParams.type && searchParams.type in INSIGHT_TYPE_LABELS ? (searchParams.type as InsightType) : undefined;
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  const where = {
    expiresAt: { gt: now },
    kickoff: { gt: now },
    ...(league ? { leagueApiId: league } : {}),
    ...(type ? { type } : {}),
  };

  // Paginate by fixture, not by insight, so a match never splits across pages.
  const [fixtures, leagueGroups] = await Promise.all([
    prisma.matchInsightCache.groupBy({
      by: ["predictionId"],
      where,
      _min: { kickoff: true },
      orderBy: [{ _min: { kickoff: "asc" } }, { predictionId: "asc" }],
      skip: (page - 1) * MATCHES_PER_PAGE,
      take: MATCHES_PER_PAGE + 1,
    }),
    prisma.matchInsightCache.groupBy({ by: ["leagueApiId"], where: { expiresAt: { gt: now }, kickoff: { gt: now } } }),
  ]);
  const pageIds = fixtures.slice(0, MATCHES_PER_PAGE).map((f) => f.predictionId);

  const leagueIds = leagueGroups.map((g) => g.leagueApiId).filter((id): id is number => id != null);
  const [rows, predictions, leagueNames] = await Promise.all([
    prisma.matchInsightCache.findMany({
      where: { ...where, predictionId: { in: pageIds } },
      orderBy: [{ strength: "desc" }, { insightKey: "asc" }],
    }),
    prisma.prediction.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, leagueName: true },
    }),
    prisma.prediction.findMany({
      where: { leagueApiId: { in: leagueIds }, leagueName: { not: null } },
      distinct: ["leagueApiId"],
      select: { leagueApiId: true, leagueName: true },
    }),
  ]);
  const teamIds = [...new Set(rows.map((r) => r.teamApiId))];
  const crests = await prisma.teamEnrichmentCache.findMany({ where: { teamApiId: { in: teamIds } }, select: { teamApiId: true, crestUrl: true } });
  const crest = new Map(crests.map((c) => [c.teamApiId, c.crestUrl]));

  const leagueOptions = leagueNames
    .map((l) => ({ id: l.leagueApiId!, name: l.leagueName! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const query = (next: Partial<SearchParams>) => {
    const params = new URLSearchParams();
    const merged = { league: searchParams.league, type: searchParams.type, ...next };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/match-insights?${qs}` : "/match-insights";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Match Insights</h1>
        <p className="mt-2 max-w-3xl text-gray-400">
          Streaks and trends for teams with an upcoming tip, calculated from their most recent completed competitive matches.
          Results are 90-minute scores, the basis bookmakers settle on; friendlies are excluded. Trends describe what has
          happened, not what will.
        </p>
      </div>

      <form className="card flex flex-wrap items-end gap-3" action="/match-insights">
        <label className="text-sm">
          <span className="block text-gray-400">Competition</span>
          <select name="league" defaultValue={searchParams.league ?? ""} className="mt-1 rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            <option value="">All competitions</option>
            {leagueOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-400">Insight</span>
          <select name="type" defaultValue={searchParams.type ?? ""} className="mt-1 rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            <option value="">All insight types</option>
            {Object.entries(INSIGHT_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>

      {pageIds.length === 0 ? (
        <div className="card">
          <h2 className="font-semibold">No current insights</h2>
          <p className="mt-1 text-sm text-gray-400">
            An insight is only shown when a team has at least five verified recent matches in scope and its history was
            checked within the last twelve hours. Try another filter, or check back closer to kickoff.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pageIds.map((predictionId) => {
            const match = predictions.find((p) => p.id === predictionId);
            const matchRows = rows.filter((r) => r.predictionId === predictionId);
            if (!match || !matchRows.length) return null;
            const slug = matchSlug(match);
            const sides = [
              { teamApiId: match.homeTeamApiId, name: match.homeTeam },
              { teamApiId: match.awayTeamApiId, name: match.awayTeam },
            ];
            const checkedAt = matchRows.reduce((latest, r) => (r.refreshedAt > latest ? r.refreshedAt : latest), matchRows[0].refreshedAt);
            return (
              <article key={predictionId} className="card space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm text-gray-400">{match.leagueName} · {kickoffLabel(match.kickoff!)}</p>
                    <h2 className="text-xl font-semibold">{match.homeTeam} vs {match.awayTeam}</h2>
                  </div>
                  {slug && <Link className="text-sm text-brand" href={`/predictions/match/${slug}`}>Open prediction →</Link>}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {sides.map((side) => {
                    const teamRows = matchRows.filter((r) => r.teamApiId === side.teamApiId);
                    const crestUrl = side.teamApiId != null ? crest.get(side.teamApiId) : null;
                    return (
                      <section key={side.teamApiId ?? side.name} className="space-y-3">
                        <div className="flex items-center gap-2">
                          {crestUrl && <Image src={crestUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain" />}
                          <h3 className="min-w-0 flex-1 font-semibold">{side.name}</h3>
                          {side.teamApiId != null && <FollowButton targetType="TEAM" targetKey={String(side.teamApiId)} label={side.name ?? undefined} />}
                        </div>
                        {teamRows.length === 0 ? (
                          <p className="text-sm text-gray-500">No verified trend to show.</p>
                        ) : (
                          <ul className="space-y-2">
                            {teamRows.map((row) => {
                              const e = row.evidence as unknown as InsightEvidence;
                              return (
                                <li key={row.id} className="rounded-md border border-brand-border p-3">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="rounded-full bg-brand/15 px-2 py-0.5 font-semibold text-brand">{INSIGHT_TYPE_LABELS[e.type]}</span>
                                    <span className="text-gray-500">{e.scope === "COMPETITION" ? e.leagueName : SCOPE_LABELS[e.scope]}</span>
                                  </div>
                                  <p className="mt-2 font-medium">{e.explanation}</p>
                                  <details className="mt-2 text-sm text-gray-400">
                                    <summary className="cursor-pointer">The {e.matches.length} matches behind this</summary>
                                    <ul className="mt-2 space-y-1">
                                      {e.matches.map((m) => (
                                        <li key={m.id} className={m.breaksStreak ? "text-gray-500" : undefined}>
                                          {matchDate(m.date)} · {m.venue === "home" ? "vs" : "at"} {m.opponent} · {m.goalsFor}–{m.goalsAgainst}
                                          <span className="text-gray-500"> · {m.leagueName}</span>
                                          {m.breaksStreak && <span className="text-gray-500"> (ended the run)</span>}
                                        </li>
                                      ))}
                                    </ul>
                                    {!e.exact && (
                                      <p className="mt-2 text-gray-500">The run extends past the matches we hold, so it is stated as a minimum.</p>
                                    )}
                                  </details>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500">Match history checked {formatRelativeTime(checkedAt)}.</p>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex gap-4">
        {page > 1 && <Link className="text-brand" href={query({ page: String(page - 1) })}>← Previous</Link>}
        {fixtures.length > MATCHES_PER_PAGE && <Link className="text-brand" href={query({ page: String(page + 1) })}>Next →</Link>}
      </div>
    </div>
  );
}
