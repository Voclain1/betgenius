/**
 * Pure early-horizon regression checks. No football API, database or secrets.
 * Run with: npx tsx scripts/check-early-fixtures.ts
 */
import assert from "node:assert/strict";
import { LEAGUE_CATALOGUE, generationTierOf, leaguesInTiers } from "../src/lib/leagues";
import { FEED_DAYS, VISIBLE_FEED_DAYS, feedDayOffset, parseFeedDay } from "../src/lib/feedDays";
import { GENERATE_UNTIL_HOURS } from "../src/lib/generation/window";
import { maxQueuedKickoff } from "../src/lib/generation/queueWindow";
import { readFileSync } from "node:fs";
import { resolveGenerationRisk, EARLY_FREE_GENERATION_INTENT, VIP_ROUTE_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import {
  EARLY_FIXTURE_POLICY,
  discoveryHorizonDays,
  earlyDateRange,
  earlyFixtureMode,
  inEarlyGenerationWindow,
  EARLY_SPOTLIGHT_LEAGUES,
  earlySpotlightLeague,
} from "../src/lib/generation/earlyFixturePolicy";

const core = leaguesInTiers(["CORE"]);
const secondary = leaguesInTiers(["SECONDARY"]);
assert.ok(core.length > 0 && secondary.length > 0, "real priority scope must exist");
const regional = [307, 301, 330, 288, 286, 333, 235];
const cataloguedIds = new Set<number>(LEAGUE_CATALOGUE.map(l => l.id));
assert.deepEqual([...EARLY_SPOTLIGHT_LEAGUES], regional, "requested leagues have a rotating early scan");
assert.ok(regional.every(id => generationTierOf(id) === "SECONDARY"), "all requested leagues have always-on normal discovery");
assert.ok(regional.every(id => cataloguedIds.has(id)), "all requested competitions have logos, names and flags");
assert.equal(LEAGUE_CATALOGUE.find(l => l.id === 301)?.country, "United Arab Emirates");
assert.equal(LEAGUE_CATALOGUE.find(l => l.id === 330)?.country, "Kuwait");
assert.equal(LEAGUE_CATALOGUE.find(l => l.id === 307)?.country, "Saudi Arabia");
assert.equal(LEAGUE_CATALOGUE.find(l => l.id === 301)?.flagCode, "ae");
assert.equal(LEAGUE_CATALOGUE.find(l => l.id === 330)?.flagCode, "kw");
const halfHour = 30 * 60_000;
const spotlightStart = new Date("2026-11-20T00:03:00Z");
assert.equal(new Set(Array.from({ length: regional.length }, (_, i) =>
  earlySpotlightLeague(new Date(spotlightStart.getTime() + i * halfHour)))).size, regional.length,
  "every requested region gets a dedicated early scan slot in seven half-hour cycles");
const rawDiscovery = readFileSync("src/lib/generation/earlyFixtureDiscovery.ts", "utf8");
assert.ok(rawDiscovery.includes("earlySpotlightLeague(now)") &&
  rawDiscovery.includes("nextLeagues(batch - 1, now)") &&
  rawDiscovery.includes("candidatesFromFixtures(rows,") &&
  rawDiscovery.includes("byLeague[leagueApiId].queued++"),
  "regional spotlight preserves three other discovery slots, standard quality filters and diagnostics");

assert.equal(Math.max(...VISIBLE_FEED_DAYS.map(feedDayOffset)), 5, "visible date rail stops at day five");
assert.ok(!VISIBLE_FEED_DAYS.includes("day-14"), "day 14 stays off the public rail");
assert.ok(FEED_DAYS.includes("day-14") && parseFeedDay("day-14") === "day-14", "internal 14-day URL remains valid");
assert.equal(discoveryHorizonDays(core[0]), 14);
assert.equal(discoveryHorizonDays(secondary[0]), 10);
assert.equal(discoveryHorizonDays(-999), 0);

const now = new Date("2026-11-19T09:00:00Z");
assert.deepEqual(earlyDateRange(now, 14), { from: "2026-11-19", to: "2026-12-03" });
const hoursLater = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
assert.equal(inEarlyGenerationWindow(hoursLater(48), now), false);
assert.equal(inEarlyGenerationWindow(hoursLater(49), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(168), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(240), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(336), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(337), now), false);
assert.equal(inEarlyGenerationWindow(hoursLater(260), now, secondary[0]), false);
assert.equal(inEarlyGenerationWindow(hoursLater(240), now, secondary[0]), true);
assert.equal(inEarlyGenerationWindow(hoursLater(300), now, core[0]), true);
assert.equal(inEarlyGenerationWindow(hoursLater(-1), now), false);
assert.equal(EARLY_FIXTURE_POLICY.MAX_QUEUE_PER_DAY, 20);

// A paid CORE fixture remains VIP for the normal worker but a dedicated
// early FREE job must be genuinely free-generated rather than re-labelled.
const corePaidRoute = VIP_ROUTE_LEAGUE_IDS[0];
assert.equal(resolveGenerationRisk(["FEATURED"], corePaidRoute).calibration, "vip");
assert.equal(resolveGenerationRisk(["FEATURED"], corePaidRoute, EARLY_FREE_GENERATION_INTENT).calibration, "genius");
assert.deepEqual(resolveGenerationRisk(["FEATURED"], corePaidRoute, EARLY_FREE_GENERATION_INTENT).promptTiers, ["GENIUS"]);
assert.equal(resolveGenerationRisk(["VIP"], corePaidRoute, EARLY_FREE_GENERATION_INTENT).calibration, "vip");
assert.equal(resolveGenerationRisk(["BANKER"], corePaidRoute, EARLY_FREE_GENERATION_INTENT).calibration, "legacy");
assert.ok(readFileSync("src/lib/generation/earlyGeneration.ts", "utf8").includes("intent: EARLY_FREE_GENERATION_INTENT"),
  "dedicated early worker must provide intent explicitly");
assert.ok(readFileSync("src/lib/ai/generate.ts", "utf8").includes("resolveGenerationRisk(input.categories, input.leagueApiId, input.intent)"));

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
