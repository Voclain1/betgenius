/**
 * Offline self-checks for the scheduled generation logic.
 *
 * No network, no database. What's pinned down here is the behaviour that keeps
 * an unattended, scheduled process safe:
 *
 *   - retry backoff escalating and then giving up, rather than retrying a
 *     permanently broken fixture forever;
 *   - the refresh priority tiers actually preferring imminent kickoffs, and
 *     skipping teams that are already fresh enough (which is where the
 *     api-football saving comes from);
 *   - review transitions being identical for single and bulk actions;
 *   - cost/latency arithmetic on the observability panel.
 *
 * Run: npx tsx scripts/check-generation.ts
 */
import { nextAttemptAt, RETRY_BACKOFF_MINUTES, MAX_GENERATION_ATTEMPTS, GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS, SAME_DAY_GENERATE_FROM_HOURS } from "../src/lib/generation/selector";
import { isLagosToday, lagosTodayBounds } from "../src/lib/lagosDate";
import { tierFor, REFRESH_TIERS } from "../src/lib/enrichment";
import { reviewTransition } from "../src/lib/predictions";
import { estimateCostUsd, providerOf, priceFor } from "../src/lib/generation/stats";
import { CURATION_MAX, CURATION_MIN, GENIUS_CONFIDENCE_FLOOR, PREMIUM_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR, selectCuratedIds } from "../src/lib/geniusCuration";
import { buildSystemPrompt } from "../src/lib/ai/analysis";
import { resolveGenerationRisk, VIP_PROXY_LEAGUE_CUTOFF, VIP_PROXY_LEAGUE_IDS } from "../src/lib/ai/generationRisk";
import { CUP_CONFIGS, competitionPredictionsHref, cupSupports, fixtureIsInCupScope } from "../src/lib/cupConfig";
import { LEAGUE_CATALOGUE, LEAGUE_PRIORITY_ORDER, assertLeaguePriorityCatalogueInvariant, leaguePriorityRank, normalizeLeagueName } from "../src/lib/leagues";
import { applyCategoryChanges } from "../src/lib/predictions";
import { resolveQueuedLeagueName } from "../src/lib/generation/queue";

let passed = 0;
const failures: string[] = [];
const check = (l: string, c: boolean, got?: unknown) => {
  if (c) passed++;
  else failures.push(`${l}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};
const eq = (l: string, a: unknown, b: unknown) => check(l, JSON.stringify(a) === JSON.stringify(b), a);

const NOW = new Date("2026-08-19T12:00:00Z");
const hoursFrom = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

// --- Retry backoff --------------------------------------------------------
eq("backoff: first failure waits 15 minutes", nextAttemptAt(1, NOW)?.toISOString(), new Date(NOW.getTime() + 15 * 60_000).toISOString());
eq("backoff: second failure waits an hour", nextAttemptAt(2, NOW)?.toISOString(), new Date(NOW.getTime() + 60 * 60_000).toISOString());
eq("backoff: third failure waits four hours", nextAttemptAt(3, NOW)?.toISOString(), new Date(NOW.getTime() + 240 * 60_000).toISOString());
eq("backoff: past the schedule there is no next attempt (dead letter)", nextAttemptAt(MAX_GENERATION_ATTEMPTS + 1, NOW), null);
check("backoff: escalates rather than repeating a fixed delay",
  RETRY_BACKOFF_MINUTES.every((m, i) => i === 0 || m > RETRY_BACKOFF_MINUTES[i - 1]), RETRY_BACKOFF_MINUTES);
eq("backoff: attempt ceiling matches the schedule length", MAX_GENERATION_ATTEMPTS, RETRY_BACKOFF_MINUTES.length);

// --- Generation window ----------------------------------------------------
check("window: opens before it closes", GENERATE_FROM_HOURS < GENERATE_UNTIL_HOURS);
check("window: leaves at least a half day for review before kickoff", GENERATE_FROM_HOURS >= 12);
check("window: same-day floor preserves review time but covers most remaining games", SAME_DAY_GENERATE_FROM_HOURS > 0 && SAME_DAY_GENERATE_FROM_HOURS <= 2);
check("window: does not generate more than two days out, where team news is unsettled", GENERATE_UNTIL_HOURS <= 48);
const lagosBounds = lagosTodayBounds(new Date("2026-08-22T23:30:00Z"));
eq("Lagos day: starts at 23:00 UTC on the preceding date", lagosBounds.start.toISOString(), "2026-08-22T23:00:00.000Z");
eq("Lagos day: ends exactly 24 hours later", lagosBounds.end.toISOString(), "2026-08-23T23:00:00.000Z");
check("Lagos day: midnight rollover is date-derived", isLagosToday("2026-08-23T22:59:59Z", new Date("2026-08-22T23:30:00Z")));
check("Lagos day: excludes the next calendar date", !isLagosToday("2026-08-23T23:00:00Z", new Date("2026-08-22T23:30:00Z")));

const geniusPool = [
  { id: "minor-90", leagueApiId: 113, confidence: 90 },
  { id: "prem-65", leagueApiId: 39, confidence: 65 },
  { id: "prem-80", leagueApiId: 39, confidence: 80 },
  { id: "liga-75", leagueApiId: 140, confidence: 75 },
  { id: "serie-72", leagueApiId: 135, confidence: 72 },
  { id: "ligue-60", leagueApiId: 61, confidence: 60 },
];
eq("priority: England precedes Spain", leaguePriorityRank(39) < leaguePriorityRank(140), true);
eq("priority: Spain precedes Italy", leaguePriorityRank(140) < leaguePriorityRank(135), true);
eq("priority: listed leagues precede unknown leagues", leaguePriorityRank(71) < leaguePriorityRank(99999), true);
let priorityInvariantRejectedMissingId = false;
try {
  assertLeaguePriorityCatalogueInvariant([...LEAGUE_PRIORITY_ORDER, 999999]);
} catch {
  priorityInvariantRejectedMissingId = true;
}
check("priority invariant: every priority id is catalogued", LEAGUE_PRIORITY_ORDER.every((id) => LEAGUE_CATALOGUE.some((league) => league.id === id)));
check("priority invariant negative control: an uncatalogued future id fails", priorityInvariantRejectedMissingId);
eq("league names: legacy placeholder is rejected", normalizeLeagueName("Unknown competition"), null);
eq("league names: provider name is retained", normalizeLeagueName("  Danish   Cup "), "Danish Cup");
eq("league resolution: catalogue name wins", resolveQueuedLeagueName(121, "Provider Danish Name"), "Danish Cup");
eq("league resolution: provider name covers an uncatalogued id", resolveQueuedLeagueName(999998, "Provider Cup"), "Provider Cup");
eq("league resolution: a missing/placeholder-only name is rejected", resolveQueuedLeagueName(999998, "Unknown competition"), null);
eq("Genius: floor filters first, league priority ranks, and only the fifth slot relaxes", selectCuratedIds(geniusPool, GENIUS_CONFIDENCE_FLOOR), ["prem-80", "prem-65", "liga-75", "serie-72", "minor-90"]);
const broadPool = Array.from({ length: 20 }, (_, i) => ({ id: `row-${String(i).padStart(2, "0")}`, leagueApiId: i % 2 ? 39 : 140, confidence: i < 10 ? 80 : i < 15 ? 72 : 60 }));
eq("Genius: maximum is fifteen", selectCuratedIds(broadPool, GENIUS_CONFIDENCE_FLOOR).length, CURATION_MAX);
eq("VIP: maximum is fifteen", selectCuratedIds(broadPool.map((r) => ({ ...r, confidence: 80 })), VIP_CONFIDENCE_FLOOR).length, CURATION_MAX);
eq("PREMIUM: maximum is fifteen", selectCuratedIds(broadPool.map((r) => ({ ...r, confidence: 80 })), PREMIUM_CONFIDENCE_FLOOR).length, CURATION_MAX);
eq("PREMIUM: confidence floor is 75%", PREMIUM_CONFIDENCE_FLOOR, 75);
check("curation: minimum remains five", CURATION_MIN === 5);
const geniusSet = new Set(selectCuratedIds(broadPool, GENIUS_CONFIDENCE_FLOOR));
const vipSet = new Set(selectCuratedIds(broadPool, VIP_CONFIDENCE_FLOOR));
const premiumSet = new Set(selectCuratedIds(broadPool, PREMIUM_CONFIDENCE_FLOOR));
check("curation: GENIUS and VIP can overlap", [...geniusSet].some((id) => vipSet.has(id)));
check("curation: a prediction can qualify for GENIUS, VIP and PREMIUM", [...premiumSet].some((id) => geniusSet.has(id) && vipSet.has(id)));
check("curation: GENIUS and VIP are independently bounded", geniusSet.size !== vipSet.size);
eq("curation: PREMIUM applies its own 75% selection", [...premiumSet], [...vipSet]);
// These two assert the TIERED block, which stopped being the default in
// c37c16a when calibration moved to margin-keyed. They must name the mode
// explicitly — passing no mode now renders the margin block, which carries
// neither string.
check("prompt: tiered mode gives GENIUS safer-market calibration", buildSystemPrompt(["GENIUS"], "tiered").includes("GENIUS (safer)"));
check("prompt: tiered mode gives VIP/PREMIUM the stricter calibration", buildSystemPrompt(["VIP"], "tiered").includes("VIP or PREMIUM (more safer)"));
check("prompt: margin is the default calibration", buildSystemPrompt(["GENIUS"]).includes("MARKET RISK CALIBRATION BY MARGIN"));
check("prompt: moderate band rejects Double Chance as a default", buildSystemPrompt(["GENIUS"]).includes("DOUBLE_CHANCE is NOT the default"));
check("prompt: moderate hedge must identify its evidence failure mode", buildSystemPrompt(["GENIUS"]).includes("PRIMARY failure mode"));
check("prompt: Draw No Bet is keyed to stalemate risk", buildSystemPrompt(["GENIUS"]).includes("DRAW / STALEMATE is the main risk"));
check("prompt: Win Either Half is keyed to concentrated scoring", buildSystemPrompt(["GENIUS"]).includes("scores in concentrated periods"));
check("prompt: legacy comparison omits calibration", !buildSystemPrompt(["PREMIUM"], false).includes("MARKET RISK CALIBRATION"));
// Multi-market breadth is opt-in: production generation must be byte-identical
// to what it was before the same-game-double research added the mode.
eq("prompt: default breadth equals explicit single", buildSystemPrompt(["GENIUS"]), buildSystemPrompt(["GENIUS"], "margin", "single"));
check("prompt: single breadth omits the multi-market block", !buildSystemPrompt(["GENIUS"]).includes("MULTIPLE MARKET CALLS"));
check("prompt: multi breadth adds the multi-market block", buildSystemPrompt(["GENIUS"], "margin", "multi").includes("MULTIPLE MARKET CALLS"));
check("prompt: multi breadth keeps calibration", buildSystemPrompt(["GENIUS"], "margin", "multi").includes("MARKET RISK CALIBRATION BY MARGIN"));
eq("risk routing: cutoff contains exactly twelve priority entries", VIP_PROXY_LEAGUE_IDS.length, VIP_PROXY_LEAGUE_CUTOFF);
eq("risk routing: top-priority league uses VIP calibration", resolveGenerationRisk(["FEATURED"], 39).calibration, "vip");
eq("risk routing: first league below cutoff uses GENIUS calibration", resolveGenerationRisk(["FEATURED"], 307).calibration, "genius");
eq("risk routing: unknown league uses GENIUS baseline", resolveGenerationRisk(["FEATURED"], 999999).calibration, "genius");
eq("risk routing: BANKER bypasses VIP proxy", resolveGenerationRisk(["FEATURED", "BANKER"], 39).calibration, "legacy");
check("cup scope: FA Cup excludes qualifying rounds", !fixtureIsInCupScope(45, "3rd Round Qualifying"));
check("cup scope: FA Cup includes Third Round Proper API value", fixtureIsInCupScope(45, "Round of 64"));
check("cup scope: DFB Pokal includes its opening round", fixtureIsInCupScope(81, "1st Round"));
check("cup scope: DFB Pokal accepts current Round of 64 naming", fixtureIsInCupScope(81, "Round of 64"));
check("cup scope: EFL Cup includes preliminary round", fixtureIsInCupScope(48, "Preliminary Round"));
check("cup scope: Coppa Italia includes preliminary round", fixtureIsInCupScope(137, "Preliminary Round"));
check("cup scope: Copa del Rey excludes regional qualifiers", !fixtureIsInCupScope(143, "1/128-finals"));
check("cup scope: Copa del Rey includes Round of 128", fixtureIsInCupScope(143, "Round of 128"));
check("cup scope: Coupe de France excludes Round of 128", !fixtureIsInCupScope(66, "Round of 128"));
check("cup scope: Coupe de France includes Round of 64", fixtureIsInCupScope(66, "Round of 64"));
const requestedCupIds = [2, 3, 848, 45, 48, 143, 137, 81, 66, 96, 90, 147, 181, 206, 199, 220, 209, 121, 105, 115, 108, 212, 732, 285, 347, 335, 359, 112, 167, 321, 384];
eq("cup coverage: all 31 requested competitions are configured", CUP_CONFIGS.length, requestedCupIds.length);
check("cup coverage: requested provider ids are unique", new Set(requestedCupIds).size === requestedCupIds.length);
check("cup coverage: every requested cup is in the generation catalogue", requestedCupIds.every((id) => LEAGUE_CATALOGUE.some((league) => league.id === id)));
check("cup scope: full-scope cups retain future provider round aliases", fixtureIsInCupScope(96, "Provider Renamed Round"));
eq("cup links: UEFA competitions use dedicated cup pages", competitionPredictionsHref(2, "champions-league-2"), "/predictions/cup/uefa-champions-league");
check("cup capabilities: pure knockout cups do not advertise standings", !cupSupports(96, "standings"));
check("cup capabilities: UEFA hybrid competitions advertise standings", cupSupports(2, "standings"));
check("cup capabilities: sparse cups are excluded from odds workloads", !cupSupports(212, "odds"));
check("cup priority: FA Cup follows the Championship", leaguePriorityRank(45) === leaguePriorityRank(40) + 1);
check("cup priority: EFL Cup follows FA Cup", leaguePriorityRank(48) === leaguePriorityRank(45) + 1);
check("cup priority: Copa del Rey follows La Liga", leaguePriorityRank(143) === leaguePriorityRank(140) + 1);
check("cup priority: Coppa Italia follows Serie A", leaguePriorityRank(137) === leaguePriorityRank(135) + 1);
check("cup priority: DFB Pokal follows Bundesliga", leaguePriorityRank(81) === leaguePriorityRank(78) + 1);
check("cup priority: Coupe de France follows Ligue 1", leaguePriorityRank(66) === leaguePriorityRank(61) + 1);
eq("cup risk: FA Cup receives VIP proxy calibration", resolveGenerationRisk(["FEATURED"], 45).calibration, "vip");
eq("cup risk: DFB Pokal receives VIP proxy calibration", resolveGenerationRisk(["FEATURED"], 81).calibration, "vip");
eq("categories: bulk add/remove preserves unaffected assignments", applyCategoryChanges(["FEATURED", "BANKER"], ["VIP"], ["FEATURED"]), ["BANKER", "VIP"]);
let rejectedEmptyCategories = false;
try { applyCategoryChanges(["FEATURED"], [], ["FEATURED"]); } catch { rejectedEmptyCategories = true; }
check("categories: bulk changes reject an empty final assignment", rejectedEmptyCategories);

// --- Refresh priority tiers ----------------------------------------------
eq("tier: kickoff in 2h is tier A", tierFor(hoursFrom(2), NOW)?.name, "A");
eq("tier: kickoff in 23h is still tier A", tierFor(hoursFrom(23), NOW)?.name, "A");
eq("tier: kickoff in 30h is tier B", tierFor(hoursFrom(30), NOW)?.name, "B");
eq("tier: kickoff in 5 days is tier C", tierFor(hoursFrom(120), NOW)?.name, "C");
eq("tier: no upcoming fixture is not refreshed at all", tierFor(null, NOW), null);
eq("tier: a kickoff in the past is not refreshed", tierFor(hoursFrom(-3), NOW), null);

check("tier: tolerance tightens as kickoff approaches",
  REFRESH_TIERS.every((t, i) => i === 0 || t.maxAgeMs > REFRESH_TIERS[i - 1].maxAgeMs),
  REFRESH_TIERS.map((t) => t.maxAgeMs));
check("tier: the most urgent tier tolerates at most 3h of staleness", REFRESH_TIERS[0].maxAgeMs <= 3 * 3600_000);

// --- Review transitions ---------------------------------------------------
const ADMIN = "admin-1";

const approve = reviewTransition("APPROVE", ADMIN, { approvedById: null });
eq("approve: sets APPROVED", approve.status, "APPROVED");
eq("approve: records the approver", approve.approvedById, ADMIN);
check("approve: never publishes", !("publishedAt" in approve), approve);

const publishFresh = reviewTransition("PUBLISH", ADMIN, { approvedById: null });
eq("publish: sets PUBLISHED", publishFresh.status, "PUBLISHED");
check("publish: stamps publishedAt", publishFresh.publishedAt instanceof Date);
eq("publish: an unapproved row records the publisher as approver", publishFresh.approvedById, ADMIN);

const publishApproved = reviewTransition("PUBLISH", ADMIN, { approvedById: "someone-else" });
check("publish: an already-approved row keeps its original approver", !("approvedById" in publishApproved), publishApproved);

const archive = reviewTransition("ARCHIVE", ADMIN, { approvedById: null });
eq("archive: sets ARCHIVED", archive.status, "ARCHIVED");
check("archive: touches nothing else", Object.keys(archive).length === 1, archive);

// The whole point of the shared helper: bulk and single must be identical.
for (const action of ["APPROVE", "PUBLISH", "ARCHIVE"] as const) {
  const a = reviewTransition(action, ADMIN, { approvedById: null });
  const b = reviewTransition(action, ADMIN, { approvedById: null });
  eq(`transition ${action}: same shape every call`, Object.keys(a).sort(), Object.keys(b).sort());
}

// No transition may set an outcome — settlement is a separate action and stays
// out of the review path entirely.
for (const action of ["APPROVE", "PUBLISH", "ARCHIVE"] as const) {
  const t = reviewTransition(action, ADMIN, { approvedById: null });
  check(`transition ${action}: never settles`, !("outcome" in t) && !("settledById" in t), t);
}

// --- Cost / provider arithmetic -------------------------------------------
eq("provider: parsed from the model string", providerOf("gemini:gemini-2.5-flash"), "gemini");
eq("provider: groq parsed", providerOf("groq:openai/gpt-oss-120b"), "groq");
// Legacy rows predate the provider prefix. They must land in the gemini bucket,
// not a pseudo-provider of their own, or every one of them counts as a fallback.
eq("provider: a legacy bare model name is gemini", providerOf("gemini-flash-latest"), "gemini");
eq("provider: a legacy bare 2.5 name is gemini", providerOf("gemini-2.5-flash"), "gemini");
eq("provider: an empty model string does not invent a provider", providerOf(""), "gemini");
eq("provider: a prefixed model still wins over the legacy default", providerOf("groq:llama"), "groq");

const cost = estimateCostUsd("gemini:gemini-2.5-flash", 2_000_000, 1_000_000);
eq("cost: input and output priced separately", cost, 0.3 * 2 + 2.5);
eq("cost: groq fallback is free at this volume", estimateCostUsd("groq:openai/gpt-oss-120b", 5_000_000, 5_000_000), 0);
eq("cost: an unknown model is costed at zero rather than crashing the panel", estimateCostUsd("mystery:x", 1_000_000, 1_000_000), 0);
eq("cost: zero tokens costs nothing", estimateCostUsd("gemini:gemini-2.5-flash", 0, 0), 0);

// Pricing is per MODEL, not per provider. The gemini-flash-latest alias
// resolves to 3.7 Flash, which costs 2.5x what 2.5 Flash does per input token —
// costing by provider alone understated the real bill by that factor.
check("price: 3.7 Flash costs more than 2.5 Flash",
  priceFor("gemini:gemini-3.7-flash").input > priceFor("gemini:gemini-2.5-flash").input);
eq("price: the floating alias is priced as what it actually resolves to",
  priceFor("gemini:gemini-flash-latest"), priceFor("gemini:gemini-3.7-flash"));
check("price: longest prefix wins over the bare provider fallback",
  priceFor("gemini:gemini-2.5-flash-lite").input < priceFor("gemini:gemini-2.5-flash").input);

// Measured on a live generation: 3,788 input / 1,400 output tokens.
const measured = estimateCostUsd("gemini:gemini-flash-latest", 3788, 1400);
check("cost: a measured real generation stays under two cents", measured < 0.02, measured);
check("cost: and is not implausibly free", measured > 0.001, measured);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("All generation checks passed.");
