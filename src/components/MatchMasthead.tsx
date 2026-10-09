import Link from "next/link";
import { TeamCrest } from "@/components/TeamCrest";
import { LeagueBadge } from "@/components/LeagueBadge";
import { teamCrestUrl } from "@/lib/leagues";
import { leagueSlug, teamSlug } from "@/lib/slug";

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const FACT_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

function Side({ name, teamApiId }: { name: string; teamApiId: number | null }) {
  return (
    <Link href={`/predictions/team/${teamSlug(name)}`} aria-label={name} className="group flex min-w-0 flex-col items-center gap-3 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-b from-brand-bg to-brand-card shadow-inner ring-1 ring-brand-border transition group-hover:ring-brand/60 sm:h-28 sm:w-28">
        <TeamCrest teamApiId={teamApiId} size={64} />
      </span>
    </Link>
  );
}

/**
 * The match page hero, in the team and competition pages' language: both
 * crests facing each other over a soft glow, the kickoff between them, the
 * fixture's facts in a stats strip underneath. Carries the page's one <h1>.
 */
export function MatchMasthead({
  homeTeam,
  awayTeam,
  homeTeamApiId,
  awayTeamApiId,
  kickoff,
  leagueName,
  leagueApiId,
  round,
  venue,
  city,
  referee,
  status,
  children,
}: {
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
  kickoff: Date;
  leagueName: string | null;
  leagueApiId: number | null;
  round?: string | null;
  venue?: string | null;
  city?: string | null;
  referee?: string | null;
  /** Live score / kickoff status line. */
  status?: React.ReactNode;
  /** Follow buttons and attribution, under the facts. */
  children?: React.ReactNode;
}) {
  const facts: [string, string][] = [["Kickoff", DAY.format(kickoff)]];
  if (round) facts.push(["Round", round]);
  if (venue) facts.push(["Venue", city ? `${venue}, ${city}` : venue]);
  if (referee) facts.push(["Referee", referee]);

  const league = (
    <>
      <LeagueBadge leagueApiId={leagueApiId} leagueName={leagueName} showName={false} size={18} />
      <span className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-gray-300">{leagueName ?? "Fixture"}</span>
    </>
  );

  return (
    <header className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      {/* Both crests, oversized and faded, as the backdrop. */}
      {homeTeamApiId != null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img aria-hidden src={teamCrestUrl(homeTeamApiId)} alt="" className="pointer-events-none absolute -left-12 -top-10 h-56 w-56 select-none object-contain opacity-[0.06] sm:h-72 sm:w-72" />
      )}
      {awayTeamApiId != null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img aria-hidden src={teamCrestUrl(awayTeamApiId)} alt="" className="pointer-events-none absolute -right-12 -top-10 h-56 w-56 select-none object-contain opacity-[0.06] sm:h-72 sm:w-72" />
      )}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-16 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.16),transparent)]" />

      <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pt-7">
        <div className="flex justify-center">
          {leagueName ? (
            <Link href={`/predictions/league/${leagueSlug(leagueName, leagueApiId)}`} className="inline-flex max-w-full items-center gap-2 hover:opacity-80">
              {league}
            </Link>
          ) : (
            <span className="inline-flex max-w-full items-center gap-2">{league}</span>
          )}
        </div>

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
          <Side name={homeTeam} teamApiId={homeTeamApiId} />
          <div className="text-center">
            <div className="text-4xl font-black tabular-nums tracking-tight text-gray-100 sm:text-5xl">{TIME.format(kickoff)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">WAT</div>
          </div>
          <Side name={awayTeam} teamApiId={awayTeamApiId} />
        </div>

        {/* One natural phrase: the team names stay linked inside the heading. */}
        <h1 className="mt-5 text-center text-2xl font-black leading-tight tracking-tight text-gray-100 sm:text-4xl">
          <Link href={`/predictions/team/${teamSlug(homeTeam)}`} className="hover:text-brand">
            {homeTeam}
          </Link>{" "}
          <span className="font-bold text-gray-500">vs</span>{" "}
          <Link href={`/predictions/team/${teamSlug(awayTeam)}`} className="hover:text-brand">
            {awayTeam}
          </Link>{" "}
          <span className="block text-base font-bold tracking-normal text-gray-400 sm:inline sm:text-4xl sm:tracking-tight">prediction</span>
        </h1>
        {status && <div className="mt-3 flex justify-center">{status}</div>}
      </div>

      {/* Hairlines from a 1px gap over the border colour, so a wrapped 2x2 grid is ruled both ways. */}
      <dl className={`relative grid gap-px border-t border-brand-border bg-brand-border ${FACT_COLS[facts.length] ?? FACT_COLS[4]}`}>
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-brand-card px-3 py-3.5 text-center">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-bold leading-snug text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>

      {children && <div className="relative space-y-3 border-t border-brand-border px-5 py-4">{children}</div>}
    </header>
  );
}
