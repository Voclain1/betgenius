import { PremiumPanel } from '@/components/PremiumPanel';
import { readLineupSnapshot } from '@/lib/lineups';

export function MatchLineups({raw,fixtureApiId,homeId,awayId,kickoff,supported=true,now=new Date()}: {raw:unknown;fixtureApiId:number|null;homeId:number|null;awayId:number|null;kickoff:Date;supported?:boolean;now?:Date}) {
  const snapshot=readLineupSnapshot(raw);
  const stale=kickoff>now && !!snapshot?.fetchedAt && now.getTime()-Date.parse(snapshot.fetchedAt)>2*60*60_000;
  const confirmed=!stale && snapshot?.status==='confirmed' && snapshot.fixtureApiId===fixtureApiId && snapshot.teams?.some(t=>t.teamId===homeId) && snapshot.teams.some(t=>t.teamId===awayId) ? snapshot : null;
  return <PremiumPanel kicker="Teams" title="Starting lineups" id="lineups">
    {confirmed ? <>
      <p className="mb-4 text-xs text-gray-400">Starting XIs reported by API-Football, fetched {new Date(confirmed.fetchedAt!).toLocaleString('en-GB',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'})} WAT. These are reported lineups, not predicted selections. Late changes may follow.</p>
      <div className="grid gap-6 md:grid-cols-2">{confirmed.teams!.map(t=><div key={t.teamId} className="min-w-0">
        <h3 className="font-bold">{t.teamName}{t.formation?` · ${t.formation}`:''}</h3>
        <ol className="mt-2 divide-y divide-brand-border">{t.starters.map(p=><li key={p.id} className="flex gap-3 py-1.5 text-sm"><span className="w-6 shrink-0 text-gray-400">{p.number??'—'}</span><span className="min-w-0 break-words">{p.name}</span>{p.position&&<span className="ml-auto text-xs text-gray-500">{p.position}</span>}</li>)}</ol>
        {!!t.substitutes.length&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-brand">Substitutes ({t.substitutes.length})</summary><ul className="mt-2 space-y-1 text-gray-400">{t.substitutes.map(p=><li key={p.id}>{p.number??'—'} · {p.name}</li>)}</ul></details>}
      </div>)}</div>
    </> : <p className="text-sm text-gray-400">{stale?'Previously reported lineups are more than two hours old and are withheld until refreshed.':!supported?'Starting-lineup coverage is unavailable for this competition.':kickoff<=now?'No complete starting XIs were captured for this match.':snapshot?.status==='unavailable'?'Lineup data is temporarily unavailable. No predicted XI is substituted.':'Complete starting XIs have not been received for this match. Check again nearer kickoff.'}</p>}
  </PremiumPanel>;
}
