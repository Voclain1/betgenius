/**
 * Odds warming is breadth-first across the whole horizon, not depth-first on
 * whatever kicks off soonest.
 *
 * THE BUG THIS LOCKS OUT. Published picks were priced only inside the Lagos day
 * (`lagosTodayBounds`), and the other half of the scope only sees UN-GENERATED
 * ledger rows — of which there are normally zero, because ordinary generation
 * drains the ledger. A pick kicking off in 24-72h was therefore reachable by
 * neither half. Measured: of 192 fixtures in the next 72h, 45 had any price and
 * 25 were fresh, every fresh one kicking off the same day; 147 had no price at
 * all. Bet of the Day rejected 173 of 286 picks for "no cached bookmaker price".
 *
 * Even with the horizon widened, ORDERING can reintroduce the same starvation:
 * near-kickoff published picks are re-priced hourly, so if they sort first they
 * refill the head of a queue that is longer than `limit` on every cycle and the
 * far end is never reached. Hence the second assertion: a fixture with no price
 * outranks one merely being refreshed.
 *
 * PURE — the ordering rule is asserted directly against selectStaleOddsTargets
 * with a stubbed cache, so no api-football call is made and no odds are fetched.
 *
 * Run: npx tsx --env-file=.env scripts/check-odds-breadth.ts
 */
export {};

import assert from "node:assert/strict";
import {
  ODDS_PUBLISHED_HORIZON_MS,
  ODDS_CANDIDATE_HORIZON_MS,
  ODDS_NEAR_KICKOFF_WINDOW_MS,
  ODDS_NEAR_KICKOFF_TTL_MS,
} from "../src/lib/enrichment";

const H = 3_600_000;

// ---------------------------------------------------------------------------
// 1. The published horizon actually spans the next 72h, and matches the
//    candidate horizon. Two different answers to "how far ahead do we care
//    about odds" is how the gap opened in the first place.
// ---------------------------------------------------------------------------
assert.equal(
  ODDS_PUBLISHED_HORIZON_MS,
  72 * H,
  "published picks must be priceable across the whole 72h horizon, not just today",
);
assert.equal(
  ODDS_PUBLISHED_HORIZON_MS,
  ODDS_CANDIDATE_HORIZON_MS,
  "the published and candidate horizons must agree — the same research bounds both",
);
// A Lagos day is at most 24h, so anything <= that would reproduce the bug.
assert(ODDS_PUBLISHED_HORIZON_MS > 24 * H, "a horizon of a day or less is the bug this replaced");

// ---------------------------------------------------------------------------
// 2. Breadth before depth. Asserted against the real selector with a stubbed
//    cache, because the ordering is the part that silently regresses.
// ---------------------------------------------------------------------------
const NOW = new Date("2026-09-19T12:00:00Z");

type Row = { matchKey: string; fetchedAt: Date | null; lastAttemptAt: Date | null };
const rows: Row[] = [
  // Priced an hour ago and kicking off in 3h: due again on the near-kickoff TTL.
  { matchKey: "near-priced", fetchedAt: new Date(NOW.getTime() - ODDS_NEAR_KICKOFF_TTL_MS - 60_000), lastAttemptAt: null },
  // Never priced, kicking off in 50h: the one that used to starve.
  { matchKey: "far-unpriced", fetchedAt: null, lastAttemptAt: null },
];

const targets = [
  { matchKey: "near-priced", fixtureApiId: 1, kickoff: new Date(NOW.getTime() + 3 * H), kind: "published" as const },
  { matchKey: "far-unpriced", fixtureApiId: 2, kickoff: new Date(NOW.getTime() + 50 * H), kind: "published" as const },
];

// Stub only the one query selectStaleOddsTargets makes.
const prismaModule = require("../src/lib/prisma");
prismaModule.prisma.fixtureOddsCache = {
  findMany: async () => rows,
};

async function main() {
  const { selectStaleOddsTargets } = await import("../src/lib/enrichment");
  const due = await selectStaleOddsTargets(targets, NOW);

  const keys = due.map((t) => t.matchKey);
  assert(keys.includes("far-unpriced"), "a never-priced fixture 50h out must be due");
  assert(keys.includes("near-priced"), "a near-kickoff fixture past its TTL must still be due");
  assert.equal(
    keys[0],
    "far-unpriced",
    "BREADTH FIRST: an unpriced fixture must outrank one merely being refreshed, or a " +
      "queue longer than `limit` never reaches the far end of the horizon",
  );

  // And the near-kickoff cadence itself is unchanged — breadth-first must not
  // have cost freshness where freshness is what matters.
  assert.equal(ODDS_NEAR_KICKOFF_WINDOW_MS, 24 * H, "near-kickoff window unchanged");
  assert.equal(ODDS_NEAR_KICKOFF_TTL_MS, 1 * H, "hourly refresh inside 24h unchanged");

  // A fixture beyond the near-kickoff window that HAS a price is not re-polled:
  // that is what keeps the widened horizon affordable — one call per fixture,
  // not one per cycle.
  const pricedFar = await selectStaleOddsTargets(
    [{ matchKey: "far-priced", fixtureApiId: 3, kickoff: new Date(NOW.getTime() + 50 * H), kind: "published" as const }],
    NOW,
  );
  prismaModule.prisma.fixtureOddsCache = {
    findMany: async () => [{ matchKey: "far-priced", fetchedAt: new Date(NOW.getTime() - 10 * H), lastAttemptAt: null }],
  };
  const pricedFarAgain = await selectStaleOddsTargets(
    [{ matchKey: "far-priced", fixtureApiId: 3, kickoff: new Date(NOW.getTime() + 50 * H), kind: "published" as const }],
    NOW,
  );
  assert.equal(pricedFar.length, 1, "an unknown far fixture is due once");
  assert.equal(
    pricedFarAgain.length,
    0,
    "a far fixture that already has a price is NOT re-polled — this is the quota guard",
  );

  console.log(
    "Odds breadth checks passed: the published horizon spans 72h and matches the candidate horizon; " +
      "unpriced fixtures outrank refreshes so the far end of the horizon is reached; near-kickoff hourly " +
      "freshness is unchanged; and a far fixture is priced once rather than every cycle.",
  );
}

main().catch((e) => {
  console.error("check-odds-breadth FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
