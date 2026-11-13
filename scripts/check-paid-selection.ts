/**
 * Paid selection quality rules, proved without a database or network.
 *
 *   1. Pricing and value (pickPrice, expectedValue): the median, not the best;
 *      de-vigged fair probability; draw no bet derived from the 1X2; no price
 *      for a selection the books do not quote.
 *   2. Odds freshness at curation (usableCurationQuote): pre-kickoff only, and
 *      no older than six hours.
 *   3. Market agreement (assessPaidCuration): every branch, and its constants
 *      pinned to the market-confirmation gate's.
 *   4. Thin-day widening (paidCurationWidened).
 *   5. Curation with verdicts (planCuration): admission only — a row already in
 *      the feed never drops out on a price move; hard floors; one pick per
 *      fixture; dedicated picks first; no verdicts = exactly the old plan.
 *   6. The DB-side loader against a recording fake: reads the odds cache only,
 *      ignores a post-kickoff or stale quote.
 *   7. Paid-route provider switch: off by default.
 *   8. Settlement of the paid markets, paid-tier access, dry-day copy.
 *   9. Backtest integrity: the audit and backtest never read a post-kickoff
 *      quote, never write, and refuse a session that is not read-only.
 *
 * Run: npx tsx scripts/check-paid-selection.ts
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
const near = (label: string, got: number | null | undefined, want: number, tol = 0.05) => check(label, got != null && Math.abs(got - want) <= tol, got);

type Any = any;
function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } } as unknown as NodeJS.Module;
}

// A recording fake: the only table the loader may read is the odds cache.
const reads: string[] = [];
let oddsRows: Any[] = [];
const refuse = (what: string) => async () => { throw new Error(`unexpected write: ${what}`); };
stub("../src/lib/prisma", {
  prisma: new Proxy({}, {
    get: (_t, table: string) => table === "fixtureOddsCache"
      ? { findMany: async (args: Any) => { reads.push(`fixtureOddsCache:${args.where.matchKey.in.join(",")}`); return oddsRows.filter((r) => args.where.matchKey.in.includes(r.matchKey)); } }
      : new Proxy({}, { get: (_x, op: string) => (["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(op) ? refuse(`${table}.${op}`) : async () => { reads.push(`${table}.${op}`); return []; }) }),
  }),
});

const sel = require("../src/lib/paidSelection");
const overlay = require("../src/lib/vipPremiumOverlay");
const curation = require("../src/lib/geniusCuration");
const mc = require("../src/lib/marketConfirmed");
const pipeline = require("../src/lib/vipPremiumPipeline");
const analysis = require("../src/lib/ai/analysis");
const { resolveMarket } = require("../src/lib/markets");
const { canViewCategory } = require("../src/lib/access");
const { emptyFeedMessage } = require("../src/components/CategoryPredictionsList");

const H = 3_600_000;
const NOW = new Date("2026-11-13T09:00:00.000Z");

/** A full quote: 1X2 with a 5% margin, double chance, Over/Under 2.5 and BTTS. */
function quote(home: number, opts: { books?: number; over25?: number } = {}) {
  const books = opts.books ?? 8, m = 1.05;
  const draw = (100 - home) * 0.55, away = 100 - home - draw;
  const p = (pct: number) => Number((100 / (pct * m)).toFixed(3));
  const s = (value: string, price: number, best = price) => ({ value, best, median: price, bookmakers: books, bestBookmaker: "B" });
  const over = opts.over25 ?? 55;
  return {
    bookmakerCount: books, update: null,
    markets: [
      { market: "Match Winner", selections: [s("Home", p(home), p(home) + 0.1), s("Draw", p(draw)), s("Away", p(away))] },
      { market: "Double Chance", selections: [s("Home/Draw", p(home + draw)), s("Draw/Away", p(draw + away)), s("Home/Away", p(home + away))] },
      { market: "Goals Over/Under", selections: [s("Over 2.5", p(over)), s("Under 2.5", p(100 - over))] },
      { market: "Both Teams Score", selections: [s("Yes", p(50)), s("No", p(50))] },
    ],
  };
}

async function main() {
  // ── 1. Pricing and value ───────────────────────────────────────────────
  {
    const q = quote(70);
    const mw = sel.pickPrice(q, "MATCH_WINNER", { value: "HOME" });
    near("price: the median price is used, never the best", mw?.median, 1.361, 0.002);
    check("price: ...and the best is kept beside it", mw?.best > mw?.median, mw);
    near("price: fair probability is de-vigged (70%, not 1/price = 73.5%)", mw?.fair, 70, 0.1);
    near("price: double chance fair probability comes from the 1X2", sel.pickPrice(q, "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" })?.fair, 86.5, 0.1);
    near("price: over/under pairs on the same line", sel.pickPrice(quote(50, { over25: 60 }), "OVER_UNDER", { line: 2.5, direction: "OVER" })?.fair, 60, 0.1);
    const dnb = sel.pickPrice(q, "DRAW_NO_BET", { value: "HOME" });
    near("price: draw no bet's fair chance is the side's share of the non-draw outcomes", dnb?.fair, (70 / (70 + 13.5)) * 100, 0.1);
    check("price: ...its price is derived and marked so", dnb?.derived === true && dnb.median > 1, dnb);
    eq("price: a line the books do not quote has no price", sel.pickPrice(q, "OVER_UNDER", { line: 3.5, direction: "OVER" }), null);
    eq("price: a market with no bookmaker equivalent has no price", sel.pickPrice(q, "CORRECT_SCORE", { home: 1, away: 0 }), null);
    eq("price: no quote, no price", sel.pickPrice(null, "MATCH_WINNER", { value: "HOME" }), null);
    near("value: EV of a fair 50% chance at 2.00 is zero", sel.expectedValue(50, 2), 0, 1e-9);
    near("value: EV of 80% at 1.20 is -4%", sel.expectedValue(80, 1.2), -0.04, 1e-9);
  }

  // ── 2. Odds freshness at curation ──────────────────────────────────────
  {
    const kickoff = new Date(NOW.getTime() + 8 * H);
    check("fresh: a quote two hours old before kickoff is usable", sel.usableCurationQuote(new Date(NOW.getTime() - 2 * H), kickoff, NOW));
    check("fresh: one seven hours old is not", !sel.usableCurationQuote(new Date(NOW.getTime() - 7 * H), kickoff, NOW));
    check("fresh: one taken after kickoff never is", !sel.usableCurationQuote(new Date(NOW.getTime() - 1 * H), new Date(NOW.getTime() - 2 * H), NOW));
    check("fresh: no timestamp, no quote", !sel.usableCurationQuote(null, kickoff, NOW));
    eq("fresh: the window is six hours", sel.PAID_CURATION_QUOTE_MAX_AGE_MS, 6 * H);
  }

  // ── 3. Market agreement ────────────────────────────────────────────────
  {
    eq("agree: the gap and books are the market-confirmation gate's own", [sel.PAID_CURATION_MAX_GAP_PP, sel.PAID_CURATION_MIN_BOOKMAKERS], [mc.MC_MAX_GAP_PP, mc.MC_MIN_BOOKMAKERS]);
    const base = { marketFloor: 75, maxMarketProbability: overlay.PAID_MAX_MARKET_PROBABILITY };
    const price = (fair: number, bookmakers = 8) => ({ median: 100 / fair / 1.05, best: 100 / fair, bookmakers, fair, derived: false });
    const v = (o: Any) => sel.assessPaidCuration({ ...base, widenedScope: false, vipRoute: true, price: null, confidence: 77, ...o });
    eq("agree: a VIP-route pick with no usable quote is eligible, as before", v({}), { eligible: true, basis: "VIP_ROUTE_UNPRICED", gapPP: null });
    eq("agree: ...one the market backs within 10pp is eligible", v({ price: price(70) }).eligible, true);
    eq("agree: ...one the market puts 12pp below the model is not", v({ price: price(65) }), { eligible: false, reason: "MODEL_MARKET_DISAGREE", gapPP: 12 });
    eq("agree: ...exactly 10pp apart is still eligible", v({ price: price(67) }).eligible, true);
    eq("agree: a quote from too few books is read as unpriced, not as disagreement", v({ price: price(50, 3) }).eligible, true);
    eq("agree: a non-VIP-route pick on a normal day is not eligible", v({ vipRoute: false }), { eligible: false, reason: "NOT_VIP_ROUTE", gapPP: null });
    const w = (o: Any) => v({ vipRoute: false, widenedScope: true, ...o });
    eq("widen: a thin-day pick the market confirms at 75–87% is eligible", w({ price: price(80) }), { eligible: true, basis: "WIDENED_MARKET_CONFIRMED", gapPP: 3 });
    eq("widen: ...unpriced is not", w({}).eligible, false);
    eq("widen: ...thin books are not", w({ price: price(80, 4) }), { eligible: false, reason: "WIDENED_THIN_BOOK", gapPP: null });
    eq("widen: ...a market under the tier's bar is not", w({ price: price(72) }).eligible === false && w({ price: price(72) }).reason, "WIDENED_MARKET_BELOW_BAR");
    eq("widen: ...a near-formality (market over ~87%) is not", w({ price: price(90), confidence: 85 }).reason, "WIDENED_TOO_SHORT");
    eq("widen: ...the PREMIUM bar is 80", w({ price: price(78), marketFloor: 80 }).reason, "WIDENED_MARKET_BELOW_BAR");
  }

  // ── 4. Thin days ───────────────────────────────────────────────────────
  {
    const row = (n: number, league: number) => ({ id: `r${n}`, leagueApiId: league, homeTeamApiId: 100 + n, awayTeamApiId: 200 + n, kickoff: NOW });
    eq("thin: fewer than three core fixtures widens", overlay.paidCurationWidened([row(1, 39), row(2, 39), row(3, 36), row(4, 5)]), true);
    eq("thin: three core fixtures does not", overlay.paidCurationWidened([row(1, 39), row(2, 140), row(3, 2)]), false);
    eq("thin: two rows on ONE core fixture count once", overlay.paidCurationWidened([row(1, 39), { ...row(1, 39), id: "dup" }, row(2, 140)]), true);
    eq("thin: the bar is the overlay's own", overlay.PAID_THIN_CORE_MIN, 3);
  }

  // ── 5. Curation with verdicts ──────────────────────────────────────────
  {
    const r = (id: string, o: Any = {}) => ({
      id, leagueApiId: 39, confidence: 78, provenance: "VIP_ROUTE_CONFIRMED", marketType: "MATCH_WINNER", createdAt: new Date("2026-11-01T00:00:00Z"),
      kickoff: new Date(NOW.getTime() + 6 * H), fixtureApiId: null, homeTeamApiId: 100 + id.length * 7 + id.charCodeAt(0), awayTeamApiId: 900 + id.charCodeAt(id.length - 1), categories: ["FEATURED"], ...o,
    });
    const rows = [
      r("a"),
      r("b"), // VIP route, market disagrees
      r("c", { provenance: "STANDARD_CURATED", leagueApiId: 5 }), // widened, market confirms
      r("d", { provenance: "STANDARD_CURATED", leagueApiId: 5, confidence: 72 }), // under the floor
      r("e", { categories: ["FEATURED", "VIP"] }), // already in the feed, market now disagrees
    ];
    const verdicts = new Map([["a", true], ["b", false], ["c", true], ["d", true], ["e", false]]);
    const plan = curation.planCuration("VIP", rows, new Set(), new Set(), verdicts);
    eq("curate: a confirmed VIP-route pick and a confirmed thin-day pick are admitted", [...plan.added].sort(), ["a", "c"]);
    check("curate: a VIP-route pick the market disagrees with is not admitted", !plan.selectedIds.includes("b"), plan);
    check("curate: the confidence floor stays hard whatever the market says", !plan.selectedIds.includes("d"), plan);
    check("curate: a pick already in the feed is kept when its market moves (admission only)", plan.selectedIds.includes("e") && !plan.removed.includes("e"), plan);
    eq("curate: diagnostics count the market exclusion and the thin-day admission", [plan.marketDisagreeExcluded, plan.widenedAdmitted], [1, 1]);
    const old = curation.planCuration("VIP", rows, new Set(), new Set());
    eq("curate: with no verdicts the plan is exactly the old route rule", [...old.selectedIds].sort(), ["a", "b", "e"]);

    const sameFixture = [r("x"), { ...r("x"), id: "y", provenance: "STANDARD_CURATED", leagueApiId: 5 }];
    const dup = curation.planCuration("VIP", sameFixture, new Set(), new Set(), new Map([["x", true], ["y", true]]));
    eq("curate: one paid pick per fixture still holds", dup.selectedIds.length, 1);
    const ded = { ...r("z"), provenance: "VIP_GENERATED", categories: ["VIP"] };
    const withDed = curation.planCuration("VIP", [ded, { ...r("z"), id: "z2" }], new Set(), new Set(), new Map([["z2", true]]));
    eq("curate: a dedicated pick keeps its fixture; the ordinary pick does not join it", withDed.selectedIds, ["z"]);
    const prem = curation.planCuration("PREMIUM", [r("p", { confidence: 79 })], new Set(), new Set(), new Map([["p", true]]));
    eq("curate: PREMIUM's 80 floor is not bypassed by a verdict", prem.selectedIds, []);
    const dbl = curation.planCuration("VIP", [r("s", { marketType: "SAME_GAME_DOUBLE" })], new Set(), new Set(), new Map([["s", true]]));
    eq("curate: a double is never a paid pick", dbl.selectedIds, []);
  }

  // ── 6. The DB-side loader ──────────────────────────────────────────────
  {
    const kickoff = new Date(NOW.getTime() + 6 * H);
    const row = (id: string, home: number, o: Any = {}) => ({ id, leagueApiId: 39, confidence: 78, provenance: "VIP_ROUTE_CONFIRMED", marketType: "MATCH_WINNER", selection: { value: "HOME" }, kickoff, fixtureApiId: null, homeTeamApiId: home, awayTeamApiId: home + 1, ...o });
    const day = kickoff.toISOString().slice(0, 10);
    oddsRows = [
      { matchKey: `10-11-${day}`, oddsJson: quote(60), fetchedAt: new Date(NOW.getTime() - H) }, // disagrees by 18pp
      { matchKey: `20-21-${day}`, oddsJson: quote(60), fetchedAt: new Date(NOW.getTime() - 9 * H) }, // stale: read as unpriced
      { matchKey: `30-31-${day}`, oddsJson: quote(76), fetchedAt: new Date(NOW.getTime() - H) }, // agrees
    ];
    reads.length = 0;
    const v = await pipeline.loadPaidCurationVerdicts([row("q1", 10), row("q2", 20), row("q3", 30), row("low", 40, { confidence: 70 }), row("ded", 50, { provenance: "VIP_GENERATED" })], "VIP", NOW);
    eq("loader: verdicts for ordinary rows at the floor only", [...v.entries()].sort(), [["q1", false], ["q2", true], ["q3", true]]);
    check("loader: reads the odds cache and nothing else", reads.length === 1 && reads[0].startsWith("fixtureOddsCache:"), reads);
    eq("loader: no candidates, no read", (reads.length = 0, (await pipeline.loadPaidCurationVerdicts([row("low", 40, { confidence: 60 })], "VIP", NOW)).size + reads.length), 0);
    const src = readFileSync(join(__dirname, "../src/lib/geniusCuration.ts"), "utf8");
    check("wiring: paid curation loads its decision and passes the verdicts to planCuration", /loadPaidCurationDecision\(rows/.test(src) && /planCuration\(category, rows, paidClaimed, awaiting, decision\?\.verdicts, decision\?\.ordering\)/.test(src));
    check("wiring: Genius curation does not", /const pipeline = CURATION_RULES\[category\]\.paid \? await import\("@\/lib\/vipPremiumPipeline"\) : null;/.test(src));
  }

  // ── 7. Paid-route provider switch ──────────────────────────────────────
  {
    const names = (chain: Any[]) => chain.map((p) => p.name);
    eq("provider: unset, paid generation uses the normal chain", names(analysis.paidRouteProviderChain(undefined)), ["anthropic", "gemini", "groq"]);
    eq("provider: PAID_ROUTE_PRIMARY_PROVIDER=gemini leads with Gemini, the rest follow", names(analysis.paidRouteProviderChain("gemini")), ["gemini", "anthropic", "groq"]);
    eq("provider: an unknown name changes nothing", names(analysis.paidRouteProviderChain("nope")), ["anthropic", "gemini", "groq"]);
    const gen = readFileSync(join(__dirname, "../src/lib/ai/generate.ts"), "utf8");
    check("provider: only the VIP route and the paid pass are marked paidRoute", /riskRoute\.calibration === "vip" \|\| input\.intent === "VIP_PREMIUM" \? \{ paidRoute: true \}/.test(gen));
  }

  // ── 8. Settlement, access, dry-day copy ────────────────────────────────
  {
    eq("settle: draw no bet on a draw is void", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 1, 1), "VOID");
    eq("settle: draw no bet on a home win is won", resolveMarket("DRAW_NO_BET", { value: "HOME" }, 2, 1), "WON");
    eq("settle: home-or-draw on a draw is won", resolveMarket("DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, 0, 0), "WON");
    eq("settle: over 1.5 on 1-0 is lost", resolveMarket("OVER_UNDER", { line: 1.5, direction: "OVER" }, 1, 0), "LOST");
    eq("settle: under 3.5 on 2-1 is won", resolveMarket("OVER_UNDER", { line: 3.5, direction: "UNDER" }, 2, 1), "WON");
    eq("settle: other markets never auto-settle", resolveMarket("OTHER", null, 1, 0), null);
    check("access: a free reader cannot view VIP or PREMIUM", !canViewCategory("VIP", "FREE", "ACTIVE") && !canViewCategory("PREMIUM", "FREE", "ACTIVE"));
    check("access: an active VIP subscriber views VIP, not PREMIUM", canViewCategory("VIP", "VIP", "ACTIVE") && !canViewCategory("PREMIUM", "VIP", "ACTIVE"));
    check("access: an expired subscription views neither", !canViewCategory("VIP", "VIP", "EXPIRED") && !canViewCategory("PREMIUM", "PREMIUM", "EXPIRED"));
    const msg = emptyFeedMessage("VIP");
    check("dry day: the empty VIP feed says why a day can be quiet", /only when our match analysis and the bookmakers' prices both clear the VIP bar/.test(msg) && /international breaks/.test(msg), msg);
    check("dry day: ...without the word AI", !/\bAI\b|artificial intelligence/i.test(msg + emptyFeedMessage("PREMIUM")));
    check("dry day: ...and never promises a pick", !/\bguarantee|\bwill (?:be|have)\b/i.test(msg), msg);
  }

  // ── 9. Backtest integrity ──────────────────────────────────────────────
  for (const f of ["measure-paid-performance.ts", "backtest-paid-selection.ts"]) {
    const src = readFileSync(join(__dirname, f), "utf8");
    check(`${f}: refuses a session that is not read-only`, /REQUIRE_READ_ONLY/.test(src) && /transaction_read_only/.test(src));
    check(`${f}: prices only from a quote taken before kickoff`, /fetchedAt\.getTime\(\) < r\.kickoff!?\.getTime\(\)/.test(src));
    check(`${f}: writes nothing`, !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(src.replace(/new Date\(/g, "")));
    check(`${f}: prices at the median, not the best`, /price!?\.median/.test(src) && !/price!?\.best - 1/.test(src));
  }
  const bt = readFileSync(join(__dirname, "backtest-paid-selection.ts"), "utf8");
  check("backtest: splits chronologically and reads the verdict off the later third", /Math\.floor\(\(dayKeys\.length \* 2\) \/ 3\)/.test(bt) && /OUT-OF-SAMPLE/.test(bt));
  check("backtest: uses the production rule, not a copy", /from "\.\.\/src\/lib\/paidSelection"/.test(bt) && /assessPaidCuration\(/.test(bt));

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("Paid selection checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
