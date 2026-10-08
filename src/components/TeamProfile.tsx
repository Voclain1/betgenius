import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import type { TeamCompetition, TeamNextMatch, TeamStanding } from "@/lib/teamProfile";

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
