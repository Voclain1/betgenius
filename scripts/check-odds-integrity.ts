import assert from "node:assert/strict";
import {
  assessOperationalOdds,
  requiresAtomicEvidence,
  ATOMIC_EVIDENCE_INTRODUCED,
} from "../src/lib/operationsIntegrity";
import { assessJobCompletion } from "../src/lib/jobOutcome";
const now = new Date("2026-11-14T08:00:00Z");
let checks = 0;
function check(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks++;
}
for (const provenance of ["VIP_GENERATED", "PREMIUM_GENERATED"]) {
  check(
    requiresAtomicEvidence(
      provenance,
      new Date(+ATOMIC_EVIDENCE_INTRODUCED - 1),
    ),
    false,
  );
  check(requiresAtomicEvidence(provenance, ATOMIC_EVIDENCE_INTRODUCED), true);
  check(requiresAtomicEvidence(provenance, null), true);
  check(requiresAtomicEvidence(provenance, new Date(NaN)), true);
}
check(requiresAtomicEvidence("STANDARD_CURATED", now), false);
const cache = {
  fetchedAt: now,
  lastError: null as string | null,
  oddsJson: {
    update: now.toISOString(),
    markets: [{ market: "Match Winner" }],
  },
};
const initialCache = JSON.stringify(cache);
const base = {
  now,
  maxMinutes: 120,
  status: "PUBLISHED",
  kickoff: new Date(+now + 3600000),
  marketType: "MATCH_WINNER",
  selection: { value: "HOME" },
  cache,
};
const assess = (over: Partial<typeof base> = {}) =>
  assessOperationalOdds({ ...base, ...over });
check(assess().issue, null);
check(
  assess({ cache: { ...cache, fetchedAt: new Date(+now - 121 * 60000) } }).issue
    ?.code,
  "ODDS_REFRESH_DUE",
);
check(assess({ cache: undefined }).issue?.code, "ODDS_REFRESH_DUE");
check(
  assess({
    cache: {
      ...cache,
      oddsJson: {
        update: new Date(+now - 36000000).toISOString(),
        markets: cache.oddsJson.markets,
      },
    },
  }).issue?.code,
  "ODDS_PROVIDER_TIMESTAMP_AGING",
);
check(
  assess({
    cache: { ...cache, oddsJson: { update: now.toISOString(), markets: [] } },
  }).issue?.code,
  "ODDS_COVERAGE_UNAVAILABLE",
);
check(
  assess({
    cache: {
      ...cache,
      lastError: "No bookmaker prices quoted for this fixture yet",
    },
  }).issue?.code,
  "ODDS_COVERAGE_UNAVAILABLE",
);
check(
  assess({ cache: { ...cache, lastError: "provider timeout" } }).issue
    ?.severity,
  "WARNING",
);
check(
  assess({ cache: { ...cache, lastError: "unknown issue" } }).issue?.code,
  "ODDS_UNKNOWN",
);
for (const marketType of ["TEAM_TOTAL", "DRAW_NO_BET", "SAME_GAME_DOUBLE"])
  check(assess({ marketType }).issue?.code, "ODDS_MARKET_UNSUPPORTED");
for (const status of ["ARCHIVED", "APPROVED", "DRAFT"])
  check(assess({ status, cache: undefined }).issue, null);
check(assess({ kickoff: new Date(+now - 1), cache: undefined }).issue, null);
for (const status of ["FT", "1H", "PST"])
  check(
    assessOperationalOdds({
      ...base,
      fixture: {
        status,
        kickoff: base.kickoff,
        updatedAt: now,
        homeScore: null,
        awayScore: null,
      },
    }).issue?.code,
    "ODDS_FIXTURE_STATUS_REVIEW",
  );
// Paid and free prices use the same cache diagnostic; publication evidence is never an input/output.
check(JSON.stringify(cache), initialCache);
check(
  assess({
    cache: {
      ...cache,
      oddsJson: { update: "invalid", markets: cache.oddsJson.markets },
    },
  }).issue?.code,
  "ODDS_PROVIDER_TIMESTAMP_UNVERIFIED",
);
check(
  assessJobCompletion("curate-accumulators", {
    attempted: false,
    tiers: Array.from({ length: 6 }, () => ({ status: "empty" })),
  }).status,
  "NO_WORK",
);
check(
  assessJobCompletion("notifications-reminders", {
    created: 0,
    insights: 0,
    digests: {
      morning: "waiting: 1 of 3 categories ready",
      night: "outside window",
    },
  }).status,
  "DEFERRED",
);
check(
  assessJobCompletion("email-dispatch", {
    ran: true,
    queued: {},
    errors: {},
    send: { sent: 0, failed: 0, retried: 0, skipped: 0, expired: 0 },
    paystack: { ran: false, reason: "unexpected sync failure" },
  }).status,
  "UNKNOWN",
);
check(
  assess({
    kickoff: new Date(+now + 86400001),
    cache: { ...cache, fetchedAt: new Date(+now - 121 * 60000) },
  }).issue?.code,
  "ODDS_DISTANT_CACHE_RETAINED",
);
check(
  assess({
    kickoff: new Date(+now + 86400000),
    cache: { ...cache, fetchedAt: new Date(+now - 121 * 60000) },
  }).issue?.code,
  "ODDS_REFRESH_DUE",
);
const cases: Array<[string, unknown, string]> = [
  [
    "refresh-insights",
    { targets: 92, insights: 343, teamsWritten: 0, cleared: 0, fetchFailed: 0 },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "refresh-insights",
    { targets: 0, insights: 0, teamsWritten: 0, cleared: 0, fetchFailed: 0 },
    "NO_WORK",
  ],
  [
    "refresh-insights",
    { targets: 2, insights: 0, teamsWritten: 0, cleared: 0, fetchFailed: 2 },
    "FAILED",
  ],
  [
    "refresh-insights",
    { targets: 2, insights: 1, teamsWritten: 1, cleared: 0, fetchFailed: 1 },
    "PARTIAL_FAILURE",
  ],
  [
    "notifications-reminders",
    {
      created: 0,
      insights: 0,
      digests: { morning: "outside window", night: "already created" },
    },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "notifications-reminders",
    {
      created: 0,
      insights: 0,
      digests: { morning: "created", night: "outside window" },
    },
    "USEFUL_OUTPUT",
  ],
  [
    "notifications-reminders",
    {
      created: 0,
      insights: 0,
      digests: { morning: "unexpected", night: "outside window" },
    },
    "UNKNOWN",
  ],
  ...[0, 8].map((retried): [string, unknown, string] => [
    "notifications-dispatch",
    {
      claimed: retried,
      delivered: 0,
      retried,
      skipped: 0,
      deferred: 0,
      lostLeases: 0,
    },
    retried ? "DEFERRED" : "NO_WORK",
  ]),
  [
    "notifications-dispatch",
    {
      claimed: 2,
      delivered: 1,
      retried: 1,
      skipped: 0,
      deferred: 0,
      lostLeases: 0,
    },
    "PARTIAL_FAILURE",
  ],
  [
    "notifications-dispatch",
    {
      claimed: 1,
      delivered: 0,
      retried: 0,
      skipped: 0,
      deferred: 0,
      lostLeases: 1,
    },
    "UNKNOWN",
  ],
  ["paystack-sync", {}, "UNKNOWN"],
  ["paystack-sync", { ran: true, recorded: 0 }, "MAINTENANCE_COMPLETE"],
  ["paystack-sync", { ran: false, recorded: 0 }, "DEFERRED"],
  ["curate-accumulators", { attempted: false, tiers: [] }, "NO_WORK"],
  [
    "curate-accumulators",
    { attempted: true, tiers: [{ status: "exists" }, { status: "empty" }] },
    "MAINTENANCE_COMPLETE",
  ],
  [
    "curate-accumulators",
    { attempted: true, tiers: [{ status: "created" }] },
    "USEFUL_OUTPUT",
  ],
  [
    "curate-accumulators",
    { attempted: true, tiers: [{ status: "unexpected" }] },
    "UNKNOWN",
  ],
];
for (const [job, payload, status] of cases)
  check(assessJobCompletion(job, payload).status, status);
for (const [sent, failed, retried, errors, status] of [
  [0, 0, 0, {}, "NO_WORK"],
  [1, 0, 0, {}, "USEFUL_OUTPUT"],
  [1, 1, 0, {}, "PARTIAL_FAILURE"],
  [0, 0, 1, {}, "DEFERRED"],
  [0, 0, 0, { producer: "failed" }, "FAILED"],
] as const)
  check(
    assessJobCompletion("email-dispatch", {
      ran: true,
      queued: { receipts: 0 },
      errors,
      send: { sent, failed, retried, skipped: 0, expired: 0 },
    }).status,
    status,
  );
check(assessJobCompletion("email-dispatch", { ran: false }).status, "DEFERRED");
check(
  assessJobCompletion("email-dispatch", { ran: true, send: {} }).status,
  "UNKNOWN",
);
console.log(
  `Odds integrity and job outcome regression: ${checks} checks passed`,
);
