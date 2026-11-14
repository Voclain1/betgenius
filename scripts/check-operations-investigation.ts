import assert from "node:assert/strict";
import { assessJobCompletion } from "../src/lib/jobOutcome";
import {
  meaningfulCompletion,
  freshness,
  reconcilePredictions,
  type OperationPrediction,
} from "../src/lib/predictionOperations";
import {
  currentLagosDayStart,
  incidentPeriod,
  groupFindings,
} from "../src/lib/settlementDiagnostics";
let n = 0;
const check = (f: () => void) => {
  f();
  n++;
};
const now = new Date("2026-11-14T02:20:00Z"),
  past = new Date("2026-11-13T14:00:00Z"),
  future = new Date("2026-11-14T14:00:00Z");
const row: OperationPrediction = {
  id: "synthetic",
  status: "PUBLISHED",
  outcome: "PENDING",
  kickoff: past,
  createdAt: past,
  publishedAt: new Date(+past - 3600000),
  settledAt: null,
  marketType: "MATCH_WINNER",
  selection: { value: "HOME" },
  category: "FEATURED",
  categories: ["FEATURED"],
  fixtureApiId: 1,
  finalHomeScore: null,
  finalAwayScore: null,
  manualSettlementOnly: false,
};
const f = {
  status: "FT",
  kickoff: past,
  homeScore: 1,
  awayScore: 0,
  updatedAt: past,
};
const assess = (p = row, fixture: typeof f | undefined = undefined) =>
  reconcilePredictions(
    [p],
    new Map(fixture ? [[1, fixture]] : []),
    new Set(),
    new Set(),
    now,
  );
for (const status of ["ARCHIVED", "DRAFT", "PENDING_REVIEW", "APPROVED"])
  check(() =>
    assert.ok(
      !assess({ ...row, status }).some((x) =>
        [
          "SETTLEMENT_DELAY",
          "FINISHED_UNSETTLED",
          "SETTLEMENT_STATUS_UNVERIFIED",
        ].includes(x.code),
      ),
    ),
  );
for (const outcome of ["WON", "LOST", "VOID"])
  check(() =>
    assert.ok(
      !assess({ ...row, outcome }, f).some(
        (x) => x.code === "FINISHED_UNSETTLED" || x.code === "SETTLEMENT_DELAY",
      ),
    ),
  );
check(() => assert.equal(assess()[0].code, "SETTLEMENT_STATUS_UNVERIFIED"));
check(() => assert.equal(assess()[0].severity, "INFO"));
check(() => assert.equal(assess()[0].period, "HISTORICAL"));
check(() =>
  assert.equal(
    assess({ ...row, manualSettlementOnly: true }, f)[0].code,
    "MANUAL_SETTLEMENT_QUEUE",
  ),
);
check(() =>
  assert.equal(
    assess({ ...row, marketType: "SAME_GAME_DOUBLE" }, f)[0].code,
    "COMPOUND_SETTLEMENT_QUEUE",
  ),
);
for (const status of ["PST", "CANC", "ABD", "SUSP", "INT"])
  check(() =>
    assert.equal(
      assess(row, { ...f, status })[0].code,
      "NONFINAL_FIXTURE_PENDING",
    ),
  );
check(() =>
  assert.ok(
    assess(row, { ...f, status: "NS", kickoff: future }).some(
      (x) => x.code === "RESCHEDULED_FIXTURE_PENDING",
    ),
  ),
);
for (const status of ["NS", "1H", "HT", "2H", "LIVE"])
  check(() =>
    assert.equal(
      assess(row, { ...f, status })[0].code,
      "SETTLEMENT_STATUS_UNVERIFIED",
    ),
  );
const final = assess(row, f);
check(() => assert.equal(final.length, 1));
check(() => assert.equal(final[0].code, "FINISHED_UNSETTLED"));
check(() => assert.ok(final[0].detail.includes("not live verification")));
check(() => assert.equal(assess({ ...row, kickoff: future }).length, 0));
check(() =>
  assert.equal(
    currentLagosDayStart(new Date("2026-11-13T23:30:00Z")).toISOString(),
    "2026-11-13T23:00:00.000Z",
  ),
);
check(() =>
  assert.equal(
    incidentPeriod(new Date("2026-11-13T23:05:00Z"), now),
    "CURRENT",
  ),
);
check(() =>
  assert.equal(
    incidentPeriod(new Date("2026-11-13T22:59:00Z"), now),
    "HISTORICAL",
  ),
);
const repeated = Array.from({ length: 250 }, (_, i) => ({
  ...final[0],
  predictionId: String(i),
}));
check(() => assert.equal(groupFindings(repeated).length, 1));
check(() => assert.equal(groupFindings(repeated)[0].count, 250));
check(() => assert.equal(groupFindings(repeated)[0].samples.length, 10));
check(() =>
  assert.ok(
    !assess({
      ...row,
      category: "VIP",
      categories: ["VIP"],
      observationExpected: false,
    }).some((x) => x.code === "MISSING_RELIABILITY_OBSERVATION"),
  ),
);
check(() =>
  assert.ok(
    assess({
      ...row,
      category: "VIP",
      categories: ["VIP"],
      observationExpected: true,
    }).some((x) => x.code === "MISSING_RELIABILITY_OBSERVATION"),
  ),
);
check(() =>
  assert.equal(
    freshness({
      now,
      fetchedAt: past,
      maxMinutes: 120,
      lastError: "No bookmaker prices quoted for this fixture yet",
    }).status,
    "MISSING",
  ),
);
check(() =>
  assert.equal(
    freshness({
      now,
      fetchedAt: past,
      maxMinutes: 120,
      lastError: "provider timeout",
    }).status,
    "PROVIDER_UNAVAILABLE",
  ),
);
check(() =>
  assert.equal(
    freshness({
      now,
      fetchedAt: past,
      maxMinutes: 120,
      lastError: "unrecognized historical note",
    }).status,
    "UNKNOWN",
  ),
);

check(() =>
  assert.ok(
    assess({
      ...row,
      category: "VIP",
      categories: ["VIP"],
      paidPublicationEvidenceRequired: false,
    }).some(
      (f) =>
        f.code === "PAID_PRICE_EVIDENCE_UNAVAILABLE" && f.severity === "INFO",
    ),
  ),
);
check(() =>
  assert.ok(
    assess({
      ...row,
      category: "VIP",
      categories: ["VIP"],
      paidPublicationEvidenceRequired: true,
    }).some(
      (f) => f.code === "MISSING_PAID_EVIDENCE" && f.severity === "CRITICAL",
    ),
  ),
);
check(() =>
  assert.ok(
    assess({ ...row, kickoff: future, outcome: "VOID", settledAt: now }).some(
      (f) => f.code === "EARLY_VOID_REVIEW" && f.severity === "INFO",
    ),
  ),
);
const cases: Array<[string, unknown, string]> = [
  [
    "generation-discovery",
    { ok: true, leaguesScanned: 3, leaguesPlanned: 3, candidatesQueued: 0 },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "generation-discovery",
    { ok: true, leaguesScanned: 3, candidatesQueued: 2 },
    "USEFUL_OUTPUT",
  ],
  [
    "generation-discovery",
    { ok: true, leaguesScanned: 0, leaguesPlanned: 3, candidatesQueued: 0 },
    "UNKNOWN",
  ],
  [
    "refresh-odds",
    { processed: 11, okCount: 7, failedCount: 4 },
    "PARTIAL_FAILURE",
  ],
  ["refresh-odds", { processed: 1, okCount: 0, failedCount: 1 }, "FAILED"],
  [
    "refresh-odds",
    {
      processed: 1,
      okCount: 0,
      failedCount: 1,
      results: [
        {
          result: "failed",
          detail: "No bookmaker prices quoted for this fixture yet",
        },
      ],
    },
    "NO_WORK",
  ],
  [
    "refresh-odds",
    { processed: 0, eligible: 0, okCount: 0, failedCount: 0 },
    "NO_WORK",
  ],
  [
    "refresh-odds",
    { processed: 3, okCount: 3, failedCount: 0 },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "select-bet-of-the-day",
    { action: "kept", selectedId: "private-id" },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "select-bet-of-the-day",
    { action: "skipped-manual-pin" },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "select-bet-of-the-day",
    { action: "pinned", selectedId: "synthetic" },
    "USEFUL_OUTPUT",
  ],
  ["select-bet-of-the-day", { action: "no-eligible-candidate" }, "NO_WORK"],
  [
    "generate-ordinary",
    { ok: true, banker: { considered: 27, selectedIds: ["a", "b"] } },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "settle",
    {
      checked: 0,
      settled: 0,
      doublesSettled: 0,
      curation: {},
      upcomingKickoffs: { checked: 102 },
    },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "settle",
    { checked: 1, settled: 0, results: [{ result: "manual_required" }] },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "settle",
    { checked: 1, settled: 0, results: [{ result: "provider_unavailable" }] },
    "FAILED",
  ],
  [
    "results-pass",
    { ran: true, checked: 0, settled: 0, doublesSettled: 0 },
    "NO_WORK",
  ],
  ["results-pass", { ran: false }, "DEFERRED"],
  ["results-pass", { ran: true, checked: 1, settled: 1 }, "USEFUL_OUTPUT"],
  [
    "generate-european-clubs",
    {
      ok: false,
      reason: "another generation run is already in progress",
      failed: 0,
    },
    "DEFERRED",
  ],
  [
    "generate-ordinary",
    {
      ok: false,
      reason: "api-football daily budget nearly exhausted (20 left)",
      failed: 0,
    },
    "DEFERRED",
  ],
  [
    "generate-ordinary",
    {
      ok: false,
      reason: "another generation run is already in progress",
      failed: 1,
    },
    "FAILED",
  ],
  ["unknown-job", {}, "UNKNOWN"],
];
for (const [job, payload, status] of cases)
  check(() =>
    assert.equal(assessJobCompletion(job, payload).status, status, job),
  );
for (const job of [
  "generate-vip-premium",
  "generate-goals",
  "generate-european-clubs",
  "generate-ordinary",
  "generate-bet-of-the-day",
]) {
  check(() =>
    assert.equal(
      assessJobCompletion(job, {
        ok: true,
        claimed: 0,
        succeeded: 0,
        failed: 0,
        predictionsCreated: 0,
      }).status,
      "NO_WORK",
    ),
  );
  check(() =>
    assert.equal(
      assessJobCompletion(job, {
        ok: true,
        claimed: 1,
        succeeded: 0,
        failed: 1,
        predictionsCreated: 0,
      }).status,
      "FAILED",
    ),
  );
  check(() =>
    assert.equal(
      assessJobCompletion(job, {
        ok: true,
        claimed: 1,
        succeeded: 1,
        failed: 0,
        predictionsCreated: 2,
      }).status,
      "USEFUL_OUTPUT",
    ),
  );
}
check(() =>
  assert.equal(
    meaningfulCompletion({ ok: true, leaguesScanned: 3, candidatesQueued: 0 })
      .status,
    "UNKNOWN",
  ),
); // reproduces old dashboard gap
check(() =>
  assert.equal(
    meaningfulCompletion({ processed: 11, okCount: 7, failedCount: 4 }).status,
    "UNKNOWN",
  ),
);
check(() =>
  assert.equal(
    assessJobCompletion(
      "refresh-odds",
      { okCount: 2, processed: 2, failedCount: 0 },
      503,
    ).status,
    "FAILED",
  ),
);
console.log(
  `Operations investigation regression: ${n} checks passed (synthetic reproductions of aggregate production shapes).`,
);
