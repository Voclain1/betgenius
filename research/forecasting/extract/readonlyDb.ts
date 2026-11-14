/**
 * A read-only, bounded, single-snapshot database session for research.
 *
 * Defence in depth — any one layer failing is not enough to write:
 *
 *   1. A DEDICATED credential (RESEARCH_READONLY_DATABASE_URL). The app's own
 *      DATABASE_URL / DATABASE_URL_UNPOOLED are refused outright, even if they
 *      happen to point at a read-only role, so a research run can never be
 *      started with the production read-write credential by accident.
 *   2. The role itself must be read-only: not a superuser, no INSERT / UPDATE /
 *      DELETE / TRUNCATE privilege on any table in the public schema, and
 *      default_transaction_read_only = on. Checked from inside the session,
 *      before any data is read; the run aborts if any check fails.
 *   3. The transaction is opened REPEATABLE READ, READ ONLY, so every query sees
 *      one consistent snapshot and Postgres itself rejects any write.
 *   4. statement_timeout, lock_timeout and idle_in_transaction_session_timeout
 *      are set LOCAL to the transaction, and the whole transaction has a wall
 *      clock limit, so a slow query cannot hold resources on the primary.
 *
 * The posture checks are a pure function (assertReadOnlyPosture) so they are
 * tested without a database.
 */

import { PrismaClient } from "@prisma/client";

export type Posture = {
  transaction_read_only: string | null;
  default_transaction_read_only: string | null;
  transaction_isolation: string | null;
  is_superuser: boolean | null;
  writable_tables: number | null;
};

export type SnapshotInfo = { server_version: string | null; snapshot_time: string; isolation: string | null; read_only_verified: true };

export type Query = <R = Record<string, unknown>>(sql: string, ...params: unknown[]) => Promise<R[]>;

export const RESEARCH_URL_ENV = "RESEARCH_READONLY_DATABASE_URL";

export class ReadOnlyRefusal extends Error {}

/** Refuse the app's own credentials and anything that is not a postgres URL. Never echoes the URL. */
export function assertDedicatedCredential(env: Record<string, string | undefined>): string {
  const url = env[RESEARCH_URL_ENV];
  if (!url) throw new ReadOnlyRefusal(`${RESEARCH_URL_ENV} is not set. A dedicated read-only credential is required; see docs/research/XGBOOST_RESEARCH_ENGINE.md.`);
  if (!/^postgres(ql)?:\/\//.test(url)) throw new ReadOnlyRefusal(`${RESEARCH_URL_ENV} is not a postgres:// URL.`);
  for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    if (env[k] && env[k] === url) throw new ReadOnlyRefusal(`${RESEARCH_URL_ENV} is identical to ${k}. Use a dedicated read-only role, not the application credential.`);
  }
  return url;
}

export function assertReadOnlyPosture(p: Posture): void {
  const problems: string[] = [];
  if (p.transaction_read_only !== "on") problems.push(`transaction_read_only is ${p.transaction_read_only ?? "unknown"}, expected on`);
  if (p.default_transaction_read_only !== "on") problems.push(`role default_transaction_read_only is ${p.default_transaction_read_only ?? "unknown"}, expected on`);
  if (p.is_superuser !== false) problems.push("role is a superuser (or could not be verified as not one)");
  if (p.writable_tables !== 0) problems.push(`role holds write privileges on ${p.writable_tables ?? "an unknown number of"} table(s)`);
  if (p.transaction_isolation !== "repeatable read") problems.push(`isolation is ${p.transaction_isolation ?? "unknown"}, expected repeatable read`);
  if (problems.length) throw new ReadOnlyRefusal(`refusing to read: ${problems.join("; ")}`);
}

function withConnectionLimit(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
  return u.toString();
}

export type SnapshotOptions = { statementTimeoutMs?: number; transactionTimeoutMs?: number };

/**
 * Run `fn` inside one verified read-only snapshot. Nothing is read before the
 * posture checks pass.
 */
export async function withReadOnlySnapshot<T>(url: string, fn: (q: Query, info: SnapshotInfo) => Promise<T>, opts: SnapshotOptions = {}): Promise<{ result: T; info: SnapshotInfo }> {
  const statementTimeoutMs = Math.max(1_000, Math.floor(opts.statementTimeoutMs ?? 120_000));
  const transactionTimeoutMs = Math.max(10_000, Math.floor(opts.transactionTimeoutMs ?? 30 * 60_000));
  const prisma = new PrismaClient({ datasourceUrl: withConnectionLimit(url), log: [] });
  try {
    return await prisma.$transaction(async (tx) => {
      // Must be the first statement of the transaction.
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = 5000");
      await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout = 60000");
      const [row] = await tx.$queryRawUnsafe<Array<Posture & { server_version: string | null; snapshot_time: Date }>>(`
        SELECT current_setting('transaction_read_only') AS transaction_read_only,
               current_setting('default_transaction_read_only') AS default_transaction_read_only,
               current_setting('transaction_isolation') AS transaction_isolation,
               current_setting('server_version') AS server_version,
               now() AS snapshot_time,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
               (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                   AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                     OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))) AS writable_tables`);
      assertReadOnlyPosture(row);
      const info: SnapshotInfo = {
        server_version: row.server_version,
        snapshot_time: new Date(row.snapshot_time).toISOString(),
        isolation: row.transaction_isolation,
        read_only_verified: true,
      };
      const q: Query = (sql, ...params) => tx.$queryRawUnsafe(sql, ...params);
      return { result: await fn(q, info), info };
    }, { timeout: transactionTimeoutMs, maxWait: 30_000 });
  } finally {
    await prisma.$disconnect();
  }
}
