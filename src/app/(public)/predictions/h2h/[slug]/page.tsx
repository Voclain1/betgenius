import type { Metadata } from "next";
import Link from "next/link";
import { LeagueBadge } from "@/components/LeagueBadge";
import { MatchLink } from "@/components/MatchLink";
import { getH2HBySlug } from "@/lib/predictionScope";
import { h2hTrendLine, type H2HMeeting, type H2HRecord } from "@/lib/h2h";
import { teamSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";

const RECENT_WINDOW = 5;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { pair, stats } = await getH2HBySlug(params.slug);

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
    title,
    description: `${title} — ${summary}`,
    alternates: { canonical: `/predictions/h2h/${params.slug}` },
  };
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-brand-bg p-2 text-center">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

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
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm">
          <span className={aIsHome ? "font-semibold" : ""}>{m.homeTeam}</span>{" "}
          <span className="text-gray-500">vs</span>{" "}
          <span className={aIsHome ? "" : "font-semibold"}>{m.awayTeam}</span>
        </div>
        {/* LeagueBadge falls back to rendering the name as text when it has no
            crest for the id, so the name is left to it entirely rather than
            printed again here — otherwise cup competitions show it twice. */}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
          <LeagueBadge leagueApiId={m.leagueApiId} leagueName={m.leagueName} />
          <span className="shrink-0">· {new Date(m.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
      </div>
      <div className={`shrink-0 text-base font-bold tabular-nums ${tone}`}>
        {m.homeGoals} - {m.awayGoals}
      </div>
    </div>
  );
}

export default async function H2HPage({ params }: { params: { slug: string } }) {
  const { pair, meetings, stats, fetchedAt, rows } = await getH2HBySlug(params.slug);

  if (!pair) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Head-to-head</h1>
        <div className="card text-gray-400">
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

  return (
    <div className="space-y-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Predictions", path: "/predictions" },
          { name: `${title} head-to-head`, path: `/predictions/h2h/${params.slug}` },
        ])}
      />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold md:text-3xl">
          <Link href={`/predictions/team/${teamSlug(pair.teamAName)}`} className="hover:underline">
            {pair.teamAName}
          </Link>{" "}
          <span className="text-gray-500">vs</span>{" "}
          <Link href={`/predictions/team/${teamSlug(pair.teamBName)}`} className="hover:underline">
            {pair.teamBName}
          </Link>
        </h1>
        <p className="text-sm text-gray-400">Head-to-head record</p>
      </div>

      {/* Three states, deliberately distinct: not fetched yet, fetched and
          they've never met, and a real record. */}
      {!fetchedAt ? (
        <div className="card text-gray-400">
          Head-to-head history isn&apos;t available for this pairing yet — it&apos;s fetched on a schedule and will appear here once it lands.
        </div>
      ) : meetings.length === 0 ? (
        <div className="card text-gray-400">
          {pair.teamAName} and {pair.teamBName} have no completed meetings on record.
        </div>
      ) : (
        <>
          {trend && (
            <p className="text-sm text-gray-300">
              <span className="font-semibold text-gray-200">H2H trends: </span>
              {trend}
            </p>
          )}

          <div className="card space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Overall</h2>
              <span className="text-xs text-gray-500">
                last {stats!.sample} {stats!.sample === 1 ? "meeting" : "meetings"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={pair.teamAName} value={stats!.overall.teamAWins} />
              <Stat label="Draws" value={stats!.overall.draws} />
              <Stat label={pair.teamBName} value={stats!.overall.teamBWins} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Avg goals" value={stats!.avgGoals!.toFixed(1)} />
              <Stat label="BTTS" value={`${Math.round(stats!.bttsPct!)}%`} />
              <Stat label="Over 2.5" value={`${Math.round(stats!.over25Pct!)}%`} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card space-y-2">
              <h2 className="text-sm font-semibold text-gray-300">{pair.teamAName} at home</h2>
              {stats!.teamAAtHome.played > 0 ? (
                <>
                  <div className="text-lg font-bold">
                    <RecordLine record={stats!.teamAAtHome} forTeamIsA />
                  </div>
                  <p className="text-xs text-gray-500">
                    {stats!.teamAAtHome.played} of the {stats!.sample} meetings hosted by {pair.teamAName}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">No meetings on record hosted by {pair.teamAName}.</p>
              )}
            </div>
            <div className="card space-y-2">
              <h2 className="text-sm font-semibold text-gray-300">{pair.teamBName} at home</h2>
              {stats!.teamBAtHome.played > 0 ? (
                <>
                  <div className="text-lg font-bold">
                    <RecordLine record={stats!.teamBAtHome} forTeamIsA={false} />
                  </div>
                  <p className="text-xs text-gray-500">
                    {stats!.teamBAtHome.played} of the {stats!.sample} meetings hosted by {pair.teamBName}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">No meetings on record hosted by {pair.teamBName}.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card space-y-1">
              <h2 className="text-sm font-semibold text-gray-300">Most recent meeting</h2>
              <div className="text-sm">
                {stats!.mostRecent!.homeTeam} {stats!.mostRecent!.homeGoals} - {stats!.mostRecent!.awayGoals} {stats!.mostRecent!.awayTeam}
              </div>
              <p className="text-xs text-gray-500">
                {new Date(stats!.mostRecent!.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                {stats!.mostRecent!.leagueName ? ` · ${stats!.mostRecent!.leagueName}` : ""}
              </p>
            </div>
            <div className="card space-y-1">
              <h2 className="text-sm font-semibold text-gray-300">Biggest win</h2>
              {stats!.biggestWin ? (
                <>
                  <div className="text-sm">
                    {stats!.biggestWin.meeting.homeTeam} {stats!.biggestWin.meeting.homeGoals} - {stats!.biggestWin.meeting.awayGoals}{" "}
                    {stats!.biggestWin.meeting.awayTeam}
                  </div>
                  <p className="text-xs text-gray-500">
                    {stats!.biggestWin.margin}-goal margin ·{" "}
                    {new Date(stats!.biggestWin.meeting.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Every meeting on record was drawn.</p>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold">Last {recent.length === 1 ? "meeting" : `${recent.length} meetings`}</h2>
            <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60">
              {recent.map((m) => (
                <MeetingRow key={m.fixtureApiId} m={m} teamAApiId={pair.teamAApiId} />
              ))}
            </div>
          </div>

          {meetings.length > recent.length && (
            <div>
              <h2 className="mb-3 text-xl font-semibold">Earlier meetings</h2>
              <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60">
                {meetings.slice(RECENT_WINDOW).map((m) => (
                  <MeetingRow key={m.fixtureApiId} m={m} teamAApiId={pair.teamAApiId} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {rows.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-semibold">Our predictions for this pairing</h2>
          <div className="divide-y divide-brand-border rounded-xl border border-brand-border bg-brand-bg/60">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <MatchLink homeTeam={r.homeTeam} awayTeam={r.awayTeam} kickoff={r.kickoff} />
                  <div className="mt-0.5 text-xs text-gray-500">
                    {r.market}
                    {r.kickoff ? ` · ${new Date(r.kickoff).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
