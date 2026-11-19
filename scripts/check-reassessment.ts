/**
 * Deterministic evidence monitoring checks — no provider, database or secrets.
 * npm run check:reassessment
 */
import assert from "node:assert/strict";
import type { MatchDigest, TeamDigest } from "../src/lib/ai/digest";
import { compareFootballEvidence, fixtureSignals, reassessmentIntervalMinutes,
  confirmedLineupSignals, oddsMovementSignal } from "../src/lib/reassessment/evidence";
import { reassessmentMode, publishedSelectionSnapshot } from "../src/lib/reassessment/worker";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { earlyPublicationBlock, earlyPublicationMode,
  EARLY_PUBLICATION_CONFIDENCE_FLOOR } from "../src/lib/generation/earlyPublication";

const now = new Date("2026-11-19T09:00:00.000Z");
const inHours = (n: number) => new Date(now.getTime() + n * 3_600_000);
const five = [
  { date: "2026-11-01", opponent: "B", venue: "home", result: "W", goalsFor: 2, goalsAgainst: 1 },
  { date: "2026-11-06", opponent: "C", venue: "away", result: "W", goalsFor: 1, goalsAgainst: 0 },
  { date: "2026-11-11", opponent: "D", venue: "home", result: "D", goalsFor: 1, goalsAgainst: 1 },
] as unknown as TeamDigest["last5"];
const team = (apiId: number, overrides: Partial<TeamDigest> = {}) => ({
  apiId,
  name: "Test " + apiId,
  overall: { played: 12, win: 8, draw: 2, loss: 2, goalsFor: 24, goalsAgainst: 9 },
  last5: five,
  availability: [],
  availabilityAsOf: "2026-11-17",
  keyPlayers: [{ name: "Main Striker", goals: 10 }],
  coach: { name: "Coach One" },
  ...overrides,
}) as TeamDigest;

const digest = (home: TeamDigest, away: TeamDigest) => ({
  v: 2, fixture: { home: "Home", away: "Away", league: "League", kickoff: inHours(120).toISOString() },
  teams: { home, away }, h2h: null, standings: null,
  coverage: { stats: true, form: true, availability: true, h2h: false, standings: false },
}) as MatchDigest;

const prior = digest(team(1), team(2));
assert.deepEqual(compareFootballEvidence(prior, prior, now), [], "unchanged evidence stays quiet");
const withoutCoverage = digest(team(1, { availabilityAsOf: null }), team(2));
const injured = digest(team(1, { availabilityAsOf: "2026-11-19",
  availability: [{ player: "Main Striker", kind: "injury", reason: "Hamstring" }] }), team(2));
assert.equal(compareFootballEvidence(prior, injured, now)[0]?.severity, "CRITICAL", "new important injury alerts");
assert.equal(compareFootballEvidence(withoutCoverage, injured, now).length, 0, "missing original injury feed is not proof of new injury");
const newResult = digest(team(1, { last5: [...five, { ...five[0], date: "2026-11-18" }] }), team(2));
assert.ok(compareFootballEvidence(prior, newResult, now).some(s => s.source === "form"));
const changedCoach = digest(team(1, { coach: { name: "Coach Two" } }), team(2));
assert.ok(compareFootballEvidence(prior, changedCoach, now).some(s => s.source === "coach"));

assert.equal(fixtureSignals(inHours(120), { fixtureApiId: 1, kickoff: inHours(120), seenAt: now, status: "NS" }, now).length, 0);
assert.equal(fixtureSignals(inHours(120), { fixtureApiId: 1, kickoff: inHours(120), seenAt: now, status: "PST" }, now)[0]?.severity, "CRITICAL");
assert.equal(fixtureSignals(inHours(120), { fixtureApiId: 1, kickoff: inHours(144), seenAt: now, status: "NS" }, now)[0]?.source, "fixture");
assert.deepEqual(fixtureSignals(inHours(120), { fixtureApiId: 1, kickoff: inHours(120),
  seenAt: new Date(now.getTime() - 24 * 3_600_000), status: "CANC" }, now), [], "stale status cannot cause withdrawal");
assert.equal(confirmedLineupSignals([{ teamId: 1, starters: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: "Starter " + i })) },
  { teamId: 2, starters: Array.from({ length: 11 }, (_, i) => ({ id: 11 + i, name: "Player " + i })) }], prior)[0]?.severity, "CRITICAL");

const oldOdds = { median: 1.75, bookmakers: 6, at: new Date(now.getTime() - 3 * 3_600_000) };
const recentOdds = { median: 2.1, bookmakers: 8, at: new Date(now.getTime() - 30 * 60_000) };
assert.equal(oddsMovementSignal(oldOdds, recentOdds, now)[0]?.source, "odds");
assert.equal(oddsMovementSignal(oldOdds, { ...recentOdds, bookmakers: 1 }, now).length, 0);
assert.equal(oddsMovementSignal(oldOdds, { ...recentOdds, at: oldOdds.at }, now).length, 0);
assert.equal(oddsMovementSignal(oldOdds, { ...recentOdds, at: new Date(now.getTime() - 6 * 3_600_000) }, now).length, 0);

assert.equal(reassessmentIntervalMinutes(now, inHours(120)), 1440);
assert.equal(reassessmentIntervalMinutes(now, inHours(48)), 720);
assert.equal(reassessmentIntervalMinutes(now, inHours(12)), 360);
assert.equal(reassessmentIntervalMinutes(now, inHours(3)), 60);
assert.equal(reassessmentIntervalMinutes(now, inHours(1)), 15);
assert.equal(reassessmentIntervalMinutes(now, inHours(-1)), 0);

const monitorSource = readFileSync(join(process.cwd(), "src/lib/reassessment/worker.ts"), "utf8");
assert.ok(monitorSource.includes("if (!freshFixture) {") &&
  monitorSource.includes('lastError: "FIXTURE_STATE_UNAVAILABLE"') &&
  monitorSource.indexOf("if (!freshFixture) {") < monitorSource.indexOf("buildGenerationDigest({"),
  "missing provider fixture must remain UNKNOWN before any updated-form comparison");
assert.ok(monitorSource.includes('lastError: "PUBLISHED_BASELINE_UNAVAILABLE"') &&
  monitorSource.includes('const keepReview = row.reassessment?.status === "REVIEW_REQUIRED"'),
  "missing original context cannot certify CURRENT or clear a pending review");
const categorySource = readFileSync(join(process.cwd(), "src/lib/categoryPredictions.ts"), "utf8");
assert.ok(categorySource.includes('NOT: { reassessment: { is: { publicHold: true } } }'),
  "free category feed must filter only live, public reassessment holds");
assert.ok(categorySource.includes('!PAID_FEEDS.has(cat)'),
  "paid category feeds must remain under separate protections");

assert.equal(reassessmentMode("bad"), "off");
assert.equal(earlyPublicationMode("bad"), "off");
assert.equal(EARLY_PUBLICATION_CONFIDENCE_FLOOR, 80);
const candidate = {
  id: "p1", status: "PENDING_REVIEW", provenance: "STANDARD_CURATED", fixtureApiId: 1,
  kickoff: inHours(120), contextComplete: true, confidence: 83,
  marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false,
  categories: ["FEATURED"],
};
assert.equal(earlyPublicationBlock({ ...candidate, marketType: "OTHER" }, prior, now), "invalid-market");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 74 }, prior, now), "below-early-confidence-floor");
assert.equal(earlyPublicationBlock({ ...candidate, categories: ["VIP"] }, prior, now), "reserved-category");
assert.equal(earlyPublicationBlock({ ...candidate, categories: ["SAME_GAME_DOUBLE"] }, prior, now), "combo-source-or-double");
assert.equal(earlyPublicationBlock(candidate, null, now), "no-reliable-evidence");
assert.equal(earlyPublicationBlock({ ...candidate, kickoff: inHours(24) }, prior, now), "outside-early-window");
assert.deepEqual(publishedSelectionSnapshot({ marketType: "BTTS", selection: { value: "YES" }, confidence: 83,
  market: "BTTS", pick: "Yes", publishedAt: now, status: "PUBLISHED", odds: null }).publishedAt, now.toISOString());

console.log("PASS: early publication refusal gates, confirmed injury/form/lineup change, fixture withdrawal, and reassessment cadence");
