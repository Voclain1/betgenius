import type { TeamDigest } from "@/lib/ai/digest";
import { computeFormRating } from "@/lib/form";
import { FormRatingBadge } from "@/components/FormRatingBadge";
import { PremiumPanel } from "@/components/PremiumPanel";

export function MatchRecentResults({ home, away, homeTeam, awayTeam }: { home: TeamDigest | null; away: TeamDigest | null; homeTeam: string; awayTeam: string }) {
  if (!home?.last5.length && !away?.last5.length) return null;
  return <PremiumPanel kicker="Form" title="Recent form and results" id="form">
    <p className="mb-4 text-xs text-gray-400">Up to five completed matches across all competitions, newest first. Scores are shown from the named team’s perspective; H/A identifies the venue. This rating does not account for opponent strength.</p>
    <div className="grid gap-6 md:grid-cols-2">
      {([{ name: homeTeam, digest: home }, { name: awayTeam, digest: away }]).map(({name,digest}) => {
        const rows = [...(digest?.last5 ?? [])].filter(f => /^[WDL]$/.test(f.result)).sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);
        const rating = computeFormRating(rows);
        return <div key={name} className="min-w-0 space-y-3">
          {rating ? <FormRatingBadge rating={rating} label={name} /> : <h3 className="font-bold">{name}</h3>}
          {!rows.length ? <p className="text-sm text-gray-400">Recent results unavailable.</p> : <>
            <p className="text-xs text-gray-500">Sample: {rows[rows.length-1].date.slice(0,10)} to {rows[0].date.slice(0,10)} · {rows.length} matches</p>
            <ul className="divide-y divide-brand-border">{rows.map((f,i) => <li key={`${f.date}-${i}`} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><time className="text-xs text-gray-400">{f.date.slice(0,10)}</time><span className="text-xs text-gray-400">{f.venue === 'home' ? 'H' : 'A'} · {f.result}</span></div>
              <div className="mt-1 flex justify-between gap-2"><span className="min-w-0 break-words">{f.opponent}</span><strong className="shrink-0 tabular-nums">{f.goalsFor == null || f.goalsAgainst == null ? 'Score unavailable' : `${f.goalsFor}–${f.goalsAgainst}`}</strong></div>
              <p className="text-xs text-gray-500">{f.competition ?? 'Competition not recorded'}</p>
            </li>)}</ul>
          </>}
        </div>;
      })}
    </div>
  </PremiumPanel>;
}
