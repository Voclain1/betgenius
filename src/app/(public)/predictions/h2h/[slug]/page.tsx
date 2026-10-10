import type { Metadata } from "next";
import { TeamCrest } from "@/components/TeamCrest";
import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { PremiumPanel } from "@/components/PremiumPanel";
import { getH2HBySlug } from "@/lib/predictionScope";
import { h2hTrendLine, type H2HMeeting, type H2HRecord } from "@/lib/h2h";
import { isSubstantiveH2H, MIN_H2H_INDEX_MEETINGS } from "@/lib/h2hEvidence";
import { teamSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, fitMetadataTitleWithSuffix, fitMetaDescription } from "@/lib/seo";

const RECENT_WINDOW = 5;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { pair, meetings, stats } = await getH2HBySlug(params.slug);

  if (!pair) {
    return {
      title: "Head-to-head",
      description: "No head-to-head record published for this pairing yet.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/h2h/${params.slug}` },
    };
  }

  const title = `${pair.teamAName} vs ${pair.teamBName} head-to-head`;
  const summary =
    stats && stats.sample > 0
      ? `${stats.sample} meetings: ${pair.teamAName} ${stats.overall.teamAWins}, ${pair.teamBName} ${stats.overall.teamBWins}, ${stats.overall.draws} drawn.`
      : "Full head-to-head record, results and goal trends.";

  return {
    title: fitMetadataTitleWithSuffix(`${pair.teamAName} vs ${pair.teamBName}`, "head-to-head"),
    description: fitMetaDescription(`${title} — ${summary}`),
    ...(isSubstantiveH2H(meetings) ? {} : { robots: { index: false, follow: true } }),
    alternates: { canonical: `/predictions/h2h/${params.slug}` },
  };
}

function Crest({ name, teamApiId }: { name: string; teamApiId: number }) {
  return (
    <Link href={`/predictions/team/${teamSlug(name)}`} aria-label={name} className="group flex min-w-0 flex-col items-center gap-2 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-b from-brand-bg to-brand-card shadow-inner ring-1 ring-brand-border transition group-hover:ring-brand/60 sm:h-28 sm:w-28">
        <TeamCrest teamApiId={teamApiId} size={64} />
      </span>
    </Link>
  );
}

const DATE = { day: "numeric", month: "short", year: "numeric" } as const;

/** W-D-L from the perspective named by `forTeam`. */
function RecordLine({ record, forTeamIsA }: { record: H2HRecord; forTeamIsA: boolean }) {
  const wins = forTeamIsA ? record.teamAWins : record.teamBWins;
  const losses = forTeamIsA ? record.teamBWins : record.teamAWins;
  return (
    <span className="tabular-nums">
      {wins}W – {record.draws}D – {losses}L
    </span>
  );
}

function MeetingRow({ m, teamAApiId }: { m: H2HMeeting; teamAApiId: number }) {
  const aIsHome = m.homeTeamApiId === teamAApiId;
  const aGoals = aIsHome ? m.homeGoals : m.awayGoals;
  const bGoals = aIsHome ? m.awayGoals : m.homeGoals;
  const tone = aGoals > bGoals ? "text-emerald-300" : aGoals < bGoals ? "text-red-300" : "text-gray-300";

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-gray-200">
          <span className={aIsHome ? "font-black text-gray-100" : ""}>{m.homeTeam}</span>{" "}
          <span className="text-gray-500">vs</span>{" "}
          <span className={aIsHome ? "" : "font-black text-gray-100"}>{m.awayTeam}</span>
        </div>
        {/* LeagueBadge falls back to rendering the name as text when it has no
            crest for the id, so the name is left to it entirely rather than
            printed again here — otherwise cup competitions show it twice. */}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
          <LeagueBadge leagueApiId={m.leagueApiId} leagueName={m.leagueName} />
          <span className="shrink-0">· {new Date(m.date).toLocaleDateString(undefined, DATE)}</span>
        </div>
      </div>
      <div className={`shrink-0 text-xl font-black tabular-nums ${tone}`}>
        {m.homeGoals} - {m.awayGoals}
      </div>
    </div>
  );
}

export default async function H2HPage({ params }: { params: { slug: string } }) {
  const { pair, meetings, stats, fetchedAt, rows } = await getH2HBySlug(params.slug);

  if (!pair) {
    return (
      <div className="space-y-8">
        <CategoryMasthead kicker="Head-to-head" title="Head-to-head" blurb="Every completed meeting between two clubs, with the goal trends behind them." stats={[]} />
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">
          No published predictions pair these two teams.{" "}
          <Link href="/predictions/today" className="text-brand hover:underline">
            See today&apos;s tips →
          </Link>
        </div>
      </div>
    );
  }

  const title = `${pair.teamAName} vs ${pair.teamBName}`;
  const recent = meetings.slice(0, RECENT_WINDOW);
  const trend = stats ? h2hTrendLine(stats, pair.teamAName, pair.teamBName) : null;
  const leader = stats
    ? stats.overall.teamAWins > stats.overall.teamBWins
      ? pair.teamAName
      : stats.overall.teamBWins > stats.overall.teamAWins
        ? pair.teamBName
        : null
    : null;

  const LIST = "divide-y divide-brand-border overflow-hidden rounded-3xl border border-brand-border bg-brand-card";
  const empty = "rounded-3xl border border-brand-border bg-brand-card p-6 text-sm leading-relaxed text-gray-400";
  const facts: [string, string][] = stats
    ? [
        ["Meetings", String(stats.sample)],
        ["Avg goals", stats.avgGoals!.toFixed(1)],
        ["BTTS", `${Math.round(stats.bttsPct!)}%`],
        ["Over 2.5", `${Math.round(stats.over25Pct!)}%`],
      ]
    : [];

  return (
    <div className="space-y-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Predictions", path: "/predictions" },
          { name: `${title} head-to-head`, path: `/predictions/h2h/${params.slug}` },
        ])}
      />

      {/* The pairing's hero, in the match page's language: both crests facing
          each other, the all-time record between them. */}
      <header className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.16),transparent)]" />
        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pt-7">
          <div className="flex items-center justify-center gap-2">
            <span aria-hidden className="h-[3px] w-5 rounded-full bg-brand" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Head-to-head</span>
          </div>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
            <Crest name={pair.teamAName} teamApiId={pair.teamAApiId} />
            {stats ? (
              <div className="text-center">
                <div className="flex items-baseline justify-center gap-2 text-4xl font-black tabular-nums tracking-tight text-gray-100 sm:text-5xl">
                  <span>{stats.overall.teamAWins}</span>
                  <span className="text-2xl text-gray-500 sm:text-3xl">{stats.overall.draws}</span>
                  <span>{stats.overall.teamBWins}</span>
                </div>
                <div className="mt-1.5 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Wins · Draws · Wins</div>
              </div>
            ) : (
              <div className="text-center text-2xl font-black text-gray-500">vs</div>
            )}
            <Crest name={pair.teamBName} teamApiId={pair.teamBApiId} />
          </div>
          <h1 className="mt-5 text-center text-2xl font-black leading-tight tracking-tight text-gray-100 sm:text-4xl">
            <Link href={`/predictions/team/${teamSlug(pair.teamAName)}`} className="hover:text-brand">
              {pair.teamAName}
            </Link>{" "}
            <span className="font-bold text-gray-500">vs</span>{" "}
            <Link href={`/predictions/team/${teamSlug(pair.teamBName)}`} className="hover:text-brand">
              {pair.teamBName}
            </Link>{" "}
            <span className="block text-base font-bold tracking-normal text-gray-400 sm:inline sm:text-4xl sm:tracking-tight">head-to-head</span>
          </h1>
        </div>
        {facts.length > 0 && (
          <dl className="relative grid grid-cols-2 gap-px border-t border-brand-border bg-brand-border sm:grid-cols-4">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse bg-brand-card px-2 py-3.5 text-center">
                <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</dt>
                <dd className="text-2xl font-black tabular-nums text-gray-100 sm:text-3xl">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {/* Three states, deliberately distinct: not fetched yet, fetched and
          they've never met, and a real record. */}
      {!fetchedAt ? (
        <div className={empty}>
          Head-to-head history isn&apos;t available for this pairing yet — it&apos;s fetched on a schedule and will appear here once it lands.
        </div>
      ) : meetings.length === 0 ? (
        <div className={empty}>
          {pair.teamAName} and {pair.teamBName} have no completed meetings on record.
        </div>
      ) : (
        <>
          <PremiumPanel kicker="The record" title="What the head-to-head record shows" id="h2h-summary-heading">
            <div className="space-y-3">
              {trend && (
                <p className="text-base font-semibold leading-relaxed text-gray-100">{trend}</p>
              )}
              <p className="text-sm leading-7 text-gray-300">
                Across the {stats!.sample} completed {stats!.sample === 1 ? "meeting" : "meetings"} in this record, {pair.teamAName} won {stats!.overall.teamAWins}, {pair.teamBName} won {stats!.overall.teamBWins}, and {stats!.overall.draws} finished level. {leader ? `${leader} therefore has more wins in the available sample.` : "Neither team has more wins in the available sample."}
              </p>
              <p className="text-sm leading-7 text-gray-300">
                These fixtures averaged {stats!.avgGoals!.toFixed(1)} total goals. Both teams scored in {Math.round(stats!.bttsPct!)}% of the recorded games, while {Math.round(stats!.over25Pct!)}% finished with more than 2.5 goals. The figures describe previous meetings only; squad changes, venue, competition and current form can make the next match different.
              </p>
            </div>
          </PremiumPanel>

          <PremiumPanel kicker="Venue split" title="Home and away" id="h2h-venues" bare>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                [pair.teamAName, stats!.teamAAtHome, true],
                [pair.teamBName, stats!.teamBAtHome, false],
              ] as const).map(([name, record, isA]) => (
                <div key={name} className="rounded-3xl border border-brand-border bg-brand-card p-5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{name} at home</h3>
                  {record.played > 0 ? (
                    <>
                      <div className="mt-2 text-3xl font-black tracking-tight text-gray-100">
                        <RecordLine record={record} forTeamIsA={isA} />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {record.played} of the {stats!.sample} meetings hosted by {name}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">No meetings on record hosted by {name}.</p>
                  )}
                </div>
              ))}
            </div>
          </PremiumPanel>

          <PremiumPanel kicker="Notable" title="Key meetings" id="h2h-notable" bare>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-brand-border bg-brand-card p-5">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">Most recent meeting</h3>
                <div className="mt-2 text-lg font-black leading-snug tracking-tight text-gray-100">
                  {stats!.mostRecent!.homeTeam} <span className="tabular-nums">{stats!.mostRecent!.homeGoals} - {stats!.mostRecent!.awayGoals}</span> {stats!.mostRecent!.awayTeam}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(stats!.mostRecent!.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                  {stats!.mostRecent!.leagueName ? ` · ${stats!.mostRecent!.leagueName}` : ""}
                </p>
              </div>
              <div className="rounded-3xl border border-brand-border bg-brand-card p-5">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">Biggest win</h3>
                {stats!.biggestWin ? (
                  <>
                    <div className="mt-2 text-lg font-black leading-snug tracking-tight text-gray-100">
                      {stats!.biggestWin.meeting.homeTeam}{" "}
                      <span className="tabular-nums">{stats!.biggestWin.meeting.homeGoals} - {stats!.biggestWin.meeting.awayGoals}</span>{" "}
                      {stats!.biggestWin.meeting.awayTeam}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {stats!.biggestWin.margin}-goal margin ·{" "}
                      {new Date(stats!.biggestWin.meeting.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">Every meeting on record was drawn.</p>
                )}
              </div>
            </div>
          </PremiumPanel>

          <PremiumPanel kicker="Results" title={`Last ${recent.length === 1 ? "meeting" : `${recent.length} meetings`}`} id="h2h-recent" bare>
            <div className={LIST}>
              {recent.map((m) => (
                <MeetingRow key={m.fixtureApiId} m={m} teamAApiId={pair.teamAApiId} />
              ))}
            </div>
          </PremiumPanel>

          {meetings.length > recent.length && (
            <PremiumPanel kicker="Archive" title="Earlier meetings" id="h2h-earlier" bare>
              <div className={LIST}>
                {meetings.slice(RECENT_WINDOW).map((m) => (
                  <MeetingRow key={m.fixtureApiId} m={m} teamAApiId={pair.teamAApiId} />
                ))}
              </div>
            </PremiumPanel>
          )}
        </>
      )}

      {fetchedAt && meetings.length > 0 && !isSubstantiveH2H(meetings) && (
        <p className="text-xs text-gray-500">
          This record currently contains fewer than {MIN_H2H_INDEX_MEETINGS} completed meetings, so treat its trends as an early sample.
        </p>
      )}

      {rows.length > 0 && (
        <PremiumPanel kicker="BetGenius" title="Our predictions for this pairing" id="h2h-predictions" bare>
          <div className={LIST}>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0 text-sm font-semibold text-gray-100">
                  <MatchLink homeTeam={r.homeTeam} awayTeam={r.awayTeam} kickoff={r.kickoff} />
                  <div className="mt-0.5 text-xs font-normal text-gray-500">
                    {r.market}
                    {r.kickoff ? ` · ${new Date(r.kickoff).toLocaleDateString(undefined, DATE)}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PremiumPanel>
      )}
    </div>
  );
}
