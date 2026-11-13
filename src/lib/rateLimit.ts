/**
 * A small fixed-window rate limiter for account mutations (follows,
 * preferences, saved predictions).
 *
 * In-process memory, deliberately. Production is one long-lived Next server on
 * the VPS (docs/VPS_MIGRATION.md), so a per-process counter is a real limit
 * there; on a multi-instance host it degrades to a per-instance limit, which
 * still stops a single client hammering one instance. It is a guard against
 * runaway clients and scripted abuse, not an accounting system — nothing
 * depends on its exact count, and it is never the only protection: every
 * write is also idempotent (unique keys) and capped (LIMITS in
 * src/lib/personalization.ts).
 *
 * Keys are `${scope}:${userId}` — always the server-resolved user id, never
 * anything the client sent.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      // Evict expired buckets first; if none, the oldest insertion.
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value as string);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  existing.count += 1;
  return { ok: true };
}

/** Per-user mutation budget shared by the personalization endpoints: 60 writes a minute. */
export const ACCOUNT_WRITE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** Team search is a read but a query per keystroke; 120 a minute. */
export const SEARCH_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
