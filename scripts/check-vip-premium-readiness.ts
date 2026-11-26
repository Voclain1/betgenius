/** Pure regression tests: no database, HTTP or model calls. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {vipPremiumOddsDiagnostic,vipPremiumOddsToWarm,vipPremiumOddsWarmReason,VIP_PREMIUM_WARM_WITHIN_MS,VIP_PREMIUM_WARM_RETRY_MS,type OverlayCandidate,type OverlayQuote} from '../src/lib/vipPremiumOverlay';
import {paidFixtureReadiness,summarisePaidOdds,paidPublicationOutcome,PAID_ODDS_SAMPLE_LIMIT} from '../src/lib/vipPremiumReadiness';
import {PAID_BASE_DAILY_ATTEMPTS} from '../src/lib/vipQuotaExperiment';
import type {FixtureOdds} from '../src/lib/odds';
const H=3600000,now=new Date('2026-11-16T10:00:00Z'),day='2026-11-17';
// Production probe must return presence only, and withhold malformed values.
const probeText=execFileSync(process.execPath,['scripts/ops/paid-supply-config-probe.mjs'],{encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:'secret-sentinel',DATABASE_URL:'secret-url-sentinel',VIP_QUOTA_INPUT_USD_PER_MILLION:'secret-invalid-rate',VIP_QUOTA_EXPERIMENT:'off'}});
const probe=JSON.parse(probeText);
assert.equal(probe.anthropicKeyPresent,true); assert.equal(probe.VIP_QUOTA_EXPERIMENT,'off');
assert.equal(probe.VIP_QUOTA_INPUT_USD_PER_MILLION,'(invalid; value withheld)');
assert.ok(!probeText.includes('secret-')); assert.equal(probe.DATABASE_URL,undefined);
const c=(id=1,h=20)=>({fixtureApiId:id,kickoff:new Date(+now+h*H),matchKey:`test-${id}`} as OverlayCandidate);
function odds(p=.82,books=6):FixtureOdds {
 const selections=[['Home',p],['Draw',(1-p)*.6],['Away',(1-p)*.4]].map(([value,p])=>({value,bookmakers:books,median:1/Number(p),best:1/Number(p),bestBookmaker:'test'}));
 return {bookmakerCount:books,markets:[{market:'Match Winner',selections}]} as FixtureOdds;
}
const q=(age=0.5,lastAge:number|null=null)=>({oddsJson:odds(),fetchedAt:new Date(+now-age*H),lastAttemptAt:lastAge===null?null:new Date(+now-lastAge*H)});
assert.equal(vipPremiumOddsDiagnostic(c(),undefined,now).cacheState,'MISSING_CACHE');
assert.equal(vipPremiumOddsDiagnostic(c(),{oddsJson:null,fetchedAt:null,lastAttemptAt:null},now).cacheState,'NO_SUCCESSFUL_QUOTE');
assert.equal(vipPremiumOddsDiagnostic(c(),q(2.01),now).cacheState,'STALE');
assert.equal(vipPremiumOddsDiagnostic(c(),q(2),now).cacheState,'FRESH');
assert.equal(vipPremiumOddsWarmReason(c(1,24.01),q(3),now),'OUTSIDE_WARMING_WINDOW');
assert.equal(vipPremiumOddsWarmReason(c(),q(3,.99),now),'FETCH_BACKOFF');
assert.equal(vipPremiumOddsWarmReason(c(),q(3,1),now),'DUE');
assert.equal(vipPremiumOddsWarmReason(c(),q(.5,.1),now),'FRESH');
assert.equal(vipPremiumOddsDiagnostic(c(),{...q(),oddsJson:odds(.82,4)},now).marketState,'INSUFFICIENT_BOOKMAKERS');
assert.equal(vipPremiumOddsDiagnostic(c(),{...q(),oddsJson:odds(.4)},now).marketState,'BELOW_MARKET_FLOOR');
assert.equal(vipPremiumOddsDiagnostic(c(),q(),now).marketState,'MEETS_MARKET_FLOOR');
const favourite=vipPremiumOddsDiagnostic(c(),{...q(),oddsJson:odds(.95)},now);
assert.equal(favourite.marketState,'MEETS_MARKET_FLOOR','above 86.96% stays targetable');
for(const [message,category] of [['No bookmaker prices quoted for this fixture yet','NO_BOOKMAKER_PRICES'],['HTTP 429 rate limit secret-should-not-appear','RATE_OR_QUOTA'],['401 invalid token secret-should-not-appear','AUTHORIZATION'],['request timed out secret-should-not-appear','TIMEOUT'],['private arbitrary error secret-should-not-appear','OTHER']] as const){
 const d=vipPremiumOddsDiagnostic(c(),{...q(3,.1),lastError:message},now);assert.equal(d.providerFailure,category);assert.ok(!JSON.stringify(d).includes('secret-should-not-appear'));
}
// Differential check against the pre-refactor warming policy at all boundaries.
let cases=0;
for(const hours of [12,20,24,24.01,48])for(const age of [null,0,1.99,2,2.01,4])for(const last of [null,0,.99,1,1.01,5]){
 const cache=age===null?undefined:q(age,last);const candidate=c(1,hours);
 let legacy=true;
 if(+candidate.kickoff-+now>VIP_PREMIUM_WARM_WITHIN_MS)legacy=false;
 else if(cache?.fetchedAt&&+now-+cache.fetchedAt<=2*H)legacy=false;
 else if(cache?.lastAttemptAt&&(!cache.fetchedAt||cache.lastAttemptAt>cache.fetchedAt)&&+now-+cache.lastAttemptAt<VIP_PREMIUM_WARM_RETRY_MS)legacy=false;
 assert.equal(vipPremiumOddsWarmReason(candidate,cache,now)==='DUE',legacy);cases++;
}
const candidates=Array.from({length:20},(_,i)=>c(i+1));
assert.equal(vipPremiumOddsToWarm(candidates,new Map(),now).length,12,'warming ceiling unchanged');
const d=summarisePaidOdds(candidates.concat(candidates[0]).map(x=>vipPremiumOddsDiagnostic(x,undefined,now)));
assert.equal(d.candidateObservations,21);assert.equal(d.uniqueFixtures,20);assert.equal(d.samples.length,PAID_ODDS_SAMPLE_LIMIT);assert.equal(d.cache.MISSING_CACHE,21);
// Richness = at least two fixtures beyond the base attempts (B = PAID_BASE_DAILY_ATTEMPTS).
const B=PAID_BASE_DAILY_ATTEMPTS;
const used=Array.from({length:B-1},(_,i)=>({day,fixtureApiId:i+1}));
const readiness=paidFixtureReadiness([...used,used[0]],[{day,fixtureApiId:B},{day,fixtureApiId:B+1},{day,fixtureApiId:1}])[0];
assert.equal(readiness.attemptRecords,B);assert.equal(readiness.repeatedIdentityRecords,1);assert.equal(readiness.uniqueUsedPlusEligible,B+1);assert.equal(readiness.fixtureRich,false);
assert.equal(paidFixtureReadiness([...used,used[0]],[{day,fixtureApiId:B},{day,fixtureApiId:B+1},{day,fixtureApiId:B+2}])[0].fixtureRich,true);
const noOutput={evaluated:0,promoted:0,published:0,publishHeld:0,heldForRequote:0,generationFailed:0};
assert.equal(paidPublicationOutcome(noOutput),'NO_GENERATION_OUTPUT');
assert.equal(paidPublicationOutcome({...noOutput,evaluated:2}),'NO_QUALIFYING_DRAFT');
assert.equal(paidPublicationOutcome({...noOutput,evaluated:2,promoted:1,publishHeld:1}),'PUBLICATION_SAFETY_HOLD');
assert.equal(paidPublicationOutcome({...noOutput,heldForRequote:2}),'AWAITING_REQUOTE');
assert.equal(paidPublicationOutcome({...noOutput,promoted:1}),'UNEXPLAINED_PROMOTION_WITHOUT_PUBLICATION');
assert.equal(paidPublicationOutcome({...noOutput,generationFailed:1}),'GENERATION_FAILED');
assert.equal(paidPublicationOutcome({...noOutput,promoted:1,published:1}),'PUBLISHED');
console.log(`paid readiness: identity reconciliation, bounded redacted diagnostics and ${cases} warming-policy differential cases passed`);
