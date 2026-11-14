/**
 * VIP/Premium Sprint 10 checks: the pre-registered alternative-market
 * experiment, the Double Chance label fix, and the guarantees that the
 * experimental path cannot publish, write, or spend provider calls without an
 * explicit invocation. Synthetic data only: no database, no network.
 *
 * Run: npx tsx scripts/check-alt-market-research.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CAPS, BAND, TARGET_SELECTIONS, ALLOCATION, DECISION, correctedFavouriteSignal, costOf, eligibility, goalsBandSignal, mayCall,
  researchDecision, sampleCandidates, sampleKey, type CandidateFixture, type EligibilityFacts,
} from "../src/lib/altMarketResearch";
import { devigProbability, lopsidednessSignal, MC_MIN_BOOKMAKERS } from "../src/lib/marketConfirmed";
import { PAID_MAX_MARKET_PROBABILITY } from "../src/lib/vipPremiumOverlay";
import { DEFAULT_MAX_RETRIES } from "../src/lib/ai/providers/anthropic";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : ` — got ${JSON.stringify(got)?.slice(0, 300)}`}`);
};
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// A quote in api-football's shape. Probabilities are de-vigged by the code under test.
function quote(o: { home: number; draw: number; away: number; over15?: number; over25?: number; books?: number; dcAwayLabel?: string }) {
  const b = o.books ?? 6;
  const price = (p: number) => Number((1 / (p * 1.05)).toFixed(3));
  const sel = (value: string, p: number) => ({ value, best: price(p), median: price(p), bookmakers: b });
  const markets: any[] = [
    { market: "Match Winner", selections: [sel("Home", o.home), sel("Draw", o.draw), sel("Away", o.away)] },
    { market: "Double Chance", selections: [sel("Home/Draw", o.home + o.draw), sel(o.dcAwayLabel ?? "Draw/Away", o.draw + o.away), sel("Home/Away", o.home + o.away)] },
  ];
  const ou: any[] = [];
  if (o.over15 != null) ou.push(sel("Over 1.5", o.over15), sel("Under 1.5", 1 - o.over15));
  if (o.over25 != null) ou.push(sel("Over 2.5", o.over25), sel("Under 2.5", 1 - o.over25));
  if (ou.length) markets.push({ market: "Goals Over/Under", selections: ou });
  return { bookmakerCount: b, update: new Date().toISOString(), markets } as any;
}

// ── 1. Spec constants ─────────────────────────────────────────────────────
check("1 caps are the authorised ceilings", CAPS.MAX_EVALUATIONS === 30 && CAPS.MAX_MODEL_REQUESTS === 30 && CAPS.MAX_API_FOOTBALL_REQUESTS === 40 && CAPS.MAX_COST_USD === 0.3);
check("1 paid band equals the gate's (75% .. fair 1.15)", BAND.MIN === 75 && Math.abs(BAND.MAX - PAID_MAX_MARKET_PROBABILITY) < 1e-9);
check("1 targeting selections are Over 1.5 and Over 2.5 only", TARGET_SELECTIONS.map((s) => s.value).join() === "Over 1.5,Over 2.5");
check("1 allocation: core <= 20, secondary <= 10, dry day <= 2 paid", ALLOCATION.CORE_MAX === 20 && ALLOCATION.SECONDARY_MAX === 10 && ALLOCATION.DRY_DAY_MAX_PAID === 2);

// ── 2. Double Chance label fix (production) ───────────────────────────────
{
  const awayFav = quote({ home: 0.18, draw: 0.24, away: 0.58 }); // away DC = 82%, away win 58%
  check("2 devigProbability reads 'Away/Draw' against the feed's 'Draw/Away'", (devigProbability(awayFav, "Double Chance", "Away/Draw")?.probability ?? 0) > 80);
  check("2 and 'Draw/Away' still reads", (devigProbability(awayFav, "Double Chance", "Draw/Away")?.probability ?? 0) > 80);
  const sig = lopsidednessSignal(awayFav);
  check("2 targeting now sees an away favourite through its double chance", !!sig && sig.probability > 80 && sig.value === "Away/Draw", sig);
  const homeFav = quote({ home: 0.58, draw: 0.24, away: 0.18 });
  check("2 home side unchanged", lopsidednessSignal(homeFav)?.value === "Home/Draw");
  check("2 an 'Away/Draw'-labelled feed still reads", (devigProbability(quote({ home: 0.18, draw: 0.24, away: 0.58, dcAwayLabel: "Away/Draw" }), "Double Chance", "Away/Draw")?.probability ?? 0) > 80);
  check("2 'Home/Away' is not confused with 'Home/Draw'", Math.abs((devigProbability(homeFav, "Double Chance", "Home/Away")?.probability ?? 0) - 76) < 1);
  check("2 the research signal agrees with the fixed production signal", Math.abs((correctedFavouriteSignal(awayFav)?.probability ?? 0) - (sig?.probability ?? -1)) < 1e-9);
}

// ── 3. Goals-band signal ──────────────────────────────────────────────────
{
  check("3 Over 1.5 at 80% is in band", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over15: 0.8 }))?.value === "Over 1.5");
  check("3 below 75% is not", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over15: 0.72 })) === null);
  check("3 above the fair-1.15 cap is not", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over15: 0.9 })) === null);
  check("3 thin books are not", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over15: 0.8, books: MC_MIN_BOOKMAKERS - 1 })) === null);
  check("3 the stronger of Over 1.5 / Over 2.5 in band wins", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over15: 0.84, over25: 0.76 }))?.value === "Over 1.5");
  check("3 Under lines never select a fixture", goalsBandSignal(quote({ home: 0.4, draw: 0.3, away: 0.3, over25: 0.2 })) === null);
}

// ── 4. Eligibility ────────────────────────────────────────────────────────
{
  const goals = { market: "Goals Over/Under", value: "Over 1.5", probability: 80, bookmakers: 6 };
  const base: EligibilityFacts = { ledgerSucceeded: true, hasOrdinaryRowWithContext: true, alreadyAttempted: false, hasDedicatedPaid: false, group: "CORE", hoursToKickoff: 18, quoteAgeMs: 30 * 60_000, favouriteSignal: 70, goals };
  const why = (o: Partial<EligibilityFacts>) => { const e = eligibility({ ...base, ...o }); return e.eligible ? "ELIGIBLE" : e.reason; };
  check("4 eligible", why({}) === "ELIGIBLE");
  check("4 not covered", why({ ledgerSucceeded: false }) === "NOT_COVERED");
  check("4 no context", why({ hasOrdinaryRowWithContext: false }) === "NO_CONTEXT");
  check("4 outside paid scope", why({ group: null }) === "OUT_OF_PAID_SCOPE");
  check("4 already attempted by the pass", why({ alreadyAttempted: true }) === "ALREADY_ATTEMPTED");
  check("4 already a dedicated pick", why({ hasDedicatedPaid: true }) === "HAS_DEDICATED_PAID");
  check("4 window 12-24h", why({ hoursToKickoff: 11.9 }) === "OUTSIDE_WINDOW" && why({ hoursToKickoff: 24.1 }) === "OUTSIDE_WINDOW");
  check("4 stale quote", why({ quoteAgeMs: 2 * 3_600_000 + 1 }) === "NO_FRESH_QUOTE" && why({ quoteAgeMs: null }) === "NO_FRESH_QUOTE");
  check("4 favourite-targeted fixtures are Path A's, not B's", why({ favouriteSignal: 75 }) === "FAVOURITE_TARGETED");
  check("4 no goals selection in band", why({ goals: null }) === "NO_GOALS_IN_BAND");
}

// ── 5. Sampling ───────────────────────────────────────────────────────────
{
  const mk = (id: number, group: "CORE" | "SECONDARY", dryDay = false): CandidateFixture => ({ fixtureApiId: id, matchKey: `k${id}`, leagueApiId: 1, kickoff: new Date(), group, dryDay });
  const pool = [...Array.from({ length: 30 }, (_, i) => mk(1000 + i, "CORE")), ...Array.from({ length: 20 }, (_, i) => mk(2000 + i, "SECONDARY")), mk(3000, "SECONDARY", true)];
  const a = sampleCandidates(pool, { evaluationsLeft: 30, coreUsed: 0, secondaryUsed: 0 });
  const b = sampleCandidates([...pool].reverse(), { evaluationsLeft: 30, coreUsed: 0, secondaryUsed: 0 });
  check("5 deterministic regardless of input order", JSON.stringify(a.map((x) => x.fixtureApiId)) === JSON.stringify(b.map((x) => x.fixtureApiId)));
  check("5 dry-day fixtures first", a[0].fixtureApiId === 3000);
  check("5 core <= 20 and secondary <= 10", a.filter((x) => x.group === "CORE").length === 20 && a.filter((x) => x.group === "SECONDARY").length === 10);
  check("5 cumulative allocation respected", sampleCandidates(pool, { evaluationsLeft: 30, coreUsed: 19, secondaryUsed: 10 }).length === 1);
  check("5 evaluations left bound the sample", sampleCandidates(pool, { evaluationsLeft: 3, coreUsed: 0, secondaryUsed: 0 }).length === 3);
  check("5 order is a salted hash of the fixture id (result-blind)", sampleKey(1) !== sampleKey(2) && sampleKey(1) === sampleKey(1) && sampleKey(1).length === 64);
  const withOutcome = pool.map((p) => ({ ...p, result: "WON" })) as unknown as CandidateFixture[];
  check("5 extra fields (e.g. a result) cannot change the sample", JSON.stringify(sampleCandidates(withOutcome, { evaluationsLeft: 30, coreUsed: 0, secondaryUsed: 0 }).map((x) => x.fixtureApiId)) === JSON.stringify(a.map((x) => x.fixtureApiId)));
}

// ── 6. Caps and cost ──────────────────────────────────────────────────────
{
  const L = { evaluations: 0, modelRequests: 0, apiFootballRequests: 0, costUsd: 0, coreUsed: 0, secondaryUsed: 0 };
  check("6 a fresh ledger may call", mayCall(L).ok);
  check("6 refuses at 30 evaluations", !mayCall({ ...L, evaluations: 30 }).ok);
  check("6 refuses at 30 model requests", !mayCall({ ...L, modelRequests: 30 }).ok);
  check("6 refuses when the next worst case could breach the cost ceiling", !mayCall({ ...L, costUsd: CAPS.MAX_COST_USD - CAPS.WORST_CASE_COST_PER_REQUEST_USD + 0.0001 }).ok && mayCall({ ...L, costUsd: CAPS.MAX_COST_USD - CAPS.WORST_CASE_COST_PER_REQUEST_USD - 0.0001 }).ok);
  check("6 refuses beyond the api-football ceiling", !mayCall({ ...L, apiFootballRequests: 41 }).ok);
  check("6 haiku cost: 10k in + 2k out = $0.002", Math.abs(costOf("claude-haiku-5-5", { promptTokens: 10_000, outputTokens: 2_000 }) - 0.002) < 1e-9);
  check("6 unknown model is charged the worst case", costOf("other", { promptTokens: 1, outputTokens: 1 }) === CAPS.WORST_CASE_COST_PER_REQUEST_USD);
  check("6 30 worst-case requests ($0.01 each) fit exactly inside the $0.30 ceiling", Math.abs(CAPS.WORST_CASE_COST_PER_REQUEST_USD - 0.01) < 1e-9 && CAPS.WORST_CASE_COST_PER_REQUEST_USD * 30 <= CAPS.MAX_COST_USD + 1e-9);
}

// ── 7. Decision rule ──────────────────────────────────────────────────────
check("7 <= 1 incremental is NO-GO", researchDecision(30, 1, 0.5) === "NO_GO" && researchDecision(30, 0, null) === "NO_GO");
check("7 >= 5 incremental with Wilson lower >= 10% is GO (larger shadow)", researchDecision(30, 5, 0.1) === "GO_LARGER_SHADOW");
check("7 >= 5 but weak lower bound is inconclusive", researchDecision(30, 6, 0.05) === "INCONCLUSIVE");
check("7 2-4 incremental is inconclusive", researchDecision(30, 3, 0.2) === "INCONCLUSIVE" && DECISION.GO_MIN_INCREMENTAL === 5);

// ── 8. Isolation, explicit invocation, no publication ─────────────────────
{
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
  walk(join(__dirname, "../src"));
  const importers = files.filter((f) => !f.endsWith("altMarketResearch.ts") && /altMarketResearch/.test(readFileSync(f, "utf8")));
  check("8 no production file imports the research module", importers.length === 0, importers);
  const runner = src("scripts/run-alt-market-experiment.ts");
  check("8 runner refuses without the explicit confirmation string", /ALT_MARKET_CONFIRM !== "RUN-ALT-MARKET-S10"[\s\S]*refusing/.test(runner));
  check("8 runner refuses a writable session", /REQUIRE_READ_ONLY !== "1"[\s\S]*transaction_read_only[\s\S]*refusing: session is not read-only/.test(runner));
  check("8 runner never persists or publishes", !/generateAndPersistPrediction|publishPaidPredictionAtomically|applyReviewAction|setPredictionCategories|prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(runner));
  check("8 runner imports no api-football client or cache writer", !/football\/api-football|refreshOddsCache|enrichment"|refreshTeamCache|refreshLeagueCache|refreshH2HCache/.test(runner));
  check("8 context is cache-only", /buildGenerationDigest\(\{[\s\S]*cacheOnly: true/.test(runner) && /sources\.apiCalls !== 0[\s\S]*throw/.test(runner));
  check("8 one provider, no fallback, no SDK retry", /makeAnthropicProvider\(\{ effort: "high", maxRetries: 0 \}\)/.test(runner) && /completeWithFallback\(request, parsePredictionOutput, \[primary\]\)/.test(runner));
  check("8 the cap is checked before every call", /const gate = mayCall\(ledger\);[\s\S]*if \(!gate\.ok\)/.test(runner) && /countTokens[\s\S]*MAX_COST_USD[\s\S]*break/.test(runner));
  check("8 credential verified before any billed request", runner.indexOf("models.retrieve") > 0 && runner.indexOf("models.retrieve") < runner.indexOf("completeWithFallback("));
  check("8 caps are cumulative across invocations (committed observations)", /priorObservations\(\)/.test(runner) && /evaluations: prior\.length/.test(runner));
  for (const f of ["scripts/settle-alt-market-experiment.ts", "scripts/measure-alt-market-baseline.ts"]) {
    const s = src(f);
    check(`8 ${f} is read-only`, /transaction_read_only/.test(s) && !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(s));
  }
  const wf = src(".github/workflows/alt-market-research.yml");
  check("8 workflow has no schedule or pull_request trigger", !/^\s*schedule:/m.test(wf) && !/^\s*pull_request/m.test(wf));
  check("8 push trigger limited to the Sprint 10 branch and the request file", /push:\s*\n\s*branches: \["ccr-0ae2ea72-2ta0dr-sprint10"\]\s*\n\s*paths: \["research\/alt-market\/run-request\.json"\]/.test(wf));
  check("8 the experiment job requires the confirmation string", /job == 'experiment' && needs\.request\.outputs\.confirm == 'RUN-ALT-MARKET-S10'/.test(wf));
  check("8 experiments never run concurrently", /concurrency: alt-market-experiment/.test(wf));
  check("8 only the production Anthropic key is exported to the experiment", /ANTHROPIC_API_KEY=\$K/.test(wf) && !/GEMINI_API_KEY|GROQ_API_KEY/.test(wf));
  check("8 every job uses a read-only database session", (wf.match(/default_transaction_read_only=on/g) ?? []).length === 3);
}

// ── 9. Shared code defaults unchanged for production ──────────────────────
{
  check("9 Anthropic SDK retries stay at 1 in production", DEFAULT_MAX_RETRIES === 1);
  const analysis = src("src/lib/ai/analysis.ts");
  check("9 production chain is unchanged (no maxRetries override)", /const PROVIDER_CHAIN: AIProvider\[\] = \[makeAnthropicProvider\(\{ effort: "high" \}\), geminiProvider, groqProvider\];/.test(analysis));
  const gen = src("src/lib/ai/generate.ts");
  check("9 production generation never sets cacheOnly", !/cacheOnly/.test(gen));
  const ctx = src("src/lib/ai/generationContext.ts");
  check("9 cacheOnly is opt-in", /cacheOnly\?: boolean/.test(ctx) && /cacheOnly = false/.test(ctx));
  const cacheOnlyTeam = ctx.slice(ctx.indexOf("if (cacheOnly) {"), ctx.indexOf("// Miss or stale"));
  check("9 the cacheOnly team branch returns before any refresh", cacheOnlyTeam.length > 0 && /return row\.teamDigestJson/.test(cacheOnlyTeam) && !/refresh/.test(cacheOnlyTeam));
  check("9 cacheOnly never refreshes standings or head to head", /else if \(input\.cacheOnly\) \{[\s\S]*?standingsRows = /.test(ctx) && /\} else if \(!input\.cacheOnly\) \{\s*const result = await refreshH2HCache/.test(ctx));
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exitCode = 1;
