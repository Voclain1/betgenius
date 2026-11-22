/**
 * Early Engine remediation (22 Nov 2026) — deterministic regressions.
 * No API-Football, model, database or secrets. Run: npm run check:early-evidence-freshness
 *
 * Fixture identities in the "realistic cases" block are the production
 * fixture named in PR #226's incident (Oxford United v Tottenham Hotspur U21,
 * EFL Trophy, 24 Nov 2026) and other real competitions; their EVIDENCE is
 * synthetic — no production rows were read to build these tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MatchDigest, TeamDigest } from "../src/lib/ai/digest";
import {
  TEAM_TOLERANCE_BY_LEAD, teamToleranceMs, standingsToleranceMs, classifyPart, staleParts,
  supersedingKickoff, savedEvidenceSupersession, latestObservedMatch, parseEvidenceProvenance,
  PLAYED_AFTER_KICKOFF_MS, type EvidenceProvenance,
  assessSupersession, resolveKnownMatch, confirmFromTeamCaches, FINISHED_STATUSES, NOT_PLAYED_STATUSES,
} from "../src/lib/ai/evidenceFreshness";
import { REFRESH_TIERS } from "../src/lib/enrichment";
import { buildStoredContext, parseStoredContext, parseStoredProvenance } from "../src/lib/ai/context";
import { earlyPublicationBlock, EARLY_PUBLICATION_CONFIDENCE_FLOOR } from "../src/lib/generation/earlyPublication";
import { classifyEarlyDisposition } from "../src/lib/generation/earlyTriage";
import { orderEarlyQueue, earlyLeadBand } from "../src/lib/generation/earlyGeneration";
import { quoteYield } from "../src/lib/generation/earlyOdds";
import { formClaimIssues, evidenceClaimIssues, stripUnsupportedClaims } from "../src/lib/ai/evidenceClaims";
import {
  telemetryBucket, telemetryPath, parseTelemetryRow, classifyProviderPayload, noteDispatch,
  TELEMETRY_DAY_PREFIX, REPEAT_WINDOW_MS, attributeApiJob, currentApiJob, withApiJob, withPaidPriority,
} from "../src/lib/football/usage";
import { bandOf, attemptErrorClass } from "../src/lib/generation/earlyFunnel";
import { hasSubstantiveFootballEvidence } from "../src/lib/ai/evidenceReadiness";
import { EARLY_LANE_MIN_QUOTA_REMAINING, EARLY_FIXTURE_POLICY } from "../src/lib/generation/earlyFixturePolicy";
import { LIVE_POLICY } from "../src/lib/liveSnapshot";
import { DAILY_LIMIT, RESERVE, PAID_PRIORITY_RESERVE } from "../src/lib/football/usage";
import { seasonMetaTtlMs, SEASON_META_LONG_TTL_MS, type LeagueSeason } from "../src/lib/football/api-football";

const H = 3_600_000;
const now = new Date("2026-11-22T12:00:00.000Z");
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * H);
let passed = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); passed++; };
const eq = <T,>(a: T, b: T, msg: string) => { assert.deepEqual(a, b, msg); passed++; };

// ---------------------------------------------------------------- tolerances
eq(TEAM_TOLERANCE_BY_LEAD.map(t => [t.withinHours, t.maxAgeMs]), REFRESH_TIERS.map(t => [t.withinHours, t.maxAgeMs]),
  "early team tolerance mirrors the enrichment cron's own refresh tiers exactly");
eq(teamToleranceMs(5 * 24), 48 * H, "4–7 days out: a team cache up to 48h old is within the site's own refresh policy");
eq(teamToleranceMs(60), 12 * H, "inside 72h the 12h floor is unchanged");
eq(teamToleranceMs(10), 3 * H, "inside 24h a 3h floor applies");
eq(standingsToleranceMs(60), 24 * H, "standings floor inside 72h unchanged (24h)");
eq(standingsToleranceMs(120), 48 * H, "standings beyond 72h: 48h");
eq(EARLY_PUBLICATION_CONFIDENCE_FLOOR, 70, "FREE floor unchanged; odds-yield ordering assumes 70");
ok(readFileSync("src/lib/generation/earlyOdds.ts", "utf8").includes("EARLY_FREE_CONFIDENCE_FLOOR = 70"), "odds yield floor mirrors 70");

// ---------------------------------------------------------- part classification
const fresh30h = classifyPart({ present: true, fetchedAt: at(-30), toleranceMs: teamToleranceMs(120), now });
eq(fresh30h.status, "fresh", "BEFORE: 30h-old cache for a 5-day fixture was 'stale' (12h floor). AFTER: fresh");
eq(classifyPart({ present: true, fetchedAt: at(-50), toleranceMs: teamToleranceMs(120), now }).status, "aged", "50h > 48h tolerance: aged");
eq(classifyPart({ present: true, fetchedAt: at(-30), toleranceMs: teamToleranceMs(60), now }).status, "aged", "2.5 days out the 12h floor still binds");
eq(classifyPart({ present: false, fetchedAt: null, toleranceMs: teamToleranceMs(120), now }).status, "missing", "missing is never 'stale'");
eq(classifyPart({ present: true, fetchedAt: at(-2), toleranceMs: teamToleranceMs(120), now, supersededBy: at(-20) }).status, "superseded",
  "a 2h-old cache that misses a match played since is NOT current");
eq(classifyPart({ present: true, fetchedAt: at(-400), toleranceMs: null, now }).status, "fresh", "H2H has no age floor (event-refreshed)");
eq(classifyPart({ present: true, fetchedAt: at(-2), toleranceMs: teamToleranceMs(120), now, unverifiedMatch: at(-20) }).status, "unverified",
  "an unconfirmed later match is recorded as unverified");
eq(staleParts({ homeTeam: { status: "unverified" }, awayTeam: { status: "fresh" }, standings: { status: "missing" }, h2h: { status: "fresh" } } as never), [],
  "unverified does NOT freeze contextComplete at generation: publication re-checks it with current data");

// --------------------------------------------------------------- supersession
const last5 = (dates: string[]) => dates.map((date, i) => ({ date, opponent: "Opp " + i, venue: "home", result: "W", goalsFor: 2, goalsAgainst: 0 })) as unknown as TeamDigest["last5"];
const asOf = latestObservedMatch({ last5: last5(["2026-11-08T15:00:00Z", "2026-11-15T15:00:00Z"]) })!;
eq(asOf.toISOString(), "2026-11-15T15:00:00.000Z", "latest observed match is the max last5 date");
// Kickoff time alone NEVER proves a result: a captured past fixture usually
// still carries its pre-kickoff "NS" (discovery stores only future fixtures).
const midweekAt = new Date("2026-11-19T19:45:00Z");
const sup = (k: Partial<import("../src/lib/ai/evidenceFreshness").KnownKickoff>, extra: Partial<Parameters<typeof assessSupersession>[0]> = {}) =>
  assessSupersession({ teamApiId: 1, evidenceAsOf: asOf, now, known: [{ teamApiId: 1, kickoff: midweekAt, opponentApiId: 7, ...k }], ...extra });
eq(sup({ status: "FT" }).superseded?.toISOString(), midweekAt.toISOString(), "finished status (FT): confirmed played, evidence superseded");
for (const st of ["AET", "PEN"]) eq(sup({ status: st }).superseded?.toISOString(), midweekAt.toISOString(), `${st}: confirmed played`);
eq(sup({ status: "NS" }), { superseded: null, unverified: midweekAt }, "stale NS 2+ days after kickoff: UNVERIFIED, not assumed played");
eq(sup({ status: "NS", confirmedPlayed: true }).superseded?.toISOString(), midweekAt.toISOString(), "NS but a current team cache lists the result: played");
for (const st of ["PST", "CANC", "ABD", "AWD", "WO"]) eq(sup({ status: st }), { superseded: null, unverified: null }, `${st}: no football result, ignored`);
for (const st of ["SUSP", "INT", "1H", "HT", "2H", "ET", "BT", "P", "LIVE", "TBD", null, "SOMETHING_NEW"])
  eq(sup({ status: st as string | null }).unverified?.toISOString(), midweekAt.toISOString(), `${st}: unresolved, blocks automatic publication only`);
eq(sup({ status: "FT", kickoff: new Date(now.getTime() - PLAYED_AFTER_KICKOFF_MS + 60_000) }), { superseded: null, unverified: null },
  "a match still inside 150 minutes of kickoff is not considered yet");
eq(sup({ status: "FT", teamApiId: 2 }), { superseded: null, unverified: null }, "another team's match is irrelevant");
eq(sup({ status: "FT", kickoff: new Date("2026-11-15T15:00:00Z") }), { superseded: null, unverified: null }, "the match already in the evidence");
eq(sup({ status: "FT", kickoff: new Date("2026-11-19T19:45:00Z") }, { evidenceMatches: [{ date: "2026-11-19T15:00:00Z", opponentApiId: 7 }] }),
  { superseded: null, unverified: null }, "a delayed/re-timed match already in the evidence (same opponent, ±72h) is not a new match");
eq(sup({ status: "FT" }, { fixtureKickoff: midweekAt }), { superseded: null, unverified: null }, "the predicted fixture is never evidence about itself");
eq(supersedingKickoff({ teamApiId: 1, evidenceAsOf: asOf, now, known: [{ teamApiId: 1, kickoff: midweekAt, status: "NS" }] }), null,
  "back-compatible helper reports only CONFIRMED supersession");
eq([...FINISHED_STATUSES].sort(), ["AET", "FT", "PEN"], "finished set");
eq([...NOT_PLAYED_STATUSES].sort(), ["ABD", "AWD", "CANC", "PST", "WO"], "not-played set");
eq(resolveKnownMatch({ status: "pst" }), "not-played", "status matching is case-insensitive");
const confirmed = confirmFromTeamCaches(
  [{ teamApiId: 1, opponentApiId: 7, kickoff: midweekAt, status: "NS" }, { teamApiId: 1, opponentApiId: 8, kickoff: midweekAt, status: "NS" }],
  new Map([[7, [{ date: "2026-11-19T19:45:00Z", opponentApiId: 1 }]]]));
eq(confirmed.map(k => !!k.confirmedPlayed), [true, false], "the OPPONENT's current cache listing the result confirms it; a different opponent does not");

// ------------------------------------------------------ provenance round trip
const prov: EvidenceProvenance = {
  v: 1, assessedAt: now.toISOString(), leadHours: 120, cacheOnly: true,
  homeTeam: fresh30h, awayTeam: classifyPart({ present: true, fetchedAt: at(-60), toleranceMs: 48 * H, now }),
  standings: classifyPart({ present: false, fetchedAt: null, toleranceMs: 48 * H, now }),
  h2h: classifyPart({ present: true, fetchedAt: at(-400), toleranceMs: null, now }),
};
eq(staleParts(prov), ["awayTeam"], "only aged/superseded parts block early completeness; missing standings do not");
const team = (apiId: number, name: string, dates: string[], over: Partial<TeamDigest> = {}) => ({
  apiId, name, rank: null, points: null, overall: { played: 12, win: 7, draw: 3, loss: 2, goalsFor: 20, goalsAgainst: 10 },
  home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
  form: "WWDWL", streak: null, biggest: null, formations: [], cards: null, penalties: null,
  last5: last5(dates), availability: [], availabilityAsOf: null, keyPlayers: [], ...over,
}) as TeamDigest;
const digest = (home: TeamDigest, away: TeamDigest, kickoff: Date, names = ["Home FC", "Away FC"]): MatchDigest => ({
  fixture: { home: names[0], away: names[1], league: "League", kickoff: kickoff.toISOString(), competitionType: "LEAGUE", round: null },
  teams: { home, away }, h2h: null, standings: null,
  coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
} as unknown as MatchDigest);
const d5 = digest(team(10, "Home FC", ["2026-11-11T15:00:00Z", "2026-11-15T15:00:00Z", "2026-11-08T15:00:00Z"]),
  team(20, "Away FC", ["2026-11-12T15:00:00Z", "2026-11-16T15:00:00Z", "2026-11-09T15:00:00Z"]), at(120));
const stored = buildStoredContext(d5, prov);
ok(parseStoredContext(stored) !== null, "stored context with provenance still parses as a digest (rewrite/reassessment unaffected)");
eq(parseStoredProvenance(stored)?.awayTeam.status, "aged", "provenance survives the round trip");
eq(parseStoredProvenance(buildStoredContext(d5)), null, "rows without provenance read as 'not recorded', never as fresh");
eq(parseEvidenceProvenance({ v: 9 }), null, "unknown versions rejected");

// ----------------------------------------------- publication: supersession gate
const candidate = {
  id: "p1", status: "PENDING_REVIEW", provenance: "STANDARD_CURATED", fixtureApiId: 1, leagueApiId: 39,
  kickoff: at(120), contextComplete: true, confidence: 74, marketType: "BTTS", selection: { value: "YES" },
  manualSettlementOnly: false, categories: ["FEATURED"], earlyJobVerified: true,
};
eq(earlyPublicationBlock(candidate, d5, now), null, "unchanged behaviour when no kickoff list is supplied");
eq(earlyPublicationBlock(candidate, d5, now, []), null, "no known later matches: eligible exactly as before");
const midweek = [{ teamApiId: 20, opponentApiId: 30, kickoff: new Date("2026-11-19T19:45:00Z"), status: "FT" }];
eq(earlyPublicationBlock(candidate, d5, now, midweek), "evidence-superseded",
  "Away FC played (FT) on 19 Nov after the saved evidence (latest 16 Nov): no automatic publication");
eq(savedEvidenceSupersession(d5, midweek, now).home, { superseded: null, unverified: null }, "only the side that played is flagged");
eq(earlyPublicationBlock(candidate, d5, now, [{ ...midweek[0], status: "NS" }]), "evidence-currency-unverified",
  "outcome unknown (stale NS): not assumed played, but not auto-published either");
eq(earlyPublicationBlock(candidate, d5, now, [{ ...midweek[0], status: "NS", confirmedPlayed: true }]), "evidence-superseded", "confirmed by a team cache");
eq(earlyPublicationBlock(candidate, d5, now, [{ ...midweek[0], status: "PST" }]), null, "postponed: evidence still current, eligible");
eq(earlyPublicationBlock(candidate, d5, now, [{ ...midweek[0], status: "ABD" }]), null, "abandoned: no result to learn from, eligible");
eq(earlyPublicationBlock({ ...candidate, contextComplete: false }, d5, now, midweek), "no-reliable-evidence", "existing gates still evaluated first");
eq(earlyPublicationBlock({ ...candidate, confidence: 69 }, d5, now, []), "below-early-confidence-floor", "70 floor unchanged");
eq(classifyEarlyDisposition({ confidence: 74, leadHours: 120, evidenceCredible: false, autoEligible: false, pricedExactSelection: true }), "hold",
  "a superseded draft 5 days out is held (recoverable), not published and not deleted");
eq(classifyEarlyDisposition({ confidence: 74, leadHours: 60, evidenceCredible: false, autoEligible: false, pricedExactSelection: true }), "review",
  "inside 72h a superseded draft goes to admin review");
ok(readFileSync("src/lib/generation/earlyPublication.ts", "utf8").includes("autoEligible: reason === null && !supersessionUnchecked"),
  "a failed supersession lookup fails CLOSED for automatic publication");

// ------------------------------------------------------- early queue ordering
const q = (key: string, h: number) => ({ matchKey: key, kickoff: at(h) });
const queue = [q("near", 50), q("target", 120), q("far", 250), q("target2", 100), q("pricedNear", 55)];
eq(orderEarlyQueue(queue, new Set(["pricedNear"]), now).map(x => x.matchKey), ["pricedNear", "target2", "target", "near", "far"],
  "priced first, then the 3–7 day target band, then 48–72h, then 7–14 days; nothing dropped");
eq([earlyLeadBand(at(60), now), earlyLeadBand(at(100), now), earlyLeadBand(at(200), now)], ["48-72h", "3-7d", "7-14d"], "lead bands");
const gen = readFileSync("src/lib/generation/earlyGeneration.ts", "utf8");
ok(gen.includes("filterSelectiveQueuedCandidates(asCandidates, now, true)") && gen.indexOf("filterSelectiveQueuedCandidates(asCandidates") < gen.indexOf(".slice(0, limit)"),
  "selective gate applied BEFORE choosing the run's fixtures (head-of-line fix)");
ok(gen.includes("retry not counted") && gen.includes("EARLY_SELECTIVE_DEFER_MS"), "gated fixtures get a visible, uncounted deferral");
ok(gen.includes("withNoFootballApiCalls(() => runGeneration("), "early generation remains provider-call free");

// --------------------------------------------------------- odds fetch yield
eq(quoteYield([], 70), "not-generated", "no draft yet");
eq(quoteYield([{ confidence: 72, contextComplete: true }], 70), "publishable-if-priced", "ready draft awaiting a quote first");
eq(quoteYield([{ confidence: 66, contextComplete: true }, { confidence: 80, contextComplete: false }], 70), "review-only", "cannot auto-publish: last");
const odds = readFileSync("src/lib/generation/earlyOdds.ts", "utf8");
ok(odds.includes("EARLY_ODDS_MAX_PER_RUN = 6") && odds.includes("due.slice(0, limit)"), "odds fetch budget per run unchanged");

// ------------------------------------------------------------ form claims
const oxford = team(1, "Oxford United", ["2026-11-01T15:00:00Z", "2026-11-05T19:45:00Z", "2026-11-08T15:00:00Z", "2026-11-15T15:00:00Z", "2026-11-18T19:45:00Z"],
  { form: "LWDWW" });
oxford.last5 = oxford.last5.map((m, i) => ({ ...m, result: ["L", "W", "D", "W", "W"][i] }));
const spursU21 = team(2, "Tottenham Hotspur U21", ["2026-11-14T13:00:00Z", "2026-11-17T19:00:00Z"], { form: null });
const efl = digest(oxford, spursU21, at(56), ["Oxford United", "Tottenham Hotspur U21"]);
eq(formClaimIssues(efl, "Oxford United have won three of their last five matches."), [], "supported by last5 (L W D W W = 3 wins)");
eq(formClaimIssues(efl, "Oxford United have won four of their last five matches.").map(i => i.code), ["form-record"], "contradicted claim flagged");
eq(formClaimIssues(efl, "Tottenham Hotspur U21 are unbeaten in their last six.").map(i => i.code), ["form-unsupported-sample"],
  "a sample larger than the saved evidence is unsupported (the 22 Nov incident pattern)");
eq(formClaimIssues(efl, "Oxford United have won four of their last five home games."), [], "venue-scoped claims are skipped, never falsely stripped");
eq(formClaimIssues(efl, "Oxford United are unbeaten in their last four."), [], "W D W W: unbeaten in four is supported");
const cleaned = stripUnsupportedClaims(efl, { matchPreview: "Oxford United have won four of their last five matches. The hosts press high.", predictions: [{ reasoning: "Goals expected." }] });
eq(cleaned.output.matchPreview, "The hosts press high.", "generation strips only the unsupported sentence");
eq(evidenceClaimIssues(efl, "Oxford United have won four of their last five matches."), [],
  "the public page's check (evidenceClaimIssues) is unchanged, so published rows render exactly as before");
ok(hasSubstantiveFootballEvidence(efl), "two-sided recent results count as usable evidence (PR #226 gate)");

// ------------------------------------------------------------ telemetry
const bucket = telemetryBucket(new Date("2026-11-22T13:20:00Z"));
eq(bucket, "#h2026-11-22T13", "UTC hour bucket");
ok(TELEMETRY_DAY_PREFIX < "0" && bucket < "2026-11-15", "telemetry rows sort below every YYYY-MM-DD key: never in budget sums or day-range audits");
eq(parseTelemetryRow({ day: bucket, path: telemetryPath("/odds", "early-free-odds", "empty"), count: 3 }),
  { hourUtc: "2026-11-22T13", path: "/odds", job: "early-free-odds", outcome: "empty", count: 3 }, "telemetry key round trip");
eq(parseTelemetryRow({ day: "2026-11-22", path: "/odds", count: 3 }), null, "budget rows are not telemetry");
eq(classifyProviderPayload({ errors: { requests: "You have reached the request limit for the day" }, response: [] }), "rate_limited", "daily limit payload");
eq(classifyProviderPayload({ errors: { rateLimit: "Too many requests" } }), "rate_limited", "per-minute limit payload");
eq(classifyProviderPayload({ errors: { token: "invalid" } }), "api_error", "other provider errors");
eq(classifyProviderPayload({ errors: [], response: [] }), "empty", "200 with no rows is a real, empty answer");
eq(classifyProviderPayload({ errors: [], response: [{ id: 1 }] }), "ok", "success");
ok(!noteDispatch("https://x/fixtures?id=1", 0) && noteDispatch("https://x/fixtures?id=1", REPEAT_WINDOW_MS - 1) && !noteDispatch("https://x/fixtures?id=1", 3 * REPEAT_WINDOW_MS),
  "repeat detection inside 10 minutes only");
const af = readFileSync("src/lib/football/api-football.ts", "utf8");
ok(af.indexOf("await recordCall(path)") < af.indexOf("res = await fetch(") && af.includes('recordApiOutcome(path, "quota_refused")'),
  "budget counting still happens before dispatch; refusals are recorded separately");

// ------------------------------------------------------------ funnel helpers
eq([bandOf(5), bandOf(30), bandOf(100), bandOf(200), bandOf(400)], ["A", "B", "C", "D", "E"], "audit kickoff groups");
eq(attemptErrorClass("Evidence pending, retry not counted: No usable results ..."), "no-usable-evidence", "PR #226 deferral classified");
eq(attemptErrorClass("Early deferred, retry not counted: selective-league ..."), "early-deferred-selective", "selective deferral classified");


// ------------------------------------------------------ quota allocation order
// Verified production ApiUsage totals per UTC day, 15–21 Nov 2026 (owner export).
const VERIFIED_DAILY_USED = { "2026-11-15": 6908, "2026-11-16": 6544, "2026-11-17": 6501, "2026-11-18": 6421, "2026-11-19": 6639, "2026-11-20": 7124, "2026-11-21": 7125 };
const workerSrc = readFileSync("src/lib/generation/worker.ts", "utf8");
const ordinaryHeadroom = Number(/const BASE_QUOTA_HEADROOM = (\d+);/.exec(workerSrc)?.[1]) + PAID_PRIORITY_RESERVE;
const paidPassHeadroom = Number(/export const PAID_PASS_MIN_QUOTA_HEADROOM = (\d+);/.exec(workerSrc)?.[1]);
eq(EARLY_FIXTURE_POLICY.MIN_API_QUOTA_REMAINING, EARLY_LANE_MIN_QUOTA_REMAINING, "discovery uses the shared early-lane threshold");
ok(readFileSync("src/lib/generation/earlyOdds.ts", "utf8").includes("const MIN_QUOTA_REMAINING = EARLY_LANE_MIN_QUOTA_REMAINING;"), "odds warming uses the shared early-lane threshold");
ok(LIVE_POLICY.GENERATION_RESERVE > EARLY_LANE_MIN_QUOTA_REMAINING && EARLY_LANE_MIN_QUOTA_REMAINING > ordinaryHeadroom && ordinaryHeadroom > paidPassHeadroom,
  `stop order as quota falls: live scores (${LIVE_POLICY.GENERATION_RESERVE}) → early lane (${EARLY_LANE_MIN_QUOTA_REMAINING}) → ordinary (${ordinaryHeadroom}) → paid (${paidPassHeadroom})`);
const usedAtStandDown = (threshold: number) => DAILY_LIMIT - RESERVE - threshold;
const crossedOld = Object.values(VERIFIED_DAILY_USED).filter(u => u > usedAtStandDown(2_200)).length;
const crossedNew = Object.entries(VERIFIED_DAILY_USED).filter(([, u]) => u > usedAtStandDown(EARLY_LANE_MIN_QUOTA_REMAINING)).map(([d]) => d);
eq(crossedOld, 7, "REPLAY (verified totals): the old 2,200 threshold was crossed on all 7 days (stand-down after 5,200 used)");
eq(crossedNew, ["2026-11-15", "2026-11-20", "2026-11-21"], "REPLAY: at 750 the early lane is shut out only on the 3 days above 6,650 used, late in the day");
ok(Object.values(VERIFIED_DAILY_USED).every(u => u <= DAILY_LIMIT - RESERVE), "no verified day reached the hard ceiling: VIP/Premium budget never short");
ok(readFileSync("src/lib/generation/earlyOdds.ts", "utf8").includes('report.stoodDown = "api-football quota headroom too low'), "odds stand-downs are named in the run summary, no longer silent");

// ---------------------------------------------------------- season list TTL
const seasonsEPL: LeagueSeason[] = [
  { year: 2025, start: "2025-08-15", end: "2026-05-24", current: false },
  { year: 2026, start: "2026-08-14", end: "2027-05-23", current: true },
];
eq(seasonMetaTtlMs(seasonsEPL, new Date("2026-11-22T12:00:00Z")), SEASON_META_LONG_TTL_MS, "mid-season: 48h (was re-read every 6h: 355 /leagues calls/day)");
eq(seasonMetaTtlMs(seasonsEPL, new Date("2026-08-01T12:00:00Z")), 6 * H, "within 21 days of a season start: 6h kept");
eq(seasonMetaTtlMs(seasonsEPL, new Date("2026-05-10T12:00:00Z")), 6 * H, "within 21 days of a season end: 6h kept");
eq(seasonMetaTtlMs([{ year: 2025, start: "2025-02-01", end: "2025-11-30", current: true }], new Date("2026-03-01T00:00:00Z")), 6 * H,
  "past every listed season (a new one may be missing): 6h kept");
eq(seasonMetaTtlMs([], now), 6 * H, "empty list: 6h");
eq(seasonMetaTtlMs([{ year: 2026, start: "2026-01-20", end: "2026-12-06", current: true }], now), 6 * H, "calendar-year league ending in 14 days: 6h");

// ------------------------------------------------------------ scheduling
const cron = readFileSync("deploy/ops/crontab", "utf8");
const earlyRun = cron.split("\n").find(l => l.includes("/api/admin/generate/early-run"))!;
const earlyMinutes = earlyRun.split(" ")[0].split(",").map(Number);
eq(earlyMinutes, [27, 57], "early-run moved off :09/:39 (one minute before ordinary generation's :10/:40)");
const leaseTtlMin = Number(/const LEASE_TTL_MS = (\d+) \* 60_000;/.exec(readFileSync("src/lib/generation/worker.ts", "utf8"))?.[1]);
eq(leaseTtlMin, 6, "generation lease TTL");
const leaseUsers = { vipPremium: [5, 20, 35, 50], ordinary: [10, 25, 40, 55], european: [15, 45] };
const minutesUntilNext = (m: number, xs: number[]) => Math.min(...xs.map(x => (x - m + 60) % 60 || 60));
for (const [lane, mins] of Object.entries(leaseUsers))
  ok(earlyMinutes.every(m => minutesUntilNext(m, mins) > leaseTtlMin),
    `GUARANTEE: an early run's lease expires before the next ${lane} slot, even if its model call hangs`);
ok(cron.includes("3,33 * * * * /ops/cron-call.sh /api/admin/generate/early-discover?batch=4") && cron.includes("6,36 * * * * /ops/cron-call.sh /api/admin/generate/early-odds?limit=4"),
  "provider-facing early schedules unchanged (no extra API-Football calls)");

// ------------------------------------------------------------ scope safety
const enr = readFileSync("src/lib/enrichment.ts", "utf8");
ok(enr.includes("if (!opts.includeQueuedEarly) return [...byId.values()];"), "player-stats scope unchanged (it has a TTL skip; widening would add calls)");
ok(readFileSync("src/lib/enrichmentWorkloads.ts", "utf8").includes("getScopedLeagueTargets({ includeQueuedEarly: true })"), "standings workload only");

(async () => {
const jobOf = await attributeApiJob("early-free-odds", async () => currentApiJob())();
eq(jobOf, "early-free-odds", "route attribution propagates through async work");
eq(await withPaidPriority(async () => currentApiJob()), "paid-priority", "unlabelled paid-reserve calls are still distinguishable");
eq(await withApiJob("settle", async () => withPaidPriority(async () => currentApiJob())), "settle", "explicit job label wins");
eq(currentApiJob(), "unattributed", "outside any scope: explicitly unattributed");
  console.log(`check-early-evidence-freshness: ${passed} assertions passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
