/**
 * Value-based paid selection wired into production, proved without a database.
 *
 *   1. Feature flags: default shadow; value needs an ACTIVE artifact or falls
 *      back to the #175 rule; the disable switch; the EV bar.
 *   2. The committed artifact: versioned, inactive per its evidence, applies.
 *   3. combinePaidDecisions: current = #175; value = #175 AND value, ordered by
 *      lower-bound EV with a per-market cap; a pricing outage falls back.
 *   4. planCuration with value ordering: rank order, per-market cap counting
 *      protected rows, the hard floor, one per fixture; absent = unchanged.
 *   5. Locked predictions API: an allowlist — no selection, market, analysis,
 *      confirmation or drafts reach a reader who cannot view the category.
 *   6. DB side against a recording fake: assessment reads only the odds cache;
 *      the shadow log writes only one JobRun; a failed log never throws;
 *      curation writes the log in shadow mode and not in current mode.
 *
 * Run: npx tsx scripts/check-paid-value-integration.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)?.slice(0, 400)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), got);
type Any = any;

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } } as unknown as NodeJS.Module;
}
const ops: string[] = [];
let oddsRows: Any[] = [];
let failJobRun = false;
stub("../src/lib/prisma", {
  prisma: new Proxy({}, {
    get: (_t, table: string) => {
      if (table === "fixtureOddsCache") return { findMany: async (a: Any) => { ops.push("fixtureOddsCache.findMany"); return oddsRows.filter((r) => a.where.matchKey.in.includes(r.matchKey)); } };
      if (table === "jobRun") return { create: async (a: Any) => { ops.push(`jobRun.create:${a.data.job}`); if (failJobRun) throw new Error("db down"); return a.data; } };
      return new Proxy({}, { get: (_x, op: string) => async () => { ops.push(`${table}.${op}`); return []; } });
    },
  }),
});

const mode = require("../src/lib/paidSelectionMode");
const { CALIBRATION_ARTIFACT } = require("../src/lib/calibrationArtifact");
const value = require("../src/lib/paidValue");
const curation = require("../src/lib/geniusCuration");
const pipeline = require("../src/lib/vipPremiumPipeline");
const { lockedPredictionView } = require("../src/lib/lockedPrediction");
const { applyCalibration } = require("../src/lib/calibration");

const NOW = new Date("2026-11-14T09:00:00.000Z");
const H = 3_600_000;

async function main() {
  // ── 1. Flags ─────────────────────────────────────────────────────────────
  const active = { ...CALIBRATION_ARTIFACT, active: true };
  eq("flag: default mode is shadow", mode.paidSelectionMode({}), "shadow");
  eq("flag: current and value are honoured; anything else is shadow", [mode.paidSelectionMode({ PAID_SELECTION_MODE: "current" }), mode.paidSelectionMode({ PAID_SELECTION_MODE: "VALUE" }), mode.paidSelectionMode({ PAID_SELECTION_MODE: "live" })], ["current", "value", "shadow"]);
  eq("flag: shadow never changes live decisions", mode.effectivePaidSelection({}), { mode: "shadow", live: "current", fallback: null });
  eq("flag: value with an inactive artifact falls back to #175", mode.effectivePaidSelection({ PAID_SELECTION_MODE: "value" }), { mode: "value", live: "current", fallback: "NO_ACTIVE_CALIBRATION" });
  eq("flag: value with an active artifact goes live", mode.effectivePaidSelection({ PAID_SELECTION_MODE: "value" }, active).live, "value");
  eq("flag: the disable switch removes even an active artifact", mode.effectivePaidSelection({ PAID_SELECTION_MODE: "value", PAID_CALIBRATION_DISABLED: "1" }, active), { mode: "value", live: "current", fallback: "NO_ACTIVE_CALIBRATION" });
  eq("flag: ...and the artifact from shadow logs", mode.calibrationArtifact({ PAID_CALIBRATION_DISABLED: "1" }), null);
  eq("flag: EV bar defaults to 0 and parses a number", [mode.paidValueMinEvLower({}), mode.paidValueMinEvLower({ PAID_VALUE_MIN_EV_LOWER: "-0.02" }), mode.paidValueMinEvLower({ PAID_VALUE_MIN_EV_LOWER: "x" })], [0, -0.02, 0]);

  // ── 2. Artifact ──────────────────────────────────────────────────────────
  check("artifact: committed with a version", /^cal-\d{8}-\d+$/.test(CALIBRATION_ARTIFACT.version), CALIBRATION_ARTIFACT.version);
  check("artifact: inactive, as its held-out evidence requires", CALIBRATION_ARTIFACT.active === false && CALIBRATION_ARTIFACT.evidence.testC3vsRaw.diff > 0);
  eq("artifact: no value strategy was recommended", CALIBRATION_ARTIFACT.evidence.valueRecommended, []);
  const ap = applyCalibration(CALIBRATION_ARTIFACT, { provider: "anthropic", marketType: "DOUBLE_CHANCE", rawConfidence: 72, marketProbability: 78 });
  check("artifact: applies to a real input with a bounded standard error", ap.modelOnly > 0.5 && ap.modelOnly < 0.95 && ap.withMarket! > 0.5 && ap.withMarketSE! > 0 && ap.withMarketSE! < 0.1, ap);
  check("artifact: the market dominates the market-blend fit, as measured", CALIBRATION_ARTIFACT.withMarket.coef[2] > 4 * CALIBRATION_ARTIFACT.withMarket.coef[1]);

  // ── 3. Combining ────────────────────────────────────────────────────────
  const assess = (id: string, o: Any = {}) => ({
    id, fixtureKey: `k${id}`, provider: "gemini", marketType: o.marketType ?? "DOUBLE_CHANCE", leagueApiId: 39, rawConfidence: 78,
    rule: { eligible: o.rule ?? true, tag: o.rule === false ? "MODEL_MARKET_DISAGREE" : "VIP_ROUTE" },
    value: { eligible: o.value ?? true, reasons: o.reasons ?? (o.value === false ? ["EV_NOT_CREDIBLE"] : []), expectedValueLower: o.evl ?? 0.01, expectedValue: 0.02 },
    quoteAgeMinutes: 30,
  });
  const set = [assess("a"), assess("b", { value: false }), assess("c", { rule: false }), assess("d", { evl: 0.05, marketType: "OVER_UNDER" })];
  eq("combine: current admits on the #175 rule only", [...value.combinePaidDecisions(set, "current").verdicts.entries()].filter(([, v]) => v).map(([k]) => k), ["a", "b", "d"]);
  const live = value.combinePaidDecisions(set, "value");
  eq("combine: value admits only rows passing both", [...live.verdicts.entries()].filter(([, v]) => v).map(([k]) => k), ["a", "d"]);
  check("combine: value ranks by lower-bound EV", live.ordering.rank.get("d") > live.ordering.rank.get("a"));
  eq("combine: per-market cap is half the admitted rows, at least 2", live.ordering.perMarketCap, 2);
  const outage = value.combinePaidDecisions([assess("x", { value: false, reasons: ["NO_EXECUTABLE_PRICE"] }), assess("y", { value: false, reasons: ["NO_EXECUTABLE_PRICE", "NO_CALIBRATION"] })], "value");
  check("combine: a pricing outage falls back to #175 and says so", outage.fallback === "NO_PRICING" && outage.verdicts.get("x") === true && !outage.ordering, outage);
  const sum = value.summarisePaidAssessments(set);
  eq("diagnose: dry-day causes are counted", [sum.candidates, sum.ruleEligible, sum.valueEligible, sum.both, sum.ruleOut.MODEL_MARKET_DISAGREE, sum.valueOut.EV_NOT_CREDIBLE], [4, 3, 3, 2, 1, 1]);

  // ── 4. planCuration with value ordering ─────────────────────────────────
  const row = (id: string, o: Any = {}) => ({
    id, leagueApiId: 39, confidence: 78, provenance: "VIP_ROUTE_CONFIRMED", marketType: o.marketType ?? "DOUBLE_CHANCE", createdAt: new Date("2026-11-01T00:00:00Z"),
    kickoff: new Date(NOW.getTime() + 6 * H), fixtureApiId: null, homeTeamApiId: 100 + id.charCodeAt(0), awayTeamApiId: 900 + id.charCodeAt(0), categories: ["FEATURED"], ...o,
  });
  const rows = [row("a"), row("b"), row("c"), row("d", { marketType: "OVER_UNDER" }), row("e", { confidence: 70 })];
  const ok = new Map(rows.map((r) => [r.id, true]));
  const rank = new Map([["a", 0.01], ["b", 0.03], ["c", 0.02], ["d", -0.01], ["e", 0.09]]);
  const plan = curation.planCuration("VIP", rows, new Set(), new Set(), ok, { rank, perMarketCap: 2 });
  eq("order: lower-bound EV first, no more than 2 of one market, the floor still hard", plan.selectedIds, ["b", "c", "d"]);
  const ded = { ...row("z"), provenance: "VIP_GENERATED", categories: ["VIP"] };
  const withDed = curation.planCuration("VIP", [ded, ...rows], new Set(), new Set(), ok, { rank, perMarketCap: 2 });
  check("order: a protected dedicated pick counts toward its market's cap", withDed.selectedIds.includes("z") && withDed.selectedIds.filter((id: string) => id !== "d").length === 2, withDed.selectedIds);
  const dupFixture = curation.planCuration("VIP", [row("a"), { ...row("a"), id: "a2", marketType: "OVER_UNDER" }], new Set(), new Set(), new Map([["a", true], ["a2", true]]), { rank: new Map([["a", 0], ["a2", 0.5]]), perMarketCap: 2 });
  eq("order: one pick per fixture, the better-ranked one", dupFixture.selectedIds, ["a2"]);
  eq("order: without ordering, the plan is the existing one", curation.planCuration("VIP", rows, new Set(), new Set(), ok).selectedIds.sort(), ["a", "b", "c", "d"]);

  // ── 5. Locked API ───────────────────────────────────────────────────────
  const full = {
    id: "p1", category: "VIP", categories: [{ category: "VIP" }], homeTeam: "A", awayTeam: "B", kickoff: NOW, leagueName: "L", status: "PUBLISHED",
    marketType: "DOUBLE_CHANCE", selection: { value: "HOME_OR_DRAW" }, market: "Double Chance", pick: "A or Draw", ouLine: 2.5, ouDirection: "OVER", overUnder: "Over 2.5 Goals",
    analysisJson: { verdict: "A" }, marketConfirmation: { value: "Home/Draw" }, previousDrafts: [{ pick: "A" }], reasoning: "secret", matchPreview: "secret", confidence: 80, settlementNote: "x", aiJobId: "j",
  };
  const locked = lockedPredictionView(full);
  for (const k of ["marketType", "selection", "market", "ouLine", "ouDirection", "overUnder", "analysisJson", "marketConfirmation", "previousDrafts", "settlementNote", "aiJobId"]) {
    check(`locked: ${k} is withheld`, !(k in locked), locked[k]);
  }
  check("locked: pick, reasoning, preview and confidence are masked", locked.pick === "LOCKED" && locked.reasoning !== "secret" && locked.matchPreview === null && locked.confidence === null && locked.locked === true);
  check("locked: the fixture is kept", locked.homeTeam === "A" && locked.awayTeam === "B" && locked.kickoff === NOW && locked.id === "p1");
  check("locked: no field leaks the pick text", !JSON.stringify(locked).includes("Draw") && !JSON.stringify(locked).includes("HOME_OR_DRAW"));
  const route = readFileSync(join(__dirname, "../src/app/api/predictions/route.ts"), "utf8");
  check("locked: the predictions API uses the allowlist", /: lockedPredictionView\(r\)/.test(route) && !/pick: "LOCKED"/.test(route));

  // ── 6. DB side ──────────────────────────────────────────────────────────
  const ko = new Date(NOW.getTime() + 6 * H);
  const day = ko.toISOString().slice(0, 10);
  const q = (home: number, fair: number, ageH = 1) => {
    const m = 1.05, draw = (100 - fair) * 0.6, away = 100 - fair - draw;
    const p = (x: number) => Number((100 / (x * m)).toFixed(2));
    const s = (v: string, price: number) => ({ value: v, best: price, median: price, bookmakers: 8, bestBookmaker: "B" });
    return { matchKey: `${home}-${home + 1}-${day}`, fetchedAt: new Date(NOW.getTime() - ageH * H), oddsJson: { bookmakerCount: 8, update: null, markets: [{ market: "Match Winner", selections: [s("Home", p(fair)), s("Draw", p(draw)), s("Away", p(away))] }] } };
  };
  oddsRows = [q(10, 80), q(20, 80, 9)];
  const cand = (id: string, home: number, o: Any = {}) => ({ id, leagueApiId: 39, confidence: 80, provenance: "VIP_ROUTE_CONFIRMED", marketType: "MATCH_WINNER", selection: { value: "HOME" }, model: "anthropic:claude-haiku-5-5", kickoff: ko, fixtureApiId: null, homeTeamApiId: home, awayTeamApiId: home + 1, ...o });
  ops.length = 0;
  const assessed = await pipeline.assessPaidCandidates([cand("fresh", 10), cand("stale", 20), cand("low", 30, { confidence: 70 })], "VIP", NOW);
  eq("db: assessment reads the odds cache and nothing else", ops, ["fixtureOddsCache.findMany"]);
  eq("db: candidates are rows at the floor only", assessed.map((a: Any) => a.id), ["fresh", "stale"]);
  const fresh = assessed[0], stale = assessed[1];
  check("db: a fresh quote is priced, valued and its age recorded", fresh.value.odds != null && fresh.value.calibrationVersion === CALIBRATION_ARTIFACT.version && fresh.quoteAgeMinutes === 60, fresh);
  check("db: raw confidence is carried unchanged beside the estimate", fresh.rawConfidence === 80 && fresh.value.rawConfidence === 80 && fresh.value.estimatedProbability !== 0.8);
  check("db: a 9-hour-old quote is not read", stale.value.reasons.includes("NO_EXECUTABLE_PRICE") && stale.quoteAgeMinutes === null, stale);
  check("db: the provider is read from the generation's model", fresh.provider === "anthropic");

  ops.length = 0;
  await pipeline.recordPaidSelectionShadow({ category: "VIP", day, effective: { mode: "shadow", live: "current", fallback: null }, assessments: assessed, selectedIds: ["fresh"], plan: { selected: 1 } });
  eq("shadow: writes exactly one JobRun and nothing else", ops, ["jobRun.create:paid-selection-shadow"]);
  failJobRun = true;
  let threw = false;
  try { await pipeline.recordPaidSelectionShadow({ category: "VIP", day, effective: { mode: "shadow", live: "current", fallback: null }, assessments: assessed, selectedIds: [], plan: {} }); } catch { threw = true; }
  check("shadow: a failed log write never throws into curation", !threw);
  failJobRun = false;

  // A broken artifact must not break curation: the decision falls back to #175.
  const poisoned = { ...CALIBRATION_ARTIFACT, modelOnly: null };
  const safe = await pipeline.loadPaidCurationDecision([cand("fresh", 10)], "VIP", NOW, poisoned);
  check("fallback: an assessment failure falls back to the #175 verdicts, labelled", safe.effective.fallback === "ASSESSMENT_FAILED" && safe.effective.live === "current" && safe.verdicts.get("fresh") === true && safe.assessments.length === 0, safe.effective);
  const healthy = await pipeline.loadPaidCurationDecision([cand("fresh", 10)], "VIP", NOW);
  check("fallback: ...and a healthy run is shadow with assessments", healthy.effective.mode === "shadow" && healthy.effective.fallback === null && healthy.assessments.length === 1, healthy.effective);
  const pipeSrc = readFileSync(join(__dirname, "../src/lib/vipPremiumPipeline.ts"), "utf8");
  check("fallback: an assessment failure falls back to the #175 rule and is labelled", /fallback: "ASSESSMENT_FAILED"/.test(pipeSrc) && /assessPaidCandidates\(rows, tier, now, null\), "current"\)/.test(pipeSrc));
  const brokenAssess = await pipeline.assessPaidCandidates([cand("fresh", 10)], "VIP", NOW, { ...CALIBRATION_ARTIFACT, modelOnly: null }).then(() => "no-throw", () => "threw");
  eq("fallback: a poisoned artifact does make assessment throw (so the guard is load-bearing)", brokenAssess, "threw");

  const src = readFileSync(join(__dirname, "../src/lib/geniusCuration.ts"), "utf8");
  check("wiring: curation takes verdicts and ordering from the decision", /planCuration\(category, rows, paidClaimed, awaiting, decision\?\.verdicts, decision\?\.ordering\)/.test(src));
  check("wiring: the shadow log is written only when the mode is not current", /decision\.effective\.mode !== "current"/.test(src));
  const pipe = readFileSync(join(__dirname, "../src/lib/vipPremiumPipeline.ts"), "utf8");
  check("wiring: current mode assesses with no artifact (exactly #175)", /effective\.mode === "current"[\s\S]{0,200}assessPaidCandidates\(rows, tier, now, null\)/.test(pipe));
  check("wiring: dedicated picks freeze a value record at promotion", /\.\.\.entryValueRecord\(winner\.row, odds\)/.test(pipe));
  check("wiring: the primary provider chain is untouched", /const PROVIDER_CHAIN: AIProvider\[\] = \[makeAnthropicProvider\(\{ effort: "high" \}\), geminiProvider, groqProvider\];/.test(readFileSync(join(__dirname, "../src/lib/ai/analysis.ts"), "utf8")));

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("Paid value integration checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
