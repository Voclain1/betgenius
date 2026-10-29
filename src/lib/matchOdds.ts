import { HEADLINE_MARKETS, type FixtureOdds } from '@/lib/odds';
export const MATCH_ODDS_MAX_AGE_MS=2*60*60_000;
export function matchOddsState(input:{odds:FixtureOdds|null;fetchedAt:Date|null;kickoff:Date;now?:Date}) {
  const now=input.now??new Date(), odds=input.odds;
  if (!odds?.markets?.some(m => (HEADLINE_MARKETS as readonly string[]).includes(m.market) && m.selections.some(s => Number.isFinite(s.best) && s.best > 1 && s.bookmakers > 0)) || !input.fetchedAt) return {state:'unavailable' as const, asOf:null};
  // If the provider timestamp is present, it controls age. Fetching an old
  // quote again must never make it appear new.
  const asOf=odds.update?new Date(odds.update):input.fetchedAt;
  if (!Number.isFinite(asOf.getTime()) || asOf>now || asOf>input.kickoff) return {state:'unavailable' as const,asOf:null};
  if (input.kickoff<=now) return {state:'archived' as const,asOf};
  return {state:now.getTime()-asOf.getTime()>MATCH_ODDS_MAX_AGE_MS?'stale' as const:'current' as const,asOf};
}
