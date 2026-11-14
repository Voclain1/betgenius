import assert from "node:assert/strict";
import {
  freshness,
  freshnessThresholds,
  meaningfulCompletion,
  publicationStatusProblem,
  reconcilePredictions,
  NON_PUBLISHABLE_STATUSES,
  type OperationPrediction,
} from "../src/lib/predictionOperations";
import { retryDelay, operationIdentity } from "../src/lib/operationExecution";
import { recoveryAuthorized } from "../src/lib/operationsRecovery";
import { regulationScoreOf } from "../src/lib/settlement";
import { resolveMarket } from "../src/lib/markets";
const now = new Date("2026-11-14T10:00:00Z"),
  past = new Date(+now - 86400000),
  future = new Date(+now + 86400000);
let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};
for (const [age, status] of [
  [0, "FRESH"],
  [80, "AGING"],
  [121, "STALE"],
  [-1, "UNKNOWN"],
] as const)
  check(() =>
    assert.equal(
      freshness({
        fetchedAt: new Date(+now - age * 60000),
        now,
        maxMinutes: 100,
      }).status,
      status,
    ),
  );
check(() =>
  assert.equal(
    freshness({ fetchedAt: null, now, maxMinutes: 120 }).status,
    "MISSING",
  ),
);
check(() =>
  assert.equal(
    freshness({ fetchedAt: past, now, maxMinutes: 120, lastError: "timeout" })
      .status,
    "PROVIDER_UNAVAILABLE",
  ),
);
check(() =>
  assert.equal(
    freshness({ fetchedAt: now, now, maxMinutes: 120, supported: false })
      .status,
    "UNKNOWN",
  ),
);
check(() =>
  assert.equal(
    freshness({ fetchedAt: new Date("invalid"), now, maxMinutes: 120 }).status,
    "UNKNOWN",
  ),
);
check(() =>
  assert.throws(() => freshness({ fetchedAt: past, now, maxMinutes: NaN })),
);
for (const invalid of ["-1", "0", "NaN", "999999"])
  check(() =>
    assert.equal(
      freshnessThresholds({ OPS_FRESHNESS_ODDS_MINUTES: invalid }).odds,
      120,
    ),
  );
check(() =>
  assert.equal(
    freshnessThresholds({ OPS_FRESHNESS_ODDS_MINUTES: "90" }).odds,
    90,
  ),
);
for (const [payload, status] of [
  [{ generated: 3 }, "USEFUL_OUTPUT"],
  [{ generated: 0 }, "NO_WORK"],
  [{ generated: 3, failed: 1 }, "PARTIAL_FAILURE"],
  [{ generated: 0, failed: 1 }, "FAILED"],
  [{ ok: false }, "FAILED"],
  [{}, "UNKNOWN"],
  [null, "UNKNOWN"],
  [{ generated: NaN }, "UNKNOWN"],
] as const)
  check(() => assert.equal(meaningfulCompletion(payload).status, status));
check(() =>
  assert.equal(meaningfulCompletion({ generated: 1 }, 500).status, "FAILED"),
);
check(() =>
  assert.equal(
    publicationStatusProblem(null, past, now),
    "KICKOFF_PASSED_OR_INVALID",
  ),
);
check(() => assert.equal(publicationStatusProblem(null, future, now), null));
for (const status of NON_PUBLISHABLE_STATUSES)
  check(() =>
    assert.equal(
      publicationStatusProblem(
        {
          status,
          kickoff: future,
          homeScore: null,
          awayScore: null,
          updatedAt: now,
        },
        future,
        now,
      ),
      "FIXTURE_NOT_PREMATCH",
    ),
  );
check(() =>
  assert.equal(
    publicationStatusProblem(
      {
        status: "NS",
        kickoff: new Date(+future + 120000),
        homeScore: null,
        awayScore: null,
        updatedAt: now,
      },
      future,
      now,
    ),
    "FIXTURE_SCHEDULE_DISAGREEMENT",
  ),
);
const row: OperationPrediction = {
  id: "p1",
  status: "PUBLISHED",
  outcome: "PENDING",
  kickoff: past,
  createdAt: past,
  publishedAt: now,
  settledAt: null,
  marketType: "MATCH_WINNER",
  selection: { value: "HOME" },
  category: "VIP",
  categories: [],
  fixtureApiId: 1,
  finalHomeScore: null,
  finalAwayScore: null,
  manualSettlementOnly: false,
};
const fixture = {
  status: "FT",
  kickoff: past,
  homeScore: 1,
  awayScore: 0,
  updatedAt: now,
};
const findings = reconcilePredictions(
  [row, { ...row, id: "p2" }],
  new Map([[1, fixture]]),
  new Set(),
  new Set(),
  now,
);
for (const code of [
  "LATE_PUBLICATION",
  "PAID_PRICE_EVIDENCE_UNAVAILABLE",
  "MISSING_PAID_LINK",
  "MISSING_CATEGORY_LINKS",
  "FINISHED_UNSETTLED",
  "DUPLICATE_SELECTION",
])
  check(() => assert.ok(findings.some((f) => f.code === code)));
const settled = {
  ...row,
  outcome: "WON",
  settledAt: new Date(+past - 1),
  finalHomeScore: 2,
  finalAwayScore: 0,
};
const conflicts = reconcilePredictions(
  [settled],
  new Map([[1, fixture]]),
  new Set([row.id]),
  new Set([row.id]),
  now,
);
check(() => assert.ok(conflicts.some((f) => f.code === "RESULT_DISCREPANCY")));
check(() =>
  assert.ok(conflicts.some((f) => f.code === "SETTLED_BEFORE_KICKOFF")),
);
check(() =>
  assert.ok(
    !reconcilePredictions(
      [settled],
      new Map([[1, { ...fixture, status: "AET" }]]),
      new Set(),
      new Set(),
      now,
    ).some((f) => f.code === "RESULT_DISCREPANCY"),
  ),
);
check(() =>
  assert.ok(
    reconcilePredictions(
      [{ ...row, status: "PENDING_REVIEW" }],
      new Map(),
      new Set(),
      new Set(),
      now,
    ).some((f) => f.code === "EXPIRED_REVIEW_HISTORY"),
  ),
);
for (const role of [undefined, "USER", "VIP", "SUPERUSER"])
  check(() => assert.equal(recoveryAuthorized(role), false));
for (const role of ["ADMIN", "SUPER_ADMIN"])
  check(() => assert.equal(recoveryAuthorized(role), true));
check(() => assert.equal(operationIdentity("a"), operationIdentity("a")));
check(() => assert.notEqual(operationIdentity("a"), operationIdentity("b")));
check(() => assert.ok(retryDelay(2, "a") > retryDelay(1, "a")));
check(() => assert.equal(retryDelay(2, "a"), retryDelay(2, "a")));
for (const status of ["PST", "ABD", "SUSP", "CANC", "1H"])
  check(() =>
    assert.equal(
      publicationStatusProblem(
        { ...fixture, status, kickoff: future },
        future,
        now,
      ),
      "FIXTURE_NOT_PREMATCH",
    ),
  );
check(() =>
  assert.equal(resolveMarket("DRAW_NO_BET", { value: "HOME" }, 1, 1), "VOID"),
);
check(() =>
  assert.equal(
    resolveMarket("OVER_UNDER", { direction: "OVER", line: 2 }, 1, 1),
    "VOID",
  ),
);
check(() =>
  assert.equal(resolveMarket("BTTS", { value: "YES" }, 1, 0), "LOST"),
);
check(() =>
  assert.equal(
    regulationScoreOf({
      fixture: { status: { short: "FT" } },
      goals: { home: 1, away: null },
      score: { fulltime: { home: 1, away: 0 } },
    }).ok,
    false,
  ),
);
check(() =>
  assert.equal(
    regulationScoreOf({
      fixture: { status: { short: "AET" } },
      goals: { home: 2, away: 1 },
      score: {
        fulltime: { home: 1, away: 1 },
        extratime: { home: 1, away: 0 },
      },
    }).ok,
    true,
  ),
);
console.log(`Prediction operations: ${n} checks passed; synthetic data only.`);
