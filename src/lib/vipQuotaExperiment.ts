import { AsyncLocalStorage } from "node:async_hooks";
import type { AIUsage } from "@/lib/ai/providers/types";

export const QUOTA_EXPERIMENT = "vip-quota-v1";
export const EXTRA_ATTEMPT_MAX = 8;
export const EXPERIMENT_MAX_OUTPUT_TOKENS = 16_000;
// Full supported input context, rather than average historical prompt size.
export const EXPERIMENT_MAX_INPUT_TOKENS = 200_000;
export type QuotaExperimentConfig = {
  extra: number; dailyMicroUsd: number; inputRate: number; outputRate: number;
  model: string; priceValidUntil: string; reservationMicroUsd: number;
};
const positive = (s: string | undefined) => s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null;
/** Explicit price attestation is required; the dashboard's unknown=zero estimate is unsuitable. */
export function quotaExperimentConfig(env: Record<string, string | undefined> = process.env, now = new Date()): QuotaExperimentConfig | null {
  if (env.VIP_QUOTA_EXPERIMENT !== "on") return null;
  const extra = positive(env.VIP_QUOTA_EXTRA_ATTEMPTS);
  const usd = positive(env.VIP_QUOTA_INCREMENTAL_DAILY_USD);
  const inputRate = positive(env.VIP_QUOTA_INPUT_USD_PER_MILLION);
  const outputRate = positive(env.VIP_QUOTA_OUTPUT_USD_PER_MILLION);
  const valid = env.VIP_QUOTA_PRICE_VALID_UNTIL;
  const expires = Date.parse(valid ?? "");
  // A short-lived attestation must be reviewed before a price/model change.
  if (!extra || !Number.isInteger(extra) || extra > EXTRA_ATTEMPT_MAX || !usd || !inputRate || !outputRate || !valid
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(valid)
    || !Number.isFinite(expires) || expires <= now.getTime() || expires > now.getTime() + 31 * 86400_000) return null;
  const model = env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  if (model !== "claude-haiku-5-5" || !env.ANTHROPIC_API_KEY || (env.PAID_ROUTE_PRIMARY_PROVIDER && env.PAID_ROUTE_PRIMARY_PROVIDER !== "anthropic")) return null;
  const dailyMicroUsd = Math.floor(usd * 1_000_000);
  const reservationMicroUsd = Math.ceil(EXPERIMENT_MAX_INPUT_TOKENS * inputRate + EXPERIMENT_MAX_OUTPUT_TOKENS * outputRate);
  if (!Number.isSafeInteger(dailyMicroUsd) || !Number.isSafeInteger(reservationMicroUsd) || reservationMicroUsd < 1 || dailyMicroUsd < reservationMicroUsd) return null;
  return { extra, dailyMicroUsd, inputRate, outputRate, model, priceValidUntil: valid, reservationMicroUsd };
}

export type RichnessFixture = { day: string; fixtureApiId: number | null };
/** Identity evidence, deliberately separate from attempt/spend counters. */
export function fixtureRichnessByDay(used: readonly RichnessFixture[], eligible: readonly RichnessFixture[]): Map<string, Set<number>> {
  const fixtures = new Map<string, Set<number>>();
  const valid = (c: RichnessFixture) => Number.isSafeInteger(c.fixtureApiId) && c.fixtureApiId! > 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.day);
  const usedIds = new Set(used.filter(valid).map(c => c.fixtureApiId!));
  for (const c of used.filter(valid)) {
    if (!fixtures.has(c.day)) fixtures.set(c.day, new Set());
    fixtures.get(c.day)!.add(c.fixtureApiId!);
  }
  for (const c of eligible.filter(valid)) {
    // A rescheduled or overlapping candidate cannot supply a second identity.
    if (usedIds.has(c.fixtureApiId!)) continue;
    if (!fixtures.has(c.day)) fixtures.set(c.day, new Set());
    fixtures.get(c.day)!.add(c.fixtureApiId!);
  }
  return fixtures;
}

/** Uses the union of real fixture identities; repeated paid calls still cost quota. */
export function experimentalDays(used: readonly RichnessFixture[], eligibleDays: readonly RichnessFixture[], extra: number): Map<string, number> {
  const quotas = new Map<string, number>();
  if (!Number.isInteger(extra) || extra < 1 || extra > 8) return quotas;
  const usedIds = new Set(used.filter(c => Number.isSafeInteger(c.fixtureApiId) && c.fixtureApiId! > 0).map(c => c.fixtureApiId));
  const eligibleDaysWithIds = new Set(eligibleDays.filter(c => Number.isSafeInteger(c.fixtureApiId) && c.fixtureApiId! > 0 && !usedIds.has(c.fixtureApiId)).map(c => c.day));
  for (const [day, ids] of fixtureRichnessByDay(used, eligibleDays)) {
    if (eligibleDaysWithIds.has(day) && ids.size >= 10) quotas.set(day, 8 + extra);
  }
  return quotas;
}

export function reliableUsageCost(config: QuotaExperimentConfig, model: string, usage: AIUsage): number | null {
  const { promptTokens: p, outputTokens: o } = usage;
  if (model !== `anthropic:${config.model}` || p == null || o == null || !Number.isSafeInteger(p) || !Number.isSafeInteger(o) || p < 0 || o < 0 || p > EXPERIMENT_MAX_INPUT_TOKENS || o > EXPERIMENT_MAX_OUTPUT_TOKENS) return null;
  return Math.ceil(p * config.inputRate + o * config.outputRate);
}

type ExperimentScope = {
  config: QuotaExperimentConfig;
  beforeModel: () => Promise<void>;
  afterModel: (model: string, usage: AIUsage) => Promise<void>;
  recordApi: () => Promise<void>;
};
const scope = new AsyncLocalStorage<ExperimentScope>();
export const experimentScope = () => scope.getStore();
export function withQuotaExperiment<T>(value: ExperimentScope, fn: () => Promise<T>): Promise<T> { return scope.run(value, fn); }
/** Reject unsupported transports before they can spend; no retries or fallback in an extra attempt. */
export async function beforeExperimentalModel(provider: string, requestBytes: number): Promise<void> {
  const s = scope.getStore();
  if (!s) return;
  if (provider !== "anthropic" || requestBytes > 90_000) throw new Error("quota experiment: unsupported provider or oversized prompt");
  await s.beforeModel();
}
