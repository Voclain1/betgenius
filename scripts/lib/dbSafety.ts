/**
 * Database safety for the check scripts. See docs/PREFLIGHT.md.
 *
 * Three tiers, each enforced here rather than by convention:
 *
 *   preflight              no database at all. DATABASE_URL is replaced with an
 *                          address that cannot resolve (NO_DATABASE_URL), so a
 *                          check cannot reach Production even if .env names it:
 *                          an explicitly set variable wins over .env in Prisma.
 *   preflight:db           the configured database, READ-ONLY at the session
 *                          level (readOnlyUrl): Postgres itself rejects every
 *                          INSERT/UPDATE/DELETE, whatever a script tries.
 *   preflight:integration  checks that insert and delete their own rows. Only
 *                          against a designated integration database that the
 *                          guard below can show is not the normal one; it fails
 *                          closed.
 */
import { existsSync, readFileSync } from "node:fs";

/** `.invalid` is reserved (RFC 2606): it never resolves, so nothing can answer. */
export const NO_DATABASE_URL = "postgresql://preflight:no-database@preflight-no-database.invalid:5432/none";

/** The same URL with every transaction read-only by default, enforced by Postgres. */
export function readOnlyUrl(raw: string) {
  const url = new URL(raw);
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  return url.toString();
}

/*
 * THE INTEGRATION GUARD
 *
 * No fingerprint of any real database is kept in this repository. Every
 * comparison is made at runtime, between the target and the normal database
 * identities this machine actually has. If there are none to compare against,
 * the guard refuses: an empty comparison proves nothing.
 */

/** Normal (non-test) database variables holding a URL: the two this repo uses, then those a Vercel/Neon env pull adds. */
export const NORMAL_DB_URL_VARS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL",
] as const;
/** Normal database variables holding a bare hostname. */
export const NORMAL_DB_HOST_VARS = ["PGHOST", "PGHOST_UNPOOLED", "POSTGRES_HOST"] as const;
/**
 * preflight:integration points DATABASE_URL at the target for its checks, so
 * it first copies each normal variable it was started with to this prefix.
 */
export const REFERENCE_PREFIX = "BETGENIUS_REFERENCE_";
/** An operator-supplied identity for the non-test database, for machines with no env file. */
export const EXPLICIT_REFERENCE_URL = "BETGENIUS_REFERENCE_DATABASE_URL";
export const EXPLICIT_REFERENCE_HOST = "BETGENIUS_REFERENCE_DATABASE_HOST";

export type EnvFile = { name: string; vars: Record<string, string> };

/** KEY=VALUE pairs from an env file, without loading them into process.env. Missing file: empty. */
export function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The env files a normal database identity may live in. */
export function defaultEnvFiles(): EnvFile[] {
  return [".env", ".env.local"].map((name) => ({ name, vars: readEnvFile(name) }));
}

/** ep-cool-name-123456-pooler.region.aws.neon.tech -> ep-cool-name-123456 */
function neonEndpoint(host: string) {
  return /^(ep-[a-z0-9-]+?)(-pooler)?\./.exec(host)?.[1] ?? null;
}

/** Same database server: same host, or the same Neon endpoint through the pooler. */
function sameServer(a: string, b: string) {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x === y || (neonEndpoint(x) != null && neonEndpoint(x) === neonEndpoint(y));
}

function urlHost(raw: string) {
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

type Identity = { source: string; host: string | null };

/**
 * Every normal database identity available at runtime, labelled by where it
 * came from (never by value). DATABASE_URL and DATABASE_URL_UNPOOLED in the
 * live environment are skipped: in a guarded run they point at the target.
 * Their normal values are still covered by the REFERENCE_PREFIX copies and the
 * env files. A value that cannot be parsed has host null, and counts against.
 */
export function normalDatabaseIdentities(env: NodeJS.ProcessEnv, files: EnvFile[]): Identity[] {
  const out: Identity[] = [];
  const add = (source: string, raw: string | undefined, kind: "url" | "host") => {
    if (!raw) return;
    out.push({ source, host: kind === "url" ? urlHost(raw) : raw.trim().toLowerCase() || null });
  };
  for (const v of NORMAL_DB_URL_VARS) {
    add(`${REFERENCE_PREFIX}${v}`, env[`${REFERENCE_PREFIX}${v}`], "url");
    if (v !== "DATABASE_URL" && v !== "DATABASE_URL_UNPOOLED") add(v, env[v], "url");
    for (const f of files) add(`${f.name}:${v}`, f.vars[v], "url");
  }
  for (const v of NORMAL_DB_HOST_VARS) {
    add(`${REFERENCE_PREFIX}${v}`, env[`${REFERENCE_PREFIX}${v}`], "host");
    add(v, env[v], "host");
    for (const f of files) add(`${f.name}:${v}`, f.vars[v], "host");
  }
  add(EXPLICIT_REFERENCE_URL, env[EXPLICIT_REFERENCE_URL], "url");
  add(EXPLICIT_REFERENCE_HOST, env[EXPLICIT_REFERENCE_HOST], "host");
  return out;
}

/**
 * The reasons a mutating run may not use this target, from configuration alone
 * (no network). Empty means it may proceed to the live-activity probe.
 * NODE_ENV has no part in this decision.
 */
export function integrationTargetProblems(env: NodeJS.ProcessEnv, files: EnvFile[] = defaultEnvFiles()): string[] {
  const problems: string[] = [];
  if (env.BETGENIUS_DB_INTEGRATION !== "1") problems.push("BETGENIUS_DB_INTEGRATION=1 is not set (explicit opt-in to a check that writes)");

  const target = env.INTEGRATION_DATABASE_URL;
  if (!target) return [...problems, "INTEGRATION_DATABASE_URL is not set: the target must be a separately supplied, designated integration database"];
  const host = urlHost(target);
  if (!host) return [...problems, "INTEGRATION_DATABASE_URL does not parse as a URL"];

  if ((env.BETGENIUS_DB_INTEGRATION_HOST ?? "").toLowerCase() !== host) {
    problems.push("BETGENIUS_DB_INTEGRATION_HOST must equal the hostname in INTEGRATION_DATABASE_URL exactly");
  }
  // The checks connect through DATABASE_URL, so it must be the target and nothing else.
  if (env.DATABASE_URL !== target) problems.push("DATABASE_URL is not INTEGRATION_DATABASE_URL (run through npm run preflight:integration)");
  const unpooled = env.DATABASE_URL_UNPOOLED;
  const unpooledHost = unpooled ? urlHost(unpooled) : null;
  if (unpooled && !(unpooledHost && sameServer(host, unpooledHost))) {
    problems.push("DATABASE_URL_UNPOOLED points at a different database from the target");
  }

  const identities = normalDatabaseIdentities(env, files);
  if (!identities.length) {
    problems.push(
      `no normal database identity is available to compare against; set ${EXPLICIT_REFERENCE_URL} or ${EXPLICIT_REFERENCE_HOST} to the non-test database`,
    );
  }
  for (const id of identities) {
    if (!id.host) problems.push(`${id.source} does not parse, so the target cannot be shown to differ from it`);
    else if (sameServer(host, id.host)) problems.push(`the target is the normal database named by ${id.source}`);
  }
  return [...new Set(problems)];
}

/** How many JobRun rows the target has from the last 6 hours. Injectable so the guard can be tested offline. */
export type RecentActivityProbe = (url: string) => Promise<number>;

export const prismaActivityProbe: RecentActivityProbe = async (url) => {
  // Imported here, not at the top: loading @prisma/client reads .env into
  // process.env, and the preflight runner passes its environment to every check.
  const { PrismaClient } = await import("@prisma/client");
  const probe = new PrismaClient({ datasources: { db: { url: readOnlyUrl(url) } } });
  try {
    return await probe.jobRun.count({ where: { ranAt: { gte: new Date(Date.now() - 6 * 3_600_000) } } });
  } finally {
    await probe.$disconnect();
  }
};

/**
 * The whole guard: configuration first, then a read-only probe of the target.
 * The live scheduler writes a JobRun every few minutes, so recent rows mean the
 * database is serving real traffic. A fresh database without the table
 * (Prisma P2021) passes; any other probe failure refuses.
 */
export async function integrationGuardProblems(
  env: NodeJS.ProcessEnv,
  files: EnvFile[] = defaultEnvFiles(),
  probe: RecentActivityProbe = prismaActivityProbe,
): Promise<string[]> {
  const problems = integrationTargetProblems(env, files);
  if (problems.length) return problems;
  try {
    const recent = await probe(env.INTEGRATION_DATABASE_URL!);
    if (recent > 0) return [`${recent} JobRun row(s) in the last 6 hours: a live scheduler is writing to this database`];
  } catch (error: any) {
    if (error?.code !== "P2021") return [`could not verify the target: ${String(error?.message ?? error).split("\n").pop()}`];
  }
  return [];
}

/** Call first thing in any check that writes to the database. Exits (code 2) unless the guard passes. */
export async function assertIntegrationDatabase(): Promise<void> {
  const problems = await integrationGuardProblems(process.env);
  if (!problems.length) return;
  console.error("\nREFUSING to run a database-mutating check:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("See docs/PREFLIGHT.md (preflight:integration).\n");
  process.exit(2);
}
