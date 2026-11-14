/**
 * Sprint 03 — provider status lookup against a real (isolated) database.
 *
 * Inserts its own FixtureDetailCache rows and asserts loadStatusCodes: a
 * captured end-state is returned for its own fixture, a record for a DIFFERENT
 * fixture on the same matchKey (a rescheduled game) is ignored, rows with no
 * result record yield nothing, and an empty or keyless request makes no query.
 * Deletes its rows in `finally`. Refuses to run anywhere but an integration
 * database.
 *
 * Run: npm run preflight:integration (or directly with the integration env).
 */
export {};

// personalizationData reaches modules that call React cache(); make it a pass-through outside Next.
import "./lib/reactCacheShim";
import { assertIntegrationDatabase } from "./lib/dbSafety";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

const DAY = "2026-11-14";
const KICK = new Date("2026-11-14T15:00:00Z");
const T = (n: number) => 99100000 + n;
const row = (n: number) => ({ homeTeamApiId: T(n), awayTeamApiId: T(n + 1), kickoff: KICK });
const key = (n: number) => `${T(n)}-${T(n + 1)}-${DAY}`;

async function main() {
  await assertIntegrationDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const { loadStatusCodes } = await import("../src/lib/personalizationData");
  const keys = [10, 20, 30, 40].map(key);

  try {
    const mk = (n: number, fixtureApiId: number, detailJson: object) =>
      prisma.fixtureDetailCache.create({ data: { homeTeamApiId: T(n), awayTeamApiId: T(n + 1), kickoffDay: DAY, matchKey: key(n), fixtureApiId, detailJson, fetchedAt: new Date() } });
    await mk(10, 991001, { result: { fixtureApiId: 991001, status: "PST" } });
    await mk(20, 991002, { result: { fixtureApiId: 555555, status: "FT" } }); // another fixture's record
    await mk(30, 991003, { venue: "No result captured" });
    await mk(40, 991004, { result: { fixtureApiId: 991004, status: "FT" } });

    const codes = await loadStatusCodes([row(10), row(20), row(30), row(40), row(50)]);
    check("a captured postponement is returned for its fixture", codes.get(key(10)) === "PST", String(codes.get(key(10))));
    check("a captured full time is returned for its fixture", codes.get(key(40)) === "FT");
    check("a record for a different fixture on the same key is ignored", !codes.has(key(20)));
    check("a row with no result record yields nothing", !codes.has(key(30)));
    check("a fixture with no cache row yields nothing", !codes.has(key(50)));
    check("only the two valid codes come back", codes.size === 2, String(codes.size));
    check("an empty request returns an empty map", (await loadStatusCodes([])).size === 0);
    check("rows without team ids or kickoff are skipped, not an error", (await loadStatusCodes([{ homeTeamApiId: null, awayTeamApiId: 1, kickoff: KICK }, { homeTeamApiId: 1, awayTeamApiId: 2, kickoff: null }])).size === 0);
    check("it never writes: the rows are unchanged", (await prisma.fixtureDetailCache.count({ where: { matchKey: { in: keys } } })) === 4);
  } finally {
    await prisma.fixtureDetailCache.deleteMany({ where: { matchKey: { in: keys } } });
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
