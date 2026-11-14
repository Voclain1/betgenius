import { captureReliabilityPrice } from "../src/lib/reliabilityPrice";
import assert from "node:assert/strict";
import {
  auditPrices,
  bookmakerOverround,
  estimateReliability,
  fitReliability,
  reliabilityMetrics,
  researchValue,
  structuralRisk,
  type DirectQuote,
  type ReliabilityRow,
} from "../src/lib/predictionReliability";
import {
  buildReliabilitySnapshots,
  reliabilityControls,
  snapshotId,
} from "../src/lib/reliabilitySnapshot";
import {
  evaluateProspective,
  protocolCohort,
  type ProspectiveObservation,
} from "../src/lib/reliabilityProtocol";
import type { PaidCandidateAssessment } from "../src/lib/paidValue";
let checks = 0;
const check = (f: () => void) => {
  f();
  checks++;
};
const at = new Date("2027-01-01T12:00:00Z"),
  kickoff = new Date("2027-01-02T12:00:00Z");
const quotes: DirectQuote[] = Array.from({ length: 4 }, (_, i) => ({
  bookmaker: `Book ${i}`,
  market: "Match Winner",
  selection: "Home",
  odds: 1.5 + i * 0.01,
  observedAt: "2027-01-01T11:50:00Z",
  providerUpdatedAt: "2027-01-01T11:40:00Z",
  source: "api-football",
  suspended: null,
}));
const audit = (qs: DirectQuote[]) =>
  auditPrices(qs, "Match Winner", "Home", at, kickoff);
check(() => assert.equal(audit(quotes).status, "VALID"));
check(() => assert.equal(audit([]).status, "MISSING_PRICE"));
for (const odds of [0, 1, -1, NaN, Infinity, 1001])
  check(() =>
    assert.equal(
      audit(quotes.map((q) => ({ ...q, odds }))).status,
      "INVALID_PRICE",
    ),
  );
for (const patch of [
  { providerUpdatedAt: null },
  { providerUpdatedAt: "2026-12-31T01:00:00Z" },
  { observedAt: "2027-01-01T13:00:00Z" },
  { providerUpdatedAt: "2027-01-01T11:55:00Z" },
  { observedAt: "invalid" },
])
  check(() =>
    assert.equal(
      audit(quotes.map((q) => ({ ...q, ...patch }))).status,
      "STALE_PRICE",
    ),
  );
for (const patch of [
  { bookmaker: "" },
  { suspended: true },
  { market: "Other" },
  { selection: "Away" },
])
  check(() =>
    assert.equal(
      audit(quotes.map((q) => ({ ...q, ...patch }))).status,
      "INVALID_PRICE",
    ),
  );
check(() =>
  assert.equal(
    audit(quotes.map((q) => ({ ...q, bookmaker: "one" }))).status,
    "INSUFFICIENT_EVIDENCE",
  ),
);
check(() => assert.equal(audit([...quotes, quotes[0]]).quotes.length, 4));
check(() =>
  assert.ok(
    audit([
      ...quotes,
      { ...quotes[0], bookmaker: "outlier", odds: 5 },
    ]).reasons.includes("SUSPICIOUS_DISPERSION"),
  ),
);
check(() =>
  assert.equal(
    auditPrices(quotes, "Match Winner", "Home", kickoff, kickoff).status,
    "STALE_PRICE",
  ),
);
check(() =>
  assert.ok(Math.abs(bookmakerOverround([2, 3, 4], 3)! - 1 / 12) < 1e-12),
);
for (const odds of [[1, 2], [2], [NaN, 2]])
  check(() => assert.equal(bookmakerOverround(odds, 2), null));
const training: ReliabilityRow[] = Array.from({ length: 240 }, (_, i) => ({
  id: String(i),
  fixture: String(i),
  market: "BTTS",
  competition: i % 3,
  decisionAt: new Date("2026-12-01"),
  kickoff: new Date("2026-12-02"),
  settledAt: new Date("2026-12-03"),
  raw: 0.8,
  outcome: i % 5 ? 1 : 0,
}));
const model = fitReliability(training, new Date("2027-01-01"), "test-v1")!;
check(() => assert.equal(model.n, 240));
check(() =>
  assert.equal(
    fitReliability(training.slice(0, 100), new Date("2027-01-01"), "small"),
    null,
  ),
);
for (const patch of [
  { raw: NaN },
  { raw: 1.1 },
  { settledAt: new Date("2027-01-01") },
  { settledAt: new Date("2026-12-01") },
  { decisionAt: new Date("2026-12-04") },
  { kickoff: new Date("invalid") },
])
  check(() =>
    assert.equal(
      fitReliability(
        training.map((r) => ({ ...r, ...patch })),
        new Date("2027-01-01"),
        "invalid",
      ),
      null,
    ),
  );
check(() =>
  assert.equal(
    fitReliability(
      [...training, ...training],
      new Date("2027-01-01"),
      "duplicates",
    )!.n,
    240,
  ),
);
const estimate = estimateReliability(model, 0.8, "BTTS", at);
check(() => assert.equal(estimate.scope, "market"));
check(() => assert.equal(estimate.status, "EVALUATION_ONLY"));
check(() => assert.equal(estimate.p, 0.8));
check(() => assert.ok(estimate.lower! < 0.8 && estimate.upper! > 0.8));
check(() =>
  assert.equal(
    estimateReliability(model, 0.8, "UNSUPPORTED", at).scope,
    "pooled",
  ),
);
check(() =>
  assert.equal(
    estimateReliability(model, 0.2, "BTTS", at).status,
    "UNCALIBRATED",
  ),
);
check(() =>
  assert.equal(
    estimateReliability(model, 0.8, "BTTS", new Date("2027-03-01")).status,
    "STALE",
  ),
);
check(() =>
  assert.equal(
    estimateReliability(model, 0.8, "BTTS", new Date("2027-01-01")).status,
    "UNCALIBRATED",
  ),
);
for (const raw of [NaN, Infinity, -0.1, 1.1])
  check(() =>
    assert.equal(estimateReliability(model, raw, "BTTS", at).p, null),
  );
check(() =>
  assert.equal(
    estimateReliability(null, 0.8, "BTTS", at).status,
    "UNCALIBRATED",
  ),
);
const price = audit(quotes);
check(() =>
  assert.equal(researchValue(estimate, price, "BTTS").status, "POSSIBLE_VALUE"),
);
check(() =>
  assert.equal(
    researchValue({ ...estimate, lower: 0.5 }, price, "BTTS").status,
    "NO_DEMONSTRATED_VALUE",
  ),
);
for (const market of ["DRAW_NO_BET", "TEAM_GOALS", "OTHER"])
  check(() =>
    assert.equal(
      researchValue(estimate, price, market).status,
      "INSUFFICIENT_EVIDENCE",
    ),
  );
check(() =>
  assert.equal(researchValue(estimate, audit([]), "BTTS").expectedReturn, null),
);
check(() =>
  assert.equal(
    researchValue(estimateReliability(null, 0.8, "BTTS", at), price, "BTTS")
      .status,
    "UNCALIBRATED",
  ),
);
check(() =>
  assert.equal(researchValue(estimate, price, "BTTS").activationAllowed, false),
);
const riskBase = {
  id: "one",
  fixture: "one",
  market: "MATCH_WINNER",
  selection: "HOME",
  competition: 1,
  confidence: 80,
  odds: 1.5,
  teams: [1, 2],
};
for (const [patch, reason] of [
  [{}, "DUPLICATE_SELECTION"],
  [{ id: "two", selection: "AWAY" }, "DIRECT_CONTRADICTION"],
  [{ id: "two", market: "DOUBLE_CHANCE" }, "SAME_FIXTURE_DEPENDENCE"],
  [{ id: "two", fixture: "two" }, "SHARED_TEAM"],
] as const)
  check(() =>
    assert.equal(
      structuralRisk([riskBase, { ...riskBase, ...patch }]).warnings[0].reason,
      reason,
    ),
  );
check(() => assert.equal(structuralRisk([riskBase]).combinedProbability, null));
const metrics = reliabilityMetrics([
  { raw: 0.8, outcome: 1 },
  { raw: 0.8, outcome: 0 },
  { raw: NaN, outcome: 1 },
]);
check(() => assert.equal(metrics.n, 2));
check(() => assert.equal(metrics.excluded, 1));
check(() => assert.ok(Math.abs(metrics.brier! - 0.34) < 1e-12));
for (const flag of [undefined, "on", "value", "true"])
  check(() =>
    assert.equal(
      reliabilityControls({ RELIABILITY_SHADOW: flag }).liveActivation,
      false,
    ),
  );
check(() =>
  assert.equal(
    reliabilityControls({ RELIABILITY_DIAGNOSTICS: "off" }).diagnostics,
    false,
  ),
);
check(() => assert.equal(reliabilityControls({}).calibration, false));
const assessment: PaidCandidateAssessment = {
  id: "p1",
  fixtureKey: "fixture",
  provider: null,
  marketType: "BTTS",
  leagueApiId: 1,
  rawConfidence: 80,
  rule: { eligible: true, tag: "BASELINE" },
  quoteAgeMinutes: 10,
  value: {
    calibrationVersion: null,
    rawConfidence: 80,
    marketProbability: 70,
    estimatedProbability: null,
    estimatedProbabilityLower: null,
    odds: 1.5,
    bookmakers: 4,
    breakEven: null,
    expectedValue: null,
    expectedValueLower: null,
    eligible: false,
    reasons: ["NO_CALIBRATION"],
  },
  reliabilityPrice: {
    quotes,
    market: "Match Winner",
    selection: "Home",
    derived: false,
    observedAt: quotes[0].observedAt,
    providerUpdatedAt: quotes[0].providerUpdatedAt,
    overrounds: [],
  },
};
const input = {
  tier: "VIP",
  assessments: [assessment],
  rows: [{ id: "p1", kickoff, selection: "YES" }],
  selectedIds: ["p1"],
  now: at,
};
const before = JSON.stringify(input),
  record = buildReliabilitySnapshots(input)[0];
check(() => assert.equal(JSON.stringify(input), before));
check(() => assert.equal(record.detail.baselineSelected, true));
check(() => assert.equal(record.detail.estimate.status, "UNCALIBRATED"));
check(() => assert.equal(record.detail.policies?.diversified, true));
check(() =>
  assert.equal(
    record.id,
    buildReliabilitySnapshots({ ...input, now: new Date(+at + 60000) })[0].id,
  ),
);
check(() => assert.notEqual(record.id, snapshotId("PREMIUM", "p1")));
check(() =>
  assert.equal(buildReliabilitySnapshots({ ...input, now: kickoff }).length, 0),
);
check(() =>
  assert.equal(
    buildReliabilitySnapshots({
      ...input,
      assessments: [
        {
          ...assessment,
          reliabilityPrice: { ...assessment.reliabilityPrice!, derived: true },
        },
      ],
    })[0].detail.price.status,
    "MISSING_PRICE",
  ),
);
const observation: ProspectiveObservation = {
  version: "reliability-s06-v1",
  id: "p1",
  tier: "VIP",
  fixture: "f1",
  market: "BTTS",
  competition: 1,
  decisionAt: "2027-01-01T12:00:00Z",
  kickoff: "2027-01-02T12:00:00Z",
  settledAt: "2027-01-03T12:00:00Z",
  outcome: "WON",
  rawConfidence: 80,
  baselineSelected: true,
  policies: { calibrated: false, lowerBoundValue: false, diversified: true },
  price: { status: "VALID", median: 1.5 },
  estimate: { p: null },
};
check(() => assert.equal(protocolCohort([observation, observation]).length, 1));
for (const patch of [
  { decisionAt: "2026-11-13" },
  { decisionAt: "2027-01-04" },
  { version: "old" },
  { market: "DRAW_NO_BET" },
])
  check(() =>
    assert.equal(protocolCohort([{ ...observation, ...patch }]).length, 0),
  );
check(() =>
  assert.throws(
    () => evaluateProspective([observation], at, "holdout"),
    /not matured/,
  ),
);
const report = evaluateProspective([observation], new Date("2027-02-01"));
check(() => assert.equal(report.sections[0].validation.baseline.n, 1));
check(() =>
  assert.equal(report.sections[0].validation.baseline.realizedReturn, null),
);
check(() => assert.equal(report.sections[0].holdout, null));
check(() => assert.equal(report.sections[0].promoted.length, 0));
check(() => assert.equal(report.activationAllowed, false));
check(() =>
  assert.equal(
    evaluateProspective(
      [{ ...observation, settledAt: "2027-03-01" }],
      new Date("2027-02-01"),
    ).sections[0].validation.baseline.n,
    0,
  ),
);
check(() =>
  assert.equal(
    evaluateProspective([], new Date("2027-03-08"), "holdout").sections[1]
      .holdout,
    null,
  ),
);

const fixtureOdds = {
  bookmakerCount: 4,
  update: quotes[0].providerUpdatedAt,
  markets: [
    {
      market: "Match Winner",
      selections: ["Home", "Draw", "Away"].map((value, i) => ({
        value,
        best: 2 + i,
        median: 2 + i,
        bookmakers: 4,
        bestBookmaker: "Book 0",
        quotes: quotes.map((q) => ({ bookmaker: q.bookmaker, odd: 2 + i })),
      })),
    },
  ],
};
const captured = captureReliabilityPrice(
  { oddsJson: fixtureOdds, fetchedAt: new Date(quotes[0].observedAt) },
  "MATCH_WINNER",
  { value: "HOME" },
)!;
check(() => assert.equal(captured.quotes.length, 4));
check(() =>
  assert.equal(
    captured.quotes[0].providerUpdatedAt,
    quotes[0].providerUpdatedAt,
  ),
);
check(() => assert.equal(captured.overrounds.length, 4));
check(() =>
  assert.ok(Math.abs(captured.overrounds[0].overround - 1 / 12) < 1e-12),
);
check(() =>
  assert.equal(
    captureReliabilityPrice(
      { oddsJson: { broken: true }, fetchedAt: at },
      "MATCH_WINNER",
      { value: "HOME" },
    ),
    undefined,
  ),
);
check(() =>
  assert.equal(
    captureReliabilityPrice(undefined, "TEAM_TOTAL", { value: "HOME" })?.quotes
      .length,
    0,
  ),
);
check(() =>
  assert.equal(
    captureReliabilityPrice(
      { oddsJson: fixtureOdds, fetchedAt: at },
      "DRAW_NO_BET",
      { value: "HOME" },
    )?.derived,
    true,
  ),
);
const many: ProspectiveObservation[] = Array.from({ length: 400 }, (_, i) => ({
  ...observation,
  id: String(i),
  fixture: String(i),
  kickoff: new Date(
    Date.parse("2027-01-02") + Math.floor(i / 15) * 86400000,
  ).toISOString(),
  decisionAt: "2027-01-01T12:00:00Z",
  settledAt: "2027-01-31T12:00:00Z",
  outcome: i % 4 === 0 ? "LOST" : "WON",
  policies: { diversified: i % 4 !== 0 },
}));
const comparison = evaluateProspective(many, new Date("2027-02-01"));
check(() => assert.equal(comparison.sections[0].validation.baseline.n, 400));
check(() =>
  assert.ok(
    comparison.sections[0].validation.candidates.find(
      (c) => c.name === "diversified",
    )!.referenceDifferenceInterval,
  ),
);
check(() =>
  assert.deepEqual(
    comparison,
    evaluateProspective(many, new Date("2027-02-01")),
  ),
);
check(() => assert.equal(comparison.sections[0].promoted.length, 0)); // development remains empty
check(() =>
  assert.equal(
    evaluateProspective(many, new Date("2027-03-08"), "holdout").sections[0]
      .holdout,
    null,
  ),
);
console.log(
  `Sprint 06 reliability: ${checks} checks passed (synthetic data; not prediction-quality evidence).`,
);
