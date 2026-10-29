import { PremiumPanel } from '@/components/PremiumPanel';
import { HEADLINE_MARKETS, type FixtureOdds } from '@/lib/odds';
import { matchOddsState } from '@/lib/matchOdds';

export function MatchOddsPanel({odds,fetchedAt,kickoff,now=new Date()}: {odds:FixtureOdds|null;fetchedAt:Date|null;kickoff:Date;now?:Date}) {
  const status=matchOddsState({odds,fetchedAt,kickoff,now});
  const usable=status.state==='current'||status.state==='archived';
  const markets=(odds?.markets??[]).filter(m=>(HEADLINE_MARKETS as readonly string[]).includes(m.market));
  return <PremiumPanel kicker="Prices" title={status.state==='archived'?'Archived pre-match odds':'Bookmaker odds comparison'} id="odds">
    {!usable?<p className="text-sm text-gray-400">{status.state==='stale'?'Cached odds are more than two hours old and are withheld until refreshed.':'No usable bookmaker quotes are available for this fixture.'}</p>:<>
      <p className="mb-4 text-xs text-gray-400">{odds?.update?'Provider quote time':'Cache fetch time (provider timestamp unavailable)'}: {status.asOf!.toLocaleString('en-GB',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'})} WAT. Decimal prices. {status.state==='archived'?'Historical quotes, not current offers.':'Prices can change; verify availability with the bookmaker.'} Coverage varies by selection; these are cached quotes, not a complete market survey.</p>
      <div className="space-y-5">{markets.map(m=><div key={m.market} className="min-w-0"><h3 className="mb-2 text-sm font-bold">{m.market}</h3><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-gray-400"><tr><th className="p-2">Selection</th><th className="p-2">Best quote</th><th className="p-2">Median / books</th></tr></thead><tbody>{m.selections.filter(s=>Number.isFinite(s.best)&&s.best>1&&s.bookmakers>0).map(s=><tr key={s.value} className="border-t border-brand-border align-top"><th className="p-2 font-semibold">{s.value}</th><td className="p-2"><strong>{s.best.toFixed(2)}</strong> · {s.bestBookmaker}{!!s.quotes?.length&&<details className="mt-1"><summary className="cursor-pointer text-brand">Named quotes ({s.quotes.length})</summary><ul className="mt-1 space-y-1">{s.quotes.map((q,i)=><li key={`${q.bookmaker}-${i}`}>{q.bookmaker}: {q.odd.toFixed(2)}</li>)}</ul></details>}</td><td className="p-2">{s.median.toFixed(2)} / {s.bookmakers}</td></tr>)}</tbody></table></div></div>)}</div>
      <p className="mt-4 text-xs text-gray-500">Bookmaker prices are separate from BetGenius confidence ratings. No opening price or odds movement is inferred from a single snapshot.</p>
    </>}
  </PremiumPanel>;
}
