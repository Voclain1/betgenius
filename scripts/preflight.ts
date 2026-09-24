/**
 * The preflight runner. One list per safety tier; see docs/PREFLIGHT.md.
 *
 *   npm run preflight              pure/local checks + TypeScript. No database
 *                                  (DATABASE_URL is replaced with an address that
 *                                  cannot resolve) and no outbound network (fetch
 *                                  is blocked). Safe even if .env names Production.
 *   npm run preflight:db           read-only checks against the configured
 *                                  database. The session is read-only in Postgres
 *                                  itself, verified before any check runs.
 *   npm run preflight:integration  checks that insert and delete rows. Refuses to
 *                                  start unless INTEGRATION_DATABASE_URL is a
 *                                  separate, provably non-Production database.
 *
 * Every step runs even after a failure, so one run reports every failure.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { NORMAL_DB_HOST_VARS, NORMAL_DB_URL_VARS, NO_DATABASE_URL, REFERENCE_PREFIX, integrationGuardProblems, readEnvFile, readOnlyUrl } from "./lib/dbSafety";
import { DB_READONLY_STEPS, INTEGRATION_STEPS, PURE_STEPS } from "./lib/preflightSteps";

/** Provider and payment secrets are removed so nothing can authenticate to an outside service. */
const NO_SECRETS = { API_FOOTBALL_KEY: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", PAYSTACK_SECRET_KEY: "", VAPID_PRIVATE_KEY: "" };

const NETWORK_GUARD = `--import=${pathToFileURL(resolve("scripts/lib/preflight-network-guard.mjs")).href}`;

function run(label: string, steps: string[], env: NodeJS.ProcessEnv) {
  console.log(`\n${label}: ${steps.length} step(s)\n`);
  const results: { step: string; ok: boolean; ms: number }[] = [];
  for (const step of steps) {
    const started = Date.now();
    console.log(`\n=== ${step}`);
    const r = spawnSync(`npx ${step}`, { stdio: "inherit", shell: true, env });
    results.push({ step, ok: r.status === 0, ms: Date.now() - started });
  }
  console.log(`\n${label} summary:`);
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.step}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

async function main() {
  const mode = process.argv.includes("--integration") ? "integration" : process.argv.includes("--db") ? "db" : "pure";
  const nodeOptions = [process.env.NODE_OPTIONS, NETWORK_GUARD].filter(Boolean).join(" ");

  if (mode === "pure") {
    run("preflight (pure, no database, no network)", PURE_STEPS, {
      ...process.env,
      ...NO_SECRETS,
      DATABASE_URL: NO_DATABASE_URL,
      DATABASE_URL_UNPOOLED: NO_DATABASE_URL,
      NODE_OPTIONS: nodeOptions,
    });
    return;
  }

  if (mode === "db") {
    const [pooled, direct] = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED];
    const dotEnv = readEnvFile(".env");
    const url = pooled ?? dotEnv.DATABASE_URL;
    const unpooled = direct ?? dotEnv.DATABASE_URL_UNPOOLED ?? url;
    if (!url) {
      console.error("preflight:db needs DATABASE_URL (environment or .env).");
      process.exit(1);
    }
    const env = { ...process.env, ...NO_SECRETS, DATABASE_URL: readOnlyUrl(url), DATABASE_URL_UNPOOLED: readOnlyUrl(unpooled!), NODE_OPTIONS: nodeOptions };
    // Fail closed: confirm Postgres will refuse writes on this session before running anything.
    // Lazy: importing @prisma/client loads .env into process.env, which every
    // pure check would then inherit.
    const { PrismaClient } = await import("@prisma/client");
    const probe = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    try {
      const [row] = await probe.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
      if (row?.transaction_read_only !== "on") throw new Error(`transaction_read_only is ${row?.transaction_read_only}`);
      console.log("preflight:db — session verified read-only (transaction_read_only = on)");
    } catch (error: any) {
      console.error(`preflight:db — refusing: could not verify a read-only session (${String(error?.message ?? error).split("\n").pop()})`);
      process.exit(1);
    } finally {
      await probe.$disconnect();
    }
    run("preflight:db (read-only database checks)", DB_READONLY_STEPS, env);
    return;
  }

  const target = process.env.INTEGRATION_DATABASE_URL;
  if (!target) {
    console.error("preflight:integration needs INTEGRATION_DATABASE_URL: a separate, disposable database. See docs/PREFLIGHT.md.");
    process.exit(2);
  }
  // Keep the normal database identities this run was started with, before
  // DATABASE_URL is pointed at the target, so the guard can compare against them.
  const references: Record<string, string> = {};
  for (const v of [...NORMAL_DB_URL_VARS, ...NORMAL_DB_HOST_VARS]) {
    const value = process.env[v];
    if (value) references[`${REFERENCE_PREFIX}${v}`] = value;
  }
  const env = { ...process.env, ...NO_SECRETS, ...references, DATABASE_URL: target, DATABASE_URL_UNPOOLED: target, NODE_OPTIONS: nodeOptions };
  // Configuration, then the read-only live-activity probe. Each check repeats it.
  const problems = await integrationGuardProblems(env);
  if (problems.length) {
    console.error("\nREFUSING preflight:integration:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  run("preflight:integration (writes to the isolated test database)", INTEGRATION_STEPS, env);
}

main();
