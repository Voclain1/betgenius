/** Production audit: one database-enforced read-only snapshot; no provider calls. */
import { PrismaClient, Prisma } from '@prisma/client';
import { parseStoredContext } from '../src/lib/ai/context';
import { evidenceClaimIssues } from '../src/lib/ai/evidenceClaims';
import { assertCompetitionStage, competitionStage } from '../src/lib/ai/competitionStage';
import { parseAnalysis } from '../src/lib/predictionAnalysis';

const db = new PrismaClient({log:[]});
async function main() {
  const report = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const mode = await tx.$queryRaw<Array<{transaction_read_only:string}>>`SHOW transaction_read_only`;
    if (mode[0]?.transaction_read_only !== 'on') throw new Error('Read-only guard failed');
    let cursor: string | undefined, checked = 0, missingEvidence = 0, unknownStage = 0, flagged = 0;
    const flaggedMatches = new Set<string>();
    const byCode: Record<string,number> = {};
    const sample: Array<{slug:string|null;codes:string[]}> = [];
    while (true) {
      const rows = await tx.prediction.findMany({where:{status:'PUBLISHED'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),orderBy:{id:'asc'},select:{id:true,matchSlugKey:true,matchPreview:true,reasoning:true,analysisJson:true,aiJob:{select:{context:true}}}});
      if (!rows.length) break;
      for (const row of rows) {
        checked++;
        let d;
        try { d=parseStoredContext(row.aiJob?.context); } catch { d=null; }
        if (!d) { missingEvidence++; continue; }
        const output={matchPreview:row.matchPreview??undefined,keyFactors:parseAnalysis(row.analysisJson)?.keyFactors,predictions:[{reasoning:row.reasoning}]};
        const issues=evidenceClaimIssues(d,[output.matchPreview,...(output.keyFactors??[]),row.reasoning].filter(Boolean).join('\n'));
        if (competitionStage(d.fixture) !== "unknown") try { assertCompetitionStage(d.fixture,output); } catch { issues.push({code:'competition-stage',claim:'',evidence:''}); }
        else unknownStage++;
        const codes=[...new Set(issues.map(i=>i.code))];
        if (codes.length) {
          flagged++;
          if (row.matchSlugKey) flaggedMatches.add(row.matchSlugKey);
          for (const code of codes) byCode[code]=(byCode[code]??0)+1;
          if (sample.length<30) sample.push({slug:row.matchSlugKey,codes});
        }
      }
      cursor=rows[rows.length-1].id;
    }
    // Public logs never contain stored contexts, paid picks or analysis text.
    return {mode:'READ_ONLY',summary:{checked,missingEvidence,unknownStage,flaggedPredictions:flagged,flaggedMatches:flaggedMatches.size,byCode},sample,sampleLimit:30,limitation:'Targeted H2H/internal-score/stage checks; not a comprehensive fact audit. Unknown historic stages are not inferred.'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:120_000,maxWait:15_000});
  console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Read-only evidence audit failed; no content was changed.');process.exitCode=1;}).finally(()=>db.$disconnect());
