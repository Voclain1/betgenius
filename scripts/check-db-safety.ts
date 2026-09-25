/**
 * The preflight tiers cannot touch Production. Pure: no database, no network.
 *
 * Pins the split (scripts/lib/preflightSteps.ts) and the guards
 * (scripts/lib/dbSafety.ts): default preflight has no database-backed step,
 * every step that writes lives in the integration tier behind
 * assertIntegrationDatabase, and that guard refuses the obvious ways of
 * pointing it at Production.
 *
 * Run: npx tsx scripts/check-db-safety.ts
 */
import { readFileSync } from "node:fs";
import { NO_DATABASE_URL, integrationGuardProblems, integrationTargetProblems, readEnvFile, readOnlyUrl, type EnvFile } from "./lib/dbSafety";
import { DB_READONLY_STEPS, INTEGRATION_STEPS, PURE_STEPS } from "./lib/preflightSteps";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

const scriptOf = (step: string) => /scripts\/[\w.-]+\.tsx?/.exec(step)?.[0] ?? null;
// A Prisma write, as it appears in a check script.
// The raw-SQL name is split so this file does not match its own pattern.
const RAW_WRITE = "execute" + "Raw";
const WRITE = new RegExp(`\\bprisma\\.\\w+\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\(|\\$${RAW_WRITE}`);

console.log("\nthe tiers:");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
check("npm run preflight is the runner, not a hand-maintained chain", pkg.scripts.preflight === "tsx scripts/preflight.ts");
check("preflight:db and preflight:integration exist", pkg.scripts["preflight:db"] === "tsx scripts/preflight.ts --db" && pkg.scripts["preflight:integration"] === "tsx scripts/preflight.ts --integration");
const all = [...PURE_STEPS, ...DB_READONLY_STEPS, ...INTEGRATION_STEPS];
check("no step is in two tiers", new Set(all).size === all.length);
check("TypeScript is part of default preflight", PURE_STEPS.includes("tsc --noEmit -p tsconfig.json"));
for (const s of ["check-tier-provenance", "check-vip-premium-gate", "check-betofday-targeting"]) {
  check(`${s} writes, so it is integration-only`, INTEGRATION_STEPS.some((x) => x.includes(s)) && !PURE_STEPS.some((x) => x.includes(s)));
}
for (const s of ["check-schema-sync", "check-feed-days", "check-prediction-slugs"]) {
  check(`${s} reads the live database, so it is not in default preflight`, DB_READONLY_STEPS.some((x) => x.includes(s)) && !PURE_STEPS.some((x) => x.includes(s)));
}
const knownWriters = INTEGRATION_STEPS.map(scriptOf).filter((f): f is string => !!f);
check("positive control: the write pattern flags every known writer", knownWriters.length === 3 && knownWriters.every((f) => WRITE.test(readFileSync(f, "utf8"))));
const pureWriters = PURE_STEPS.map(scriptOf).filter((f): f is string => !!f).filter((f) => WRITE.test(readFileSync(f, "utf8")));
check("no default-preflight script contains a Prisma write", pureWriters.length === 0, pureWriters);
const dbWriters = DB_READONLY_STEPS.map(scriptOf).filter((f): f is string => !!f).filter((f) => WRITE.test(readFileSync(f, "utf8")));
check("no preflight:db script contains a Prisma write", dbWriters.length === 0, dbWriters);
for (const step of INTEGRATION_STEPS) {
  const file = scriptOf(step)!;
  const src = readFileSync(file, "utf8");
  const main = src.indexOf("async function main() {");
  const guard = src.indexOf("await assertIntegrationDatabase();", main);
  const prismaImport = src.indexOf('import("../src/lib/prisma")', main);
  check(`${file} calls the guard before it loads Prisma`, main > -1 && guard > main && prismaImport > guard);
  check(`${file} has no static Prisma import that could run first`, !/^import \{ prisma \}/m.test(src));
}

console.log("\ndefault preflight cannot reach a database or the network:");
const runner = readFileSync("scripts/preflight.ts", "utf8");
check("the unreachable address is under .invalid, which never resolves", new URL(NO_DATABASE_URL).hostname.endsWith(".invalid"));
check("pure mode overrides both database URLs with it", /DATABASE_URL: NO_DATABASE_URL,\s*DATABASE_URL_UNPOOLED: NO_DATABASE_URL/.test(runner));
check("pure mode preloads the network guard", runner.includes("preflight-network-guard.mjs") && /NODE_OPTIONS: nodeOptions/.test(runner));
const dbSafetySource = readFileSync("scripts/lib/dbSafety.ts", "utf8");
check(
  "the runner never loads @prisma/client at startup (that would read .env into every check's environment)",
  !/^import .*@prisma\/client/m.test(runner) && !/^import .*@prisma\/client/m.test(dbSafetySource),
);
check("provider and payment secrets are removed", /API_FOOTBALL_KEY: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", PAYSTACK_SECRET_KEY: ""/.test(runner));

console.log("\npreflight:db is read-only in Postgres itself:");
const ro = new URL(readOnlyUrl("postgresql://u:p@db.example.test:5432/app?sslmode=require"));
check("the session option is set", ro.searchParams.get("options") === "-c default_transaction_read_only=on");
check("existing parameters are kept", ro.searchParams.get("sslmode") === "require");
check("the runner verifies transaction_read_only = on before running anything", /SHOW transaction_read_only/.test(runner) && runner.indexOf("SHOW transaction_read_only") < runner.indexOf('run("preflight:db'));

console.log("\nno infrastructure fingerprint is kept in source:");
// Every file of the preflight and guard machinery, plus its documentation.
const SAFETY_FILES = [
  "scripts/lib/dbSafety.ts",
  "scripts/lib/preflightSteps.ts",
  "scripts/lib/preflight-network-guard.mjs",
  "scripts/preflight.ts",
  "scripts/check-db-safety.ts",
  "docs/PREFLIGHT.md",
];
const HEX_DIGEST = /\b[0-9a-f]{32,}\b/i;
check("no hash or digest literal in any safety file", SAFETY_FILES.every((f) => !HEX_DIGEST.test(readFileSync(f, "utf8"))), SAFETY_FILES.filter((f) => HEX_DIGEST.test(readFileSync(f, "utf8"))));
check("the guard computes no hashes", !/node:crypto|createHash/.test(dbSafetySource));
// Only the synthetic hosts used in this file and the docs example may appear.
const SYNTHETIC_ENDPOINTS = new Set(["ep-test-branch-000000", "ep-normal-db-111111", "ep-other-000000", "ep-test-branch-123456", "ep-cool-name-123456"]);
const endpoints = SAFETY_FILES.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bep-[a-z]+(?:-[a-z]+)*-\d{6}\b/g)].map((m) => m[0]));
check("every Neon endpoint named in a safety file is synthetic", endpoints.every((e) => SYNTHETIC_ENDPOINTS.has(e)), endpoints.filter((e) => !SYNTHETIC_ENDPOINTS.has(e)));
// Against whatever real identities this machine has (none in CI): read, compared, never printed.
const localValues: string[] = [];
for (const file of [".env", ".env.local"]) {
  const vars = readEnvFile(file);
  for (const [key, value] of Object.entries(vars)) {
    if (!/DATABASE|POSTGRES|PG|NEON|DIRECT_URL/.test(key) || value.length < 6) continue;
    localValues.push(value);
    try {
      const u = new URL(value);
      localValues.push(u.hostname, u.username, decodeURIComponent(u.password), u.pathname.slice(1));
      const ep = /^(ep-[a-z0-9-]+?)(-pooler)?\./.exec(u.hostname)?.[1];
      if (ep) localValues.push(ep);
    } catch {
      /* a bare host or name: already added */
    }
  }
}
const leaked = SAFETY_FILES.filter((f) => localValues.some((v) => v.length >= 6 && readFileSync(f, "utf8").includes(v)));
check(`no local database identity appears in a safety file (${localValues.length} values compared)`, leaked.length === 0, leaked);

console.log("\nthe integration guard compares against runtime identities and fails closed:");
check(
  "the runner copies the normal database variables before pointing DATABASE_URL at the target",
  /references\[`\$\{REFERENCE_PREFIX\}\$\{v\}`\] = value/.test(runner) && runner.indexOf("REFERENCE_PREFIX}${v}") < runner.indexOf("DATABASE_URL: target"),
);
const TEST_HOST = "ep-test-branch-000000.us-east-2.aws.neon.tech";
const TEST = `postgresql://u:p@${TEST_HOST}/test`;
const NORMAL_POOLED = "postgresql://u:p@ep-normal-db-111111-pooler.us-east-2.aws.neon.tech/app";
const NORMAL_DIRECT = "postgresql://u:p@ep-normal-db-111111.us-east-2.aws.neon.tech/app";
const DOT_ENV: EnvFile[] = [{ name: ".env", vars: { DATABASE_URL: NORMAL_POOLED, DATABASE_URL_UNPOOLED: NORMAL_DIRECT } }];
// What the runner hands a check: the target as DATABASE_URL, normal identities copied aside.
const isolated = {
  BETGENIUS_DB_INTEGRATION: "1",
  INTEGRATION_DATABASE_URL: TEST,
  BETGENIUS_DB_INTEGRATION_HOST: TEST_HOST,
  DATABASE_URL: TEST,
  DATABASE_URL_UNPOOLED: TEST,
  BETGENIUS_REFERENCE_DATABASE_URL: NORMAL_POOLED,
} as unknown as NodeJS.ProcessEnv;
const targeting = (url: string, extra: Record<string, string | undefined> = {}) =>
  ({ ...isolated, INTEGRATION_DATABASE_URL: url, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, BETGENIUS_DB_INTEGRATION_HOST: new URL(url).hostname, ...extra }) as unknown as NodeJS.ProcessEnv;
const refused = (env: NodeJS.ProcessEnv, files: EnvFile[], needle: string) => integrationTargetProblems(env, files).some((p) => p.includes(needle));

check("a structurally valid isolated target passes configuration", integrationTargetProblems(isolated, DOT_ENV).length === 0, integrationTargetProblems(isolated, DOT_ENV));
check("integration URL equal to the normal DATABASE_URL (runner copy): refused", refused(targeting(NORMAL_POOLED), [], "BETGENIUS_REFERENCE_DATABASE_URL"));
check("integration URL equal to DATABASE_URL in .env: refused", refused(targeting(NORMAL_POOLED, { BETGENIUS_REFERENCE_DATABASE_URL: undefined }), DOT_ENV, ".env:DATABASE_URL"));
check("integration URL equal to DIRECT_URL: refused", refused(targeting(NORMAL_DIRECT, { BETGENIUS_REFERENCE_DATABASE_URL: undefined, DIRECT_URL: NORMAL_DIRECT }), [], "the normal database named by DIRECT_URL"));
check("...and to a runner-copied DIRECT_URL", refused(targeting(NORMAL_DIRECT, { BETGENIUS_REFERENCE_DATABASE_URL: undefined, BETGENIUS_REFERENCE_DIRECT_URL: NORMAL_DIRECT }), [], "BETGENIUS_REFERENCE_DIRECT_URL"));
check("the normal database's direct host is caught through its pooled one (same Neon endpoint)", refused(targeting(NORMAL_DIRECT), [], "BETGENIUS_REFERENCE_DATABASE_URL"));
check("a host-only variable (PGHOST) is compared too", refused(targeting(NORMAL_DIRECT, { BETGENIUS_REFERENCE_DATABASE_URL: undefined, PGHOST: "ep-normal-db-111111.us-east-2.aws.neon.tech" }), [], "PGHOST"));
check("mismatched hostname confirmation: refused", refused({ ...isolated, BETGENIUS_DB_INTEGRATION_HOST: "ep-other-000000.us-east-2.aws.neon.tech" } as NodeJS.ProcessEnv, DOT_ENV, "BETGENIUS_DB_INTEGRATION_HOST"));
check("missing hostname confirmation: refused", refused({ ...isolated, BETGENIUS_DB_INTEGRATION_HOST: undefined } as NodeJS.ProcessEnv, DOT_ENV, "BETGENIUS_DB_INTEGRATION_HOST"));
check(
  "no normal or reference identity available: refused, not silently allowed",
  refused({ ...isolated, BETGENIUS_REFERENCE_DATABASE_URL: undefined } as NodeJS.ProcessEnv, [], "no normal database identity is available"),
);
check(
  "...and an explicit reference host alone is enough to compare against",
  integrationTargetProblems({ ...isolated, BETGENIUS_REFERENCE_DATABASE_URL: undefined, BETGENIUS_REFERENCE_DATABASE_HOST: "db.normal.example" } as NodeJS.ProcessEnv, []).length === 0,
);
check("an unparseable normal identity refuses rather than being skipped", refused({ ...isolated, BETGENIUS_REFERENCE_DATABASE_URL: "not a url" } as NodeJS.ProcessEnv, [], "does not parse"));
check("missing mutation opt-in: refused", refused({ ...isolated, BETGENIUS_DB_INTEGRATION: undefined } as NodeJS.ProcessEnv, DOT_ENV, "BETGENIUS_DB_INTEGRATION=1"));
check("NODE_ENV=test is not an opt-in", refused({ ...isolated, BETGENIUS_DB_INTEGRATION: undefined, NODE_ENV: "test" } as NodeJS.ProcessEnv, DOT_ENV, "BETGENIUS_DB_INTEGRATION=1"));
check("NODE_ENV=production does not change a valid verdict (no safety role)", integrationTargetProblems({ ...isolated, NODE_ENV: "production" } as NodeJS.ProcessEnv, DOT_ENV).length === 0);
check("no designated integration URL: refused", refused({ ...isolated, INTEGRATION_DATABASE_URL: undefined } as NodeJS.ProcessEnv, DOT_ENV, "INTEGRATION_DATABASE_URL is not set"));
check("DATABASE_URL not pointed at the designated target: refused", refused({ ...isolated, DATABASE_URL: NORMAL_POOLED } as NodeJS.ProcessEnv, DOT_ENV, "DATABASE_URL is not INTEGRATION_DATABASE_URL"));
check("an unpooled URL on a different database: refused", refused({ ...isolated, DATABASE_URL_UNPOOLED: NORMAL_DIRECT } as NodeJS.ProcessEnv, DOT_ENV, "DATABASE_URL_UNPOOLED"));

(async () => {
  console.log("\n...then the live-activity probe (injected, no network):");
  const probed: string[] = [];
  const quiet = async (url: string) => (probed.push(url), 0);
  check("a valid isolated target proceeds to the probe and passes when it is quiet", (await integrationGuardProblems(isolated, DOT_ENV, quiet)).length === 0 && probed.join() === TEST);
  check(
    "recent scheduler activity refuses",
    (await integrationGuardProblems(isolated, DOT_ENV, async () => 4)).some((p) => p.includes("a live scheduler is writing")),
  );
  const missingTable = async () => {
    throw Object.assign(new Error("table does not exist"), { code: "P2021" });
  };
  check("a fresh database without the JobRun table passes", (await integrationGuardProblems(isolated, DOT_ENV, missingTable)).length === 0);
  check("any other probe failure refuses", (await integrationGuardProblems(isolated, DOT_ENV, async () => { throw new Error("connection refused"); })).some((p) => p.includes("could not verify")));
  probed.length = 0;
  check(
    "a refused configuration never reaches the probe",
    (await integrationGuardProblems(targeting(NORMAL_POOLED), [], quiet)).length > 0 && probed.length === 0,
  );

  if (failures) {
    console.error(`\n${failures} database safety check(s) failed`);
    process.exit(1);
  }
  console.log("\ndatabase safety checks passed");
})();
