/**
 * Pure early-horizon regression checks. No football API, database or secrets.
 * Run with: npx tsx scripts/check-early-fixtures.ts
 */
import assert from "node:assert/strict";
import { leaguesInTiers } from "../src/lib/leagues";
import { GENERATE_UNTIL_HOURS } from "../src/lib/generation/window";
import { maxQueuedKickoff } from "../src/lib/generation/queueWindow";
import { readFileSync } from "node:fs";
import {
  EARLY_FIXTURE_POLICY,
  discoveryHorizonDays,
  earlyDateRange,
  earlyFixtureMode,
  inEarlyGenerationWindow,
} from "../src/lib/generation/earlyFixturePolicy";

const core = leaguesInTiers(["CORE"]);
const secondary = leaguesInTiers(["SECONDARY"]);
assert.ok(core.length > 0 && secondary.length > 0, "real priority scope must exist");
assert.equal(discoveryHorizonDays(core[0]), 14);
assert.equal(discoveryHorizonDays(secondary[0]), 10);
assert.equal(discoveryHorizonDays(-999), 0);

const now = new Date("2026-11-19T09:00:00Z");
assert.deepEqual(earlyDateRange(now, 14), { from: "2026-11-19", to: "2026-12-03" });
const hoursLater = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
assert.equal(inEarlyGenerationWindow(hoursLater(48), now), false);
assert.equal(inEarlyGenerationWindow(hoursLater(49), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(168), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(169), now), false);
assert.equal(inEarlyGenerationWindow(hoursLater(-1), now), false);
assert.equal(EARLY_FIXTURE_POLICY.MAX_QUEUE_PER_DAY, 20);

assert.equal(earlyFixtureMode(undefined), earlyFixtureMode(process.env.EARLY_FIXTURE_MODE));
assert.equal(earlyFixtureMode("off"), "off");
assert.equal(earlyFixtureMode("shadow"), "shadow");
assert.equal(earlyFixtureMode("on"), "on");
assert.equal(earlyFixtureMode("invalid"), "off");

// The existing 48h final/paid lane cannot steal new 2–7d rows merely
// because discovery put them in the shared ledger before their normal window.
assert.equal(GENERATE_UNTIL_HOURS, 48);
assert.equal(maxQueuedKickoff(now)?.toISOString(), hoursLater(48).toISOString());
assert.equal(maxQueuedKickoff(now, [])?.toISOString(), hoursLater(48).toISOString());
assert.equal(maxQueuedKickoff(now, ["explicit-early-match"]), undefined);
const ordinaryQueue = readFileSync("src/lib/generation/queue.ts", "utf8");
assert.ok(ordinaryQueue.includes("const ordinaryUntil = maxQueuedKickoff(now, opts.matchKeys)"));
assert.ok(ordinaryQueue.includes("kickoff: { gt: now, ...(ordinaryUntil ? { lte: ordinaryUntil } : {}) }"));
const queueCapture = readFileSync("src/lib/generation/earlyFixtureDiscovery.ts", "utf8");
assert.ok(queueCapture.includes("await tx.generationAttempt.create(") &&
  queueCapture.includes("await tx.upcomingFixture.updateMany(") &&
  queueCapture.includes('if (marked.count !== 1) throw new Error("EARLY_FIXTURE_ALREADY_QUEUED")'),
  "new queue provenance is atomic, never bulk-stamped after partial dedupe");

console.log("PASS: early fixture policy, bounded windows, quota, rollout and 48h isolation");
