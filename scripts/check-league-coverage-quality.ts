/**
 * Sprint 05 regression suite: league coverage, fair discovery, the shadow
 * candidate-quality layer, policy validation and the coverage diagnostics.
 * Synthetic fixtures only: no database, no network, no quota.
 *
 * Run: npx tsx scripts/check-league-coverage-quality.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureRow } from "../src/lib/football/api-football";
import { COMPETITION_REGISTRY, CURRENT_RULES, PROPOSED_RULES, coverageRollout, fairOrder, liveRules, registryEntry, FAIR_PER_COMPETITION_CAP } from "../src/lib/generation/competitionEligibility";
import { compareFallbackPlans, excludedLeagueIds, fallbackQualityGate, planFallback, simulateFill, type CoverageDecision } from "../src/lib/generation/coverage";
import { auditCoverageFunnel } from "../src/lib/generation/coverageFunnel";
import { assessCandidateQuality, evaluateCandidateSet, proposedTier, shadowQualityRecord, tallyDecisions, QUALITY_POLICY, type QualityCandidate } from "../src/lib/paidCandidateQuality";
import { chronologicalSplit, comparePolicies, judgedAt, missingOddsSensitivity, selectByPolicy, type ValidationRow } from "../src/lib/paidPolicyValidation";
import { explainCompetition, tallyDiscovery, WELSH_COMPETITION_IDS } from "../src/lib/coverageDiagnostics";
import { PAID_ANY_LEAGUE_IDS } from "../src/lib/vipPremiumOverlay";
import { generationTierOf, LEAGUE_CATALOGUE } from "../src/lib/leagues";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : ` — got ${JSON.stringify(got)?.slice(0, 300)}`}`);
};

const NOW = new Date("2026-11-13T12:00:00Z");
const H = 3_600_000;
let fid = 1000;
const fx = (league: number, hoursAhead: number, opts: Partial<{ status: string; home: string; away: string; round: string }> = {}): FixtureRow => {
  const id = ++fid;
  return {
    fixture: { id, date: new Date(NOW.getTime() + hoursAhead * H).toISOString(), status: { short: opts.status ?? "NS" } },
    league: { id: league, name: `L${league}`, country: "X", season: 2026, round: opts.round ?? "Regular Season - 1" },
    teams: { home: { id: id * 10 + 1, name: opts.home ?? `Home ${id}` }, away: { id: id * 10 + 2, name: opts.away ?? `Away ${id}` } },
  } as unknown as FixtureRow;
};
const deep: Pick<CoverageDecision, "allowedTiers" | "widened" | "need"> = { allowedTiers: ["CORE", "SECONDARY", "FALLBACK", "DEEP_FALLBACK"], widened: true, need: 10 };

// ── 1-3. Welsh discovery, season mapping, supported vs unsupported ──────────
check("1 Cymru North/South (111) is unrecognised under the current rules", CURRENT_RULES.tierOf(111) === null);
check("1 ... and DEEP_FALLBACK under the proposed rules", PROPOSED_RULES.tierOf(111) === "DEEP_FALLBACK");
check("1 current gate refuses a 111 fixture as unrecognised", (fallbackQualityGate(fx(111, 20), { now: NOW }) as any).reason === "unrecognised_competition");
check("1 proposed gate accepts it", fallbackQualityGate(fx(111, 20), { now: NOW, rules: PROPOSED_RULES }).ok);
check("1 Welsh Cup refused as unpriced_cup today", (fallbackQualityGate(fx(112, 20, { round: "Round of 32" }), { now: NOW }) as any).reason === "unpriced_cup");
check("1 ... and accepted under the proposed rules (provider odds coverage)", fallbackQualityGate(fx(112, 20, { round: "Round of 32" }), { now: NOW, rules: PROPOSED_RULES }).ok);
check("1 Cymru Premier (110) keeps its catalogue tier", PROPOSED_RULES.tierOf(110) === "DEEP_FALLBACK" && CURRENT_RULES.tierOf(110) === "DEEP_FALLBACK");
for (const e of COMPETITION_REGISTRY) {
  check(`2 registry ${e.id}: evidence carries a provider source and season`, !!e.evidence.source && e.evidence.season > 2000 && /^\d{4}-\d{2}-\d{2}$/.test(e.evidence.checkedAt));
  if (e.proposal.action !== "EXCLUDED") check(`2 registry ${e.id}: active proposal's season had not ended when checked`, e.evidence.seasonEnd >= e.evidence.checkedAt);
  if (e.proposal.action === "ADD") check(`2 registry ${e.id}: an ADD is not already catalogued`, !LEAGUE_CATALOGUE.some((l) => l.id === e.id));
}
check("3 stale/unsupported Welsh League Cup (738) stays out under both rules", CURRENT_RULES.tierOf(738) === null && PROPOSED_RULES.tierOf(738) === null && registryEntry(738)?.proposal.action === "EXCLUDED");
check("3 no registry entry widens the VIP/Premium scope", !COMPETITION_REGISTRY.some((e) => PAID_ANY_LEAGUE_IDS.includes(e.id)) && !PAID_ANY_LEAGUE_IDS.includes(110));

// ── 4-7. Missing standings, partial stats, incomplete books, freshness ─────
const cand = (o: Partial<QualityCandidate> = {}): QualityCandidate => ({
  id: "c1", fixtureKey: "1-2-2026-11-14", leagueApiId: 39, marketType: "MATCH_WINNER", selection: "HOME",
  kickoff: new Date(NOW.getTime() + 20 * H), confidence: 82, odds: 1.22, marketProbability: 81, bookmakers: 9, derivedPrice: false,
  quoteFetchedAt: new Date(NOW.getTime() - 30 * 60_000), calibratedLower: 0.79, expectedValueLower: 0.01, ...o,
});
const d = (c: QualityCandidate, tier: "VIP" | "PREMIUM" = "VIP") => assessCandidateQuality(c, tier, NOW).decision;
check("4 missing standings refuses a match-winner pick", d(cand({ evidence: { standingsKnown: false } })) === "REJECTED_INSUFFICIENT_DATA");
check("4 ... but not a goals pick", d(cand({ marketType: "OVER_UNDER", evidence: { standingsKnown: false } })) === "QUALIFIED");
check("5 partial stats (2 form matches) is insufficient data", d(cand({ evidence: { formMatches: 2 } })) === "REJECTED_INSUFFICIENT_DATA");
check("5 unknown evidence is not held against the pick", d(cand({ evidence: undefined })) === "QUALIFIED");
check("6 three books: invalid price for VIP", d(cand({ bookmakers: 3 })) === "REJECTED_INVALID_PRICE");
check("6 six books: VIP qualifies, PREMIUM needs eight", d(cand({ bookmakers: 6 })) === "QUALIFIED" && d(cand({ bookmakers: 6 }), "PREMIUM") === "REJECTED_INVALID_PRICE");
check("7 a quote older than 2h is stale", d(cand({ quoteFetchedAt: new Date(NOW.getTime() - 200 * 60_000) })) === "REJECTED_STALE_DATA");
check("7 a quote from the future is stale", d(cand({ quoteFetchedAt: new Date(NOW.getTime() + 60_000) })) === "REJECTED_STALE_DATA");

// ── 8-9. Fair batching, competition-aware scheduling ────────────────────────
const rowsA = [fx(10, 20), fx(10, 21), fx(10, 22), fx(10, 23), fx(10, 24), fx(10, 25), fx(329, 30), fx(110, 31)];
const fair = fairOrder(rowsA, (r) => r.league.id, (r) => new Date(r.fixture.date).getTime(), (r) => r.fixture.id);
check("8 fair order puts each competition's first fixture in round one", new Set(fair.slice(0, 3).map((r) => r.league.id)).size === 3, fair.map((r) => r.league.id));
const curPlan = planFallback(rowsA, deep, new Map(), () => null, NOW, CURRENT_RULES);
const propPlan = planFallback(rowsA, deep, new Map(), () => null, NOW, PROPOSED_RULES);
check("8 current plan is unchanged: priority order, no cap", curPlan.capped === 0 && curPlan.eligible.FALLBACK.length === 6 && curPlan.rules === "current");
check(`8 proposed plan caps one competition at ${FAIR_PER_COMPETITION_CAP} per sweep`, propPlan.eligible.FALLBACK.length === FAIR_PER_COMPETITION_CAP && propPlan.capped === 2);
const tight = { ...deep, need: 5 };
const qc = simulateFill(curPlan, tight), qp = simulateFill(propPlan, tight);
check("9 tier order kept: FALLBACK fills before DEEP_FALLBACK under both rules", (qc[10] ?? 0) === 5 && !qc[110] && (qp[10] ?? 0) === 4 && (qp[329] ?? 0) + (qp[110] ?? 0) === 1, { qc, qp });
const shadow = compareFallbackPlans(curPlan, propPlan, tight, "current");
check("9 shadow comparison names the competitions the proposal adds", shadow.addedCompetitions.length === 1 && shadow.rules.live === "current", shadow);
const wPlanC = planFallback([fx(112, 20, { round: "Round of 32" })], deep, new Map(), () => null, NOW, CURRENT_RULES);
const wPlanP = planFallback([fx(112, 20, { round: "Round of 32" })], deep, new Map(), () => null, NOW, PROPOSED_RULES);
const wShadow = compareFallbackPlans(wPlanC, wPlanP, deep, "current");
check("9 Welsh Cup: rejections recorded per competition and lifted in shadow", wPlanC.rejectedByLeague[112]?.unpriced_cup === 1 && wShadow.liftedRejections[112]?.unpriced_cup === 1);
check("9 healthy decision plans nothing under either rules", planFallback(rowsA, { allowedTiers: ["CORE", "SECONDARY"], widened: false }, new Map(), () => null, NOW, PROPOSED_RULES).considered === 0);
check("9 registry addition 111 is excluded from generation with its tier", excludedLeagueIds({ allowedTiers: ["CORE", "SECONDARY", "FALLBACK"] }).includes(111) && !excludedLeagueIds({ allowedTiers: ["CORE", "SECONDARY", "FALLBACK", "DEEP_FALLBACK"] }).includes(111));

// ── 10-13. Duplicates, postponed/finished, near kickoff, odds ──────────────
const dup = evaluateCandidateSet([cand({ id: "a" }), cand({ id: "a" })], "VIP", NOW);
check("10 the same id twice: one stands, one is a duplicate", dup.map((v) => v.decision).sort().join() === "QUALIFIED,REJECTED_DUPLICATE", dup.map((v) => v.decision));
const sameSel = evaluateCandidateSet([cand({ id: "a" }), cand({ id: "b", confidence: 80 })], "VIP", NOW);
check("10 same fixture, market and selection: the weaker is a duplicate", sameSel[0].decision === "QUALIFIED" && sameSel[1].decision === "REJECTED_DUPLICATE");
for (const st of ["PST", "FT", "CANC", "1H"]) check(`11 ${st} fixture refused (not_scheduled) under both rules`, (fallbackQualityGate(fx(110, 20, { status: st }), { now: NOW, rules: PROPOSED_RULES }) as any).reason === "not_scheduled" && (fallbackQualityGate(fx(110, 20, { status: st }), { now: NOW }) as any).reason === "not_scheduled");
check("12 30 minutes before kickoff is too close", d(cand({ kickoff: new Date(NOW.getTime() + 30 * 60_000), quoteFetchedAt: new Date(NOW.getTime() - 5 * 60_000) })) === "REJECTED_TOO_CLOSE_TO_KICKOFF");
check("12 the sweep gate still refuses fixtures inside the 12h lead time", (fallbackQualityGate(fx(111, 6), { now: NOW, rules: PROPOSED_RULES }) as any).reason === "inside_lead_time");
check("13 no price: missing price", d(cand({ odds: null, marketProbability: null })) === "REJECTED_MISSING_PRICE");
check("13 a derived price is not a price", d(cand({ derivedPrice: true })) === "REJECTED_MISSING_PRICE");
check("13 odds of 1.01 are invalid", d(cand({ odds: 1.01 })) === "REJECTED_INVALID_PRICE");
check("13 a market probability out of range is invalid", d(cand({ marketProbability: 140 })) === "REJECTED_INVALID_PRICE");

// ── 14-16. Uncalibrated confidence, contradictions, correlation, tiers ─────
check("14 uncalibrated: VIP can qualify on market agreement", d(cand({ calibratedLower: null, expectedValueLower: null })) === "QUALIFIED");
check("14 uncalibrated: PREMIUM is shadow only, never qualified", d(cand({ calibratedLower: null, expectedValueLower: null }), "PREMIUM") === "SHADOW_ONLY");
check("14 calibrated with negative EV lower bound: PREMIUM refused on value", d(cand({ expectedValueLower: -0.03 }), "PREMIUM") === "REJECTED_LOW_VALUE_EVIDENCE");
check("14 model/market gap over 10pp is low value evidence", d(cand({ confidence: 92, marketProbability: 78 })) === "REJECTED_LOW_VALUE_EVIDENCE");
check("14 confidence 72 is low confidence", d(cand({ confidence: 72, marketProbability: 76 })) === "REJECTED_LOW_CONFIDENCE");
const contra = evaluateCandidateSet([cand({ id: "h" }), cand({ id: "aw", selection: "AWAY" })], "VIP", NOW);
check("15 contradictory selections on one fixture/market: both refused", contra.every((v) => v.decision === "REJECTED_CORRELATED_SELECTION"));
const twoMarkets = evaluateCandidateSet([cand({ id: "m1" }), cand({ id: "m2", marketType: "DOUBLE_CHANCE", selection: "HOME_DRAW", marketProbability: 80 })], "VIP", NOW);
check("15 a second market on the same fixture is correlated", twoMarkets.filter((v) => v.decision === "REJECTED_CORRELATED_SELECTION").length === 1);
const slot = evaluateCandidateSet([1, 2, 3].map((i) => cand({ id: `s${i}`, fixtureKey: `f${i}`, marketType: ["MATCH_WINNER", "OVER_UNDER", "BTTS"][i - 1] })), "VIP", NOW);
check("15 a third pick from one league in one kickoff slot is correlated", slot.filter((v) => v.decision === "QUALIFIED").length === QUALITY_POLICY.MAX_PER_LEAGUE_SLOT);
check("16 proposed tier PREMIUM for a calibrated, deep, tight pick", proposedTier(cand(), NOW).tier === "PREMIUM");
check("16 proposed tier VIP when the book is too thin for PREMIUM", proposedTier(cand({ bookmakers: 6 }), NOW).tier === "VIP");
check("16 proposed tier none when VIP fails", proposedTier(cand({ confidence: 70 }), NOW).tier === null);
check("16 decisions tally", JSON.stringify(tallyDecisions(contra)) === JSON.stringify({ REJECTED_CORRELATED_SELECTION: 2 }));

// ── 17-18. Holdout leakage, missing historical prices ───────────────────────
const vrow = (i: number, o: Partial<ValidationRow> = {}): ValidationRow => ({
  ...cand({ id: `v${i}`, fixtureKey: `vf${i}`, leagueApiId: 39 + (i % 5), kickoff: new Date(NOW.getTime() - (200 - Math.floor(i / 2)) * H), quoteFetchedAt: new Date(NOW.getTime() - (203 - Math.floor(i / 2)) * H), calibratedLower: null, expectedValueLower: null }),
  outcome: i % 4 === 0 ? "LOST" : "WON", categories: i % 3 === 0 ? ["VIP"] : [], inPaidScope: true, day: `d${Math.floor(i / 6)}`, priceSource: "closing", ...o,
});
const hist = Array.from({ length: 80 }, (_, i) => vrow(i));
const split = chronologicalSplit(hist);
check("17 split: training ends strictly before holdout", split.training.length > 0 && split.holdout.length > 0 && split.training.at(-1)!.kickoff < split.holdout[0].kickoff);
check("17 split: a shared kickoff never straddles the boundary", !split.training.some((t) => split.holdout.some((h) => h.kickoff.getTime() === t.kickoff.getTime())));
check("17 every judgement happens before kickoff", hist.every((r) => judgedAt(r) < r.kickoff) && judgedAt(vrow(1, { quoteFetchedAt: new Date(NOW.getTime() - 200 * H + 30 * 60_000) })) < vrow(1).kickoff);
const cmp = comparePolicies(hist, "VIP");
check("17 all five policies reported with both windows", cmp.results.length === 5 && cmp.results.every((r) => r.training.n + r.holdout.n === r.all.n));
check("17 EXISTING is exactly the tagged picks", cmp.results[0].all.n === hist.filter((r) => r.categories.includes("VIP")).length);
const sens = missingOddsSensitivity([vrow(1), vrow(2, { odds: null }), vrow(4, { odds: null, outcome: "LOST" })]);
check("18 missing-odds sensitivity counts unpriced and shows the worst case", sens.unpriced === 2 && sens.roiUnpricedAsLossPct! < sens.roiExcludedPct!);
check("18 unpriced history never qualifies under quality-first", selectByPolicy([vrow(1, { odds: null, marketProbability: null })], "QUALITY_FIRST", "VIP").length === 0);
check("18 EXPANDED_COVERAGE includes out-of-scope competitions; QUALITY_FIRST does not", selectByPolicy([vrow(1, { inPaidScope: false })], "EXPANDED_COVERAGE", "VIP").length === 1 && selectByPolicy([vrow(1, { inPaidScope: false })], "QUALITY_FIRST", "VIP").length === 0);

// ── 19, 25. Shadow isolation, no unintended activation ──────────────────────
check("19/25 rollout defaults to shadow", coverageRollout({}) === "shadow" && coverageRollout({ COVERAGE_ROLLOUT: "yes" }) === "shadow");
check("19/25 only an explicit on activates the proposed rules", coverageRollout({ COVERAGE_ROLLOUT: " ON " }) === "on" && liveRules("on") === PROPOSED_RULES && liveRules("shadow") === CURRENT_RULES && liveRules("off") === CURRENT_RULES);
const rec = shadowQualityRecord(
  [{ id: "x", fixtureKey: "k", leagueApiId: 39, marketType: "MATCH_WINNER", rawConfidence: 82, quoteAgeMinutes: 20, value: { odds: 1.22, marketProbability: 81, bookmakers: 9, estimatedProbabilityLower: null, expectedValueLower: null, reasons: ["NO_CALIBRATION"] } }],
  new Map([["x", { kickoff: new Date(NOW.getTime() + 20 * H), selection: { value: "Home" } }]]), "PREMIUM", NOW, ["x"],
);
check("19 shadow record is labelled shadow only and versioned", rec.activation === "SHADOW_ONLY" && rec.policyVersion === "quality-s05-v1" && rec.decisions.SHADOW_ONLY === 1);
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
check("19 curation never reads quality decisions back (only the shadow writer uses them)", !/paidCandidateQuality/.test(src("src/lib/geniusCuration.ts")) && !/quality\.(verdicts|decisions)/.test(src("src/lib/vipPremiumPipeline.ts")));
check("19 the quality record is written inside the best-effort shadow log only", /quality = shadowQualityRecord\(/.test(src("src/lib/vipPremiumPipeline.ts")) && /QUALITY_RECORD_FAILED/.test(src("src/lib/vipPremiumPipeline.ts")));
check("25 the sweep acts on liveRules(rollout), never PROPOSED_RULES directly", /const rules = liveRules\(rollout\)/.test(src("src/lib/generation/queue.ts")) && /planFallback\(rows, decision, odds, keyOf, now, rules\)/.test(src("src/lib/generation/queue.ts")));
check("25 no workflow or env file sets COVERAGE_ROLLOUT=on", !/COVERAGE_ROLLOUT\s*[:=]\s*"?on/i.test(src(".env.example") + src(".github/workflows/deploy-vps.yml")));

// ── Funnel and diagnostics (Phase H) ────────────────────────────────────────
const funnel = auditCoverageFunnel({
  ledger: [
    { matchKey: "1-2-2026-11-14", leagueApiId: 39, leagueName: "Premier League", kickoff: new Date(NOW.getTime() + 10 * H), status: "SUCCEEDED", attempts: 1 },
    { matchKey: "3-4-2026-11-12", leagueApiId: 110, leagueName: "Premier League", kickoff: new Date(NOW.getTime() - 10 * H), status: "PENDING", attempts: 0 },
  ],
  predictions: [
    { leagueApiId: 39, leagueName: "Premier League", kickoff: new Date(NOW.getTime() + 10 * H), status: "PUBLISHED", homeTeamApiId: 1, awayTeamApiId: 2, categories: ["VIP"] },
    { leagueApiId: 39, leagueName: "Premier League", kickoff: new Date(NOW.getTime() + 10 * H), status: "PUBLISHED", homeTeamApiId: 1, awayTeamApiId: 2, categories: ["GOALS"] },
  ],
  odds: [{ matchKey: "1-2-2026-11-14", bookmakerCount: 9, fetchedAt: new Date(NOW.getTime() - H) }],
  now: NOW, minBookmakers: 5,
});
const epl = funnel.leagues.find((l) => l.leagueApiId === 39)!;
check("H funnel counts a fixture once across markets", epl.predicted === 1 && epl.published === 1 && epl.vip === 1 && epl.priced === 1);
check("H funnel reports a starved fixture by tier", funnel.starvedByTier.DEEP_FALLBACK === 1);
const tally = tallyDiscovery([
  { coverage: { mode: "SECONDARY", widened: false, sweep: { ran: false } } },
  { coverage: { mode: "DEEP_FALLBACK", widened: true, sweep: { ran: true, gateRejectedByLeague: { 112: { unpriced_cup: 3 } }, shadow: { addedCompetitions: [111], liftedRejections: { 112: { unpriced_cup: 3 } } } } } },
  { coverage: { mode: "FALLBACK", widened: true, sweep: { ran: false, skippedReason: "target already met (20 higher-tier + 8 fallback already selected)" } } },
  null,
]);
check("H discovery tally", tally.runs === 3 && tally.sweeps === 1 && tally.modes.DEEP_FALLBACK === 1 && tally.rejectedByLeague[112].unpriced_cup === 3 && Object.keys(tally.skipped)[0].includes("N higher-tier"));
const why = explainCompetition(112, funnel, tally, "shadow");
check("H Welsh Cup explanation names tier, rejection, scope, registry and shadow", [/DEEP_FALLBACK/, /unpriced_cup 3/, /Outside the VIP\/Premium/, /CUP_ODDS_SUPPORTED/, /COVERAGE_ROLLOUT=on \(now shadow\)/, /Shadow: in 1/].every((re) => why.lines.some((l) => re.test(l))), why.lines);
const why111 = explainCompetition(111, funnel, tally, "shadow");
check("H FAW Championship explanation says it is not catalogued", why111.lines[0].startsWith("Not in the league catalogue") && /queued it in 1/.test(why111.lines.join(" ")));
check("H Welsh set covers 110, 111, 112 and not the stale 738", [110, 111, 112].every((id) => WELSH_COMPETITION_IDS.includes(id)) && !WELSH_COMPETITION_IDS.includes(738));
check("H admin page renders the coverage section from the bounded loader", /loadCoverageDiagnostics\(14\)/.test(src("src/app/admin/paid-ops/page.tsx")) && /take: 700/.test(src("src/lib/coverageDiagnostics.ts")));
check("H design rules: no accent stripe or tinted pill in the new section", !/border-[lr]-|bg-[a-z]+(-\d+)?\/\d+/.test(src("src/app/admin/paid-ops/page.tsx").split("League coverage")[1]?.split("</section>")[0] ?? ""));
check("design: no 'AI' wording in the new admin copy", !/\bAI\b/.test(src("src/app/admin/paid-ops/page.tsx").split("League coverage")[1]?.split("</section>")[0] ?? ""));
check("catalogue unchanged: Welsh catalogue tiers are still DEEP_FALLBACK", generationTierOf(110) === "DEEP_FALLBACK" && generationTierOf(112) === "DEEP_FALLBACK" && generationTierOf(111) === null);

console.log(`\n  ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) process.exit(1);
console.log("League coverage and candidate-quality checks passed");
