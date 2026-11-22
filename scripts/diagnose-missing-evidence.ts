/**
 * Read-only, production-safe incident sample. Does not call API-Football,
 * write to the database, reveal team identities or print credential-bearing
 * provider errors. Run only on a trusted environment with read-only DB access.
 *
 *   npx tsx scripts/diagnose-missing-evidence.ts
 */
import { prisma } from "../src/lib/prisma";

const LOOKBACK_HOURS = 72;
const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000);
const pageSize = 400;
type Row = { id: string; leagueApiId: number | null; leagueName: string | null;
  status: string; contextComplete: boolean; homeTeamApiId: number | null;
  awayTeamApiId: number | null; aiJobId: string | null; };
const rows: Row[] = [];
try {
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.prediction.findMany({
      where: { createdAt: { gte: since }, aiJobId: { not: null } },
      select: { id: true, leagueApiId: true, leagueName: true, status: true,
        contextComplete: true, homeTeamApiId: true, awayTeamApiId: true, aiJobId: true },
      orderBy: { id: "asc" }, take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    rows.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < pageSize) break;
  }

  const poor = rows.filter(r => !r.contextComplete);
  const byCompetition = new Map<string, { total: number; noEvidence: number; published: number; missingIds: number }>();
  for (const row of rows) {
    const key = row.leagueApiId === null ? "unknown" : String(row.leagueApiId);
    const v = byCompetition.get(key) ?? { total: 0, noEvidence: 0, published: 0, missingIds: 0 };
    v.total++;
    if (!row.contextComplete) {
      v.noEvidence++;
      if (row.status === "PUBLISHED") v.published++;
      if (row.homeTeamApiId == null || row.awayTeamApiId == null) v.missingIds++;
    }
    byCompetition.set(key, v);
  }
  const ids = [...new Set(poor.flatMap(r => [r.homeTeamApiId, r.awayTeamApiId]).filter((id): id is number => id !== null))];
  const errors = new Map<string, number>();
  const classify = (error: string | null): string => {
    if (!error) return "no-recorded-error";
    if (/quota|daily limit|requests.*limit/i.test(error)) return "quota";
    if (/rate.limit|429|too many/i.test(error)) return "rate-limit";
    if (/403|forbidden|subscription|season|plan/i.test(error)) return "plan-or-season-access";
    if (/401|unauthoriz|invalid key|api.key/i.test(error)) return "authorization";
    if (/timeout|etimedout|fetch failed|connect|network/i.test(error)) return "network";
    if (/no data returned|empty/i.test(error)) return "empty-provider-response";
    return "other-provider-error";
  };
  for (let start = 0; start < ids.length; start += pageSize) {
    const cache = await prisma.teamEnrichmentCache.findMany({
      where: { teamApiId: { in: ids.slice(start, start + pageSize) } },
      select: { lastError: true },
    });
    for (const row of cache) {
      const reason = classify(row.lastError);
      errors.set(reason, (errors.get(reason) ?? 0) + 1);
    }
  }
  const report = {
    inspectedHours: LOOKBACK_HOURS, sampledPredictions: rows.length,
    noEvidence: poor.length, publishedNoEvidence: poor.filter(r => r.status === "PUBLISHED").length,
    missingTeamIds: poor.filter(r => r.homeTeamApiId == null || r.awayTeamApiId == null).length,
    byCompetition: [...byCompetition].filter(([,x])=>x.noEvidence>0)
      .map(([leagueApiId,x])=>({leagueApiId,...x})).sort((a,b)=>b.noEvidence-a.noEvidence),
    cacheErrorsByType: Object.fromEntries(errors),
    note: "Read-only incident evidence. contextComplete is historical metadata; it is not proof of current API health. No provider calls made.",
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
