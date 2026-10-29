/** Read-only audit. Run with the configured DATABASE_URL; never rewrites picks. */
import { prisma } from '../src/lib/prisma';
import { parseStoredContext } from '../src/lib/ai/context';
import { evidenceClaimIssues } from '../src/lib/ai/evidenceClaims';
import { assertCompetitionStage } from '../src/lib/ai/competitionStage';
import { parseAnalysis } from '../src/lib/predictionAnalysis';

async function main() {
  let cursor: string | undefined, checked = 0, missingEvidence = 0, flagged = 0;
  // Each batch is bounded and the query is read-only. Retain the JSONL output as
  // a review manifest; a finding is not authorisation to rewrite original prose.
  while (true) {
    const rows = await prisma.prediction.findMany({ where: { status: 'PUBLISHED' }, take: 100, ...(cursor ? {cursor:{id:cursor},skip:1}:{}), orderBy:{id:'asc'}, select:{ id:true, matchSlugKey:true, matchPreview:true, reasoning:true, analysisJson:true, aiJob:{select:{context:true,createdAt:true}} } });
    if (!rows.length) break;
    for (const row of rows) {
      checked++;
      const d = parseStoredContext(row.aiJob?.context);
      if (!d) { missingEvidence++; continue; }
      const output = {matchPreview: row.matchPreview ?? undefined, keyFactors:parseAnalysis(row.analysisJson)?.keyFactors, predictions:[{reasoning:row.reasoning}]};
      const issues = evidenceClaimIssues(d,[output.matchPreview,...(output.keyFactors??[]),row.reasoning].filter(Boolean).join('\n'));
      if (d.fixture.round) try { assertCompetitionStage(d.fixture, output); } catch { issues.push({code:'competition-stage',claim:'Unsupported knockout wording',evidence:`Stored round: ${d.fixture.round}`}); }
      if (issues.length) { flagged++; console.log(JSON.stringify({predictionId:row.id,slug:row.matchSlugKey,evidenceRecordedAt:row.aiJob?.createdAt,issues})); }
    }
    cursor=rows[rows.length-1].id;
  }
  console.log(JSON.stringify({summary:{checked,missingEvidence,flagged},mode:'READ_ONLY',limitation:'Targeted H2H and stage checks, not a general factual audit.'}));
}
main().finally(()=>prisma.$disconnect());
