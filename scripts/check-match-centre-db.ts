/**
 * Sprint 02 — result capture against a real (isolated) database.
 *
 * Inserts its own FixtureDetailCache rows, runs captureFixtureResults the way
 * settlement and the fixture refresh do, and asserts the stored record:
 * rich capture stored, other detail keys untouched, a later slimmer capture
 * keeps events, other fixtures untouched, malformed rows ignored. Deletes its
 * rows in `finally`. Refuses to run anywhere but an integration database.
 *
 * Run: npm run preflight:integration (or directly with the integration env).
 */
export {};

import { assertIntegrationDatabase } from "./lib/dbSafety";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

const KEY_A = "it-mc-99000001-99000002-2026-11-14";
const KEY_B = "it-mc-99000003-99000004-2026-11-14";
const FX_A = 990000001;
const FX_B = 990000002;

async function main() {
  await assertIntegrationDatabase();
  const { prisma } = await import("../src/lib/prisma");
  const { captureFixtureResults } = await import("../src/lib/fixtureResultCapture");
  const { readFixtureResult } = await import("../src/lib/matchCentre");
  const read = async (key: string) => (await prisma.fixtureDetailCache.findUnique({ where: { matchKey: key } }))?.detailJson as Record<string, any> | null;

  try {
    const base = { homeTeamApiId: 99000001, awayTeamApiId: 99000002, kickoffDay: "2026-11-14" };
    await prisma.fixtureDetailCache.create({ data: { ...base, matchKey: KEY_A, fixtureApiId: FX_A, detailJson: { venue: "Test Ground", round: "Round 12", lineups: { kept: true } }, fetchedAt: new Date() } });
    await prisma.fixtureDetailCache.create({ data: { ...base, homeTeamApiId: 99000003, awayTeamApiId: 99000004, matchKey: KEY_B, fixtureApiId: FX_B, detailJson: { venue: "Other Ground" }, fetchedAt: new Date() } });

    const rich = {
      fixture: { id: FX_A, status: { short: "FT", elapsed: 90 } },
      teams: { home: { id: 99000001 }, away: { id: 99000002 } },
      score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 0 } },
      events: [{ time: { elapsed: 30 }, team: { id: 99000001 }, player: { name: "Scorer" }, type: "Goal", detail: "Normal Goal" }],
      statistics: [
        { team: { id: 99000001 }, statistics: [{ type: "Total Shots", value: 12 }] },
        { team: { id: 99000002 }, statistics: [{ type: "Total Shots", value: 4 }] },
      ],
    };
    const n1 = await captureFixtureResults([rich, { junk: true }, null]);
    check("one valid row written, malformed rows ignored", n1 === 1, `wrote ${n1}`);
    const a1 = await read(KEY_A);
    const r1 = readFixtureResult(a1?.result, FX_A);
    check("result stored with scores, events, statistics", r1?.status === "FT" && r1.fulltime?.home === 2 && r1.halftime?.home === 1 && r1.events?.length === 1 && r1.statistics?.length === 1);
    check("venue, round and lineups untouched", a1?.venue === "Test Ground" && a1?.round === "Round 12" && a1?.lineups?.kept === true);
    check("other fixture's row untouched", !(await read(KEY_B))?.result);

    // The date slate later re-reports the same fixture without events.
    const slim = { fixture: { id: FX_A, status: { short: "FT" } }, teams: rich.teams, score: { fulltime: { home: 2, away: 0 }, halftime: { home: null, away: null } } };
    await captureFixtureResults([slim]);
    const r2 = readFixtureResult((await read(KEY_A))?.result, FX_A);
    check("slimmer later capture keeps events, statistics and half-time", r2?.events?.length === 1 && r2?.statistics?.length === 1 && r2?.halftime?.home === 1);

    // A postponement reported for fixture B before kickoff.
    await captureFixtureResults([{ fixture: { id: FX_B, status: { short: "PST" } }, teams: { home: { id: 99000003 }, away: { id: 99000004 } }, score: {} }]);
    const b = readFixtureResult((await read(KEY_B))?.result, FX_B);
    check("postponed status recorded with no score", b?.status === "PST" && b.fulltime === null && b.events === null);

    check("no cache row for an unknown fixture id → nothing written, no throw", (await captureFixtureResults([{ fixture: { id: 990000999, status: { short: "FT" } } }])) === 0);
    check("read-back rejects a record for another fixture id", readFixtureResult((await read(KEY_A))?.result, FX_B) === null);
  } finally {
    await prisma.fixtureDetailCache.deleteMany({ where: { matchKey: { in: [KEY_A, KEY_B] } } });
    const left = await prisma.fixtureDetailCache.count({ where: { matchKey: { in: [KEY_A, KEY_B] } } });
    check("cleanup: no test rows remain", left === 0);
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
