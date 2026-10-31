/**
 * Everything the generation panel shows, in one read.
 *
 * All of it comes from rows the pipeline already writes — AIJob (provider,
 * tokens, duration), GenerationAttempt (queued/failed/dead-lettered),
 * TeamEnrichmentCache (refresh failures) and ApiUsage (football quota). Nothing
 * here is a separate metrics store to keep in sync.
 */

import { prisma } from "@/lib/prisma";
import { getUsageSnapshot, type UsageSnapshot } from "@/lib/football/usage";
import { generationSourceOf } from "@/lib/generationFailures";

/**
 * Per-million-token prices, in USD, keyed by MODEL rather than provider.
 *
 * Model-level pricing matters more than it looks. AIJob rows show the
 * `gemini-flash-latest` alias currently resolving to Gemini 3.7 Flash, which is
 * roughly 2.5x the cost of 2.5 Flash per input token — a floating alias moved
 * the bill without any change here. Pricing by provider alone would have
 * reported that as a 2-3x understatement.
 *
 * Prices are matched by longest key prefix so a pinned id and an alias both
 * resolve, with UNKNOWN_PRICE as the last resort. Groq's developer tier is free
 * at this volume, so it prices at zero — the point of tracking it is fallback
 * FREQUENCY, not spend.
 *
 * A local table rather than anything fetched: this turns stored token counts
 * into an at-a-glance figure, and a cost panel that could itself fail or go
 * stale would be worse than one that is transparently approximate. Update it
 * alongside a model change.
 */
export const MODEL_PRICES: Array<{ match: string; input: number; output: number; note?: string }> = [
  // Introductory pricing through 2026-12-31; doubles to 1.50/7.50 on 2027-01-01.
  { match: "gemini:gemini-3.7-flash", input: 0.75, output: 3.75, note: "introductory until 2027-01-01" },
  { match: "gemini:gemini-2.5-flash-lite", input: 0.1, output: 0.4 },
  { match: "gemini:gemini-2.5-flash", input: 0.3, output: 2.5 },
  // Legacy rows only. GEMINI_MODEL is pinned to a concrete id now (see
  // DEFAULT_GEMINI_MODEL), but jobs generated before the pin recorded the alias
  // and still need costing at what it resolved to.
  { match: "gemini:gemini-flash-latest", input: 0.75, output: 3.75, note: "legacy alias — resolved to 3.7 Flash" },
  { match: "gemini", input: 0.75, output: 3.75 },
  { match: "groq", input: 0, output: 0 },
  // Anthropic list price; used by scripts/compare-models.ts and, if adopted,
  // by the panel. Prompts over 100K tokens price higher, which this app never sends.
  { match: "anthropic:claude-haiku-5-5", input: 0.1, output: 0.5 },
];

/** Used when no price is known, so an unrecognised model reports zero rather than crashing the panel. */
export const UNKNOWN_PRICE = { input: 0, output: 0 };

export function priceFor(model: string): { input: number; output: number } {
  let best: (typeof MODEL_PRICES)[number] | null = null;
  for (const p of MODEL_PRICES) {
    if (!model.startsWith(p.match)) continue;
    if (!best || p.match.length > best.match.length) best = p;
  }
  // Only the rates are returned — `match` and `note` are table bookkeeping, and
  // leaking them made two entries with identical pricing compare unequal.
  return best ? { input: best.input, output: best.output } : UNKNOWN_PRICE;
}

export function estimateCostUsd(model: string, promptTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (promptTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

/** The primary provider, for fallback-rate purposes. Everything else counts as a fallback. */
const PRIMARY_PROVIDER = "anthropic";

/**
 * "gemini:gemini-2.5-flash" -> "gemini".
 *
 * Rows written before the provider abstraction stored a bare model name with no
 * prefix. Bucketing those under their raw value made each one its own
 * pseudo-provider, and since fallbackPct is "everything that isn't the primary",
 * every legacy row scored as a fallback — 7 of them were reporting a 70%+
 * fallback rate on a chain that had not failed over once. Gemini was the only
 * provider that existed when they were written, so that is what they are.
 */
export function providerOf(model: string): string {
  const i = model.indexOf(":");
  // Legacy rows are Gemini's: it was the primary when they were written.
  return i === -1 ? "gemini" : model.slice(0, i);
}

/** Percentile over a sorted-in-place copy. Null for an empty sample rather than 0, which would read as "instant". */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export type WindowSummary = {
  jobs: number;
  failedJobs: number;
  promptTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Jobs that were paid for and then rejected (no pick kept), and what they cost. */
  rejectedJobs: number;
  rejectedCostUsd: number;
  byProvider: Record<string, number>;
  /** Share of completed jobs answered by a non-primary provider, 0-100. Null when nothing ran. */
  fallbackPct: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
};

export type GenerationStats = {
  today: WindowSummary;
  last7d: WindowSummary;
  attempts: { pending: number; failed: number; abandoned: number; succeededToday: number };
  deadLetters: Array<{ matchKey: string; homeTeam: string; awayTeam: string; kickoff: Date; attempts: number; lastError: string | null }>;
  retrying: Array<{ matchKey: string; homeTeam: string; awayTeam: string; kickoff: Date; attempts: number; nextAttemptAt: Date | null; lastError: string | null }>;
  enrichmentFailures: Array<{ teamApiId: number; teamName: string | null; lastError: string | null; lastAttemptAt: Date | null }>;
  /** The number that matters most while review is manual-only. */
  pendingReview: number;
  predictionsCreatedToday: number;
  usage: UsageSnapshot;
  /** Last 7 days, one row per Lagos day and generation pass: where the spend goes. */
  spendByPass: PassSpend[];
};

export type PassSpend = { day: string; pass: string; jobs: number; rejected: number; promptTokens: number; outputTokens: number; costUsd: number };

/**
 * Which pass a job came from, read from the input stored on AIJob.prompt.
 * Same admin words as the failed-generations list (generationSourceOf), plus
 * rewrites and the category-only passes that carry no intent. Pure.
 */
export function passOf(prompt: string): string {
  let input: any;
  try {
    input = JSON.parse(prompt);
  } catch {
    return "Other";
  }
  if (!input || typeof input !== "object") return "Other";
  if (input.rewriteOf) return "Rewrite";
  const source = generationSourceOf(input);
  if (source !== "Scheduled") return source;
  const cats: string[] = Array.isArray(input.categories) ? input.categories : [];
  if (cats.includes("SAME_GAME_DOUBLE")) return "Same-game double";
  if (cats.includes("BET_OF_THE_DAY")) return "Bet of the Day";
  return "Scheduled";
}

const lagosDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

/** Groups jobs by day and pass, newest day first, costliest pass first within a day. Pure. */
export function spendByPass(jobs: Array<{ prompt: string; model: string; status: string; promptTokens: number | null; outputTokens: number | null; createdAt: Date }>): PassSpend[] {
  const rows = new Map<string, PassSpend>();
  for (const j of jobs) {
    if (j.status === "FAILED") continue;
    const day = lagosDay(j.createdAt);
    const pass = passOf(j.prompt);
    const key = `${day}|${pass}`;
    const r = rows.get(key) ?? { day, pass, jobs: 0, rejected: 0, promptTokens: 0, outputTokens: 0, costUsd: 0 };
    const pt = j.promptTokens ?? 0;
    const ot = j.outputTokens ?? 0;
    r.jobs++;
    if (j.status === "REJECTED") r.rejected++;
    r.promptTokens += pt;
    r.outputTokens += ot;
    r.costUsd += estimateCostUsd(j.model, pt, ot);
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.day.localeCompare(a.day) || b.costUsd - a.costUsd);
}

function summarise(jobs: Array<{ model: string; status: string; promptTokens: number | null; outputTokens: number | null; durationMs: number | null }>): WindowSummary {
  const byProvider: Record<string, number> = {};
  let promptTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let failedJobs = 0;
  let rejectedJobs = 0;
  let rejectedCostUsd = 0;
  const latencies: number[] = [];

  for (const j of jobs) {
    if (j.status === "FAILED") {
      failedJobs++;
      // A failed job has no usable tokens or latency — counting it would drag
      // both figures toward zero and hide the real cost of the work that ran.
      continue;
    }
    const provider = providerOf(j.model);
    byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    const pt = j.promptTokens ?? 0;
    const ot = j.outputTokens ?? 0;
    promptTokens += pt;
    outputTokens += ot;
    const cost = estimateCostUsd(j.model, pt, ot);
    costUsd += cost;
    if (j.status === "REJECTED") {
      rejectedJobs++;
      rejectedCostUsd += cost;
    }
    if (j.durationMs != null) latencies.push(j.durationMs);
  }

  const completed = Object.values(byProvider).reduce((a, b) => a + b, 0);
  const fallbacks = completed - (byProvider[PRIMARY_PROVIDER] ?? 0);

  return {
    jobs: jobs.length,
    failedJobs,
    promptTokens,
    outputTokens,
    costUsd,
    rejectedJobs,
    rejectedCostUsd,
    byProvider,
    fallbackPct: completed > 0 ? Number(((fallbacks / completed) * 100).toFixed(1)) : null,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  };
}

export async function getGenerationStats(now: Date = new Date()): Promise<GenerationStats> {
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const jobSelect = { model: true, status: true, promptTokens: true, outputTokens: true, durationMs: true, createdAt: true, prompt: true } as const;

  const [jobs7d, attemptGroups, deadLetters, retrying, enrichmentFailures, pendingReview, predictionsToday, usage, succeededToday] =
    await Promise.all([
      prisma.aIJob.findMany({ where: { createdAt: { gte: sevenDaysAgo } }, select: jobSelect }),
      prisma.generationAttempt.groupBy({ by: ["status"], _count: true }),
      prisma.generationAttempt.findMany({
        where: { status: "ABANDONED" },
        orderBy: { lastAttemptAt: "desc" },
        take: 20,
        select: { matchKey: true, homeTeam: true, awayTeam: true, kickoff: true, attempts: true, lastError: true },
      }),
      prisma.generationAttempt.findMany({
        where: { status: "FAILED" },
        orderBy: { nextAttemptAt: "asc" },
        take: 20,
        select: { matchKey: true, homeTeam: true, awayTeam: true, kickoff: true, attempts: true, nextAttemptAt: true, lastError: true },
      }),
      prisma.teamEnrichmentCache.findMany({
        where: { lastError: { not: null } },
        orderBy: { lastAttemptAt: "desc" },
        take: 20,
        select: { teamApiId: true, teamName: true, lastError: true, lastAttemptAt: true },
      }),
      prisma.prediction.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.prediction.count({ where: { createdAt: { gte: startOfToday } } }),
      getUsageSnapshot(),
      prisma.generationAttempt.count({ where: { status: "SUCCEEDED", lastAttemptAt: { gte: startOfToday } } }),
    ]);

  const byStatus = Object.fromEntries(attemptGroups.map((g) => [g.status, g._count]));

  return {
    today: summarise(jobs7d.filter((j) => j.createdAt >= startOfToday)),
    last7d: summarise(jobs7d),
    spendByPass: spendByPass(jobs7d),
    attempts: {
      pending: byStatus.PENDING ?? 0,
      failed: byStatus.FAILED ?? 0,
      abandoned: byStatus.ABANDONED ?? 0,
      succeededToday,
    },
    deadLetters,
    retrying,
    enrichmentFailures,
    pendingReview,
    predictionsCreatedToday: predictionsToday,
    usage,
  };
}
