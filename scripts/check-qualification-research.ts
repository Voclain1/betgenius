/**
 * VIP/Premium Sprint 08 regression suite: the pre-registered qualification
 * research (src/lib/qualificationResearch.ts), its isolation from production
 * code, and the read-only diagnostics wiring. Synthetic rows only: no
 * database, no network, no quota.
 *
 * Run: npx tsx scripts/check-qualification-research.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CANDIDATES, LOOSENING_PROMOTION, RESEARCH_MAX_MARKET, RESEARCH_MIN_BOOKS, additions, baseline, blockedByConfidenceAlone, firstLoss,
  holdoutDecision, judgeAdditions, marketConfirmed, onePerFixture, policySelection, promotionDecision, roiInterval, stats,
  type FunnelFixture, type ResearchRow,
} from "../src/lib/qualificationResearch";
import { PAID_MAX_MARKET_PROBABILITY, VIP_MARKET_FLOOR } from "../src/lib/vipPremiumOverlay";
import { MC_MAX_GAP_PP, MC_MIN_BOOKMAKERS } from "../src/lib/marketConfirmed";
import { PREMIUM_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { threeWaySplit } from "../src/lib/paidPolicyResearch";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : ` — got ${JSON.stringify(got)?.slice(0, 300)}`}`);
};

let n = 0;
const row = (o: Partial<ResearchRow> = {}): ResearchRow => {
  const id = `r${++n}`;
  const kickoff = o.kickoff ?? new Date(Date.UTC(2026, 9, 1 + (n % 40), 15));
  return {
    id, fixtureKey: o.fixtureKey ?? `fx${n}`, leagueApiId: 39, marketType: "OVER_UNDER", kickoff, day: kickoff.toISOString().slice(0, 10),
    confidence: 76, odds: 1.25, marketProbability: 78, bookmakers: 8, outcome: "WON", source: "PUBLISHED", paidTiers: [],
    vipRoute: false, inPaidScope: true, provider: "claude", priceSource: "closing", ...o,
  };
};
const cand = (name: string) => CANDIDATES.find((c) => c.name === name)!;

// ── 1. Constants are the production gate's own ─────────────────────────────
check("1 research market cap equals PAID_MAX_MARKET_PROBABILITY", Math.abs(RESEARCH_MAX_MARKET - PAID_MAX_MARKET_PROBABILITY) < 1e-9);
check("1 research min books equals MC_MIN_BOOKMAKERS", RESEARCH_MIN_BOOKS === MC_MIN_BOOKMAKERS);
check("1 published floors unchanged (75 / 80)", VIP_CONFIDENCE_FLOOR === 75 && PREMIUM_CONFIDENCE_FLOOR === 80 && VIP_MARKET_FLOOR === 75 && MC_MAX_GAP_PP === 10);

// ── 2. Market confirmation ────────────────────────────────────────────────
check("2 confirmed at 78% / 8 books / gap 2", marketConfirmed(row({ confidence: 76, marketProbability: 78 }), { minMarket: 75, maxGapPP: 10 }));
check("2 thin book refused", !marketConfirmed(row({ bookmakers: 4 }), { minMarket: 75, maxGapPP: 10 }));
check("2 unpriced refused", !marketConfirmed(row({ odds: null }), { minMarket: 75, maxGapPP: 10 }) && !marketConfirmed(row({ marketProbability: null }), { minMarket: 75, maxGapPP: 10 }));
check("2 too short (>86.96%) refused", !marketConfirmed(row({ marketProbability: 88, confidence: 82 }), { minMarket: 75, maxGapPP: 10 }));
check("2 below market floor refused", !marketConfirmed(row({ marketProbability: 74 }), { minMarket: 75, maxGapPP: 10 }));
check("2 gap 11 refused at 10, admitted at 15", !marketConfirmed(row({ confidence: 70, marketProbability: 81 }), { minMarket: 75, maxGapPP: 10 }) && marketConfirmed(row({ confidence: 70, marketProbability: 81 }), { minMarket: 75, maxGapPP: 15 }));

// ── 3. Candidates admit only what they say ────────────────────────────────
const v1 = cand("V1_CONF73_MARKET_CONFIRMED"), v2 = cand("V2_CONF70_MARKET_CONFIRMED"), v3 = cand("V3_CONF70_MARKET80"), v4 = cand("V4_SCOPE_MARKET_CONFIRMED");
const ctx = { vipBaseline: new Set<string>() };
check("3 V1 admits 73-74, not 72 or 75", v1.admits(row({ confidence: 73 }), ctx) && v1.admits(row({ confidence: 74 }), ctx) && !v1.admits(row({ confidence: 72 }), ctx) && !v1.admits(row({ confidence: 75 }), ctx));
check("3 V2 admits 70, not 69", v2.admits(row({ confidence: 70, marketProbability: 76 }), ctx) && !v2.admits(row({ confidence: 69, marketProbability: 76 }), ctx));
check("3 V3 needs market >= 80", !v3.admits(row({ confidence: 72, marketProbability: 79 }), ctx) && v3.admits(row({ confidence: 72, marketProbability: 81 }), ctx));
check("3 V4 never lowers the floor", !v4.admits(row({ confidence: 74 }), ctx) && v4.admits(row({ confidence: 75 }), ctx));
check("3 no candidate admits outside paid scope", CANDIDATES.every((c) => !c.admits(row({ inPaidScope: false, confidence: 82, marketProbability: 82 }), { vipBaseline: new Set(["fxX"]) }) || c.tier === "PREMIUM"));
check("3 no VIP candidate re-admits a row already paid", [v1, v2, v3, v4].every((c) => !c.admits(row({ paidTiers: ["VIP"], confidence: 74 }), ctx)));
check("3 floor-lowering candidates are flagged", CANDIDATES.filter((c) => c.changesPublishedFloor).map((c) => c.name).sort().join() === "P1_CONF78_MARKET80,P2_VIP_MARKET83,V1_CONF73_MARKET_CONFIRMED,V2_CONF70_MARKET_CONFIRMED,V3_CONF70_MARKET80");

// ── 4. Fixture-level deduplication and superset property ──────────────────
{
  const a = row({ fixtureKey: "F1", confidence: 74 }), b = row({ fixtureKey: "F1", confidence: 73 }), c = row({ fixtureKey: "F1", confidence: 74, marketProbability: 80 });
  const one = onePerFixture([a, b, c]);
  check("4 one row per fixture, highest confidence then market", one.length === 1 && one[0].id === c.id, one.map((r) => r.id));
  const paid = row({ fixtureKey: "F2", paidTiers: ["VIP"], confidence: 78 });
  const extra = row({ fixtureKey: "F2", confidence: 74 });
  check("4 a fixture with a baseline pick gets no second pick", additions([paid, extra], v1).length === 0);
  const universe = [paid, extra, row({ fixtureKey: "F3", confidence: 74 }), row({ fixtureKey: "F3", confidence: 73, source: "DEDICATED_REJECTED" }), row({ fixtureKey: "F4", paidTiers: ["VIP", "PREMIUM"], confidence: 82 })];
  for (const c of CANDIDATES) {
    const sel = policySelection(universe, c);
    const base = baseline(universe, c.tier);
    check(`4 ${c.name} keeps every baseline fixture`, base.every((b) => sel.some((s) => s.fixtureKey === b.fixtureKey)));
    check(`4 ${c.name} never has two picks on a fixture`, new Set(sel.map((s) => s.fixtureKey)).size === sel.length);
  }
  check("4 baseline ignores dedicated-rejected rows", baseline([row({ source: "DEDICATED_REJECTED", paidTiers: ["VIP"] })], "VIP").length === 0);
  const p1 = cand("P1_CONF78_MARKET80");
  const vipOnly = row({ fixtureKey: "F9", paidTiers: ["VIP"], confidence: 78, marketProbability: 82 });
  check("4 PREMIUM candidate upgrades a VIP fixture", additions([vipOnly], p1).length === 1);
  check("4 PREMIUM candidate does not upgrade a non-VIP fixture", additions([row({ fixtureKey: "F10", confidence: 78, marketProbability: 82 })], p1).length === 0);
}

// ── 5. Statistics ─────────────────────────────────────────────────────────
{
  const rows = [row({ outcome: "WON", odds: 1.5, day: "2026-10-01" }), row({ outcome: "LOST", odds: 1.5, day: "2026-10-01" }), row({ outcome: "VOID", odds: 1.5, day: "2026-10-02" })];
  const s = stats(rows, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  check("5 win rate over decided picks only", s.winRate === 0.5 && s.voids === 1);
  check("5 ROI withheld below 30 priced picks", s.roiPct === null && s.roi90 === null);
  check("5 per-day supply and zero days over active days", s.perDay === 1 && s.zeroDays === 1);
  const many = Array.from({ length: 40 }, (_, i) => row({ outcome: i % 5 === 0 ? "LOST" : "WON", odds: 1.3 }));
  const sm = stats(many, ["d"]);
  check("5 ROI computed at 30+ priced", sm.roiPct != null && Math.abs(sm.roiPct - ((32 * 0.3 - 8) / 40) * 100) < 1e-9, sm.roiPct);
  check("5 bootstrap is deterministic and brackets the point estimate", JSON.stringify(roiInterval(many.map((r) => (r.outcome === "WON" ? 0.3 : -1)))) === JSON.stringify(roiInterval(many.map((r) => (r.outcome === "WON" ? 0.3 : -1)))) && sm.roi90![0] <= sm.roiPct! && sm.roi90![1] >= sm.roiPct!);
  check("5 Brier uses priced decided rows", sm.brierN === 40 && sm.brierModel != null && sm.brierMarket != null);
  const unpriced = stats([row({ odds: null, outcome: "LOST" }), ...many], ["d"]);
  check("5 unpriced-as-loss sensitivity is worse than excluded", unpriced.roiUnpricedAsLossPct! < unpriced.roiPct!);
}

// ── 6. Promotion rule ─────────────────────────────────────────────────────
{
  const mk = (n: number, win: number, odds: number, conf = 76, mkt = 78) => Array.from({ length: n }, (_, i) => row({ outcome: i < Math.round(n * win) ? "WON" : "LOST", odds, confidence: conf, marketProbability: mkt, day: `d${i % 10}` }));
  const days = Array.from({ length: 10 }, (_, i) => `d${i}`);
  const base = stats(mk(60, 0.82, 1.22), days);
  const goodAdded = stats(mk(40, 0.82, 1.24), days);
  const combined = stats([...mk(60, 0.82, 1.22), ...mk(40, 0.82, 1.24)], days);
  check("6 equal-quality additions with supply pass", judgeAdditions(base, goodAdded, combined, LOOSENING_PROMOTION.MIN_ADDED_N).pass, judgeAdditions(base, goodAdded, combined, 30).reasons);
  check("6 too few additions fail", !judgeAdditions(base, stats(mk(10, 0.9, 1.3), days), combined, 30).pass);
  const weak = stats(mk(40, 0.7, 1.24), days);
  check("6 weaker strike fails", judgeAdditions(base, weak, combined, 30).reasons.some((r) => /strike/.test(r)));
  check("6 no supply gain fails", judgeAdditions(base, goodAdded, base, 30).reasons.some((r) => /supply gain/.test(r)));
  const overconfident = stats(mk(40, 0.75, 1.3, 90, 76), days);
  check("6 model much worse than market on additions fails", judgeAdditions(base, overconfident, combined, 30).reasons.some((r) => /Brier/.test(r)));
  const t = { base, added: goodAdded, combined }, v = { base, added: weak, combined };
  check("6 promotion needs dev-validate AND the dev-train sign check", !promotionDecision(t, v).pass && !promotionDecision(v, t).pass && promotionDecision(t, t).pass);
  check("6 holdout uses the same bars", holdoutDecision(t).pass && !holdoutDecision(v).pass);
}

// ── 7. Funnel attribution ─────────────────────────────────────────────────
{
  const pick = (o: Partial<FunnelFixture["picks"][number]> = {}) => ({ confidence: 76, vipRoute: true, marketProbability: 78, bookmakers: 8, odds: 1.25, ...o });
  const f = (o: Partial<FunnelFixture> = {}): FunnelFixture => ({ fixtureKey: "k", inPaidScope: true, picks: [pick()], carriedVip: false, widenedDay: false, ...o });
  check("7 paid", firstLoss(f({ carriedVip: true })) === "PAID");
  check("7 no published single", firstLoss(f({ picks: [] })) === "NO_PUBLISHED_SINGLE");
  check("7 scope before confidence", firstLoss(f({ inPaidScope: false, picks: [pick({ confidence: 60 })] })) === "OUT_OF_PAID_SCOPE");
  check("7 confidence", firstLoss(f({ picks: [pick({ confidence: 74 })] })) === "CONFIDENCE");
  check("7 healthy-day non-route", firstLoss(f({ picks: [pick({ vipRoute: false })] })) === "NOT_VIP_ROUTE_ON_HEALTHY_DAY");
  check("7 widened day, unpriced", firstLoss(f({ widenedDay: true, picks: [pick({ vipRoute: false, marketProbability: null })] })) === "NO_USABLE_PRICE");
  check("7 widened day, market out of band", firstLoss(f({ widenedDay: true, picks: [pick({ vipRoute: false, marketProbability: 70 })] })) === "MARKET_OUTSIDE_BAND");
  check("7 disagreement", firstLoss(f({ picks: [pick({ confidence: 80, marketProbability: 60 })] })) === "MODEL_MARKET_DISAGREE");
  check("7 confidence alone: 72 confirmed by the market", blockedByConfidenceAlone(f({ picks: [pick({ confidence: 72, marketProbability: 78 })] })));
  check("7 not confidence alone when the market disagrees", !blockedByConfidenceAlone(f({ picks: [pick({ confidence: 72, marketProbability: 60 })] })));
  check("7 not confidence alone outside paid scope", !blockedByConfidenceAlone(f({ inPaidScope: false, picks: [pick({ confidence: 72 })] })));
}

// ── 8. Chronological split has no leakage ─────────────────────────────────
{
  const rows = Array.from({ length: 100 }, (_, i) => row({ kickoff: new Date(Date.UTC(2026, 7, 1) + Math.floor(i / 2) * 86_400_000) }));
  const s = threeWaySplit(rows);
  const maxT = Math.max(...s.devTrain.map((r) => r.kickoff.getTime())), minV = Math.min(...s.devValidate.map((r) => r.kickoff.getTime()));
  const maxV = Math.max(...s.devValidate.map((r) => r.kickoff.getTime())), minH = Math.min(...s.holdout.map((r) => r.kickoff.getTime()));
  check("8 dev-train ends before dev-validate, which ends before the holdout", maxT < minV && maxV < minH);
  check("8 every row lands in exactly one period", s.devTrain.length + s.devValidate.length + s.holdout.length === rows.length);
}

// ── 9. Isolation: research never reaches production code ──────────────────
{
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
  walk(join(__dirname, "../src"));
  const importers = files.filter((f) => !f.endsWith("qualificationResearch.ts") && /qualificationResearch/.test(readFileSync(f, "utf8")));
  check("9 no file under src imports the research module", importers.length === 0, importers);
  const research = readFileSync(join(__dirname, "../src/lib/qualificationResearch.ts"), "utf8");
  check("9 research module imports nothing that touches the database", !/prisma|@\/lib\/predictions|vipPremiumPipeline/.test(research));
  const script = readFileSync(join(__dirname, "research-qualification-loosening.ts"), "utf8");
  check("9 research script refuses a writable session", /REQUIRE_READ_ONLY[\s\S]*transaction_read_only[\s\S]*refusing/.test(script));
  check("9 research script never writes", !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(script));
  check("9 holdout scored only for promoted candidates", /for \(const c of promoted\)[\s\S]*holdoutDecision/.test(script) && !/holdoutDecision\([^)]*CANDIDATES/.test(script));
  const funnel = readFileSync(join(__dirname, "measure-qualification-funnel.ts"), "utf8");
  check("9 funnel script refuses a writable session and never writes", /refusing: session is not read-only/.test(funnel) && !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(funnel));
  const wf = readFileSync(join(__dirname, "../.github/workflows/diagnose-generation.yml"), "utf8");
  const job = wf.slice(wf.indexOf("  qualification:"));
  check("9 workflow job runs both scripts with REQUIRE_READ_ONLY", (job.match(/REQUIRE_READ_ONLY: "1"/g) ?? []).length >= 2 && /default_transaction_read_only=on/.test(job));
  check("9 configuration probe prints only allowlisted names", /for n in COVERAGE_ROLLOUT [A-Z_ ]+; do/.test(job) && !/printenv\s*\|/.test(job) && !/printenv"?\s*$/m.test(job) && !/KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL\b.*printenv/.test(job.slice(job.indexOf("for n in"), job.indexOf("done"))));
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exitCode = 1;
