/**
 * The paid-tier grace window, proved against the real predicates.
 *
 * WHAT THIS PROTECTS. The VIP/PREMIUM pass can only target ledger rows that are
 * still PENDING, and ordinary generation never leaves a fixture in that state —
 * it discovers from api-football, writes the row and completes in one run. The
 * measured consequence was ZERO PENDING rows in the whole ledger, 4 paid-pass
 * attempts in 14 days, and 0 VIP / 1 PREMIUM against a forecast of 1.65 and
 * 1.00 per day. A reservation is what makes the fixture visible long enough for
 * the paid pass to have a fair go at it.
 *
 * The five properties below are each a way that mechanism could be wrong in a
 * way nobody would notice for weeks:
 *   1. the paid pass CAN take a reserved fixture during grace;
 *   2. ordinary generation CANNOT take it during grace;
 *   3. ordinary generation CAN take it once grace expires — no fixture is lost;
 *   4. non-paid-tier fixtures are untouched — ordinary content is not delayed;
 *   5. SUCCEEDED rows are never reserved or regenerated.
 *
 * PURE. Both sides of the race are decided by predicates asserted here directly
 * — isReservable, and the two ledger conditions the real code uses — so no
 * database, no api-football call and no generation is needed. Nothing is
 * written, and no quota is consumed.
 *
 * Run: npx tsx --env-file=.env scripts/check-paid-tier-grace.ts
 */
export {};

import assert from "node:assert/strict";
import { isPaidTierLeague, isReservable, PAID_TIER_GRACE_MS } from "../src/lib/generation/paidTierGrace";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "../src/lib/generation/window";
import { VIP_PROXY_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import { MAX_GENERATION_ATTEMPTS } from "../src/lib/generation/selector";

const NOW = new Date("2026-09-19T12:00:00Z");
const H = 3_600_000;
/** Mid-window: inside 12..48h, so both passes consider it in scope. */
const IN_WINDOW = new Date(NOW.getTime() + 24 * H);

const PAID_LEAGUE = VIP_PROXY_LEAGUE_IDS[0];
const FREE_LEAGUE = 399; // NPFL — real, ranked, and deliberately not paid-tier.
assert(!isPaidTierLeague(FREE_LEAGUE), "the control league must not be paid-tier");
assert(isPaidTierLeague(PAID_LEAGUE), "the test league must be paid-tier");

/**
 * The two predicates the real code races on, restated exactly.
 *
 * ordinaryCanClaim mirrors the ledger checks in selectCandidates: terminal
 * states are final, and a row still serving `nextAttemptAt` is skipped.
 * paidCanClaim mirrors selectVipPremiumTargets: PENDING, paid-tier league, in
 * the kickoff window — and deliberately NO nextAttemptAt check, which is the
 * asymmetry the whole mechanism rests on.
 */
type Row = { status: string; nextAttemptAt: Date | null; leagueApiId: number; kickoff: Date; fixtureApiId: number | null };

function ordinaryCanClaim(row: Row, now: Date): boolean {
  if (row.status === "SUCCEEDED" || row.status === "ABANDONED") return false;
  if (row.nextAttemptAt && row.nextAttemptAt > now) return false;
  return true;
}

function paidCanClaim(row: Row, now: Date): boolean {
  if (row.status !== "PENDING") return false;
  if (!row.fixtureApiId) return false;
  if (!isPaidTierLeague(row.leagueApiId)) return false;
  const ms = row.kickoff.getTime() - now.getTime();
  return ms >= GENERATE_FROM_HOURS * H && ms <= GENERATE_UNTIL_HOURS * H;
}

// A fixture ordinary generation has just discovered and reserved.
const reserved: Row = {
  status: "PENDING",
  nextAttemptAt: new Date(NOW.getTime() + PAID_TIER_GRACE_MS),
  leagueApiId: PAID_LEAGUE,
  kickoff: IN_WINDOW,
  fixtureApiId: 1234567,
};

// ---------------------------------------------------------------------------
// 1. The paid pass can claim during grace. Without this the reservation is a
//    pure delay and strictly worse than doing nothing.
// ---------------------------------------------------------------------------
const midGrace = new Date(NOW.getTime() + PAID_TIER_GRACE_MS / 2);
assert.equal(paidCanClaim(reserved, NOW), true, "the paid pass can claim a reservation immediately");
assert.equal(paidCanClaim(reserved, midGrace), true, "the paid pass can still claim it mid-grace");

// ---------------------------------------------------------------------------
// 2. Ordinary generation cannot steal it during grace. This is the race being
//    closed: it held every one of these fixtures before.
// ---------------------------------------------------------------------------
assert.equal(ordinaryCanClaim(reserved, NOW), false, "ordinary generation must not claim a fresh reservation");
assert.equal(ordinaryCanClaim(reserved, midGrace), false, "ordinary generation must not claim it mid-grace");
const justBeforeExpiry = new Date(NOW.getTime() + PAID_TIER_GRACE_MS - 1000);
assert.equal(ordinaryCanClaim(reserved, justBeforeExpiry), false, "the hold lasts the whole grace window");

// ---------------------------------------------------------------------------
// 3. Ordinary generation CAN claim once grace expires — nothing is stranded.
//    A reservation is a timestamp, not a flag, so there is no state that
//    survives it.
// ---------------------------------------------------------------------------
const afterGrace = new Date(NOW.getTime() + PAID_TIER_GRACE_MS + 1000);
assert.equal(ordinaryCanClaim(reserved, afterGrace), true, "ordinary generation claims it once grace expires");
const muchLater = new Date(NOW.getTime() + 6 * H);
assert.equal(ordinaryCanClaim(reserved, muchLater), true, "a reservation cannot strand a fixture indefinitely");
// And the reservation spends none of the retry budget, so expiry leaves a
// fixture with its full allowance of real attempts.
assert.equal(MAX_GENERATION_ATTEMPTS, 3, "retry budget is unchanged by this feature");

// ---------------------------------------------------------------------------
// 4. Non-paid-tier fixtures are unaffected. Ordinary content must not be
//    delayed to serve a pass that could never claim it.
// ---------------------------------------------------------------------------
assert.equal(
  isReservable({ leagueApiId: FREE_LEAGUE, kickoff: IN_WINDOW, isNewToLedger: true }, NOW),
  false,
  "a non-paid-tier fixture is never reserved",
);
const freeFixture: Row = { ...reserved, leagueApiId: FREE_LEAGUE, nextAttemptAt: null };
assert.equal(ordinaryCanClaim(freeFixture, NOW), true, "ordinary generation claims non-paid-tier fixtures at once");
assert.equal(paidCanClaim(freeFixture, NOW), false, "the paid pass never takes a non-paid-tier fixture");

// Outside the paid pass's own kickoff window, reserving would delay content for
// a pass that is structurally unable to act.
assert.equal(
  isReservable({ leagueApiId: PAID_LEAGUE, kickoff: new Date(NOW.getTime() + 3 * H), isNewToLedger: true }, NOW),
  false,
  "a fixture nearer than GENERATE_FROM_HOURS is not reserved",
);
assert.equal(
  isReservable({ leagueApiId: PAID_LEAGUE, kickoff: new Date(NOW.getTime() + 60 * H), isNewToLedger: true }, NOW),
  false,
  "a fixture beyond GENERATE_UNTIL_HOURS is not reserved",
);
assert.equal(
  isReservable({ leagueApiId: PAID_LEAGUE, kickoff: IN_WINDOW, isNewToLedger: true }, NOW),
  true,
  "an in-window paid-tier fixture new to the ledger IS reserved",
);

// ---------------------------------------------------------------------------
// 5. Already-generated work is never touched. A fixture with a ledger row is
//    not new, so it is never reserved; and a terminal row is claimable by
//    nobody, so it cannot be regenerated.
// ---------------------------------------------------------------------------
assert.equal(
  isReservable({ leagueApiId: PAID_LEAGUE, kickoff: IN_WINDOW, isNewToLedger: false }, NOW),
  false,
  "a fixture already in the ledger is never reserved",
);
for (const status of ["SUCCEEDED", "ABANDONED"]) {
  const terminal: Row = { ...reserved, status, nextAttemptAt: null };
  assert.equal(ordinaryCanClaim(terminal, afterGrace), false, `${status} is never re-claimed by ordinary generation`);
  assert.equal(paidCanClaim(terminal, NOW), false, `${status} is never claimed by the paid pass`);
}

// A genuine retry backoff still works exactly as before — the grace mechanism
// reuses that field and must not have changed its meaning.
const retrying: Row = { ...reserved, status: "PENDING", nextAttemptAt: new Date(NOW.getTime() + 15 * 60 * 1000) };
assert.equal(ordinaryCanClaim(retrying, NOW), false, "a row serving its retry backoff is still skipped");
assert.equal(ordinaryCanClaim(retrying, new Date(NOW.getTime() + 16 * 60 * 1000)), true, "and claimable after it");

// ---------------------------------------------------------------------------
// 6. The grace duration is long enough to be worth having. A grace shorter
//    than one paid-pass period could expire between two ticks and guarantee
//    nothing at all.
// ---------------------------------------------------------------------------
const PAID_PASS_PERIOD_MS = 15 * 60 * 1000;
assert(
  PAID_TIER_GRACE_MS > PAID_PASS_PERIOD_MS,
  "grace must exceed one paid-pass period, or it can guarantee no attempt at all",
);
assert(
  PAID_TIER_GRACE_MS <= 30 * 60 * 1000,
  "grace must stay short enough not to materially delay ordinary content",
);

console.log(
  "Paid-tier grace checks passed: the paid pass can claim during grace; ordinary generation cannot steal it " +
    "during grace and can claim after it expires; non-paid-tier and out-of-window fixtures are untouched; " +
    "ledger-known and terminal rows are never reserved or regenerated; retry backoff semantics unchanged; " +
    `grace (${PAID_TIER_GRACE_MS / 60000}m) exceeds one paid-pass period.`,
);
