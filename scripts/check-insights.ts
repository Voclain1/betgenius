import assert from "node:assert/strict";
import { calculateInsights } from "../src/lib/insights";

const fixture = (id:number, date:string, homeId:number, awayId:number, hg:number, ag:number, status="FT", league=39) => ({
  fixture:{id,date,status:{short:status}}, league:{id:league,name:"League",country:"",logo:null,season:2026,round:null},
  teams:{home:{id:homeId,name:"A",logo:null},away:{id:awayId,name:"B",logo:null}}, goals:{home:hg,away:ag}, score:{halftime:{home:null,away:null},fulltime:{home:hg,away:ag},extratime:{home:null,away:null},penalty:{home:null,away:null}},
});
const rows = [
  fixture(1,"2026-09-10T12:00:00Z",1,2,2,1), fixture(2,"2026-09-08T12:00:00Z",3,1,1,1),
  fixture(3,"2026-09-06T12:00:00Z",1,4,3,0,"AET"), fixture(4,"2026-09-04T12:00:00Z",5,1,0,2,"PEN"),
  fixture(5,"2026-09-02T12:00:00Z",1,6,1,0), fixture(5,"2026-09-02T12:00:00Z",1,6,1,0),
  fixture(6,"2026-09-15T12:00:00Z",1,7,9,0), fixture(7,"2026-09-01T12:00:00Z",1,8,0,2,"NS"),
] as any;
const opts={teamApiId:1,teamName:"A",cutoff:new Date("2026-09-14T00:00:00Z"),refreshedAt:new Date("2026-09-14T00:00:00Z")};
const all=calculateInsights(rows,opts);
assert.equal(all.find(x=>x.type==="UNBEATEN_STREAK")?.count,5,"AET/PEN use provider final goals and eligible completed status");
assert.equal(all[0]?.matchIds.length,5,"duplicates and future/non-finished fixtures are removed");
assert.equal(calculateInsights(rows,{...opts,scope:"HOME"}).length,0,"minimum sample applies after home/away scope");
console.log("insight calculation checks passed");
