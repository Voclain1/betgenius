import { prisma } from '@/lib/prisma';
import { getFixtureLineups } from '@/lib/football/api-football';
import { matchKey } from '@/lib/slug';
import { cupSupports } from '@/lib/cupConfig';
import { lineupRefreshDue, readLineupSnapshot, trimConfirmedLineups, type LineupSnapshot } from '@/lib/lineups';

export async function getLineupTargets(now = new Date()) {
  const rows=await prisma.prediction.findMany({where:{status:'PUBLISHED',kickoff:{gte:new Date(now.getTime()-15*60_000),lte:new Date(now.getTime()+90*60_000)},homeTeamApiId:{not:null},awayTeamApiId:{not:null}},select:{homeTeamApiId:true,awayTeamApiId:true,kickoff:true,leagueApiId:true}});
  const byKey=new Map(rows.filter(r=>cupSupports(r.leagueApiId,'lineups')).map(r=>[matchKey(r),r]));
  const details=await prisma.fixtureDetailCache.findMany({where:{matchKey:{in:[...byKey.keys()].filter((k):k is string=>!!k)},fixtureApiId:{not:null}},select:{matchKey:true,fixtureApiId:true,detailJson:true}});
  return details.flatMap(row=>{
    const fixture=byKey.get(row.matchKey)!;
    const snapshot=readLineupSnapshot((row.detailJson as {lineups?:unknown}|null)?.lineups);
    return lineupRefreshDue(fixture.kickoff!,snapshot?.fixtureApiId===row.fixtureApiId?snapshot:null,now)?[{matchKey:row.matchKey,fixtureApiId:row.fixtureApiId!,homeId:fixture.homeTeamApiId!,awayId:fixture.awayTeamApiId!,kickoff:fixture.kickoff!}]:[];
  }).sort((a,b)=>a.kickoff.getTime()-b.kickoff.getTime());
}

export async function refreshLineupCache(target: Awaited<ReturnType<typeof getLineupTargets>>[number]) {
  const now=new Date().toISOString();
  let snapshot:LineupSnapshot;
  try {
    const raw=await getFixtureLineups(target.fixtureApiId);
    const teams=trimConfirmedLineups(raw,target.homeId,target.awayId);
    snapshot={fixtureApiId:target.fixtureApiId,attemptedAt:now,status:teams?'confirmed':raw?'not-reported':'unavailable',...(teams?{teams,fetchedAt:now}:{})};
  } catch {
    snapshot={fixtureApiId:target.fixtureApiId,attemptedAt:now,status:'unavailable'};
  }
  // Atomic JSON subfield update: concurrent fixture-detail refreshes cannot
  // erase a lineup, and a lineup refresh cannot overwrite venue/round data.
  // A late failed attempt never replaces an already confirmed XI.
  await prisma.$executeRaw`UPDATE "FixtureDetailCache" SET "detailJson"=jsonb_set(COALESCE("detailJson",'{}'::jsonb),'{lineups}',${JSON.stringify(snapshot)}::jsonb),"updatedAt"=NOW()
    WHERE "matchKey"=${target.matchKey} AND "fixtureApiId"=${target.fixtureApiId}
    AND (${snapshot.status} = 'confirmed' OR COALESCE("detailJson"->'lineups'->>'status','') <> 'confirmed' OR COALESCE("detailJson"->'lineups'->>'fixtureApiId','') <> ${String(target.fixtureApiId)})`;
  return {id:`lineup:${target.matchKey}`,result:snapshot.status==='unavailable'?'failed':'ok',detail:snapshot.status};
}
