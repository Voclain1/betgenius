import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { rateLimit, ACCOUNT_WRITE_LIMIT } from "@/lib/rateLimit";

/**
 * The gate every account-specific endpoint passes through, in a fixed order:
 *
 *   1. a session (expired or missing → 401; the user id comes ONLY from the
 *      signed session, never from the request),
 *   2. for writes, the CSRF origin check every other mutation in the app uses,
 *   3. for writes, the per-user rate limit.
 *
 * `decideAccountAccess` is the pure decision so scripts/check-personalization.ts
 * can assert the order and the status codes without a running server.
 */
export type AccessDecision = { ok: true; userId: string } | { ok: false; status: 401 | 403 | 429; error: string; retryAfterSeconds?: number };

export function decideAccountAccess(input: {
  userId: string | null | undefined;
  write: boolean;
  originOk: boolean;
  rate: { ok: true } | { ok: false; retryAfterSeconds: number };
}): AccessDecision {
  if (!input.userId) return { ok: false, status: 401, error: "Sign in to continue" };
  if (input.write && !input.originOk) return { ok: false, status: 403, error: "Invalid origin" };
  if (input.write && !input.rate.ok) return { ok: false, status: 429, error: "Too many changes. Try again shortly.", retryAfterSeconds: input.rate.retryAfterSeconds };
  return { ok: true, userId: input.userId };
}

/** Private, per-user responses: never stored by a shared cache. */
export const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...PRIVATE_HEADERS, ...extra } });
}

export async function requireAccount(req: NextRequest, opts: { write: boolean; scope: string; limit?: { limit: number; windowMs: number } }): Promise<AccessDecision & { response?: NextResponse }> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const originOk = opts.write ? hasValidMutationOrigin(req) : true;
  const l = opts.limit ?? ACCOUNT_WRITE_LIMIT;
  // Only count a request against the budget once it is known to be a real,
  // same-origin request from a signed-in user.
  const rate = userId && originOk && opts.write ? rateLimit(`${opts.scope}:${userId}`, l.limit, l.windowMs) : ({ ok: true } as const);
  const decision = decideAccountAccess({ userId, write: opts.write, originOk, rate });
  if (decision.ok) return decision;
  return {
    ...decision,
    response: json({ error: decision.error }, decision.status, decision.retryAfterSeconds ? { "retry-after": String(decision.retryAfterSeconds) } : {}),
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}
