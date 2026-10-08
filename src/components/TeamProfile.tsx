import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import type { TeamCompetition, TeamNextMatch, TeamStanding } from "@/lib/teamProfile";
import type { SquadPlayer } from "@/lib/enrichment";
import type { Honour } from "@/lib/clubHonours";

/**
 * The editorial pieces of the team page: masthead, next match, competitions
 * and the "Know more about" feature. Server components; the only client parts
 * are the crest and league badge images, which need an onError fallback.
 */

const ORDINAL = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** A magazine-style section label: small caps kicker over the heading. */
export function SectionHead({ kicker, title, id }: { kicker: string; title: string; id?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">{kicker}</div>
      <h2 id={id} className="mt-0.5 text-xl font-bold tracking-tight text-gray-100">
        {title}
      </h2>
    </div>
  );
}

export function TeamMasthead({
  name,
  teamApiId,
  country,
  flagCode,
  standing,
  children,
}: {
  name: string;
  teamApiId: number | null;
  country: string | null;
  flagCode: string | null;
  standing: TeamStanding | null;
  /** Follow button and anything else that sits under the name. */
  children?: React.ReactNode;
}) {
  const r = standing?.row;
  return (
    <header className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-card">
      {/* A wash of the brand colour behind the crest: the page's one decorative flourish. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/15 via-transparent to-transparent" />
      <div className="relative flex items-center gap-4 p-5 sm:gap-6 sm:p-7">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand-bg/70 ring-1 ring-brand-border sm:h-24 sm:w-24">
          <TeamCrest teamApiId={teamApiId} size={64} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-100 sm:text-4xl">{name}</h1>
          {country && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              {flagCode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`https://media.api-sports.io/flags/${flagCode}.svg`} alt="" width={18} height={13} className="rounded-[2px] object-cover" />
              )}
              <span>{country}</span>
            </div>
          )}
          {children}
        </div>
      </div>
      {r && r.played > 0 && standing && (
        <dl className="relative grid grid-cols-4 divide-x divide-brand-border border-t border-brand-border text-center">
          {[
            ["Position", ORDINAL(r.rank)],
            ["Points", String(r.points)],
            ["Played", String(r.played)],
            ["Goals", `${r.goalsFor}:${r.goalsAgainst}`],
          ].map(([label, value]) => (
            <div key={label} className="px-2 py-3">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-gray-100">{value}</dd>
            </div>
          ))}
          <div className="col-span-4 border-t border-brand-border px-3 py-2 text-[11px] text-gray-500">
            {standing.leagueName}
            {r.zone ? ` · ${r.zone}` : ""}
          </div>
        </dl>
      )}
    </header>
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function Side({ name, teamApiId }: { name: string; teamApiId: number | null }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <span className="flex h-14 w-14 items-center justify-center sm:h-16 sm:w-16">
        <TeamCrest teamApiId={teamApiId} size={52} />
      </span>
      <span className="line-clamp-2 w-full break-words text-sm font-semibold leading-snug text-gray-100 sm:text-base">{name}</span>
    </div>
  );
}

/**
 * The club's next fixture as a matchup card. Links to the match page when a
 * prediction is published for it; otherwise it is information only.
 */
export function NextMatchCard({ match }: { match: TeamNextMatch }) {
  const body = (
    <div className="card space-y-4 transition hover:border-brand/50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <LeagueBadge leagueApiId={match.leagueApiId} leagueName={match.leagueName} showName={false} size={16} />
          <span className="truncate text-xs font-medium text-gray-400">{match.leagueName ?? "Next fixture"}</span>
        </div>
        {match.href && <ChevronRight size={18} className="shrink-0 text-brand" aria-hidden />}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <Side name={match.homeTeam} teamApiId={match.homeTeamApiId} />
        <div className="text-center">
          <div className="text-2xl font-bold tabular-nums text-gray-100">{TIME.format(match.kickoff)}</div>
          <div className="mt-0.5 whitespace-nowrap text-xs text-gray-400">{DAY.format(match.kickoff)}</div>
        </div>
        <Side name={match.awayTeam} teamApiId={match.awayTeamApiId} />
      </div>

      <div className="border-t border-brand-border pt-3 text-center text-sm">
        {match.href ? (
          <span className="font-semibold text-brand">See our prediction</span>
        ) : (
          <span className="text-gray-500">Prediction not published yet</span>
        )}
      </div>
    </div>
  );
  return match.href ? (
    <Link href={match.href} className="block" aria-label={`${match.homeTeam} vs ${match.awayTeam} prediction`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function TeamCompetitions({ competitions }: { competitions: TeamCompetition[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {competitions.map((c) => {
        const inner = (
          <>
            <LeagueBadge leagueApiId={c.leagueApiId} leagueName={c.name} showName={false} size={18} />
            <span className="text-sm font-medium text-gray-200">{c.name}</span>
          </>
        );
        return (
          <li key={c.leagueApiId}>
            {c.href ? (
              <Link href={c.href} className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-card px-3 py-1.5 transition hover:border-brand">
                {inner}
              </Link>
            ) : (
              <span className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-card px-3 py-1.5">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Know more about": the feature article. The first paragraph opens with a drop cap. */
export function TeamAbout({ name, paragraphs }: { name: string; paragraphs: string[] }) {
  return (
    <article className="card relative overflow-hidden sm:p-6">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />
      <SectionHead kicker="Club profile" title={`Know more about ${name}`} />
      <div className="space-y-3 text-[15px] leading-relaxed text-gray-300">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={i === 0 ? "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-5xl first-letter:font-extrabold first-letter:leading-[0.8] first-letter:text-brand" : undefined}
          >
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}

const ROW_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });

/** The club's upcoming fixtures, one row each; rows with a published prediction link to it. */
export function TeamFixtureList({ fixtures, teamApiId }: { fixtures: TeamNextMatch[]; teamApiId: number | null }) {
  if (!fixtures.length) return <p className="text-sm text-gray-500">No upcoming fixtures listed right now.</p>;
  return (
    <ul className="divide-y divide-brand-border">
      {fixtures.map((f) => {
        const home = f.homeTeamApiId === teamApiId;
        const opponent = home ? f.awayTeam : f.homeTeam;
        const opponentId = home ? f.awayTeamApiId : f.homeTeamApiId;
        const row = (
          <div className="flex items-center gap-3 py-2.5">
            <div className="w-16 shrink-0 text-center">
              <div className="text-xs font-semibold tabular-nums text-gray-200">{TIME.format(f.kickoff)}</div>
              <div className="whitespace-nowrap text-[10px] text-gray-500">{ROW_DAY.format(f.kickoff)}</div>
            </div>
            <TeamCrest teamApiId={opponentId} size={24} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-100">
                <span className="mr-1 text-xs font-medium text-gray-500">{home ? "vs" : "at"}</span>
                {opponent}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <LeagueBadge leagueApiId={f.leagueApiId} leagueName={f.leagueName} showName={false} size={12} />
                <span className="truncate">{f.leagueName}</span>
              </div>
            </div>
            {f.href ? (
              <span className="chip shrink-0 bg-brand/15 text-brand">Prediction</span>
            ) : (
              <span className="shrink-0 text-[11px] text-gray-600">Soon</span>
            )}
          </div>
        );
        return (
          <li key={`${f.kickoff.toISOString()}-${opponent}`}>
            {f.href ? (
              <Link href={f.href} className="block rounded-md transition hover:bg-brand-bg/60">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One leaderboard inside the Top players tab. */
function Leaders({ title, rows, format }: { title: string; rows: { p: SquadPlayer; value: number }[]; format: (v: number) => string }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">{title}</h3>
      <ol className="space-y-1.5">
        {rows.map(({ p, value }, i) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg bg-brand-bg/60 px-2.5 py-2">
            <span className="w-4 text-xs font-bold tabular-nums text-gray-500">{i + 1}</span>
            {p.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photo} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="h-7 w-7 shrink-0 rounded-full bg-brand-border" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-100">{p.name}</div>
              <div className="text-[10px] text-gray-500">
                {p.position ?? ""}
                {p.stats ? ` · ${p.stats.appearances} app${p.stats.appearances === 1 ? "" : "s"}` : ""}
              </div>
            </div>
            <span className="text-base font-bold tabular-nums text-brand">{format(value)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * This season's standout players from the squad's stored season totals:
 * goals, assists and average rating (rating needs a fair share of
 * appearances, so a one-match 8.0 does not top the list).
 */
export function TeamTopPlayers({ squad }: { squad: SquadPlayer[] }) {
  const withStats = squad.filter((p) => p.stats && p.stats.appearances > 0);
  if (!withStats.length) return <p className="text-sm text-gray-500">Player statistics for this season are not available yet.</p>;
  const top = (value: (p: SquadPlayer) => number, n = 3) =>
    withStats
      .map((p) => ({ p, value: value(p) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  const maxApps = Math.max(...withStats.map((p) => p.stats!.appearances));
  const minApps = Math.max(2, Math.ceil(maxApps * 0.4));
  const rated = withStats
    .filter((p) => p.stats!.rating != null && p.stats!.appearances >= minApps)
    .map((p) => ({ p, value: p.stats!.rating! }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <Leaders title="Goals" rows={top((p) => p.stats!.goals)} format={(v) => String(v)} />
      <Leaders title="Assists" rows={top((p) => p.stats!.assists)} format={(v) => String(v)} />
      <Leaders title="Average rating" rows={rated} format={(v) => v.toFixed(2)} />
    </div>
  );
}

/** Major honours as a trophy cabinet: count, competition and the most recent win. */
export function TeamHonours({ honours, asOf }: { honours: Honour[]; asOf: string }) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {honours.map((h) => (
          <li key={h.title} className="rounded-xl border border-brand-border bg-brand-card p-3">
            <div className="flex items-baseline gap-1.5">
              <Trophy size={14} className="shrink-0 text-amber-300" aria-hidden />
              <span className="text-2xl font-extrabold tabular-nums text-gray-100">{h.count}</span>
            </div>
            <div className="mt-1 text-xs font-medium leading-snug text-gray-300">{h.title}</div>
            <div className="mt-0.5 text-[11px] text-gray-500">Last won {h.last}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-gray-600">Major honours up to the end of the {asOf} season.</p>
    </div>
  );
}
