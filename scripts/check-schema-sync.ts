/**
 * Fails when prisma/schema.prisma and the live database disagree.
 *
 * This exists because of a specific, real incident: GenerationAttempt.leagueName
 * sat in the schema for a whole change set without ever being pushed, while
 * queue.ts read it in three places. Discovery and the consumer would both have
 * thrown P2022 on their next scheduled run — and NOTHING caught it. Typecheck
 * passed, 113 generation assertions passed, the production build passed, because
 * not one of them touches that column. A fully-green suite hid an unrunnable
 * application.
 *
 * DIRECTION MATTERS, and this is the whole design.
 *
 *   Database MISSING something the schema declares  -> FAIL.
 *     This is the dangerous direction and the one that caused the incident.
 *     The code expects a column that does not exist, so every query touching
 *     it throws at runtime, in production, on a schedule, with no local signal.
 *
 *   Database has EXTRA things the schema no longer declares -> WARN.
 *     Harmless to reads, and failing here would block a rollback: deploying an
 *     older build whose schema predates a column is a legitimate, often urgent
 *     action, and a check that forbids it would be worse than the problem it
 *     prevents. Pass --strict to fail on this too.
 *
 * UNREACHABLE DATABASE IS NOT DRIFT. Neon idles and connections drop; that
 * happened twice while this was being written. Being unable to check is not
 * evidence of a problem, so an unreachable database warns and exits 0 rather
 * than breaking a deploy over a transient network fault.
 *
 * Run: npx tsx scripts/check-schema-sync.ts [--strict]
 */
export {};

import { execFileSync } from "child_process";

const STRICT = process.argv.includes("--strict");
const SCHEMA = "prisma/schema.prisma";

/** Statements that mean the DATABASE IS BEHIND the schema — the failing direction. */
const BEHIND = [
  /\bADD COLUMN\b/i,
  /\bCREATE TABLE\b/i,
  /\bCREATE UNIQUE INDEX\b/i,
  /\bCREATE INDEX\b/i,
  /\bADD CONSTRAINT\b/i,
  /\bCREATE TYPE\b/i,
  /\bALTER COLUMN\b.*\bSET NOT NULL\b/i,
];

/** Statements that mean the DATABASE HAS EXTRAS — tolerated unless --strict. */
const AHEAD = [/\bDROP COLUMN\b/i, /\bDROP TABLE\b/i, /\bDROP INDEX\b/i, /\bDROP CONSTRAINT\b/i, /\bDROP TYPE\b/i];

function runDiff(): { ok: true; sql: string } | { ok: false; reason: string } {
  try {
    // from datasource -> to datamodel: the SQL that would bring the DATABASE up
    // to the schema. So ADD statements mean the database is missing them.
    const sql = execFileSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datasource",
        SCHEMA,
        "--to-schema-datamodel",
        SCHEMA,
        "--script",
      ],
      // shell:true is required for npx resolution on Windows.
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
    );
    return { ok: true, sql };
  } catch (err: any) {
    const message = String(err?.stderr || err?.message || err);
    return { ok: false, reason: message.trim().split("\n").slice(0, 4).join(" ") };
  }
}

function main() {
  // DATABASE_URL is deliberately NOT read from process.env here. tsx does not
  // load .env, but the Prisma CLI does — so checking the variable directly
  // would report "not configured" on a machine where it plainly is. Let the
  // CLI resolve it and classify what comes back instead.
  const result = runDiff();

  if (!result.ok && /Environment variable not found|DATABASE_URL/i.test(result.reason)) {
    // Not a failure: this lets the check sit in CI before the secret is
    // configured without turning every run red.
    console.log("SKIP  schema-sync — no DATABASE_URL available to this process.");
    console.log("      Configure it to make this check meaningful.");
    return;
  }

  // Only a genuine CONNECTIVITY problem is tolerated. A spawn failure, a
  // missing binary or a malformed schema means the check did not run at all,
  // and treating that as "fine" would be the same silent pass this file exists
  // to prevent — the first draft of this script did exactly that, reporting an
  // EINVAL from a bad binary name as though the database were merely asleep.
  const UNREACHABLE = /Can't reach database server|connection.*(refused|reset|timed? out)|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

  if (!result.ok && UNREACHABLE.test(result.reason)) {
    console.log("WARN  schema-sync — could not reach the database, so no comparison was made.");
    console.log(`      ${result.reason}`);
    console.log("      Being unable to check is not evidence of drift; not failing on it.");
    return;
  }

  if (!result.ok) {
    console.log("FAIL  schema-sync — the check itself could not run.");
    console.log(`      ${result.reason}`);
    console.log("      This is not a pass. Fix the tooling and re-run.");
    process.exitCode = 1;
    return;
  }

  const sql = result.sql.trim();
  const statements = sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"));

  if (statements.length === 0) {
    console.log("PASS  schema-sync — prisma/schema.prisma matches the live database.");
    return;
  }

  const behind = statements.filter((s) => BEHIND.some((rx) => rx.test(s)));
  const ahead = statements.filter((s) => AHEAD.some((rx) => rx.test(s)));
  const other = statements.filter((s) => !behind.includes(s) && !ahead.includes(s));

  console.log("schema-sync — prisma/schema.prisma and the live database DISAGREE.\n");

  if (behind.length) {
    console.log("The database is MISSING these (code expecting them throws P2022 at runtime):");
    for (const s of behind) console.log(`   ${s}`);
    console.log("");
  }
  if (ahead.length) {
    console.log("The database has EXTRAS the schema no longer declares (harmless to reads):");
    for (const s of ahead) console.log(`   ${s}`);
    console.log("");
  }
  if (other.length) {
    console.log("Other differences:");
    for (const s of other) console.log(`   ${s}`);
    console.log("");
  }

  // Anything unclassified is treated as failing: an unrecognised statement is
  // not evidence of safety, and a silent pass is what this check exists to
  // prevent.
  const fatal = behind.length > 0 || other.length > 0 || (STRICT && ahead.length > 0);

  if (fatal) {
    console.log("FAIL  schema-sync.");
    console.log("      Fix with:  npx prisma db push");
    console.log("      Then re-run this check before committing or deploying.");
    process.exitCode = 1;
    return;
  }

  console.log("WARN  schema-sync — database is ahead of the schema, which does not break reads.");
  console.log("      Pass --strict to treat this as a failure.");
}

main();
