import {
  getScopedTeamTargets,
  getScopedLeagueTargets,
  getScopedFixtureTargets,
  getScopedH2HTargets,
  orderTeamsByPriority,
  orderLeaguesByStaleness,
  orderFixtureDaysByStaleness,
  selectStaleH2HTargets,
  selectStalePlayerStatLeagues,
  selectStaleSquadTargets,
  refreshTeamCache,
  refreshLeagueCache,
  refreshFixtureDetailsForDay,
  refreshH2HCache,
  refreshLeaguePlayerStats,
  refreshTeamSquad,
} from "@/lib/enrichment";

export const ENRICHMENT_WORKLOADS = ["teams", "leagues", "fixture-details", "h2h", "player-stats", "squads"] as const;
export type EnrichmentWorkload = (typeof ENRICHMENT_WORKLOADS)[number];

const DEFAULT_BUDGET_MS = 20_000;
// Do not start another upstream operation in the final eight seconds. The
// football API calls are throttled and can take several seconds themselves;
// this reserve is what lets the response close before cron-job.org's 30s wall.
const START_RESERVE_MS = 8_000;

type WorkResult = { id: number | string; result: string; detail?: string };

async function runBudgeted<T>(
  items: T[],
  limit: number,
  startedAt: number,
  budgetMs: number,
  run: (item: T) => Promise<WorkResult | WorkResult[]>,
) {
  const results: WorkResult[] = [];
  let processed = 0;

  for (const item of items.slice(0, limit)) {
    if (processed > 0 && Date.now() - startedAt >= budgetMs - START_RESERVE_MS) break;
    const result = await run(item);
    results.push(...(Array.isArray(result) ? result : [result]));
    processed += 1;
  }

  return {
    processed,
    remaining: Math.max(0, items.length - processed),
    budgetExhausted: processed < Math.min(limit, items.length),
    results,
  };
}

export async function runEnrichmentWorkload(
  workload: EnrichmentWorkload,
  options: { limit: number; budgetMs?: number },
) {
  const startedAt = Date.now();
  const budgetMs = Math.min(25_000, Math.max(20_000, options.budgetMs ?? DEFAULT_BUDGET_MS));

  let scoped = 0;
  let eligible = 0;
  let report: Awaited<ReturnType<typeof runBudgeted<unknown>>>;

  if (workload === "teams") {
    const targets = await getScopedTeamTargets();
    const queue = await orderTeamsByPriority(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (target) => {
      const r = await refreshTeamCache(target);
      return { id: target.teamApiId, result: r.result, detail: r.detail };
    });
  } else if (workload === "leagues") {
    const targets = await getScopedLeagueTargets();
    const queue = await orderLeaguesByStaleness(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (target) => {
      const r = await refreshLeagueCache(target);
      return { id: target.leagueApiId, result: r.result, detail: r.detail };
    });
  } else if (workload === "fixture-details") {
    const targets = await getScopedFixtureTargets();
    const queue = await orderFixtureDaysByStaleness(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (batch) => {
      const rows = await refreshFixtureDetailsForDay(batch.day, batch.targets);
      return rows.map((r) => ({ id: r.matchKey, result: r.result, detail: r.detail }));
    });
  } else if (workload === "h2h") {
    const targets = await getScopedH2HTargets();
    const queue = await selectStaleH2HTargets(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (target) => {
      const r = await refreshH2HCache(target);
      return { id: target.pairKey, result: r.result, detail: r.detail ?? (r.meetings != null ? `${r.meetings} meetings` : undefined) };
    });
  } else if (workload === "player-stats") {
    const targets = await getScopedLeagueTargets();
    const queue = await selectStalePlayerStatLeagues(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (target) => {
      const r = await refreshLeaguePlayerStats(target);
      return { id: target.leagueApiId, result: r.result, detail: r.detail ?? r.counts };
    });
  } else {
    const targets = await getScopedTeamTargets();
    const queue = await selectStaleSquadTargets(targets);
    scoped = targets.length;
    eligible = queue.length;
    report = await runBudgeted(queue, options.limit, startedAt, budgetMs, async (target) => {
      const r = await refreshTeamSquad(target);
      return { id: target.teamApiId, result: r.result, detail: r.detail };
    });
  }

  const elapsedMs = Date.now() - startedAt;
  return {
    workload,
    budgetMs,
    elapsedMs,
    scoped,
    eligible,
    processed: report.processed,
    remaining: report.remaining,
    budgetExhausted: report.budgetExhausted,
    okCount: report.results.filter((r) => r.result === "ok").length,
    failedCount: report.results.filter((r) => r.result !== "ok").length,
    results: report.results,
  };
}
