/**
 * Read-only, production-safe incident sample. Does not call API-Football,
 * write to the database, reveal team identities or print credential-bearing
 * provider errors. Run only on a trusted environment with read-only DB access.
 *
 *   npx tsx --env-file=.env scripts/diagnose-missing-evidence.ts [--days=N]
 *
 * Default lookback 72 hours. --days=N widens it to N days of generated
 * predictions (all statuses). Besides the original contextComplete/cache-error
 * summary, it reports the historical classification used by the admin
 * Evidence review (src/lib/ai/historicalEvidence.ts): counts by class x
 * status x tier x competition, reason codes, and the prediction ids that need
 * individual editorial verification. Ids and codes only: no team names,
 * reasoning text, prompts or provider errors.
 */
import { prisma } from "../src/lib/prisma";
import { EVIDENCE_REVIEW_SELECT, classifyRow, loadKnownKickoffs } from "../src/lib/evidenceReview";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";

const daysArg = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7));
const LOOKBACK_HOURS = Number.isFinite(daysArg) && daysArg > 0 ? daysArg * 24 : 72;
const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000);
const pageSize = 400;
type Row = { id: string; leagueApiId: number | null; leagueName: string | null;
  status: string; contextComplete: boolean; homeTeamApiId: number | null;
  awayTeamApiId: number | null; aiJobId: string | null; };
const rows: Row[] = [];
// Wrapped in main(): top-level await is rejected by tsx in this repo (CJS output),
// so the documented command never ran before this fix.
async function main() {
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
  // Historical classification (same rules as the admin Evidence review).
  const byClass: Record<string, number> = {};
  const byClassStatus: Record<string, Record<string, number>> = {};
  const byClassTier: Record<string, Record<string, number>> = {};
  const byClassCompetition: Record<string, Record<string, number>> = {};
  const reasonCodes: Record<string, number> = {};
  const editorial: Array<{ id: string; class: string; status: string; tier: string; kickoff: string | null; upcoming: boolean; reasons: string[] }> = [];
  const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
  const now = new Date();
  let classCursor: string | undefined;
  for (;;) {
    const page = await prisma.prediction.findMany({
      where: { createdAt: { gte: since }, aiJobId: { not: null } },
      select: EVIDENCE_REVIEW_SELECT, orderBy: { id: "asc" }, take: 200,
      ...(classCursor ? { cursor: { id: classCursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    classCursor = page[page.length - 1].id;
    const known = await loadKnownKickoffs(page);
    for (const row of page) {
      const e = classifyRow(row, known);
      const tier = isPaidOnlyProvenance(row.provenance) || row.categories.some((c) => c.category === "VIP" || c.category === "PREMIUM") ? "paid" : "free";
      bump(byClass, e.classification);
      bump((byClassStatus[e.classification] ??= {}), row.status);
      bump((byClassTier[e.classification] ??= {}), tier);
      bump((byClassCompetition[e.classification] ??= {}), row.leagueApiId == null ? "unknown" : String(row.leagueApiId));
      for (const r of e.reasons) bump(reasonCodes, r.code);
      // Individual editorial verification: anything flagged that readers can
      // see (published) or that is still awaiting a decision (review / held).
      if (["FRESHNESS_UNCERTAIN", "EVIDENCE_INSUFFICIENT", "SNAPSHOT_UNAVAILABLE"].includes(e.classification)
          && ["PUBLISHED", "PENDING_REVIEW", "DRAFT"].includes(row.status) && !row.revisions.length) {
        editorial.push({ id: row.id, class: e.classification, status: row.status, tier,
          kickoff: row.kickoff?.toISOString() ?? null, upcoming: !!row.kickoff && row.kickoff > now, reasons: e.reasons.map((r) => r.code) });
      }
    }
    if (page.length < 200) break;
  }
  const order = { EVIDENCE_INSUFFICIENT: 0, FRESHNESS_UNCERTAIN: 1, SNAPSHOT_UNAVAILABLE: 2 } as Record<string, number>;
  editorial.sort((a, b) => Number(b.status === "PUBLISHED") - Number(a.status === "PUBLISHED") || Number(b.upcoming) - Number(a.upcoming) || order[a.class] - order[b.class]);
  Object.assign(report, {
    historicalClassification: {
      rules: "src/lib/ai/historicalEvidence.ts (recency bound 21 days; missed-match check from 19 Nov 2026)",
      byClass, byClassStatus, byClassTier, byClassCompetition, reasonCodes,
      editorialVerification: { count: editorial.length, items: editorial },
    },
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
}
main().catch((e) => { console.error("diagnostic failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
