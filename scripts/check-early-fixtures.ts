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
  inEarlyDiscoveryWindow,
  generationHorizonHours,
  EARLY_SPOTLIGHT_LEAGUES,
  earlySpotlightLeague,
} from "../src/lib/generation/earlyFixturePolicy";

const core = leaguesInTiers(["CORE"]);
const secondary = leaguesInTiers(["SECONDARY"]);
const fallback = leaguesInTiers(["FALLBACK"]);
const deepFallback = leaguesInTiers(["DEEP_FALLBACK"]);
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
  rawDiscovery.includes("nextLeagues(ordinarySlots, now)") &&
  rawDiscovery.includes("candidatesFromFixtures(rows,") &&
  rawDiscovery.includes("byLeague[leagueApiId].queued++"),
  "regional spotlight preserves three other slots including lower-league rotation, quality filters and diagnostics");

assert.equal(Math.max(...VISIBLE_FEED_DAYS.map(feedDayOffset)), 5, "visible date rail stops at day five");
assert.ok(!VISIBLE_FEED_DAYS.includes("day-14"), "day 14 stays off the public rail");
assert.ok(FEED_DAYS.includes("day-14") && parseFeedDay("day-14") === "day-14", "internal 14-day URL remains valid");
assert.equal(discoveryHorizonDays(core[0]), 14);
assert.equal(discoveryHorizonDays(secondary[0]), 10);
assert.equal(discoveryHorizonDays(fallback[0]), 7);
assert.equal(discoveryHorizonDays(deepFallback[0]), 5);
assert.equal(discoveryHorizonDays(-999), 0);

const now = new Date("2026-11-19T09:00:00Z");
assert.deepEqual(earlyDateRange(now, 14), { from: "2026-11-19", to: "2026-12-03" });
const hoursLater = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
// Generation eligibility (issue #237): 5 days (120h) for CORE/SECONDARY/FALLBACK, 3 days for DEEP_FALLBACK.
const day = (d: number) => hoursLater(d * 24);
for (const [league, name] of [[core[0], "CORE"], [secondary[0], "SECONDARY"], [fallback[0], "FALLBACK"]] as const) {
  assert.equal(inEarlyGenerationWindow(day(14), now, league), false, name + " 14d not generated");
  assert.equal(inEarlyGenerationWindow(day(10), now, league), false, name + " 10d not generated");
  assert.equal(inEarlyGenerationWindow(day(7), now, league), false, name + " 7d not generated");
  assert.equal(inEarlyGenerationWindow(hoursLater(121), now, league), false, name + " 121h not generated");
  assert.equal(inEarlyGenerationWindow(day(5), now, league), true, name + " 5d (120h) generated");
  assert.equal(inEarlyGenerationWindow(day(3), now, league), true, name + " 3d generated");
  assert.equal(inEarlyGenerationWindow(hoursLater(49), now, league), true);
  assert.equal(inEarlyGenerationWindow(day(2), now, league), false, name + " 48h belongs to the final lane");
  assert.equal(inEarlyGenerationWindow(day(1), now, league), false);
}
assert.equal(inEarlyGenerationWindow(day(5), now, deepFallback[0]), false, "DEEP_FALLBACK not at 5d");
assert.equal(inEarlyGenerationWindow(hoursLater(73), now, deepFallback[0]), false);
assert.equal(inEarlyGenerationWindow(day(3), now, deepFallback[0]), true, "DEEP_FALLBACK target is 3d");
assert.equal(generationHorizonHours(deepFallback[0]), 72);
assert.equal(generationHorizonHours(core[0]), 120);
assert.equal(inEarlyGenerationWindow(day(10), now), false, "unknown league never generated at 10d");
assert.equal(inEarlyGenerationWindow(day(4), now), true);
assert.equal(inEarlyGenerationWindow(hoursLater(-1), now), false);
// Discovery / odds warming keep the old 14/10/7/5-day horizons.
assert.equal(inEarlyDiscoveryWindow(day(14), now, core[0]), true);
assert.equal(inEarlyDiscoveryWindow(hoursLater(337), now, core[0]), false);
assert.equal(inEarlyDiscoveryWindow(day(10), now, secondary[0]), true);
assert.equal(inEarlyDiscoveryWindow(hoursLater(241), now, secondary[0]), false);
assert.equal(inEarlyDiscoveryWindow(day(7), now, fallback[0]), true);
assert.equal(inEarlyDiscoveryWindow(day(5), now, deepFallback[0]), true);
assert.equal(inEarlyDiscoveryWindow(hoursLater(48), now, core[0]), false);
// Rescheduling moves a fixture across the boundary in either direction.
assert.equal(inEarlyGenerationWindow(day(8), now, core[0]), false);
assert.equal(inEarlyGenerationWindow(new Date(day(8).getTime() - 4 * 86_400_000), now, core[0]), true, "moved 4 days earlier becomes eligible");
// Every early entrypoint uses the shared generation window; only odds warming uses discovery.
for (const f of ["earlyGeneration", "earlyPublication"]) {
  const src = readFileSync(`src/lib/generation/${f}.ts`, "utf8");
  assert.ok(src.includes("inEarlyGenerationWindow"), f + " gates on the generation window");
}
assert.ok(readFileSync("src/lib/generation/earlyOdds.ts", "utf8").includes("inEarlyDiscoveryWindow"), "odds warming keeps the discovery horizon");
const earlyRunRoute = readFileSync("src/app/api/admin/generate/early-run/route.ts", "utf8");
assert.ok(earlyRunRoute.includes("export const POST") && earlyRunRoute.includes("isAdmin(session?.user.role)") &&
  !/postOverride[\s\S]*CRON_SECRET/.test(earlyRunRoute), "early override is admin-session only, never the scheduler secret");
assert.ok(readFileSync("src/lib/generation/earlyGeneration.ts", "utf8").includes("pricedKeys.has(a.matchKey)) : workable"), "override requires an actual fresh quote");
assert.equal(EARLY_FIXTURE_POLICY.MAX_RUN_MS, 22_000, "existing discovery runtime cutoff is preserved");
assert.ok(!("MAX_QUEUE_PER_DAY" in EARLY_FIXTURE_POLICY) && !("MAX_QUEUE_PER_LEAGUE" in EARLY_FIXTURE_POLICY),
  "no artificial daily/league limit on early queueing");
assert.ok(rawDiscovery.includes('leaguesInTiers(["CORE", "SECONDARY"])') &&
  rawDiscovery.includes('leaguesInTiers(["FALLBACK", "DEEP_FALLBACK"])') &&
  rawDiscovery.includes("expansionSlots = batch >= 4"),
  "priority and fallback competitions rotate within the same four provider scans");
assert.ok(rawDiscovery.includes("const season = expandedTier ? cachedSeason?.season : await resolveSeason(leagueApiId, now);") &&
  rawDiscovery.includes("if (!season) continue;"),
  "fallback scan never consumes an extra /leagues lookup when season metadata is missing");

assert.ok(!rawDiscovery.includes("todayQueued") && !rawDiscovery.includes("MAX_QUEUE_PER_DAY"),
  "early fixtures remain queueable regardless of the number queued earlier today");

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

console.log("PASS: full-tier early fixture discovery without daily limits, quotas, rollout and 48h isolation");
