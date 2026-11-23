/**
 * Regression tests for the market-quality remediation (Nov 2026). No database,
 * no network.
 *
 *   npx tsx scripts/check-market-selection.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateCandidate, selectPrimary, selectionRecord, verifiedRank, marketSelectionMode, marketQualityRankingEnabled,
  SELECTION_POLICY, type CandidateInput,
} from "../src/lib/marketSelection";
import { automaticOddsFailure } from "../src/lib/autoOddsFloor";
import { storedQualityRank, selectHomepageFeatured, selectHomepageGenius } from "../src/lib/homepageFeatured";
import { compareByConfidenceRank } from "../src/lib/geniusCuration";
import { alternativeProblems, applyMarketSelection } from "../src/lib/ai/marketSelectionStep";
import { assembleMatchDigest, buildTeamDigest } from "../src/lib/ai/digest";
import { stripUnsupportedClaims } from "../src/lib/ai/evidenceClaims";
import type { AIPredictionOutput } from "../src/lib/ai/analysis";
import { buildSystemPrompt, buildPredictionRequest } from "../src/lib/ai/analysis";
import { verdictLine } from "../src/lib/matchFacts";
import type { FixtureOdds } from "../src/lib/odds";
import type { MatchDigest } from "../src/lib/ai/digest";

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const src = (p: string) => readFileSync(p, "utf8");
const NOW = new Date("2026-11-23T12:00:00Z");

/** Odds with every leg, medians as given, 8 books each, fresh. */
function odds(p: { h: number; d: number; a: number; dc1x: number; dcx2: number; dc12: number; o25: number; u25: number; by: number; bn: number; o15?: number; u15?: number }, books = 8, update = "2026-11-23T10:00:00Z"): FixtureOdds {
  const s = (value: string, median: number) => ({ value, median, best: median * 1.03, bookmakers: books, bestBookmaker: "X" });
  return { bookmakerCount: books, update, markets: [
    { market: "Match Winner", selections: [s("Home", p.h), s("Draw", p.d), s("Away", p.a)] },
    { market: "Double Chance", selections: [s("Home/Draw", p.dc1x), s("Draw/Away", p.dcx2), s("Home/Away", p.dc12)] },
    { market: "Goals Over/Under", selections: [s("Over 2.5", p.o25), s("Under 2.5", p.u25), ...(p.o15 ? [s("Over 1.5", p.o15), s("Under 1.5", p.u15!)] : [])] },
    { market: "Both Teams Score", selections: [s("Yes", p.by), s("No", p.bn)] },
  ] } as FixtureOdds;
}
const c = (marketType: string, selection: unknown, confidence: number, source: "primary" | "alternative" = "alternative"): CandidateInput => ({ marketType, selection, confidence, source });
const sel = (cands: CandidateInput[], o: FixtureOdds | null, evidenceComplete = true) => selectPrimary(cands, o, { evidenceComplete, now: NOW });

// Fixtures (real shapes from the 23-26 Nov homepage investigation).
const ajaxThun = odds({ h: 1.17, d: 7.1, a: 12, dc1x: 1.04, dcx2: 4.63, dc12: 1.08, o25: 1.25, u25: 3.7, by: 1.67, bn: 2.08, o15: 1.06, u15: 7 });
const feyenoordPorto = odds({ h: 2.7, d: 3.7, a: 2.4, dc1x: 1.54, dcx2: 1.44, dc12: 1.27, o25: 1.6, u25: 2.3, by: 1.5, bn: 2.5 });
const leipzigLens = odds({ h: 1.44, d: 5.3, a: 6, dc1x: 1.13, dcx2: 2.79, dc12: 1.16, o25: 1.3, u25: 3.33, by: 1.44, bn: 2.62 });
const moderate = odds({ h: 1.75, d: 3.9, a: 4.6, dc1x: 1.2, dcx2: 2.05, dc12: 1.27, o25: 1.8, u25: 2.0, by: 1.75, bn: 2.0 });

// ------------------------------------------------------------------ heavy favourite: near-worthless Double Chance gives way to the outright win
{
  const r = sel([c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 72, "primary"), c("MATCH_WINNER", { value: "HOME" }, 78)], ajaxThun);
  ok(r.candidates[0].tier === "INELIGIBLE" && /below the 1.12 floor/.test(r.candidates[0].reasons[0]), "Ajax or Draw at 1.04 fails the floor");
  ok(r.decision === "SWITCH" && r.chosen?.marketType === "MATCH_WINNER", "heavy favourite: the win (1.17, verified) replaces the 1.04 hedge");
  ok(r.chosen!.confidence === 78, "the switched pick keeps the model's OWN stated confidence for it (never inflated)");
}
// ------------------------------------------------------------------ moderate favourite: Draw No Bet has no executable price, so it is never auto-preferred
{
  const dnb = evaluateCandidate(c("DRAW_NO_BET", { value: "HOME" }, 74, "primary"), moderate, SELECTION_POLICY, NOW);
  ok(dnb.tier === "UNPRICED" && dnb.derivedFairOdds != null && Math.abs(dnb.derivedFairOdds - 1.39) < 0.05, "DNB fair price derived from de-vigged 1X2 (~1.39), never presented as executable");
  const r = sel([c("DRAW_NO_BET", { value: "HOME" }, 74, "primary"), c("MATCH_WINNER", { value: "HOME" }, 58), c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 80)], moderate);
  ok(r.decision === "SWITCH" && r.chosen?.tier !== "UNPRICED", "unpriced DNB primary: the likeliest VERIFIED alternative is used");
  const alone = sel([c("DRAW_NO_BET", { value: "HOME" }, 74, "primary")], moderate);
  ok(alone.decision === "HOLD" && alone.holdReason === "NO_VERIFIED_PRICE" && alone.chosen?.marketType === "DRAW_NO_BET", "DNB alone: held for admin review, not published as a verified tip");
  const brighton = odds({ h: 1.14, d: 7.65, a: 15.24, dc1x: 1.03, dcx2: 5.4, dc12: 1.07, o25: 1.36, u25: 2.95, by: 2.05, bn: 1.68 });
  const b = evaluateCandidate(c("DRAW_NO_BET", { value: "HOME" }, 72, "primary"), brighton, SELECTION_POLICY, NOW);
  ok(b.tier === "INELIGIBLE" && b.derivedFairOdds! < 1.12, "Brighton DNB: derived fair ~1.07 is below the floor, so the real price is too");
  ok(automaticOddsFailure(brighton, "DRAW_NO_BET", { value: "HOME" })?.reason === "BELOW_MINIMUM_ODDS", "the generation floor now catches the DNB bypass");
  ok(automaticOddsFailure(moderate, "DRAW_NO_BET", { value: "HOME" }) === null, "a DNB with a sensible derived price still passes the floor");
}
// ------------------------------------------------------------------ balanced fixture: a verified Double Chance is kept
{
  const r = sel([c("DOUBLE_CHANCE", { value: "AWAY_OR_DRAW" }, 70, "primary"), c("OVER_UNDER", { line: 2.5, direction: "OVER" }, 60)], feyenoordPorto);
  ok(r.decision === "KEEP_PRIMARY" && r.chosen?.marketType === "DOUBLE_CHANCE", "Porto or Draw at 1.44 is verified and kept: Double Chance is not banned, only not a universal fallback");
}
// ------------------------------------------------------------------ strong BTTS / strong Over 2.5 primaries are kept
{
  const r1 = sel([c("BTTS", { value: "YES" }, 66, "primary"), c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 82)], feyenoordPorto);
  ok(r1.decision === "KEEP_PRIMARY" && r1.chosen?.marketType === "BTTS", "strong BTTS primary at 1.50 kept (no switch to a higher-confidence hedge)");
  const r2 = sel([c("OVER_UNDER", { line: 2.5, direction: "OVER" }, 72, "primary"), c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 84)], leipzigLens);
  ok(r2.decision === "KEEP_PRIMARY" && r2.chosen?.marketType === "OVER_UNDER", "strong Over 2.5 at 1.30 kept: never simply the highest confidence");
}
// ------------------------------------------------------------------ missing, stale, thin and over-confident prices
{
  ok(sel([c("MATCH_WINNER", { value: "HOME" }, 70, "primary")], null).holdReason === "NO_VERIFIED_PRICE", "missing odds: HOLD, never a guessed price");
  const stale = odds({ h: 1.6, d: 4, a: 5.5, dc1x: 1.15, dcx2: 2.3, dc12: 1.25, o25: 1.8, u25: 2, by: 1.85, bn: 1.9 }, 8, "2026-11-17T10:00:00Z");
  const st = evaluateCandidate(c("MATCH_WINNER", { value: "HOME" }, 66, "primary"), stale, SELECTION_POLICY, NOW);
  ok(st.tier === "UNPRICED" && /older than 96h/.test(st.reasons[0]), "a six-day-old quote is not a verified price");
  const thin = odds({ h: 1.6, d: 4, a: 5.5, dc1x: 1.15, dcx2: 2.3, dc12: 1.25, o25: 1.8, u25: 2, by: 1.85, bn: 1.9 }, 2);
  ok(evaluateCandidate(c("MATCH_WINNER", { value: "HOME" }, 66, "primary"), thin, SELECTION_POLICY, NOW).tier === "UNPRICED", "two bookmakers do not verify a price");
  const over = evaluateCandidate(c("BTTS", { value: "YES" }, 78, "primary"), leipzigLens, SELECTION_POLICY, NOW);
  ok(over.tier === "QUALIFIED", "BTTS 78 vs market 64.5: within the 15pp tolerance");
  const way = evaluateCandidate(c("BTTS", { value: "YES" }, 85, "primary"), leipzigLens, SELECTION_POLICY, NOW);
  ok(way.tier === "INELIGIBLE" && /above the market/.test(way.reasons.join(" ")), "a stated 85% the market prices at 64.5% is not trusted");
  const weak = evaluateCandidate(c("MATCH_WINNER", { value: "AWAY" }, 45, "primary"), feyenoordPorto, SELECTION_POLICY, NOW);
  ok(weak.tier === "INELIGIBLE" && /below 50%/.test(weak.reasons.join(" ")), "a selection under 50% on the blended view is not a tip");
  const short = evaluateCandidate(c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 75, "primary"), leipzigLens, SELECTION_POLICY, NOW);
  ok(short.tier === "SHORT", "1.13 is short but legitimate (no measured case for demoting it)");
  ok(sel([c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 75, "primary"), c("MATCH_WINNER", { value: "HOME" }, 70)], leipzigLens).decision === "KEEP_PRIMARY", "a short but verified primary is kept, not swapped for price");
}
// ------------------------------------------------------------------ insufficient evidence, conflicts, unavailable markets, duplicates in input
{
  const r = sel([c("MATCH_WINNER", { value: "HOME" }, 78, "primary")], ajaxThun, false);
  ok(r.decision === "HOLD" && r.holdReason === "INSUFFICIENT_EVIDENCE", "no credible football evidence: HOLD regardless of price");
  const conflict = sel([c("MATCH_WINNER", { value: "HOME" }, 40, "primary"), c("DOUBLE_CHANCE", { value: "AWAY_OR_DRAW" }, 68)], feyenoordPorto);
  ok(conflict.decision === "SWITCH" && conflict.chosen?.marketType === "DOUBLE_CHANCE", "conflicting candidates: exactly one is chosen, never both");
  const tt = sel([c("TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" }, 75, "primary")], ajaxThun);
  ok(tt.decision === "HOLD" && tt.candidates[0].tier === "UNPRICED", "team total without an exact cached price cannot bypass verification");
  const dup = sel([c("MATCH_WINNER", { value: "HOME" }, 78, "primary"), c("MATCH_WINNER", { value: "HOME" }, 78)], ajaxThun);
  ok(dup.candidates.length === 1, "duplicate candidates are collapsed");
  ok(sel([], ajaxThun).holdReason === "NO_CANDIDATES", "no candidates: HOLD");
  const rec = selectionRecord(sel([c("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 72, "primary"), c("MATCH_WINNER", { value: "HOME" }, 78)], ajaxThun), "shadow", null);
  ok(rec.decision === "SWITCH" && rec.candidates.length === 2 && JSON.parse(JSON.stringify(rec)).policyVersion === rec.policyVersion, "the record is compact JSON with every candidate and reason");
}
// ------------------------------------------------------------------ flags default off
{
  ok(marketSelectionMode(undefined) === "off" && marketSelectionMode("bogus") === "off" && marketSelectionMode("shadow") === "shadow", "MARKET_SELECTION_MODE defaults off");
  ok(!marketQualityRankingEnabled(undefined) && marketQualityRankingEnabled("on"), "MARKET_QUALITY_RANKING defaults off");
  ok(!/from "@\/lib\/football\/api-football"/.test(src("src/lib/marketSelection.ts") + src("src/lib/ai/marketSelectionStep.ts")), "selection makes no provider call (uses the odds already loaded)");
}
// ------------------------------------------------------------------ alternatives pass the SAME evidence, structure, certainty and voice gates (behavioural)
const realDigest = assembleMatchDigest({ fixture: { home: "Ajax", away: "Thun", league: "Europa League", kickoff: "2026-11-27T20:00:00Z", competitionType: "CUP", round: "League Stage - 5" },
  homeTeam: buildTeamDigest({ name: "Ajax", apiId: 1, keyPlayers: [{ name: "Kasper Dolberg", goals: 7 }] } as never), awayTeam: buildTeamDigest({ name: "Thun", apiId: 2 }),
  homeApiId: 1, awayApiId: 2, meetings: [], standings: null } as never);
const goodWin = "Ajax have the stronger attack on the saved numbers and the home price is still fair.";
const alt = (reasoning: string, marketType = "MATCH_WINNER", selection: unknown = { value: "HOME" }, confidence = 78) => ({ marketType, selection, confidence, reasoning }) as never as NonNullable<AIPredictionOutput["alternatives"]>[number];
{
  ok(alternativeProblems(realDigest, alt(goodWin)).length === 0, "control: a supported alternative passes");
  const cases: Array<[string, string]> = [
    ["unnamed manager", "Manager John Heitinga has drilled Ajax into a pressing side all season and they should win."],
    ["player not in the evidence", "Ajax's striker Brian Brobbey should be the difference against a tired Thun defence."],
    ["knockout talk in a league-phase match", "Ajax should take control of this knockout tie on home soil tonight."],
    ["scoreline not in the evidence", "Ajax beat Thun 4-0 when the sides last met and should repeat the result."],
    ["certainty language", "Ajax will definitely win this one, it is a guaranteed home victory for them."],
  ];
  for (const [label, text] of cases) ok(alternativeProblems(realDigest, alt(text)).length > 0, `alternative rejected: ${label}`);
  ok(alternativeProblems(realDigest, alt("Ajax's striker Kasper Dolberg leads their scoring and the home price is fair.")).length === 0, "a player who IS in the saved evidence is allowed");
  ok(alternativeProblems(realDigest, alt(goodWin, "MATCH_WINNER", { value: "BOTH" })).some((p) => /invalid selection/.test(p)), "alternative rejected: invalid selection structure");
  ok(alternativeProblems(realDigest, alt(goodWin, "CORRECT_SCORE", { home: 2, away: 0 })).length > 0, "alternative rejected: excluded market");
  ok(alternativeProblems(realDigest, alt(goodWin, "MATCH_WINNER", { value: "HOME" }, 140)).some((p) => /confidence/.test(p)), "alternative rejected: confidence out of range");
  ok(alternativeProblems(realDigest, alt("Ajax win.")).some((p) => /reasoning/.test(p)), "alternative rejected: no real reasoning");
  // The same unsupported manager sentence is stripped from the PRIMARY by the shared gate: the alternative gate is not weaker.
  ok(stripUnsupportedClaims(realDigest, { predictions: [{ reasoning: cases[0][1] }] }).removed.length === 1, "the shared gate treats the primary the same way");
}
// ------------------------------------------------------------------ applyMarketSelection: switching, persisted draft, quote times (behavioural)
{
  const base = { matchPreview: "Ajax host Thun.", keyFactors: ["Ajax are stronger at home."], predictions: [
    { marketType: "DOUBLE_CHANCE", selection: { value: "HOME_OR_DRAW" }, confidence: 72, reasoning: "Ajax are unlikely to lose at home against a weaker Thun side." },
  ] } as never as AIPredictionOutput;
  const withAlts = (alts: unknown[]) => ({ ...base, alternatives: alts }) as AIPredictionOutput;
  const fetched = new Date("2026-11-23T10:05:00Z");
  const run = (o: Partial<Parameters<typeof applyMarketSelection>[0]>) => applyMarketSelection({ output: withAlts([alt(goodWin)]), digest: realDigest, odds: ajaxThun,
    quoteFetchedAt: fetched, contextComplete: true, mode: "on", manual: false, earlyFree: false, failsPriceChecks: (d) => d.marketType === "DOUBLE_CHANCE", now: NOW, ...o });

  const on = run({});
  ok(on.switched && on.output.predictions[0].marketType === "MATCH_WINNER" && on.output.predictions.length === 1, "on: the 1.04 hedge is replaced by the validated, verified win; exactly one pick persists");
  ok(on.output.predictions[0].reasoning === goodWin, "the switched pick carries the alternative's own (validated) reasoning");
  const shadow = run({ mode: "shadow" });
  ok(!shadow.switched && shadow.output === shadow.output && shadow.output.predictions[0].marketType === "DOUBLE_CHANCE" && shadow.record.decision === "SWITCH", "shadow: records the decision, never changes the pick");
  ok(!run({ manual: true }).switched, "admin-requested generation is never switched");
  const bad = run({ output: withAlts([alt("Ajax's striker Brian Brobbey should be the difference against a tired Thun defence.")]) });
  ok(!bad.switched && bad.record.rejectedAlternatives?.length === 1 && bad.record.candidates.length === 1, "an alternative with an unsupported claim never becomes a candidate (recorded as rejected)");

  // Early publication safety is decided on the draft that is actually persisted.
  ok(run({ earlyFree: true }).earlyPriceUnsafe === false, "early, switched to a verified pick: publication safety follows the CHOSEN draft");
  ok(run({ earlyFree: true, mode: "shadow" }).earlyPriceUnsafe === true, "early, shadow keeps the unsafe 1.04 hedge: blocked from automatic publication");
  const keepOk = run({ earlyFree: true, output: withAlts([]), failsPriceChecks: () => false, odds: moderate });
  ok(keepOk.earlyPriceUnsafe === false, "early: an unqualified ALTERNATIVE no longer blocks a safe persisted primary");
  ok(run({ earlyFree: true, output: withAlts([]), odds: null, failsPriceChecks: () => false }).earlyPriceUnsafe === true, "early, on: HOLD (no verified price) blocks automatic publication");

  // Quote timestamps: recorded, and a quote not provably available at the decision is not verified.
  ok(on.record.quoteFetchedAt === fetched.toISOString() && on.record.providerQuoteAt === ajaxThun.update && on.record.decidedAt === NOW.toISOString(), "provider and cache quote times and the decision time are recorded");
  const future = run({ odds: { ...ajaxThun, update: "2026-11-23T13:00:00Z" } as FixtureOdds });
  ok(future.record.decision === "HOLD" && future.record.candidates.every((x) => x.tier === "UNPRICED"), "a quote stamped after the decision is not treated as available");
  const unknown = run({ odds: { ...ajaxThun, update: undefined } as never, quoteFetchedAt: null });
  ok(unknown.record.candidates.every((x) => x.tier === "UNPRICED" && x.reasons.some((r) => /quote time unknown/.test(r))), "unknown quote time: unverified");
  const fallback = run({ odds: { ...ajaxThun, update: undefined } as never });
  ok(fallback.switched, "no provider stamp: the cache fetch time (before the decision) is used");
  const stale = run({ odds: { ...ajaxThun, update: "2026-11-18T10:00:00Z" } as FixtureOdds });
  ok(stale.record.candidates.every((x) => x.tier === "UNPRICED"), "a quote older than the age limit is not verified");
}
// ------------------------------------------------------------------ prompts: alternatives only with the flag; VIP keeps its caution
{
  const digest = { fixture: { home: "A", away: "B", league: "L", kickoff: "2026-11-24T20:00:00Z" }, teams: { home: {}, away: {} }, coverage: {} } as unknown as MatchDigest;
  const off = buildPredictionRequest({ digest, tiers: ["GENIUS"] });
  ok(!/ALTERNATIVE MARKETS/.test(off.system), "flag off: the prompt is unchanged (no alternatives block)");
  ok(/ALTERNATIVE MARKETS/.test(buildPredictionRequest({ digest, tiers: ["GENIUS"], marketSelection: "shadow" }).system), "shadow/on: alternatives requested in the SAME call");
  ok(/do not raise a number to make an\s+alternative look competitive/.test(buildPredictionRequest({ digest, tiers: ["GENIUS"], marketSelection: "on" }).system), "alternatives get independent confidence, never inflated");
  ok(/This draft is for a cautious tier/.test(buildSystemPrompt(["GENIUS"])), "default: GENIUS still cautious (unchanged until FREE_TIER_NEUTRAL_BANDS=on)");
  ok(/This draft is for a standard tier/.test(buildSystemPrompt(["GENIUS"], "margin", "single", { freeTierNeutral: true })), "free-tier neutral bands remove the hedging bias");
  ok(/This draft is for a cautious tier/.test(buildSystemPrompt(["VIP"], "margin", "single", { freeTierNeutral: true })), "VIP keeps its caution");
}
// ------------------------------------------------------------------ homepage ranking: exact production functions, legacy rows are NOT verified
{
  ok(verifiedRank("QUALIFIED") === 0 && verifiedRank("SHORT") === 0, "short prices are not demoted (measured)");
  ok(verifiedRank("UNPRICED") === 1 && verifiedRank("INELIGIBLE") === 2, "unpriced, then failed");
  ok(verifiedRank(null) === 1 && verifiedRank(undefined) === 1, "a row with no stored record is unverified, whatever its market");
  const row = (id: string, marketType: string, confidence: number, tier?: string, h = 1) => ({ id, marketType, confidence, leagueApiId: 39, publishedAt: "2026-11-22T10:00:00Z",
    homeTeamApiId: h, awayTeamApiId: h + 100, analysisJson: tier ? { v: 1, keyFactors: [], selectionQuality: { tier } } : { v: 1, keyFactors: [] }, selection: {} });
  // Realistic legacy rows: everything published before this change has analysisJson without selectionQuality.
  const legacy = [row("dc", "DOUBLE_CHANCE", 74, undefined, 1), row("ou", "OVER_UNDER", 70, undefined, 2), row("tt", "TEAM_TOTAL", 80, undefined, 3), row("dnb", "DRAW_NO_BET", 77, undefined, 4)];
  const off = selectHomepageFeatured(legacy, new Map()).map((r) => r.id).join();
  ok(selectHomepageFeatured(legacy, new Map(), 6, new Set(), { qualityRanking: true }).map((r) => r.id).join() === off, "legacy rows with the flag on: the order is unchanged (no market is presumed verified)");
  ok(selectHomepageFeatured(legacy, new Map(), 6, new Set(), { qualityRanking: true })[0].id === "tt", "a legacy Double Chance does not jump a legacy Team Total by market type alone");
  ok(storedQualityRank({ analysisJson: { v: 1 }, marketType: "DOUBLE_CHANCE" }) === 1, "legacy Double Chance: rank 1 (not verified)");
  const pool = [row("tt", "TEAM_TOTAL", 82, undefined, 1), row("dnb", "DRAW_NO_BET", 80, "UNPRICED", 2), row("dc", "DOUBLE_CHANCE", 74, "QUALIFIED", 3), row("ou", "OVER_UNDER", 66, "SHORT", 4)];
  ok(selectHomepageFeatured(pool, new Map(), 2).map((r) => r.id).join() === "tt,dnb", "flag off: unchanged confidence-first order");
  ok(selectHomepageFeatured(pool, new Map(), 2, new Set(), { qualityRanking: true }).map((r) => r.id).join() === "dc,ou", "flag on: rows with a stored verified record first, then confidence");
  ok(selectHomepageFeatured([...pool].reverse(), new Map(), 4, new Set(), { qualityRanking: true }).map((r) => r.id).join() === "dc,ou,tt,dnb", "stable regardless of input order");
  ok(selectHomepageGenius(pool, new Map(), 3, new Set(), { qualityRanking: true })[0].id === "dc", "Genius excerpt uses the same rule");
  const two = [row("a", "DOUBLE_CHANCE", 80, "QUALIFIED", 7), row("b", "OVER_UNDER", 78, "QUALIFIED", 7)];
  ok(selectHomepageFeatured(two, new Map(), 6, new Set(), { qualityRanking: true }).length === 1, "one pick per fixture on the homepage");
  // Genius curation comparator (the production function), flag read from the environment.
  const prev = process.env.MARKET_QUALITY_RANKING;
  const cur = (id: string, marketType: string, confidence: number, tier?: string) => ({ ...row(id, marketType, confidence, tier), kickoff: new Date("2026-11-24T20:00:00Z") }) as never;
  process.env.MARKET_QUALITY_RANKING = "on";
  ok(compareByConfidenceRank(cur("x", "DOUBLE_CHANCE", 70), cur("y", "TEAM_TOTAL", 75)) > 0, "curation, flag on: legacy rows still compare by confidence");
  ok(compareByConfidenceRank(cur("x", "OVER_UNDER", 66, "QUALIFIED"), cur("y", "DOUBLE_CHANCE", 80)) < 0, "curation, flag on: a stored verified record outranks a legacy row");
  process.env.MARKET_QUALITY_RANKING = "off";
  ok(compareByConfidenceRank(cur("x", "OVER_UNDER", 66, "QUALIFIED"), cur("y", "DOUBLE_CHANCE", 80)) > 0, "curation, flag off: unchanged");
  if (prev === undefined) delete process.env.MARKET_QUALITY_RANKING; else process.env.MARKET_QUALITY_RANKING = prev;
}
// ------------------------------------------------------------------ secondary goals outlook is not a second tip
{
  const table = src("src/components/PredictionsTable.tsx");
  ok(/>Goals outlook</.test(table) && !/>Over\/Under</.test(table), "column reads Goals outlook");
  ok(/p\.marketType === "OVER_UNDER" \? "—"/.test(table), "no duplicate outlook when the pick is itself a goals call");
  ok(/text-xs text-gray-500/.test(table), "muted, not styled like the Pick");
  const v = verdictLine({ market: "Double Chance", pick: "Ajax or Draw", confidence: 72, overUnder: "Over 2.5 Goals" });
  ok(/Goals outlook: over 2\.5 goals\.$/.test(v) && !/Total goals:/.test(v), "verdict calls it an outlook, not a second backed selection");
}
// ------------------------------------------------------------------ published immutability and monitoring are read-only
{
  for (const f of ["src/lib/marketSelection.ts", "src/lib/marketQualityReport.ts", "src/app/admin/market-quality/page.tsx", "scripts/audit-market-quality.ts", "scripts/backtest-market-selection.ts"])
    ok(!/\.(update|updateMany|delete|deleteMany|create|createMany|upsert)\(/.test(src(f)), "no writes: " + f);
  const audit = src("scripts/audit-market-quality.ts") + src("scripts/backtest-market-selection.ts");
  ok((audit.match(/transaction_read_only/g) ?? []).length >= 2, "both production scripts refuse a writable session");
  const bt = src("scripts/backtest-market-selection.ts");
  ok(/selectHomepageFeatured\(/.test(bt) && /pairedDayRoiDiff90/.test(bt), "backtest ranks with the production function and reports paired per-day returns per arm");
  ok(SELECTION_POLICY.MODEL_WEIGHT === 0.3 && /unproven shadow parameter/i.test(src("src/lib/marketSelection.ts")), "0.3 is documented as an unproven shadow parameter, not a fitted optimum");
  ok(/!\/\\bAI\\b\//.test("") || !/\bAI\b/.test(src("src/app/admin/market-quality/page.tsx") + src("src/components/PredictionsTable.tsx")), "no AI wording added");
}

console.log(`PASS: market selection — ${n} assertions (heavy favourite, DNB, balanced, BTTS, Over 2.5, missing/stale/thin/over-confident prices, near-worthless, evidence, conflicts, unpriced markets, duplicates, flags, VIP separation, prompts, homepage stability, goals outlook, immutability, no leakage)`);
