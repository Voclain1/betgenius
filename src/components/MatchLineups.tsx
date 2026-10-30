import { PremiumPanel } from '@/components/PremiumPanel';
import { TeamCrest } from '@/components/TeamCrest';
import { formationRows, readLineupSnapshot, shirtName, type ConfirmedTeamLineup, type LineupPlayer } from '@/lib/lineups';

/** One player on the pitch: shirt number in a solid disc, short name under it. Home and away differ by the disc's own colour. */
function Marker({ p, side }: { p: LineupPlayer; side: 'home' | 'away' }) {
  return (
    <li className="flex w-[4.5rem] min-w-0 flex-col items-center gap-1 sm:w-24" title={p.name}>
      <span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-black tabular-nums shadow-md shadow-black/30 sm:h-10 sm:w-10 ${side === 'home' ? 'bg-brand text-on-brand' : 'bg-gray-100 text-brand-bg'}`}>
        {p.number ?? '·'}
      </span>
      <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-gray-100 sm:text-xs">{shirtName(p.name)}</span>
    </li>
  );
}

function TeamBar({ t, side }: { t: ConfirmedTeamLineup; side: 'home' | 'away' }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <TeamCrest teamApiId={t.teamId} name={t.teamName} size={24} />
        <span className="truncate text-sm font-black tracking-tight text-gray-100">{t.teamName}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${side === 'home' ? 'bg-brand' : 'bg-gray-100'}`} />
        {t.formation && <span className="text-sm font-black tabular-nums text-gray-300">{t.formation}</span>}
      </div>
    </div>
  );
}

/**
 * Both XIs on one pitch, as the provider's formation places them: the away
 * side at the top attacking down, the home side at the bottom attacking up,
 * forwards meeting at the halfway line. Rows come from formationRows(), which
 * uses the provider's own pitch slots and otherwise the formation string over
 * the provider's line-by-line order; it returns null rather than guess, and
 * the plain list below is shown instead.
 */
function Pitch({ home, away, homeRows, awayRows }: { home: ConfirmedTeamLineup; away: ConfirmedTeamLineup; homeRows: LineupPlayer[][]; awayRows: LineupPlayer[][] }) {
  const line = 'pointer-events-none absolute border-gray-100/15';
  return (
    <div aria-hidden className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-brand-border bg-brand-card">
      <TeamBar t={away} side="away" />
      <div
        className="relative"
        style={{ backgroundImage: 'repeating-linear-gradient(180deg, rgb(var(--brand) / 0.09) 0 56px, rgb(var(--brand) / 0.04) 56px 112px)' }}
      >
        {/* Markings: touchline box, halfway line, centre circle, both penalty areas and goal areas. */}
        <div className={`${line} inset-3 rounded-md border`} />
        <div className={`${line} inset-x-3 top-1/2 border-t`} />
        <div className={`${line} left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border`} />
        <div className={`${line} left-1/2 top-3 h-[13%] w-[54%] -translate-x-1/2 border border-t-0`} />
        <div className={`${line} left-1/2 top-3 h-[5%] w-[26%] -translate-x-1/2 border border-t-0`} />
        <div className={`${line} bottom-3 left-1/2 h-[13%] w-[54%] -translate-x-1/2 border border-b-0`} />
        <div className={`${line} bottom-3 left-1/2 h-[5%] w-[26%] -translate-x-1/2 border border-b-0`} />

        <div className="relative flex flex-col gap-4 px-2 py-6 sm:gap-5 sm:px-6">
          {/* Away: goalkeeper at the top, lines downward; columns mirrored, as seen from the other end. */}
          {awayRows.map((row, i) => (
            <ol key={`a${i}`} className="flex justify-around">
              {[...row].reverse().map((p) => <Marker key={p.id} p={p} side="away" />)}
            </ol>
          ))}
          <div className="h-6 sm:h-8" />
          {/* Home: forwards nearest halfway, goalkeeper at the bottom. */}
          {[...homeRows].reverse().map((row, i) => (
            <ol key={`h${i}`} className="flex justify-around">
              {row.map((p) => <Marker key={p.id} p={p} side="home" />)}
            </ol>
          ))}
        </div>
      </div>
      <TeamBar t={home} side="home" />
    </div>
  );
}

function PlainList({ t }: { t: ConfirmedTeamLineup }) {
  return (
    <div className="min-w-0 rounded-3xl border border-brand-border bg-brand-card p-5">
      <h3 className="flex items-center gap-2.5 font-black tracking-tight text-gray-100">
        <TeamCrest teamApiId={t.teamId} name={t.teamName} size={22} />
        <span className="truncate">{t.teamName}</span>
        {t.formation && <span className="ml-auto shrink-0 tabular-nums text-gray-400">{t.formation}</span>}
      </h3>
      <ol className="mt-3 divide-y divide-brand-border">
        {t.starters.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-6 shrink-0 font-bold tabular-nums text-gray-400">{p.number ?? '—'}</span>
            <span className="min-w-0 break-words text-gray-100">{p.name}</span>
            {p.position && <span className="ml-auto text-xs text-gray-500">{p.position}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

type LineupsProps = {raw:unknown;fixtureApiId:number|null;homeId:number|null;awayId:number|null;kickoff:Date;supported?:boolean;now?:Date};

export function MatchLineups(props: LineupsProps) {
  return <PremiumPanel bare kicker="Teams" title="Starting lineups" id="lineups"><MatchLineupsBody {...props} /></PremiumPanel>;
}

/** The pitch (or its fallbacks) without a section heading, for a panel that carries its own. */
export function MatchLineupsBody({raw,fixtureApiId,homeId,awayId,kickoff,supported=true,now=new Date()}: LineupsProps) {
  const snapshot=readLineupSnapshot(raw);
  const stale=kickoff>now && !!snapshot?.fetchedAt && now.getTime()-Date.parse(snapshot.fetchedAt)>2*60*60_000;
  const confirmed=!stale && snapshot?.status==='confirmed' && snapshot.fixtureApiId===fixtureApiId && snapshot.teams?.some(t=>t.teamId===homeId) && snapshot.teams.some(t=>t.teamId===awayId) ? snapshot : null;
  const home=confirmed?.teams!.find(t=>t.teamId===homeId);
  const away=confirmed?.teams!.find(t=>t.teamId===awayId);
  const homeRows=home?formationRows(home):null;
  const awayRows=away?formationRows(away):null;
  return <>
    {confirmed && home && away ? <>
      {homeRows && awayRows ? <>
        <Pitch home={home} away={away} homeRows={homeRows} awayRows={awayRows} />
        {/* The pitch is drawn for the eye; this is the same XI for a screen reader. */}
        <div className="sr-only">{[home, away].map(t=><div key={t.teamId}><h3>{t.teamName}{t.formation?` · ${t.formation}`:''}</h3><ol>{t.starters.map(p=><li key={p.id}>{p.number??'—'} {p.name}{p.position?` (${p.position})`:''}</li>)}</ol></div>)}</div>
      </> : <div className="grid gap-4 md:grid-cols-2">{[home, away].map(t=><PlainList key={t.teamId} t={t} />)}</div>}

      {(home.substitutes.length>0||away.substitutes.length>0)&&<div className="mt-4 grid gap-4 md:grid-cols-2">{[home, away].map(t=><details key={t.teamId} className="group rounded-3xl border border-brand-border bg-brand-card px-5 py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-gray-100">
          <span className="flex min-w-0 items-center gap-2"><TeamCrest teamApiId={t.teamId} name={t.teamName} size={18} /><span className="truncate">{t.teamName}</span></span>
          <span className="shrink-0 text-xs font-semibold text-gray-400">Substitutes ({t.substitutes.length}) <span aria-hidden className="inline-block transition-transform group-open:rotate-180">▾</span></span>
        </summary>
        <ul className="mt-3 divide-y divide-brand-border">{t.substitutes.map(p=><li key={p.id} className="flex gap-3 py-2 text-sm"><span className="w-6 shrink-0 font-bold tabular-nums text-gray-400">{p.number??'—'}</span><span className="min-w-0 break-words text-gray-300">{p.name}</span>{p.position&&<span className="ml-auto text-xs text-gray-500">{p.position}</span>}</li>)}</ul>
      </details>)}</div>}

      <p className="mt-3 text-xs leading-relaxed text-gray-500">Starting XIs reported by API-Football, fetched {new Date(confirmed.fetchedAt!).toLocaleString('en-GB',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'})} WAT. These are reported lineups, not predicted selections. Late changes may follow.</p>
    </> : <div className="rounded-3xl border border-brand-border bg-brand-card p-5"><p className="text-sm text-gray-400">{stale?'Previously reported lineups are more than two hours old and are withheld until refreshed.':!supported?'Starting-lineup coverage is unavailable for this competition.':kickoff<=now?'No complete starting XIs were captured for this match.':snapshot?.status==='unavailable'?'Lineup data is temporarily unavailable. No predicted XI is substituted.':'Complete starting XIs have not been received for this match. Check again nearer kickoff.'}</p></div>}
  </>;
}
