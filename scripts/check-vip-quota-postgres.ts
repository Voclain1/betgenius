/** Destructive only to an explicitly disposable local quota_test database. No providers. */
export {};
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const react=require("react"); if(typeof react.cache!=="function")react.cache=(f:unknown)=>f;
import { prisma } from "../src/lib/prisma";
import { reserveExtraAttempt, runExtraAttempt } from "../src/lib/vipQuotaExperimentStore";
import { quotaExperimentConfig, experimentScope, beforeExperimentalModel } from "../src/lib/vipQuotaExperiment";
import { recordCall, withPaidPriority, hasBudget } from "../src/lib/football/usage";
import { autoPublishVipPremiumPrediction, selectVipPremiumTargets, loadVipPremiumAttempts } from "../src/lib/vipPremiumPipeline";
import { lagosDateKey } from "../src/lib/lagosDate";
import type { VipPremiumTarget } from "../src/lib/vipPremiumOverlay";
async function main(){
 const url=new URL(process.env.DATABASE_URL??"");
 if(!["localhost","127.0.0.1","postgres"].includes(url.hostname)||url.pathname!=="/quota_test")throw new Error("disposable local quota_test database required");
 Object.assign(process.env,{VIP_QUOTA_EXPERIMENT:"on",VIP_QUOTA_EXTRA_ATTEMPTS:"8",VIP_QUOTA_INCREMENTAL_DAILY_USD:"0.056",VIP_QUOTA_INPUT_USD_PER_MILLION:"0.1",VIP_QUOTA_OUTPUT_USD_PER_MILLION:"0.5",VIP_QUOTA_PRICE_VALID_UNTIL:new Date(Date.now()+86400_000).toISOString(),ANTHROPIC_API_KEY:"test-no-network"});
 if (process.argv.includes("--hard-api-ceiling")) {
   await prisma.apiUsage.deleteMany();
   const utc=new Date().toISOString().slice(0,10);
   await prisma.apiUsage.create({data:{day:utc,path:"hard-limit-seed",count:7498}});
   const calls=await withPaidPriority(()=>Promise.allSettled(Array.from({length:8},()=>recordCall("hard-limit-call"))));
   assert.equal(calls.filter(r=>r.status==="fulfilled").length,2);
   assert.equal((await prisma.apiUsage.aggregate({_sum:{count:true}}))._sum.count,7500);
   console.log("hard API limit: 7500 enforced despite larger environment override");
   return;
 }
 const now=new Date(), kickoff=new Date(now.getTime()+20*3600_000), day=lagosDateKey(kickoff);
 const cfg=quotaExperimentConfig()!;
 await prisma.notificationEvent.deleteMany(); await prisma.prediction.deleteMany();
 await prisma.fixtureOddsCache.deleteMany(); await prisma.generationAttempt.deleteMany();
 await prisma.paidQuotaAttempt.deleteMany(); await prisma.aIJob.deleteMany(); await prisma.apiUsage.deleteMany();
 const user=await prisma.user.upsert({where:{email:"quota-test@example.invalid"},create:{email:"quota-test@example.invalid"},update:{}});
 await prisma.aIJob.createMany({data:Array.from({length:8},(_,i)=>({userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:i+1,kickoff:kickoff.toISOString()}),model:"test",rawOutput:"{}"}))});
 const target=(id:number)=>({fixtureApiId:id,kickoff} as VipPremiumTarget);
 const pool=Array.from({length:310},(_,i)=>({day,fixtureApiId:i+100}));
 // Duplicated paid records consume spend, but cannot manufacture a rich day.
 await prisma.aIJob.deleteMany({where:{prompt:{contains:'"fixtureApiId":8,'}}});
 const duplicate=await prisma.aIJob.create({data:{userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:1,kickoff:kickoff.toISOString()}),model:"manual-retry-test",rawOutput:"{}"}});
 const thinProof=[{day,fixtureApiId:100},{day,fixtureApiId:101}];
 const thin=await Promise.all(Array.from({length:10},(_,i)=>reserveExtraAttempt(target(100+i%2),cfg,thinProof)));
 assert.equal(thin.filter(Boolean).length,0,"7 unique used plus 2 candidates cannot reserve concurrently");
 assert.equal(await prisma.paidQuotaAttempt.count(),0);
 assert.equal(await prisma.aIJob.count(),8,"paid duplicate records must remain counted");
 await prisma.aIJob.delete({where:{id:duplicate.id}});
 await prisma.aIJob.create({data:{userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:8,kickoff:kickoff.toISOString()}),model:"test",rawOutput:"{}"}});
 assert.equal(await reserveExtraAttempt(target(100),cfg,[...Array.from({length:8},(_,i)=>({day,fixtureApiId:i+1})),{day,fixtureApiId:100}]),null,"used/candidate overlap must not inflate richness");
 // An old baseline attempt still blocks an extra after a distant reschedule.
 await prisma.aIJob.create({data:{userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:777,kickoff:new Date(Date.now()-10*86400_000).toISOString()}),createdAt:new Date(Date.now()-10*86400_000),model:"test",rawOutput:"{}"}});
 assert.equal(await reserveExtraAttempt(target(777),cfg,[...pool,{day,fixtureApiId:777}]),null);
 // Concurrent reservations cannot double-charge a fixture or overrun the ceiling.
 const results=await Promise.all(Array.from({length:12},(_,i)=>reserveExtraAttempt(target(100+i%3),cfg,pool)));
 assert.equal(results.filter(Boolean).length,2);
 assert.equal((await prisma.paidQuotaAttempt.aggregate({_sum:{reservedMicroUsd:true}}))._sum.reservedMicroUsd,56000);
 const row=results.find(Boolean)!;
 await assert.rejects(runExtraAttempt(row.fixtureApiId,cfg,async()=>{
   await beforeExperimentalModel("anthropic",200);
   throw new Error("unknown transport cost");
 }),/unknown transport/);
 process.env.VIP_QUOTA_INCREMENTAL_DAILY_USD="1";
 const unknownCfg=quotaExperimentConfig()!;
 assert.equal(await reserveExtraAttempt(target(200),unknownCfg,pool),null);
 process.env.VIP_QUOTA_INCREMENTAL_DAILY_USD="0.056";
 assert.equal((await prisma.paidQuotaAttempt.findUniqueOrThrow({where:{fixtureApiId:row.fixtureApiId}})).reservedMicroUsd,28000);
 await assert.rejects(runExtraAttempt(row.fixtureApiId,cfg,()=>beforeExperimentalModel("anthropic",200)),/already reserved/);
 // Record reliable actual usage, but never refund the conservative charge.
 await prisma.paidQuotaAttempt.update({where:{fixtureApiId:row.fixtureApiId},data:{modelRequests:0}});
 await runExtraAttempt(row.fixtureApiId,cfg,async()=>{await beforeExperimentalModel("anthropic",200);await experimentScope()!.afterModel("anthropic:claude-haiku-5-5",{promptTokens:4000,outputTokens:2000,totalTokens:6000});});
 const charged=await prisma.paidQuotaAttempt.findUniqueOrThrow({where:{fixtureApiId:row.fixtureApiId}});
 assert.equal(charged.actualMicroUsd,1400); assert.equal(charged.reservedMicroUsd,28000); assert.equal(charged.usageReliable,true);
 // The shared API ledger must stop at the unchanged paid ceiling, even racing.
 const utc=new Date().toISOString().slice(0,10);
 await prisma.apiUsage.create({data:{day:utc,path:"test-seed",count:7398}});
 const calls=await withPaidPriority(()=>Promise.allSettled(Array.from({length:10},()=>recordCall("test-call"))));
 assert.equal(calls.filter(r=>r.status==="fulfilled").length,2);
 assert.equal((await prisma.apiUsage.aggregate({_sum:{count:true}}))._sum.count,7400);
 // Daily model-call cap includes reservations with no AIJob (crashed request).
 await prisma.paidQuotaAttempt.deleteMany();
 Object.assign(process.env,{VIP_QUOTA_INCREMENTAL_DAILY_USD:"1"}); const larger=quotaExperimentConfig()!;
 const cap=await Promise.all(Array.from({length:8},(_,i)=>reserveExtraAttempt(target(300+i),larger,pool)));
 assert.equal(cap.filter(Boolean).length,4);
 assert.ok((await prisma.paidQuotaAttempt.findMany()).every(r=>r.kickoffDay===day));
 // Real publish-time gate: an attributable extra can publish, but rollback,
 // missing usage, duplicates and kickoff checks still block it.
 const reserved=cap.find(Boolean)!;
 const fx=reserved.fixtureApiId;
 await prisma.paidQuotaAttempt.update({where:{fixtureApiId:fx},data:{modelRequests:1,usageReliable:true,actualMicroUsd:1400}});
 const job=await prisma.aIJob.create({data:{userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:fx,kickoff:kickoff.toISOString(),quotaExperiment:"vip-quota-v1"}),model:"anthropic:claude-haiku-5-5",rawOutput:"{}"}});
 const key=`6100-6101-${kickoff.toISOString().slice(0,10)}`;
 const common={authorId:user.id,fixtureApiId:fx,kickoff,homeTeamApiId:6100,awayTeamApiId:6101,homeTeam:"Quota Home",awayTeam:"Quota Away",leagueApiId:39,leagueName:"Premier League",confidence:84,reasoning:"Local integration fixture",contextComplete:true};
 await prisma.generationAttempt.create({data:{matchKey:key,fixtureApiId:fx,leagueApiId:39,homeTeam:"Quota Home",awayTeam:"Quota Away",kickoff,status:"SUCCEEDED",predictionIds:[]}});
 await prisma.prediction.create({data:{...common,category:"FEATURED",status:"PUBLISHED",marketType:"BTTS",selection:{value:"YES"},market:"BTTS",pick:"Yes",provenance:"STANDARD_CURATED"}});
 const quotes=(share:number)=>({best:1/(share*1.05),median:1/(share*1.05),bookmakers:6,quotes:[{bookmaker:"Local test book",odd:1/(share*1.05)}]});
 await prisma.fixtureOddsCache.create({data:{matchKey:key,bookmakerCount:6,fetchedAt:new Date(),oddsJson:{bookmakerCount:6,markets:[{market:"Match Winner",selections:[{value:"Home",...quotes(.82)},{value:"Draw",...quotes(.1)},{value:"Away",...quotes(.08)}]}]}}});
 const paid=await prisma.prediction.create({data:{...common,aiJobId:job.id,category:"VIP",status:"PENDING_REVIEW",marketType:"MATCH_WINNER",selection:{value:"HOME"},market:"Match Winner",pick:"Home",provenance:"VIP_GENERATED",marketConfirmation:{test:"local"},categories:{create:[{category:"VIP"}]}}});
 process.env.VIP_QUOTA_EXPERIMENT="off";
 assert.equal((await autoPublishVipPremiumPrediction(paid.id,user.id)).published,false);
 process.env.VIP_QUOTA_EXPERIMENT="on";
 await prisma.paidQuotaAttempt.update({where:{fixtureApiId:fx},data:{usageReliable:false}});
 assert.equal((await autoPublishVipPremiumPrediction(paid.id,user.id)).published,false);
 await prisma.paidQuotaAttempt.update({where:{fixtureApiId:fx},data:{usageReliable:true}});
 const published=await autoPublishVipPremiumPrediction(paid.id,user.id);
 assert.equal(published.published,true,JSON.stringify(published));
 assert.equal((await autoPublishVipPremiumPrediction(paid.id,user.id)).published,false);
 assert.equal(await prisma.notificationEvent.count({where:{predictionId:paid.id,type:"NEW_PREDICTION"}}),1);
 await prisma.prediction.update({where:{id:paid.id},data:{kickoff:new Date(Date.now()-1000)}});
 assert.equal((await autoPublishVipPremiumPrediction(paid.id,user.id)).published,false);
 // Exercise actual selection with a rich eligible pool: strongest favourite
 // remains first, and no quote warming/network request is made.
 for (const [id,probability] of [[600,.90],[601,.80]] as const) {
   const k=`${id*10}-${id*10+1}-${kickoff.toISOString().slice(0,10)}`;
   await prisma.generationAttempt.create({data:{matchKey:k,fixtureApiId:id,leagueApiId:39,homeTeam:"Eligible Home",awayTeam:"Eligible Away",kickoff,status:"SUCCEEDED",predictionIds:[]}});
   await prisma.prediction.create({data:{...common,fixtureApiId:id,homeTeamApiId:id*10,awayTeamApiId:id*10+1,category:"FEATURED",status:"PUBLISHED",marketType:"BTTS",selection:{value:"YES"},market:"BTTS",pick:"Yes",provenance:"STANDARD_CURATED"}});
   await prisma.fixtureOddsCache.create({data:{matchKey:k,bookmakerCount:6,fetchedAt:new Date(),oddsJson:{bookmakerCount:6,markets:[{market:"Match Winner",selections:[{value:"Home",...quotes(probability)},{value:"Draw",...quotes((1-probability)*.6)},{value:"Away",...quotes((1-probability)*.4)}]}]}}});
 }
 const selected=await selectVipPremiumTargets(new Date(),1,{warmOdds:false});
 assert.equal(selected.experiment?.quotas[day],16);
 assert.equal(selected.targets[0]?.fixtureApiId,600);
 assert.equal(selected.oddsCalls,0);
 // Exercise the complete selector with the production failure shape, not only
 // the pure counting helper: 8 calls / 7 identities plus 2 fresh candidates.
 await prisma.prediction.updateMany({where:{aiJobId:job.id},data:{aiJobId:null}});
 await prisma.generationAttempt.delete({where:{matchKey:key}});
 await prisma.paidQuotaAttempt.deleteMany(); await prisma.aIJob.deleteMany();
 await prisma.aIJob.createMany({data:Array.from({length:8},(_,i)=>({userId:user.id,prompt:JSON.stringify({intent:"VIP_PREMIUM",fixtureApiId:i===7?1:i+1,kickoff:kickoff.toISOString()}),model:"test",rawOutput:"{}"}))});
 const thinSelection=await selectVipPremiumTargets(new Date(),1,{warmOdds:false});
 assert.equal(thinSelection.experiment?.quotas[day],undefined);
 assert.equal(thinSelection.targets.length,0,"duplicate attempt records must not unlock a ninth attempt");
 const identity=thinSelection.readiness?.fixtureDays.find(d=>d.day===day);
 assert.equal(identity?.attemptRecords,8); assert.equal(identity?.uniqueUsedFixtureIds.length,7);
 assert.equal(identity?.uniqueUsedPlusEligible,9); assert.equal(identity?.fixtureRich,false);
 process.env.VIP_QUOTA_EXPERIMENT="off";
 const offSelection=await selectVipPremiumTargets(new Date(),1,{warmOdds:false});
 assert.equal(offSelection.experiment,undefined); assert.equal(offSelection.targets.length,0);
 assert.equal(offSelection.oddsCalls,0); assert.deepEqual(offSelection.readiness?.fixtureDays,thinSelection.readiness?.fixtureDays);
 process.env.VIP_QUOTA_EXPERIMENT="on";
 // A crashed extra's identity must survive rescheduling beyond the lookback.
 await prisma.paidQuotaAttempt.create({data:{fixtureApiId:999,experiment:"vip-quota-v1",kickoffDay:"2026-01-01",spendDay:"2026-01-01",createdAt:new Date(Date.now()-10*86400_000),reservedMicroUsd:28000,configJson:JSON.stringify(larger)}});
 assert.ok((await loadVipPremiumAttempts()).some(a=>a.fixtureApiId===999));
 // A missing usage ledger fails closed before any network dispatch.
 await prisma.$executeRawUnsafe('ALTER TABLE "ApiUsage" RENAME TO "ApiUsage_quota_test_hidden"');
 try {
   assert.equal(await hasBudget(),false);
   await assert.rejects(recordCall("must-not-dispatch"));
 } finally { await prisma.$executeRawUnsafe('ALTER TABLE "ApiUsage_quota_test_hidden" RENAME TO "ApiUsage"'); }
 const hardLimitOutput=execFileSync(process.execPath,["--import","tsx","scripts/check-vip-quota-postgres.ts","--hard-api-ceiling"],{env:{...process.env,API_FOOTBALL_DAILY_LIMIT:"999999"},encoding:"utf8"});
 assert.match(hardLimitOutput,/7500 enforced/);
 delete process.env.VIP_QUOTA_EXPERIMENT;
 assert.equal(await reserveExtraAttempt(target(400),larger,pool),null);
 console.log("quota postgres: concurrent dedupe, budget reservation, unknown cost, no refunds, API ceiling, 12-call cap, rollback/publication/notification integrity and API fail-closed checks passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
