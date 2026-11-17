/** One-off forward assessment: database SELECTs and pure rules only. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {lagosDateKey,lagosDayBounds} from '../src/lib/lagosDate';
import {planVipPremiumCandidates,qualifyVipPremiumTargets,paidScopeFor,spareQuotaSlotsByDay,spareQuotaWideningMode,readVipPremiumAttempt,attemptKickoffDay,attemptsByKickoffDay,vipPremiumOddsDiagnostic,PAID_CORE_LEAGUE_IDS,PAID_ANY_LEAGUE_IDS,VIP_PREMIUM_BACKOFF_LOCK_PREFIX} from '../src/lib/vipPremiumOverlay';
import {paidFixtureReadiness} from '../src/lib/vipPremiumReadiness';
import {lopsidednessSignal} from '../src/lib/marketConfirmed';
import type {FixtureOdds} from '../src/lib/odds';
const H=3600000,D=24*H;
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const ssh=(command:string)=>execFileSync('ssh',['-o','BatchMode=yes','vps',command],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
const emit=(kind:string,data:object)=>console.log(JSON.stringify({kind,...data}));
let db:PrismaClient|undefined,stage='runtime';
async function main(){
 const runtime=JSON.parse(ssh('cd /opt/betgenius && docker compose --env-file deploy.env exec -T app node -e '+quote("const e=process.env;console.log(JSON.stringify({off:e.VIP_QUOTA_EXPERIMENT==='off',spare:['off','on','shadow'].includes(e.PAID_SPARE_QUOTA_WIDENING)?e.PAID_SPARE_QUOTA_WIDENING:'off',limit:/^\\d+$/.test(e.API_FOOTBALL_DAILY_LIMIT||'')?Number(e.API_FOOTBALL_DAILY_LIMIT):7500,reserve:/^\\d+$/.test(e.API_FOOTBALL_DAILY_RESERVE||'')?Number(e.API_FOOTBALL_DAILY_RESERVE):100,buildId:e.APP_BUILD_ID}))")));
 assert.equal(runtime.off,true);assert.equal(runtime.buildId,'4d23e7fd2fa369c8557f48c97ab071cf4dc8a4f9');
 const now=new Date(),start=lagosDayBounds(0,now).start,end=lagosDayBounds(7,now).start;
 const days=Array.from({length:7},(_,i)=>lagosDateKey(lagosDayBounds(i,now).start));
 const url=new URL(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL||'');url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
 db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
 stage='read-only-seven-day-snapshot';
 const evidence=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const [guard]=await tx.$queryRawUnsafe<{database:string;read_only:string}[]>("SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only");assert.equal(guard.database,'betgenius');assert.equal(guard.read_only,'on');
  const ledger=await tx.generationAttempt.findMany({where:{kickoff:{gte:start,lt:new Date(+end+D)}},orderBy:{updatedAt:'desc'}});
  const rows=await tx.prediction.findMany({where:{kickoff:{gte:start,lt:end},status:{not:'ARCHIVED'}},select:{id:true,fixtureApiId:true,homeTeamApiId:true,awayTeamApiId:true,kickoff:true,status:true,provenance:true,contextComplete:true}});
  const jobs=await tx.aIJob.findMany({where:{prompt:{contains:'"intent":"VIP_PREMIUM"'}},select:{prompt:true,createdAt:true}});
  const history=jobs.flatMap(j=>{const a=readVipPremiumAttempt(j.prompt,j.createdAt);return a?[a]:[];});
  const reservations=await tx.paidQuotaAttempt.findMany({select:{fixtureApiId:true,kickoffDay:true,spendDay:true,createdAt:true,reservedMicroUsd:true,modelRequests:true,usageReliable:true}});
  const attempts=history.filter(a=>+a.createdAt>=+now-4*D);
  for(const r of reservations)if(!attempts.some(a=>a.fixtureApiId===r.fixtureApiId)){const a=readVipPremiumAttempt(JSON.stringify({intent:'VIP_PREMIUM',fixtureApiId:r.fixtureApiId,kickoff:r.kickoffDay+'T12:00:00+01:00'}),r.createdAt);if(a)attempts.push(a);}
  const historicalIds=new Set([...history.flatMap(a=>a.fixtureApiId===null?[]:[a.fixtureApiId]),...reservations.map(r=>r.fixtureApiId)]);
  const used=attemptsByKickoffDay(attempts),windowFrom=new Date(+now+12*H),windowUntil=new Date(+now+48*H);
  const currentLedger=ledger.filter(l=>l.status==='SUCCEEDED'&&l.fixtureApiId!==null&&l.kickoff>=windowFrom&&l.kickoff<=windowUntil);
  const locks=await tx.appLock.findMany({where:{key:{startsWith:VIP_PREMIUM_BACKOFF_LOCK_PREFIX},expiresAt:{gt:now}},select:{key:true}});
  const backingOff=new Set(locks.map(l=>Number(l.key.slice(VIP_PREMIUM_BACKOFF_LOCK_PREFIX.length))));
  const slots=spareQuotaSlotsByDay({days:ledger.map(l=>lagosDateKey(l.kickoff)),coreLedger:ledger,attempted:new Set(attempts.flatMap(a=>a.fixtureApiId===null?[]:[a.fixtureApiId])),used,quota:8,now});
  const plan=planVipPremiumCandidates({ledger:currentLedger,rows,attempts,backingOff,now,scope:paidScopeFor(currentLedger,now),spareQuota:{mode:spareQuotaWideningMode({PAID_SPARE_QUOTA_WIDENING:runtime.spare}),slots}});
  const quotes=await tx.fixtureOddsCache.findMany({where:{matchKey:{in:ledger.map(l=>l.matchKey)}},select:{matchKey:true,oddsJson:true,fetchedAt:true,lastAttemptAt:true,lastError:true}});
  const qm=new Map(quotes.map(q=>[q.matchKey,{oddsJson:q.oddsJson as unknown as FixtureOdds|null,fetchedAt:q.fetchedAt,lastAttemptAt:q.lastAttemptAt,lastError:q.lastError}]));
  const uncapped=qualifyVipPremiumTargets(plan.candidates,qm,now,plan.candidates.length,undefined,slots);
  const eligible=uncapped.targets.filter(t=>!historicalIds.has(t.fixtureApiId));
  const baseline=qualifyVipPremiumTargets(plan.candidates,qm,now,plan.candidates.length,{used,quota:8},slots);
  const ready=paidFixtureReadiness(attempts.map(a=>({day:attemptKickoffDay(a),fixtureApiId:a.fixtureApiId})),eligible.map(t=>({day:lagosDateKey(t.kickoff),fixtureApiId:t.fixtureApiId})));
  const observations=plan.candidates.map(c=>({...vipPremiumOddsDiagnostic(c,qm.get(c.matchKey),now),matchKey:c.matchKey}));
  type Scheduled={fixtureApiId:number;kickoff:Date;leagueApiId:number;source:string;cacheAt:Date|null;home:string;away:string};
  const calendar=new Map<number,Scheduled>();const conflicts=new Set<number>();
  function remember(s:Scheduled){if(!Number.isSafeInteger(s.fixtureApiId)||s.fixtureApiId<=0||!Number.isFinite(+s.kickoff)||s.kickoff<start||s.kickoff>=end)return;const previous=calendar.get(s.fixtureApiId);if(previous&&Math.abs(+previous.kickoff-+s.kickoff)>60000)conflicts.add(s.fixtureApiId);if(!previous)calendar.set(s.fixtureApiId,s);}
  const leagues=await tx.leagueEnrichmentCache.findMany({where:{upcomingJson:{not:null as any}},select:{leagueApiId:true,upcomingJson:true,fetchedAt:true}});
  for(const l of leagues)for(const f of Array.isArray(l.upcomingJson)?l.upcomingJson as any[]:[]){if(typeof f.id==='number'&&typeof f.date==='string')remember({fixtureApiId:f.id,kickoff:new Date(f.date),leagueApiId:l.leagueApiId,source:'cached-league-schedule',cacheAt:l.fetchedAt,home:typeof f.homeTeam==='string'?f.homeTeam:'',away:typeof f.awayTeam==='string'?f.awayTeam:''});}
  const fixtures=await tx.fixture.findMany({where:{kickoff:{gte:start,lt:end}},select:{apiId:true,kickoff:true,status:true,updatedAt:true,league:{select:{apiId:true}},homeTeam:{select:{name:true}},awayTeam:{select:{name:true}}}});
  const nonPrematch=new Set(fixtures.filter(f=>!['NS','TBD'].includes(f.status)).map(f=>f.apiId));
  for(const f of fixtures)if(f.status==='NS')remember({fixtureApiId:f.apiId,kickoff:f.kickoff,leagueApiId:f.league.apiId,source:'stored-fixture',cacheAt:f.updatedAt,home:f.homeTeam.name,away:f.awayTeam.name});
  for(const l of ledger)if(l.fixtureApiId&&l.leagueApiId)remember({fixtureApiId:l.fixtureApiId,kickoff:l.kickoff,leagueApiId:l.leagueApiId,source:'generation-ledger',cacheAt:l.updatedAt,home:l.homeTeam,away:l.awayTeam});
  const inventory=[...calendar.values()].filter(f=>!conflicts.has(f.fixtureApiId)&&!nonPrematch.has(f.fixtureApiId));
  const unique=(ids:(number|null)[])=>[...new Set(ids.filter((id):id is number=>id!==null&&Number.isSafeInteger(id)&&id>0))];
  const counts=days.map(day=>{
   const covered=ledger.filter(l=>l.status==='SUCCEEDED'&&lagosDateKey(l.kickoff)===day);
   const previous=history.filter(a=>attemptKickoffDay(a)===day);
   const observed=observations.filter(o=>o.kickoffDay===day);
   const d=ready.find(d=>d.day===day);
   const scheduled=inventory.filter(f=>lagosDateKey(f.kickoff)===day&&PAID_ANY_LEAGUE_IDS.includes(f.leagueApiId));
   const reachable=scheduled.filter(f=>+f.kickoff>+now+12*H&&!historicalIds.has(f.fixtureApiId));
   const fresh=observed.filter(o=>o.cacheState==='FRESH');
   const previousIds=unique([...previous.map(a=>a.fixtureApiId),...reservations.filter(r=>r.kickoffDay===day).map(r=>r.fixtureApiId)]);
   const potentialIds=unique([...previousIds,...reachable.map(f=>f.fixtureApiId)]);
   return {day,distinctCovered:unique(covered.map(l=>l.fixtureApiId)).length,coveredPaidScope:unique(covered.filter(l=>PAID_ANY_LEAGUE_IDS.includes(l.leagueApiId??-1)).map(l=>l.fixtureApiId)).length,previouslyAttemptedDistinct:previousIds.length,previouslyAttemptedIds:previousIds,attemptRecordsCharged:used.get(day)??0,inCurrentGenerationWindow:unique(plan.candidates.filter(c=>lagosDateKey(c.kickoff)===day).map(c=>c.fixtureApiId)).length,awaitingPermittedWarming:unique(observed.filter(o=>o.cacheState!=='FRESH').map(o=>o.fixtureApiId)).length,waitingUntil24h:unique(observed.filter(o=>o.cacheState!=='FRESH'&&o.warmReason==='OUTSIDE_WARMING_WINDOW').map(o=>o.fixtureApiId)).length,warmingDueNow:unique(observed.filter(o=>o.cacheState!=='FRESH'&&o.warmReason==='DUE').map(o=>o.fixtureApiId)).length,fetchBackoff:unique(observed.filter(o=>o.warmReason==='FETCH_BACKOFF').map(o=>o.fixtureApiId)).length,freshBookmakerQualified:unique(fresh.filter(o=>o.signal!==null).map(o=>o.fixtureApiId)).length,freshMarketQualityFailures:unique(fresh.filter(o=>o.marketState!=='MEETS_MARKET_FLOOR').map(o=>o.fixtureApiId)).length,eligibleUnattempted:unique(eligible.filter(t=>lagosDateKey(t.kickoff)===day).map(t=>t.fixtureApiId)).length,eligibleFixtureIds:unique(eligible.filter(t=>lagosDateKey(t.kickoff)===day).map(t=>t.fixtureApiId)),baselineEligible:unique(baseline.targets.filter(t=>lagosDateKey(t.kickoff)===day).map(t=>t.fixtureApiId)).length,uniqueUsedPlusCurrentlyEligible:d?.uniqueUsedPlusEligible??previousIds.length,confirmedRich:d?.fixtureRich??false,cachedScheduledPaid:scheduled.length,cachedScheduledCore:scheduled.filter(f=>PAID_CORE_LEAGUE_IDS.includes(f.leagueApiId)).length,reachableUnattemptedScheduled:reachable.length,calendarUpperBoundUsedPlusPotential:potentialIds.length,calendarCoreUpperBoundUsedPlusPotential:unique([...previousIds,...reachable.filter(f=>PAID_CORE_LEAGUE_IDS.includes(f.leagueApiId)).map(f=>f.fixtureApiId)]).length,calendarCacheOldestAgeHours:scheduled.length?Math.max(...scheduled.map(f=>f.cacheAt?(+now-+f.cacheAt)/H:Infinity)):null};
  });
  const potentialDays=counts.filter(d=>d.calendarUpperBoundUsedPlusPotential>=10&&d.reachableUnattemptedScheduled>0);
  const baselineDays=counts.filter(d=>d.calendarCoreUpperBoundUsedPlusPotential>=10&&d.reachableUnattemptedScheduled>0);
  const today=history.filter(a=>lagosDateKey(a.createdAt)===lagosDateKey(now));const extra=reservations.filter(r=>r.spendDay===lagosDateKey(now));
  const charges=today.length+extra.filter(r=>!today.some(a=>a.fixtureApiId===r.fixtureApiId)).length;
  const usage=await tx.apiUsage.findMany({where:{day:now.toISOString().slice(0,10)}});const apiCalls=usage.reduce((s,r)=>s+r.count,0);
  const recent=await tx.jobRun.findMany({where:{job:'generate-vip-premium',ranAt:{gte:new Date(+now-7*D)}},select:{ranAt:true,ok:true,detail:true}});
  return {at:now,rangeStart:start,rangeEndExclusive:end,days:counts,currentWindow:{from:windowFrom,until:windowUntil,scopeWidened:plan.widened,skipped:plan.skipped,quoteSkips:uncapped.skipped,observations},conditionalCalendar:{earliestAnyScope:potentialDays[0]?.day??null,earliestCore:baselineDays[0]?.day??null,conflictingScheduleIds:[...conflicts],inventory:inventory.filter(f=>PAID_ANY_LEAGUE_IDS.includes(f.leagueApiId)).map(f=>({...f,core:PAID_CORE_LEAGUE_IDS.includes(f.leagueApiId),covered:ledger.some(l=>l.status==='SUCCEEDED'&&l.fixtureApiId===f.fixtureApiId),previouslyAttempted:historicalIds.has(f.fixtureApiId),generationOpens:new Date(+f.kickoff-48*H),warmingOpens:new Date(+f.kickoff-24*H),generationCloses:new Date(+f.kickoff-12*H)}))},budget:{creationDay:lagosDateKey(now),creationDayCharges:charges,creationSlotsRemaining:Math.max(0,12-charges),apiUtcDay:now.toISOString().slice(0,10),apiCalls,apiCeiling:Math.min(runtime.limit,7500),paidApiHeadroom:Math.max(0,Math.min(runtime.limit,7500)-runtime.reserve-apiCalls),experimentalReservedUsd:extra.reduce((s,r)=>s+r.reservedMicroUsd,0)/1e6},sevenDayCycles:{runs:recent.length,failed:recent.filter(r=>!r.ok).length,publishedObservations:recent.reduce((s,r)=>s+(Number((r.detail as any)?.vipPremium?.published)||0),0)},runtime,readOnly:guard.read_only,productionWritten:false,providerCalls:0,quotesWarmed:0};
 },{isolationLevel:'RepeatableRead',timeout:90000,maxWait:15000});
 emit('seven_day_supply_assessment',evidence);
}
main().catch(()=>{emit('assessment_failed',{stage,valuesWithheld:true});process.exitCode=1;}).finally(()=>db?.$disconnect());
