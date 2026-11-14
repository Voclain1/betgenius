import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
export const OPERATION_LEASE_MS = 300000;
export function operationIdentity(key: string) {
  return "s07_" + createHash("sha256").update(key).digest("hex");
}
export function retryDelay(attempt: number, key: string) {
  const jitter =
    parseInt(createHash("sha256").update(key).digest("hex").slice(0, 4), 16) %
    1000;
  return Math.min(60000, 5000 * 2 ** Math.max(0, attempt - 1)) + jitter;
}
export type ExecutionState = {
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "TERMINAL" | "INTERRUPTED";
  attempt: number;
  nextAt?: string;
  reason?: string;
  actorId: string;
  holder: string;
  result?: unknown;
};
/** Durable idempotent recovery, using existing AppLock/JobRun; no scheduler or automatic retry loop. */
export async function executeOperation(input: {
  key: string;
  resource: string;
  actorId: string;
  reason: string;
  run: (lease: {
    key: string;
    holder: string;
  }) => Promise<{ ok: boolean; detail: unknown }>;
}) {
  if (!input.actorId || input.reason.trim().length < 8)
    throw new Error(
      "An administrator and an explicit audit reason are required",
    );
  const now = new Date(),
    id = operationIdentity(input.key),
    leaseKey = "s07:" + operationIdentity(input.resource),
    holder = randomUUID();
  const claimed = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key","holder","acquiredAt","expiresAt") VALUES (${leaseKey},${holder},${now},${new Date(+now + OPERATION_LEASE_MS)})
    ON CONFLICT ("key") DO UPDATE SET "holder"=EXCLUDED."holder","acquiredAt"=EXCLUDED."acquiredAt","expiresAt"=EXCLUDED."expiresAt"
    WHERE "AppLock"."expiresAt"<=${now} RETURNING "holder"`;
  if (!claimed.length) return { status: "BUSY", id };
  try {
    const prior = await prisma.jobRun.findUnique({ where: { id } });
    const state = prior?.detail as ExecutionState | null;
    if (state?.status === "SUCCEEDED" || state?.status === "TERMINAL")
      return { status: state.status, id, replayed: true };
    if (state?.nextAt && Date.parse(state.nextAt) > +now)
      return { status: "BACKOFF", id, nextAt: state.nextAt };
    if (state?.status === "RUNNING")
      await prisma.jobRun.updateMany({
        where: { id: `${id}_${state.attempt}` },
        data: {
          ok: false,
          detail: {
            ...state,
            status: "INTERRUPTED",
            reason: "EXPIRED_EXECUTION_LEASE",
          },
        },
      });
    const attempt = (state?.attempt ?? 0) + 1;
    if (attempt > 3) {
      await prisma.jobRun.update({
        where: { id },
        data: {
          ok: false,
          detail: {
            ...state,
            status: "TERMINAL",
            reason: "INTERRUPTED_RETRY_LIMIT",
            actorId: input.actorId,
          },
        },
      });
      return { status: "TERMINAL", id };
    }
    const detail: ExecutionState = {
      status: "RUNNING",
      attempt,
      actorId: input.actorId,
      reason: input.reason,
      holder,
    };
    await prisma.jobRun.upsert({
      where: { id },
      create: {
        id,
        job: "operations-execution",
        ranAt: now,
        ok: false,
        summary: input.resource,
        detail,
      },
      update: { ranAt: now, ok: false, detail },
    });
    // Separate immutable attempt history survives changes to the execution receipt.
    await prisma.jobRun.create({
      data: {
        id: `${id}_${attempt}`,
        job: "operations-attempt",
        ok: false,
        summary: input.resource,
        detail,
      },
    });
    let result: { ok: boolean; detail: unknown };
    try {
      result = await input.run({ key: leaseKey, holder });
    } catch (error) {
      result = {
        ok: false,
        detail: {
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "UNKNOWN_FAILURE",
        },
      };
    }
    const finished = new Date();
    const next: ExecutionState = {
      ...detail,
      status: result.ok ? "SUCCEEDED" : attempt >= 3 ? "TERMINAL" : "FAILED",
      result: result.detail,
      ...(!result.ok
        ? {
            nextAt: new Date(
              +finished + retryDelay(attempt, input.key),
            ).toISOString(),
          }
        : {}),
    };
    await prisma.$transaction(
      async (tx) => {
        const lease = await tx.appLock.findUnique({ where: { key: leaseKey } });
        if (lease?.holder !== holder || lease.expiresAt <= finished)
          throw new Error("LEASE_EXPIRED_RESULT_UNCONFIRMED");
        await tx.jobRun.update({
          where: { id },
          data: {
            ok: result.ok,
            detail: JSON.parse(JSON.stringify(next)),
            ms: +finished - +now,
          },
        });
        await tx.jobRun.update({
          where: { id: `${id}_${attempt}` },
          data: {
            ok: result.ok,
            detail: JSON.parse(JSON.stringify(next)),
            ms: +finished - +now,
          },
        });
      },
      { timeout: 3000, maxWait: 1000 },
    );
    return { status: next.status, id, attempt, result: result.detail };
  } finally {
    await prisma.appLock
      .deleteMany({ where: { key: leaseKey, holder } })
      .catch(() => {});
  }
}
