import Link from "next/link";
import { ArrowRight, ChevronRight, Trophy } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { teamCrestUrl } from "@/lib/leagues";
import type { TeamCompetition, TeamNextMatch, TeamStanding } from "@/lib/teamProfile";
import type { SquadPlayer } from "@/lib/enrichment";
import type { Honour } from "@/lib/clubHonours";

/**
 * The editorial pieces of the team page: masthead, next match, fixtures,
 * players, honours, competitions and the "Know more about" feature. Server
 * components; the only client parts are the crest and league badge images,
 * which need an onError fallback.
 *
 * One visual language throughout: deep surfaces with a soft brand glow, big
 * confident numerals, hairline dividers, and gold reserved for honours.
 */

const ORDINAL = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** Section label: a short brand rule and small-caps kicker over a heavy title. */
export function SectionHead({ kicker, title, id }: { kicker: string; title: string; id?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-[3px] w-5 rounded-full bg-brand" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">{kicker}</span>
      </div>
      <h2 id={id} className="mt-1.5 text-2xl font-black tracking-tight text-gray-100">
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
    <header className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      {/* The crest again, oversized and faded, as the hero's backdrop. */}
      {teamApiId != null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          aria-hidden
          src={teamCrestUrl(teamApiId)}
          alt=""
          className="pointer-events-none absolute -right-10 -top-8 h-56 w-56 select-none object-contain opacity-[0.07] blur-[1px] sm:h-72 sm:w-72"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-brand/20 blur-3xl" />

      <div className="relative flex items-center gap-4 p-5 sm:gap-6 sm:p-8">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-brand-bg to-brand-card shadow-inner ring-1 ring-brand-border sm:h-28 sm:w-28">
          <TeamCrest teamApiId={teamApiId} size={72} />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          {country && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-bg/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
              {flagCode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`https://media.api-sports.io/flags/${flagCode}.svg`} alt="" width={16} height={12} className="rounded-[2px] object-cover" />
              )}
              {country}
            </div>
          )}
          <h1 className="text-3xl font-black leading-[1.05] tracking-tight text-gray-100 sm:text-5xl">{name}</h1>
          {children}
        </div>
      </div>

      {r && r.played > 0 && standing && (
        <div className="relative border-t border-brand-border bg-brand-bg/40">
          <dl className="grid grid-cols-4 divide-x divide-brand-border text-center">
            {[
              ["Position", ORDINAL(r.rank)],
              ["Points", String(r.points)],
              ["Played", String(r.played)],
              ["Goals", `${r.goalsFor}–${r.goalsAgainst}`],
            ].map(([label, value], i) => (
              <div key={label} className="px-1 py-3.5">
                <dd className={`text-2xl font-black tabular-nums sm:text-3xl ${i === 0 ? "text-brand" : "text-gray-100"}`}>{value}</dd>
                <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</dt>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-brand-border px-3 py-2.5">
            <LeagueBadge leagueApiId={standing.leagueApiId} leagueName={standing.leagueName} showName={false} size={14} />
            <span className="text-xs font-semibold text-gray-300">{standing.leagueName}</span>
            {r.zone && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">{r.zone}</span>}
          </div>
        </div>
      )}
    </header>
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function Side({ name, teamApiId }: { name: string; teamApiId: number | null }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2.5 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-bg/70 ring-1 ring-brand-border sm:h-20 sm:w-20">
        <TeamCrest teamApiId={teamApiId} size={48} />
      </span>
      <span className="line-clamp-2 w-full break-words text-sm font-bold leading-snug text-gray-100 sm:text-base">{name}</span>
    </div>
  );
}

/**
 * The club's next fixture as a matchup card. Links to the match page when a
 * prediction is published for it; otherwise it is information only.
 */
export function NextMatchCard({ match }: { match: TeamNextMatch }) {
  const body = (
    <div className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card p-5 transition group-hover:border-brand/60">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-3xl" />
      <div className="relative flex items-center justify-center gap-2">
        <LeagueBadge leagueApiId={match.leagueApiId} leagueName={match.leagueName} showName={false} size={16} />
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">{match.leagueName ?? "Next fixture"}</span>
      </div>

      <div className="relative mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <Side name={match.homeTeam} teamApiId={match.homeTeamApiId} />
        <div className="text-center">
          <div className="text-3xl font-black tabular-nums tracking-tight text-gray-100">{TIME.format(match.kickoff)}</div>
          <div className="mt-1.5 inline-block whitespace-nowrap rounded-full border border-brand-border bg-brand-bg/70 px-2.5 py-0.5 text-[11px] font-semibold text-gray-300">
            {DAY.format(match.kickoff)}
          </div>
        </div>
        <Side name={match.awayTeam} teamApiId={match.awayTeamApiId} />
      </div>

      <div className="relative mt-5">
        {match.href ? (
          <span className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-black text-on-brand transition group-hover:bg-brand-dark">
            View our prediction <ArrowRight size={16} aria-hidden />
          </span>
        ) : (
          <span className="flex w-full items-center justify-center rounded-xl border border-dashed border-brand-border py-3 text-sm font-semibold text-gray-500">
            Prediction coming soon
          </span>
        )}
      </div>
    </div>
  );
  return match.href ? (
    <Link href={match.href} className="group block" aria-label={`${match.homeTeam} vs ${match.awayTeam} prediction`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function TeamCompetitions({ competitions }: { competitions: TeamCompetition[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {competitions.map((c) => {
        const inner = (
          <>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-bg ring-1 ring-brand-border">
              <LeagueBadge leagueApiId={c.leagueApiId} leagueName={c.name} showName={false} size={22} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">{c.name}</span>
            {c.href && <ChevronRight size={18} className="shrink-0 text-brand" aria-hidden />}
          </>
        );
        return (
          <li key={c.leagueApiId}>
            {c.href ? (
              <Link href={c.href} className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-card p-2.5 transition hover:border-brand/60">
                {inner}
              </Link>
            ) : (
              <span className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-card p-2.5">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Know more about": the feature article, set in a serif with a drop cap. */
export function TeamAbout({ name, paragraphs }: { name: string; paragraphs: string[] }) {
  return (
    <article className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card p-5 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand/10 blur-3xl" />
      <div className="relative">
        <SectionHead kicker="Club profile" title={`Know more about ${name}`} />
        <div className="space-y-4 font-serif text-[16px] leading-[1.75] text-gray-300 sm:text-[17px]">
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className={
                i === 0
                  ? "first-letter:float-left first-letter:mr-2.5 first-letter:mt-1.5 first-letter:font-sans first-letter:text-6xl first-letter:font-black first-letter:leading-[0.75] first-letter:text-brand"
                  : undefined
              }
            >
              {p}
            </p>
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * The club's upcoming fixtures. A fixture with a published prediction is a
 * solid, tinted row with a brand edge and an arrow, and links to it; the rest
 * are quiet rows.
 */
export function TeamFixtureList({ fixtures, teamApiId }: { fixtures: TeamNextMatch[]; teamApiId: number | null }) {
  if (!fixtures.length) return <p className="text-sm text-gray-500">No upcoming fixtures listed right now.</p>;
  return (
    <ul className="space-y-2">
      {fixtures.map((f) => {
        const home = f.homeTeamApiId === teamApiId;
        const opponent = home ? f.awayTeam : f.homeTeam;
        const opponentId = home ? f.awayTeamApiId : f.homeTeamApiId;
        const predicted = !!f.href;
        const row = (
          <div
            className={`flex items-center gap-3 rounded-2xl border-l-4 px-3 py-3 ${
              predicted ? "border-brand bg-brand/[0.14]" : "border-transparent bg-brand-bg/50"
            }`}
          >
            <div className="w-14 shrink-0 text-center">
              <div className="text-sm font-black tabular-nums text-gray-100">{TIME.format(f.kickoff)}</div>
              <div className="whitespace-nowrap text-[10px] font-medium text-gray-500">{DAY.format(f.kickoff)}</div>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-card ring-1 ring-brand-border">
              <TeamCrest teamApiId={opponentId} size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-gray-100">
                <span className="mr-1 text-[11px] font-semibold uppercase text-gray-500">{home ? "vs" : "at"}</span>
                {opponent}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                <LeagueBadge leagueApiId={f.leagueApiId} leagueName={f.leagueName} showName={false} size={12} />
                <span className="truncate">{f.leagueName}</span>
              </div>
            </div>
            {predicted && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
                <ArrowRight size={16} aria-hidden />
              </span>
            )}
          </div>
        );
        return (
          <li key={`${f.kickoff.toISOString()}-${opponent}`}>
            {predicted ? (
              <Link href={f.href!} className="block transition hover:opacity-90" aria-label={`${f.homeTeam} vs ${f.awayTeam} prediction`}>
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

const MEDAL = ["bg-amber-300 text-black", "bg-gray-300 text-black", "bg-[#cd7f32] text-black"];

/** One leaderboard inside the Top players tab. */
function Leaders({ title, rows, format }: { title: string; rows: { p: SquadPlayer; value: number }[]; format: (v: number) => string }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-brand-border bg-brand-bg/40 p-3">
      <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">{title}</h3>
      <ol className="space-y-2">
        {rows.map(({ p, value }, i) => (
          <li key={p.id} className="flex items-center gap-3">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${MEDAL[i] ?? "bg-brand-border text-gray-300"}`}>{i + 1}</span>
            {p.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photo} alt="" width={36} height={36} loading="lazy" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-brand-border" />
            ) : (
              <span className="h-9 w-9 shrink-0 rounded-full bg-brand-border" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-gray-100">{p.name}</div>
              <div className="text-[10px] text-gray-500">
                {p.position ?? ""}
                {p.stats ? ` · ${p.stats.appearances} app${p.stats.appearances === 1 ? "" : "s"}` : ""}
              </div>
            </div>
            <span className="text-xl font-black tabular-nums text-brand">{format(value)}</span>
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
    <div className="grid gap-3 sm:grid-cols-3">
      <Leaders title="Top scorers" rows={top((p) => p.stats!.goals)} format={(v) => String(v)} />
      <Leaders title="Most assists" rows={top((p) => p.stats!.assists)} format={(v) => String(v)} />
      <Leaders title="Best rated" rows={rated} format={(v) => v.toFixed(2)} />
    </div>
  );
}

/** Major honours as a trophy cabinet: gold numerals, the competition and the most recent win. */
export function TeamHonours({ honours, asOf }: { honours: Honour[]; asOf: string }) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {honours.map((h) => (
          <li
            key={h.title}
            className="relative overflow-hidden rounded-2xl border border-amber-300/25 bg-gradient-to-b from-amber-300/[0.12] to-brand-card p-4"
          >
            <Trophy size={40} aria-hidden className="pointer-events-none absolute right-3 top-3 text-amber-300/15" />
            <div className="text-4xl font-black tabular-nums leading-none text-amber-300">{h.count}</div>
            <div className="mt-2 text-[13px] font-bold leading-snug text-gray-100">{h.title}</div>
            <div className="mt-1 text-[11px] font-medium text-gray-500">Last won {h.last}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[11px] text-gray-600">Major honours up to the end of the {asOf} season.</p>
    </div>
  );
}
