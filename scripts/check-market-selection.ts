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
// ------------------------------------------------------------------ flags default off; shadow never changes publication
{
  ok(marketSelectionMode(undefined) === "off" && marketSelectionMode("bogus") === "off" && marketSelectionMode("shadow") === "shadow", "MARKET_SELECTION_MODE defaults off");
  ok(!marketQualityRankingEnabled(undefined) && marketQualityRankingEnabled("on"), "MARKET_QUALITY_RANKING defaults off");
  const gen = src("src/lib/ai/generate.ts");
  ok(/if \(selectionMode === "on" && !input\.manual\) \{/.test(gen), "only \"on\" may change the persisted pick; admin-requested generation is never switched");
  ok(/rawOutput: JSON\.stringify\(marketSelection \? \{ \.\.\.output, marketSelection \} : output\)/.test(gen), "the decision is recorded with the job");
  ok(/if \(result\.decision === "HOLD" && earlyFree\) input\.earlyPriceUnsafe = true;/.test(gen), "early lane: a HOLD blocks automatic publication (review instead)");
  ok(/\.slice\(0, marketBreadth === "single" \? 1 : undefined\)/.test(gen), "single-market generation persists exactly one row per fixture");
  ok(/!\["VIP_PREMIUM", "EUROPEAN_CLUB", "MARKET_CONFIRMED", REGULAR_COMBO_INTENT\]\.includes/.test(gen) && /riskRoute\.calibration !== "legacy"/.test(gen), "paid pass, European lane, combos and Banker are untouched");
  ok(!/from "@\/lib\/football\/api-football"/.test(src("src/lib/marketSelection.ts")), "selection makes no provider call (uses the odds already loaded)");
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
// ------------------------------------------------------------------ homepage ranking: verified first, stable, outcome-blind
{
  ok(verifiedRank("QUALIFIED", "DOUBLE_CHANCE") === 0 && verifiedRank("SHORT", "MATCH_WINNER") === 0, "short prices are not demoted (measured)");
  ok(verifiedRank("UNPRICED", "OVER_UNDER") === 1 && verifiedRank("INELIGIBLE", "BTTS") === 2, "unpriced then failed");
  ok(verifiedRank(null, "DRAW_NO_BET") === 1 && verifiedRank(null, "TEAM_TOTAL") === 1 && verifiedRank(null, "DOUBLE_CHANCE") === 0, "legacy rows inferred from the market");
  const row = (id: string, marketType: string, confidence: number, tier?: string, h = 1) => ({ id, marketType, confidence, leagueApiId: 39, publishedAt: "2026-11-22T10:00:00Z",
    homeTeamApiId: h, awayTeamApiId: h + 100, analysisJson: tier ? { v: 1, keyFactors: [], selectionQuality: { tier } } : { v: 1, keyFactors: [] }, selection: {} });
  const pool = [row("tt", "TEAM_TOTAL", 82, undefined, 1), row("dnb", "DRAW_NO_BET", 80, "UNPRICED", 2), row("dc", "DOUBLE_CHANCE", 74, "QUALIFIED", 3), row("ou", "OVER_UNDER", 66, "SHORT", 4)];
  ok(selectHomepageFeatured(pool, new Map(), 2).map((r) => r.id).join() === "tt,dnb", "flag off: unchanged confidence-first order");
  ok(selectHomepageFeatured(pool, new Map(), 2, new Set(), { qualityRanking: true }).map((r) => r.id).join() === "dc,ou", "flag on: verified prices first, then confidence");
  ok(selectHomepageFeatured([...pool].reverse(), new Map(), 4, new Set(), { qualityRanking: true }).map((r) => r.id).join() === "dc,ou,tt,dnb", "stable regardless of input order");
  ok(selectHomepageGenius(pool, new Map(), 3, new Set(), { qualityRanking: true })[0].id === "dc", "Genius excerpt uses the same rule");
  ok(storedQualityRank({ analysisJson: null, marketType: "BTTS" }) === 0, "tier comes only from the stored generation record (no live prices: no movement)");
  const two = [row("a", "DOUBLE_CHANCE", 80, "QUALIFIED", 7), row("b", "OVER_UNDER", 78, "QUALIFIED", 7)];
  ok(selectHomepageFeatured(two, new Map(), 6, new Set(), { qualityRanking: true }).length === 1, "one pick per fixture on the homepage");
  ok(/MARKET_QUALITY_RANKING|marketQualityRankingEnabled\(\)/.test(src("src/lib/geniusCuration.ts")), "Genius curation reads the same flag");
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
  ok(/const cut = Math\.floor\(settled\.length \* 0\.6\)/.test(bt) && /sort\(\(a, b\) => a\.r\.kickoff!\.getTime\(\) - b\.r\.kickoff!\.getTime\(\)\)/.test(bt), "blend weight fitted chronologically (earlier 60%), judged on the later 40%");
  ok(/!\/\\bAI\\b\//.test("") || !/\bAI\b/.test(src("src/app/admin/market-quality/page.tsx") + src("src/components/PredictionsTable.tsx")), "no AI wording added");
}

console.log(`PASS: market selection — ${n} assertions (heavy favourite, DNB, balanced, BTTS, Over 2.5, missing/stale/thin/over-confident prices, near-worthless, evidence, conflicts, unpriced markets, duplicates, flags, VIP separation, prompts, homepage stability, goals outlook, immutability, no leakage)`);
