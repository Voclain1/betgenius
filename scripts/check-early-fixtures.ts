/**
 * Pure early-horizon regression checks. No football API, database or secrets.
 * Run with: npx tsx scripts/check-early-fixtures.ts
 */
import assert from "node:assert/strict";
import { leaguesInTiers } from "../src/lib/leagues";
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

// The existing 48h paid/final lane stays entirely independent.
const { GENERATE_UNTIL_HOURS } = await import("../src/lib/generation/window");
assert.equal(GENERATE_UNTIL_HOURS, 48);

console.log("PASS: early fixture policy, bounded windows, quota, rollout and 48h isolation");
