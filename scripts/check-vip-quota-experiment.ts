import assert from "node:assert/strict";
import { quotaExperimentConfig, experimentalDays, fixtureRichnessByDay, reliableUsageCost, beforeExperimentalModel, withQuotaExperiment, experimentScope } from "../src/lib/vipQuotaExperiment";
import { completeWithFallback } from "../src/lib/ai/analysis";
const now = new Date("2026-11-15T12:00:00Z");
const env = { VIP_QUOTA_EXPERIMENT: "on", VIP_QUOTA_EXTRA_ATTEMPTS: "8", VIP_QUOTA_INCREMENTAL_DAILY_USD: "0.25", VIP_QUOTA_INPUT_USD_PER_MILLION: "0.1", VIP_QUOTA_OUTPUT_USD_PER_MILLION: "0.5", VIP_QUOTA_PRICE_VALID_UNTIL: "2026-11-20T00:00:00Z", ANTHROPIC_API_KEY: "test-not-a-real-key" };
async function main() {
  assert.equal(quotaExperimentConfig({}, now), null);
  const config = quotaExperimentConfig(env, now)!;
  assert.equal(config.extra,8); assert.equal(config.reservationMicroUsd,28000);
  for (const patch of [
    {VIP_QUOTA_EXPERIMENT:"true"}, {VIP_QUOTA_EXTRA_ATTEMPTS:"9"}, {VIP_QUOTA_EXTRA_ATTEMPTS:"-1"}, {VIP_QUOTA_EXTRA_ATTEMPTS:"1.5"},
    {VIP_QUOTA_INCREMENTAL_DAILY_USD:""}, {VIP_QUOTA_INCREMENTAL_DAILY_USD:"NaN"}, {VIP_QUOTA_INCREMENTAL_DAILY_USD:"0.001"},
    {VIP_QUOTA_INPUT_USD_PER_MILLION:"0"}, {VIP_QUOTA_OUTPUT_USD_PER_MILLION:"Infinity"},
    {VIP_QUOTA_PRICE_VALID_UNTIL:"2026-11-14"}, {VIP_QUOTA_PRICE_VALID_UNTIL:"2027-01-01"},
    {ANTHROPIC_MODEL:"unpriced-alias"}, {ANTHROPIC_API_KEY:""}, {PAID_ROUTE_PRIMARY_PROVIDER:"gemini"},
  ]) assert.equal(quotaExperimentConfig({...env,...patch},now),null,JSON.stringify(patch));
  for (const key of ["VIP_QUOTA_EXPERIMENT","VIP_QUOTA_EXTRA_ATTEMPTS","VIP_QUOTA_INCREMENTAL_DAILY_USD","VIP_QUOTA_INPUT_USD_PER_MILLION","VIP_QUOTA_OUTPUT_USD_PER_MILLION","VIP_QUOTA_PRICE_VALID_UNTIL"]) {
    const missing: Record<string,string>={...env};delete missing[key];assert.equal(quotaExperimentConfig(missing,now),null,`missing ${key} must fail closed`);
  }
  assert.equal(quotaExperimentConfig({...env,VIP_QUOTA_PRICE_VALID_UNTIL:now.toISOString()},now),null);
  assert.equal(quotaExperimentConfig({...env,VIP_QUOTA_PRICE_VALID_UNTIL:"2026-11-20"},now),null,"expiry requires an explicit timezone-bearing instant");
  const upperTier=quotaExperimentConfig({...env,VIP_QUOTA_INPUT_USD_PER_MILLION:"0.50",VIP_QUOTA_OUTPUT_USD_PER_MILLION:"2.50",VIP_QUOTA_INCREMENTAL_DAILY_USD:"0.30"},now)!;
  assert.equal(upperTier.reservationMicroUsd,140000);
  assert.equal(Math.floor(upperTier.dailyMicroUsd/upperTier.reservationMicroUsd),2);
  assert.equal(quotaExperimentConfig({...env,VIP_QUOTA_INPUT_USD_PER_MILLION:"0.50",VIP_QUOTA_OUTPUT_USD_PER_MILLION:"2.50",VIP_QUOTA_INCREMENTAL_DAILY_USD:"0.139"},now),null);
  const day="2026-11-16", used=Array.from({length:8},(_,i)=>({day,fixtureApiId:100+i}));
  assert.equal(experimentalDays(used,[{day,fixtureApiId:1}],8).size,0);
  assert.equal(experimentalDays(used,[{day,fixtureApiId:1},{day,fixtureApiId:1}],8).size,0);
  assert.equal(experimentalDays(used,[{day,fixtureApiId:1},{day,fixtureApiId:2}],8).get(day),16);
  assert.equal(experimentalDays(used,[{day,fixtureApiId:1},{day,fixtureApiId:2}],2).get(day),10);
  assert.equal(experimentalDays(used,[{day,fixtureApiId:1},{day,fixtureApiId:2}],0).size,0);
  const duplicated=[...used.slice(0,7),used[0]];
  const two=[{day,fixtureApiId:1},{day,fixtureApiId:2}];
  assert.equal(experimentalDays(duplicated,two,2).size,0,"8 records for 7 IDs plus 2 is only 9 fixtures");
  assert.equal(experimentalDays(duplicated,[...two,{day,fixtureApiId:3}],2).get(day),10);
  assert.equal(experimentalDays(used,[used[0],{day,fixtureApiId:1}],2).size,0,"used/candidate overlap is not another fixture");
  assert.equal(experimentalDays(used,[...two,...two],2).get(day),10);
  assert.equal(experimentalDays([...used,{day,fixtureApiId:null}],two,2).get(day),10);
  assert.equal(experimentalDays(used,[{day,fixtureApiId:NaN},{day,fixtureApiId:-1}],2).size,0);
  assert.equal(experimentalDays([...used,{day,fixtureApiId:108},{day,fixtureApiId:109}],[used[0]],2).size,0,"a used-only pool has no eligible extra target");
  const next="2026-11-17";
  assert.equal(fixtureRichnessByDay(used,[{day:next,fixtureApiId:100}]).has(next),false,"reschedule cannot reuse a spent identity");
  for (const usage of [{promptTokens:null,outputTokens:100,totalTokens:100}, {promptTokens:100,outputTokens:null,totalTokens:100}, {promptTokens:-1,outputTokens:1,totalTokens:0}, {promptTokens:200001,outputTokens:1,totalTokens:0}]) assert.equal(reliableUsageCost(config,"anthropic:claude-haiku-5-5",usage),null);
  const usage={promptTokens:4000,outputTokens:2000,totalTokens:6000};
  assert.equal(reliableUsageCost(config,"anthropic:unknown",usage),null);
  assert.equal(reliableUsageCost(config,"anthropic:claude-haiku-5-5",usage),1400);
  assert.equal(experimentScope(),undefined);
  let reserved=0, transports=0;
  await withQuotaExperiment({config,beforeModel:async()=>{ if(reserved++)throw new Error("spent"); },afterModel:async()=>{},recordApi:async()=>{}},async()=>{
    await assert.rejects(beforeExperimentalModel("gemini",10),/unsupported/);
    await assert.rejects(beforeExperimentalModel("anthropic",90001),/oversized/);
    assert.equal(reserved,0);
    await assert.rejects(completeWithFallback({system:"a",user:"b",label:"test"},JSON.parse,[
      {name:"anthropic",isConfigured:()=>true,complete:async()=>{transports++; throw Object.assign(new Error("timeout"),{status:503});}},
      {name:"gemini",isConfigured:()=>true,complete:async()=>{transports++;throw new Error("must not spend");}},
    ]),/unsupported/);
    assert.equal(transports,1);
    await assert.rejects(beforeExperimentalModel("anthropic",10),/spent/);
  });
  assert.equal(experimentScope(),undefined);
  // Baseline provider behaviour is unaffected outside the explicit scope.
  const baseline = await completeWithFallback({system:"a",user:"b",label:"baseline"},JSON.parse,[{name:"gemini",isConfigured:()=>true,complete:async()=>({text:'{"ok":true}',model:"gemini:test",usage})}]);
  assert.equal(baseline.output.ok,true);
  console.log("quota experiment: configuration, eligibility, reliable costing, transport blocking, isolation and baseline checks passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
