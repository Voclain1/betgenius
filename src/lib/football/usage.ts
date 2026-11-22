import { experimentScope } from "@/lib/vipQuotaExperiment";
import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Daily quota accounting for api-football.
 *
 * The Pro plan caps usage at 7,500 requests/day (resetting at UTC midnight) on
 * top of the 300/min rate limit that api-football.ts's MIN_GAP_MS throttle
 * paces. Those two limits need different mechanisms: the per-minute cap is a
 * pacing problem one instance can solve locally, but the daily cap is a shared
 * budget across every serverless instance, so it lives in the database (see the
 * ApiUsage model) and is incremented atomically per request.
 *
 * Why this matters now: a single prediction generation costs ~11 API calls
 * (2x searchTeam, 2x getTeamContext at 3 calls each, standings, h2h,
 * resolveSeason), so a 20-fixture bulk run is ~220 calls. At the 240 req/min
 * the throttle now permits, the daily budget is exhaustible in ~31 minutes of
 * sustained bulk generation — previously impossible under the old 6.5s gap.
 */
import { prisma } from "@/lib/prisma";

/** api-football's quota day rolls over at UTC midnight. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Plan ceiling. Overridable so a plan change doesn't need a code deploy, and so
 * the limit can be dialled down to leave headroom for other consumers of the
 * same key.
 */
export const DAILY_LIMIT = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;

/**
 * Requests held back from the ceiling. Local counting can drift below the
 * account's real usage (calls made outside this app, or an instance dying
 * between dispatching a request and recording it), so stopping short of the
 * true limit keeps that drift from turning into hard 429s mid-run.
 */
export const RESERVE = Number(process.env.API_FOOTBALL_DAILY_RESERVE) || 100;

/**
 * Requests only the paid VIP/Premium pass may spend.
 *
 * WHY. Every consumer (enrichment, settlement, live scores, discovery,
 * ordinary generation) draws on one daily api-football budget, first come
 * first served. Over 14 Oct – 13 Nov 2026 the paid pass — the one consumer a
 * paying subscriber depends on, and one of the cheapest (≤12 odds calls and a
 * handful of context calls per run) — stood down about 130 times because the
 * budget was gone, 102 of them at 0 left (scripts/verify-paid-production.ts).
 * Calls made inside withPaidPriority may use the last PAID_PRIORITY_RESERVE of
 * the budget; everything else stops that much earlier.
 */
export const PAID_PRIORITY_RESERVE = Number(process.env.API_FOOTBALL_PAID_RESERVE) || 300;

const priorityScope = new AsyncLocalStorage<boolean>();

/** Run `fn` with paid priority: its api-football calls may use the paid reserve. */
export function withPaidPriority<T>(fn: () => Promise<T>): Promise<T> {
  return priorityScope.run(true, fn);
}

export function inPaidPriority(): boolean {
  return priorityScope.getStore() === true;
}

// ---------------------------------------------------------------------------
// Request telemetry: hour × endpoint × job × outcome (added 22 Nov 2026).
//
// WHY. ApiUsage only ever held (UTC day, path) totals. That cannot answer
// which job spent a request, at what hour, or whether it succeeded, failed,
// was rate-limited or was refused by our own budget gate — so the seven-day
// usage audit (docs/API_FOOTBALL_7_DAY_USAGE_REPORT.md) could not be
// reconstructed from history. These counters make the next audit measurable.
//
// STORAGE. Rows live in the existing ApiUsage table under a `day` key that
// starts with "#h" (e.g. "#h2026-11-22T13", the UTC hour). Budget reads match
// `day` exactly against "YYYY-MM-DD", and "#" sorts below every digit, so
// these rows can never be counted against the quota nor picked up by the
// `day >= "YYYY-MM-DD"` range reads in existing audit scripts. No schema
// change, so no production `db push` is required to deploy this.
//
// COST. One extra upsert per DISPATCHED provider request, fire-and-forget:
// never awaited on the request path and never able to fail the call. Set
// API_TELEMETRY=off to disable.
// ---------------------------------------------------------------------------

const jobScope = new AsyncLocalStorage<string>();

/** Label every api-football request made inside `fn` with `job`. */
export function withApiJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
  return jobScope.run(job, fn);
}

/** Wrap a route handler so its provider requests are attributed. The label may depend on the request. */
export function attributeApiJob<A extends unknown[], R>(label: string | ((...args: A) => string), handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => jobScope.run(typeof label === "function" ? label(...args) : label, () => handler(...args));
}

export function currentApiJob(): string {
  return jobScope.getStore() ?? (inPaidPriority() ? "paid-priority" : "unattributed");
}

export const TELEMETRY_DAY_PREFIX = "#h";
const SEP = "|";

export type ApiOutcome =
  | "ok" // 200 with a non-empty response
  | "empty" // 200 with an empty response: a real answer, not automatically waste
  | "http_error" // non-2xx other than 429
  | "rate_limited" // 429, or a provider `errors` payload naming the request/rate limit
  | "api_error" // provider `errors` payload of any other kind
  | "timeout"
  | "network_error"
  | "quota_refused"; // stopped by our own daily budget gate; NOT sent to the provider

/** UTC hour bucket for a telemetry row. */
export function telemetryBucket(at: Date): string {
  return TELEMETRY_DAY_PREFIX + at.toISOString().slice(0, 13);
}

export function telemetryPath(path: string, job: string, outcome: ApiOutcome): string {
  return [path, job.replaceAll(SEP, "/"), outcome].join(SEP);
}

export type TelemetryRow = { hourUtc: string; path: string; job: string; outcome: ApiOutcome; count: number };

/** Inverse of telemetryBucket/telemetryPath. Null for ordinary budget rows. */
export function parseTelemetryRow(row: { day: string; path: string; count: number }): TelemetryRow | null {
  if (!row.day.startsWith(TELEMETRY_DAY_PREFIX)) return null;
  const parts = row.path.split(SEP);
  if (parts.length !== 3) return null;
  return { hourUtc: row.day.slice(TELEMETRY_DAY_PREFIX.length), path: parts[0], job: parts[1], outcome: parts[2] as ApiOutcome, count: row.count };
}

/** Classify a provider response body. Pure; unit-checked. */
export function classifyProviderPayload(json: unknown): ApiOutcome {
  const j = json as { errors?: unknown; response?: unknown } | null;
  const errors = j?.errors;
  const hasErrors = !!errors && typeof errors === "object" && Object.keys(errors as object).length > 0;
  if (hasErrors) {
    const text = JSON.stringify(errors).toLowerCase();
    return /requests|ratelimit|rate limit|too many/.test(text) ? "rate_limited" : "api_error";
  }
  const r = j?.response;
  if (r == null || (Array.isArray(r) && r.length === 0)) return "empty";
  return "ok";
}

export function recordApiOutcome(path: string, outcome: ApiOutcome, at: Date = new Date()): void {
  if (process.env.API_TELEMETRY === "off") return;
  const day = telemetryBucket(at);
  const key = telemetryPath(path, currentApiJob(), outcome);
  void prisma.apiUsage
    .upsert({ where: { day_path: { day, path: key } }, create: { day, path: key, count: 1 }, update: { count: { increment: 1 } } })
    .catch((err) => console.error("[api-football/telemetry] failed to record", key, err?.message ?? err));
}

/** The day's ceiling for a caller: the paid pass may go to DAILY_LIMIT − RESERVE, everyone else stops PAID_PRIORITY_RESERVE short. */
export function budgetCeiling(priority: boolean): number {
  return DAILY_LIMIT - RESERVE - (priority ? 0 : PAID_PRIORITY_RESERVE);
}

export type UsageSnapshot = {
  day: string;
  used: number;
  limit: number;
  reserve: number;
  remaining: number;
  byPath: Array<{ path: string; count: number }>;
};

/** Total requests recorded for a day. Cheap enough to run per-call at this volume. */
export async function usedToday(day: string = utcDay()): Promise<number> {
  const agg = await prisma.apiUsage.aggregate({ where: { day }, _sum: { count: true } });
  return agg._sum.count ?? 0;
}

/** Full breakdown for the admin usage endpoint. */
export async function getUsageSnapshot(day: string = utcDay()): Promise<UsageSnapshot> {
  const rows = await prisma.apiUsage.findMany({
    where: { day },
    select: { path: true, count: true },
    orderBy: { count: "desc" },
  });
  const used = rows.reduce((sum, r) => sum + r.count, 0);
  return {
    day,
    used,
    limit: DAILY_LIMIT,
    reserve: RESERVE,
    remaining: Math.max(0, DAILY_LIMIT - RESERVE - used),
    byPath: rows,
  };
}

/**
 * Atomic per-endpoint increment. Uses upsert's `increment` rather than a
 * read-modify-write so concurrent instances can't clobber each other's counts.
 *
 * Outside the experiment, never throws: a tracking failure must not take down the API call
 * that succeeded. A dropped increment under-counts (fails open), which the
 * /status reconciliation in reconcileWithAccount() is there to correct.
 */
export async function recordCall(path: string, day: string = utcDay()): Promise<void> {
  if (experimentScope() && process.env.VIP_QUOTA_EXPERIMENT !== "on") throw new Error("quota experiment disabled before API dispatch");
  if (process.env.VIP_QUOTA_EXPERIMENT === "on") {
    // All app callers serialize reservation+increment while the experiment is
    // on. A failed reservation/tracking write throws BEFORE network dispatch.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(750000)`;
      const usage = await tx.apiUsage.aggregate({ where: { day }, _sum: { count: true } });
      const ceiling = Math.min(7500, budgetCeiling(inPaidPriority()));
      if (!Number.isFinite(ceiling) || ceiling <= 0 || (usage._sum.count ?? 0) >= ceiling) throw new Error("api-football hard daily ceiling reached");
      await tx.apiUsage.upsert({ where: { day_path: { day, path } }, create: { day, path, count: 1 }, update: { count: { increment: 1 } } });
    });
    await experimentScope()?.recordApi();
    return;
  }
  try {
    await prisma.apiUsage.upsert({
      where: { day_path: { day, path } },
      create: { day, path, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    console.error("[api-football/usage] failed to record call", path, err);
  }
}

/**
 * True when there's budget left to spend. Callers should treat `false` as a
 * hard stop for the rest of the UTC day, not a retryable condition.
 *
 * Fails OPEN. This gate sits in front of every api-football request, so a
 * database blip (or a deploy that lands before `prisma db push` creates the
 * ApiUsage table) would otherwise black out the entire football integration —
 * a far worse outcome than briefly spending unmetered against a 7,500/day
 * ceiling. getUsageSnapshot() deliberately does NOT do this: it only backs
 * admin-facing reads, where a visible error beats a confidently wrong
 * "remaining" figure.
 */
export async function hasBudget(day: string = utcDay()): Promise<boolean> {
  try {
    return (await usedToday(day)) < budgetCeiling(inPaidPriority());
  } catch (err) {
    const failClosed = process.env.VIP_QUOTA_EXPERIMENT === "on";
    console.error(`[api-football/usage] budget check failed — ${failClosed ? "refusing" : "allowing"} request`, err);
    return !failClosed;
  }
}

/**
 * Align local counts with the account's authoritative `requests.current` from
 * /status. Local tracking only ever under-counts (untracked callers, lost
 * increments), so this corrects upward only — writing a lower number would
 * hand back budget the account has genuinely already spent.
 *
 * The adjustment lands on a synthetic "(reconciled)" path so it stays visible
 * as drift in the breakdown instead of silently inflating a real endpoint.
 */
export async function reconcileWithAccount(accountCurrent: number, day: string = utcDay()): Promise<{ adjusted: number }> {
  const local = await usedToday(day);
  const drift = accountCurrent - local;
  if (drift <= 0) return { adjusted: 0 };
  await prisma.apiUsage.upsert({
    where: { day_path: { day, path: "(reconciled)" } },
    create: { day, path: "(reconciled)", count: drift },
    update: { count: { increment: drift } },
  });
  return { adjusted: drift };
}

/**
 * Repeat detection: the same full request URL dispatched again within
 * REPEAT_WINDOW_MS by this process. Recorded under a separate "#d" bucket so
 * it is never summed with outcomes. A repeat is a waste CANDIDATE (two jobs
 * independently fetching one record), not proof: a deliberate retry after a
 * failure also repeats. In-process only — exact on the single-process VPS
 * deployment, a lower bound on multi-instance hosting.
 */
export const REPEAT_WINDOW_MS = 10 * 60_000;
export const REPEAT_DAY_PREFIX = "#d";
const recentDispatch = new Map<string, number>();
const RECENT_MAX = 5_000;

/** Returns true when `url` was dispatched within the window. Pure apart from the bounded map. */
export function noteDispatch(url: string, now: number = Date.now()): boolean {
  const prev = recentDispatch.get(url);
  recentDispatch.delete(url);
  recentDispatch.set(url, now);
  if (recentDispatch.size > RECENT_MAX) {
    const oldest = recentDispatch.keys().next().value;
    if (oldest !== undefined) recentDispatch.delete(oldest);
  }
  return prev !== undefined && now - prev < REPEAT_WINDOW_MS;
}

export function recordRepeat(path: string, at: Date = new Date()): void {
  if (process.env.API_TELEMETRY === "off") return;
  const day = REPEAT_DAY_PREFIX + at.toISOString().slice(0, 13);
  const key = [path, currentApiJob().replaceAll(SEP, "/"), "repeat_within_10m"].join(SEP);
  void prisma.apiUsage
    .upsert({ where: { day_path: { day, path: key } }, create: { day, path: key, count: 1 }, update: { count: { increment: 1 } } })
    .catch((err) => console.error("[api-football/telemetry] failed to record repeat", key, err?.message ?? err));
}
