/**
 * Deterministic evidence monitoring checks — no provider, database or secrets.
 * npm run check:reassessment
 */
import assert from "node:assert/strict";
import type { MatchDigest, TeamDigest } from "../src/lib/ai/digest";
import { compareFootballEvidence, fixtureSignals, reassessmentIntervalMinutes,
  confirmedLineupSignals, oddsMovementSignal } from "../src/lib/reassessment/evidence";
import { reassessmentMode, publishedSelectionSnapshot, shouldRecordReassessmentReceipt } from "../src/lib/reassessment/worker";
import { FREE_REASSESSMENT_VISIBLE, MIXED_REASSESSMENT_VISIBLE } from "../src/lib/reassessment/visibility";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { earlyPublicationBlock, earlyPublicationMode, isDedicatedEarlyFreeJob,
  EARLY_PUBLICATION_CONFIDENCE_FLOOR } from "../src/lib/generation/earlyPublication";
import { GENIUS_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR, PREMIUM_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { GOALS_MIN_CONFIDENCE } from "../src/lib/goalsGeneration";

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
assert.ok(!categorySource.includes('publicHold: true'),
  "category feed must never hide a published tip on automatic reassessment");
assert.ok(categorySource.includes('!PAID_FEEDS.has(cat)') || categorySource.includes('PAID_FEEDS'),
  "paid feed access rules remain separate");

// Detection records one private receipt for a new material signature; no
// SHADOW-to-LIVE public disclosure, repeated notice or unapproved withdrawal.
const receipt = (mode: "on" | "shadow", sameSignature: boolean, existingStatus = "REVIEW_REQUIRED", publicHold = false) =>
  shouldRecordReassessmentReceipt({ mode, sameSignature, existingStatus, publicHold });
assert.equal(receipt("shadow", true), false);
assert.equal(receipt("on", true), false);
assert.equal(receipt("on", true, "REVIEW_REQUIRED", true), false);
assert.equal(receipt("on", true, "CURRENT", false), false);
assert.equal(receipt("on", false, "CURRENT", false), true);
assert.deepEqual(FREE_REASSESSMENT_VISIBLE, {}, "free public recommendations ignore admin-only review flags");
assert.deepEqual(MIXED_REASSESSMENT_VISIBLE, {}, "mixed match/team/league lists ignore review flags");
assert.ok(monitorSource.includes('publiclyVisible: false') &&
  monitorSource.includes('publicHold: false') &&
  !monitorSource.includes('status: "ARCHIVED"') &&
  !monitorSource.includes('status: "WITHDRAWN"') &&
  !monitorSource.includes('generatePredictionForFixture(') &&
  !monitorSource.includes('createNotificationEvent('),
  "monitoring cannot alter publication, generate rewrites or notify readers");
assert.ok(monitorSource.includes('retainedUnchanged: alreadyRecorded && input.previousStatus === "CURRENT"')
  && monitorSource.includes("if (retainedUnchanged) {"),
  "a reviewed and retained evidence signature must not reopen without new information");
const matchSource = readFileSync(join(process.cwd(), "src/app/(public)/predictions/match/[slug]/page.tsx"), "utf8");
const revisionPage = readFileSync(join(process.cwd(), "src/app/(public)/predictions/updates/[id]/page.tsx"), "utf8");
const rewriteRoute = readFileSync(join(process.cwd(), "src/app/api/admin/reassessment/rewrite/route.ts"), "utf8");
const resolveRoute = readFileSync(join(process.cwd(), "src/app/api/admin/reassessment/resolve/route.ts"), "utf8");
assert.ok(!matchSource.includes("Important prediction update") &&
  !matchSource.includes("reviewNotices") &&
  revisionPage.includes("if (!isAdmin(session?.user.role)) notFound()"),
  "never render public review banners or public reassessment histories, paid or free");
assert.ok(rewriteRoute.includes('action: z.enum(["GENERATE", "APPLY"])') &&
  rewriteRoute.includes('kind: "ADMIN_REWRITE_DRAFT"') &&
  rewriteRoute.includes('kind: "ADMIN_REWRITE_APPLIED"') &&
  rewriteRoute.includes("unchangedSelection(current, draft)") &&
  resolveRoute.includes('kind: action === "REPLACE" ? "REPLACED" : "WITHDRAWN", publiclyVisible: false'),
  "only an administrator can generate/apply an audited rewrite or explicitly withdraw a tip");
assert.equal(reassessmentMode("bad"), "off");
assert.equal(earlyPublicationMode("bad"), "off");
// The free early lane must never inherit the VIP or Premium floor. Its bar is
// identical to existing FREE Genius/Goals, but qualifying still demands the
// provider, structural and evidence checks below.
assert.equal(GENIUS_CONFIDENCE_FLOOR, 70);
assert.equal(GOALS_MIN_CONFIDENCE, GENIUS_CONFIDENCE_FLOOR);
assert.equal(VIP_CONFIDENCE_FLOOR, 75);
assert.equal(PREMIUM_CONFIDENCE_FLOOR, 80);
assert.equal(EARLY_PUBLICATION_CONFIDENCE_FLOOR, GENIUS_CONFIDENCE_FLOOR);
const candidate = {
  id: "p1", status: "PENDING_REVIEW", provenance: "STANDARD_CURATED", fixtureApiId: 1,
  kickoff: inHours(120), contextComplete: true, confidence: 83,
  marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false,
  categories: ["FEATURED"], earlyJobVerified: true,
};
assert.equal(earlyPublicationBlock({ ...candidate, marketType: "OTHER" }, prior, now), "invalid-market");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 69 }, prior, now), "below-early-confidence-floor");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70 }, prior, now), null,
  "a 70% early FREE pick with genuine two-sided evidence qualifies");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 74 }, prior, now), null,
  "free picks in the 70–74 band must not be held to VIP's 75% bar");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 79 }, prior, now), null,
  "free picks in the 75–79 band must not be held to Premium's 80% bar");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, categories: ["PREMIUM"] }, prior, now), "reserved-category");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, provenance: "VIP_GENERATED" }, prior, now), "protected-provenance");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, contextComplete: false }, prior, now), "no-reliable-evidence");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, earlyJobVerified: false }, prior, now), "not-dedicated-early-free-job");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, marketType: "OVER_UNDER",
  selection: { line: 2.5, direction: "OVER" }, categories: ["FEATURED", "GOALS"] }, prior, now), null,
  "a genuine structured Over 2.5 pick may carry the automatically derived free GOALS tag");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70,
  categories: ["FEATURED", "VIP"] }, prior, now), "reserved-category",
  "free early approval must refuse a manually VIP-tagged draft even if also Featured");
assert.equal(earlyPublicationBlock({ ...candidate, confidence: 70, manualSettlementOnly: true }, prior, now),
  "invalid-market", "auto publication must retain structured settlement eligibility");
assert.equal(earlyPublicationBlock({ ...candidate, categories: ["VIP"] }, prior, now), "reserved-category");
assert.equal(earlyPublicationBlock({ ...candidate, categories: ["SAME_GAME_DOUBLE"] }, prior, now), "combo-source-or-double");
assert.equal(earlyPublicationBlock(candidate, null, now), "no-reliable-evidence");
assert.equal(earlyPublicationBlock({ ...candidate, earlyJobVerified: false }, prior, now), "not-dedicated-early-free-job");
assert.equal(isDedicatedEarlyFreeJob(JSON.stringify({ intent: "EARLY_FREE", fixtureApiId: 1, categories: ["FEATURED"] }), 1), true);
assert.equal(isDedicatedEarlyFreeJob(JSON.stringify({ intent: "EARLY_FREE", fixtureApiId: 2, categories: ["FEATURED"] }), 1), false);
assert.equal(isDedicatedEarlyFreeJob(JSON.stringify({ intent: "VIP_PREMIUM", fixtureApiId: 1, categories: ["FEATURED"] }), 1), false);
assert.equal(isDedicatedEarlyFreeJob(JSON.stringify({ intent: "EARLY_FREE", fixtureApiId: 1, categories: ["VIP"] }), 1), false);
assert.equal(isDedicatedEarlyFreeJob("not-json", 1), false);
assert.equal(earlyPublicationBlock({ ...candidate, kickoff: inHours(24) }, prior, now), "outside-early-window");
assert.deepEqual(publishedSelectionSnapshot({ marketType: "BTTS", selection: { value: "YES" }, confidence: 83,
  market: "BTTS", pick: "Yes", publishedAt: now, status: "PUBLISHED", odds: null }).publishedAt, now.toISOString());

console.log("PASS: early publication refusal gates, confirmed injury/form/lineup change, fixture withdrawal, and reassessment cadence");
