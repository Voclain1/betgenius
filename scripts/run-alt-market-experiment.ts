/**
 * VIP/Premium Sprint 10: the pre-registered alternative-market shadow
 * experiment (spec: src/lib/altMarketResearch.ts, SPEC_VERSION).
 *
 * For each sampled fixture: build the dedicated pass's context from caches
 * only, make exactly the dedicated pass's model call (same prompt builder,
 * intent, avoid-list, provider and model, effort "high") with ONE request and
 * no fallback provider, then judge every draft with the dedicated gate
 * (evaluateMarketConfirmed + paidTierFor + repeatsExistingPick). Record
 * everything. Nothing is persisted, published or written anywhere but stdout
 * and the observation file.
 *
 * Hard protections (checked in scripts/check-alt-market-research.ts):
 *   - refuses unless the session is read-only AND ALT_MARKET_CONFIRM matches;
 *   - cumulative caps across invocations, from the committed observation files
 *     (research/alt-market/observations/*.json): evaluations, model requests,
 *     cost; a call is refused BEFORE it is made if its worst case could breach;
 *   - no api-football client is imported; context and odds are cache-only;
 *   - provider list is the configured primary alone, maxRetries 0;
 *   - stops after CAPS.MAX_CONSECUTIVE_ERRORS consecutive provider errors.
 *
 * Run (only via .github/workflows/alt-market-research.yml, job=experiment):
 *   ALT_MARKET_CONFIRM=RUN-ALT-MARKET-S10 REQUIRE_READ_ONLY=1 npx tsx scripts/run-alt-market-experiment.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import type { FixtureOdds } from "../src/lib/odds";
import { lopsidednessSignal, evaluateMarketConfirmed, compareMarketConfirmed, type MarketConfirmedVerdict } from "../src/lib/marketConfirmed";
import { PAID_CORE_LEAGUE_IDS, PAID_WIDENED_LEAGUE_IDS, VIP_PREMIUM_INTENT, paidTierFor, readVipPremiumAttempt, repeatsExistingPick } from "../src/lib/vipPremiumOverlay";
import { DEDICATED_PAID_PROVENANCES } from "../src/lib/geniusCuration";
import { GOALS_GENERATED_PROVENANCE } from "../src/lib/goalsGeneration";
import { existingPicksOnFixture, liveRowsOnFixture } from "../src/lib/vipPremiumPipeline";
import { buildGenerationDigest } from "../src/lib/ai/generationContext";
import { buildPredictionRequest, checkPredictionOutput, completeWithFallback, parsePredictionOutput } from "../src/lib/ai/analysis";
import { makeAnthropicProvider } from "../src/lib/ai/providers/anthropic";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";
import { marketBreadthForCategories } from "../src/lib/doublesTargeting";
import { scanDraftForCertainty } from "../src/lib/certaintyLanguage";
import { scanDraftForInternalTerminology } from "../src/lib/houseVoice";
import { isValidSelection, deriveMarketAndPick, type MarketType, type Selection } from "../src/lib/markets";
import { pickPrice } from "../src/lib/paidSelection";
import {
  CAPS, SPEC_VERSION, costOf, correctedFavouriteSignal, eligibility, goalsBandSignal, mayCall, pricedSelections, sampleCandidates,
  COMPARISON_SELECTIONS, ALLOCATION, type CandidateFixture, type EligibilityFacts, type Ledger,
} from "../src/lib/altMarketResearch";

const OBS_DIR = join(__dirname, "../research/alt-market/observations");
const H = 3_600_000;

type Observation = Record<string, unknown> & { fixtureApiId: number; group: "CORE" | "SECONDARY"; modelRequests: number; costUsd: number };

function priorObservations(): Observation[] {
  if (!existsSync(OBS_DIR)) return [];
  return readdirSync(OBS_DIR).filter((f) => f.endsWith(".json")).flatMap((f) => (JSON.parse(readFileSync(join(OBS_DIR, f), "utf8")).observations ?? []) as Observation[]);
}

async function main() {
  if (process.env.ALT_MARKET_CONFIRM !== "RUN-ALT-MARKET-S10") throw new Error("refusing: ALT_MARKET_CONFIRM must be RUN-ALT-MARKET-S10 (explicit invocation only)");
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  console.log(`session verified read-only; spec ${SPEC_VERSION}`);

  const primary = makeAnthropicProvider({ effort: "high", maxRetries: 0 });
  if (!primary.isConfigured()) throw new Error("blocked: the configured production provider (anthropic) has no credential in this environment; no substitute provider is used");
  const modelId = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  // Free pre-checks before any billed request: the credential works and the
  // model exists. Token counting below is also free. A failure here spends nothing.
  const admin = new Anthropic({ maxRetries: 0, timeout: 30_000 });
  try {
    const info = await admin.models.retrieve(modelId);
    console.log(`credential verified; model ${info.id} available`);
  } catch (err: any) {
    throw new Error(`blocked before spending: cannot verify the production provider credential/model (${String(err?.status ?? "")} ${String(err?.message ?? err).slice(0, 160)})`);
  }

  const prior = priorObservations();
  const ledger: Ledger = {
    evaluations: prior.length,
    modelRequests: prior.reduce((s, o) => s + (o.modelRequests ?? 0), 0),
    apiFootballRequests: 0,
    costUsd: prior.reduce((s, o) => s + (o.costUsd ?? 0), 0),
    coreUsed: prior.filter((o) => o.group === "CORE").length,
    secondaryUsed: prior.filter((o) => o.group === "SECONDARY").length,
  };
  const seen = new Set(prior.map((o) => o.fixtureApiId));
  console.log(`cumulative before this run: ${JSON.stringify(ledger)}`);

  // ── Candidates (all reads) ───────────────────────────────────────────────
  const now = new Date();
  const from = new Date(now.getTime() + 12 * H), until = new Date(now.getTime() + 24 * H);
  const rows = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: from, lte: until }, status: "SUCCEEDED", fixtureApiId: { not: null }, leagueApiId: { in: [...PAID_CORE_LEAGUE_IDS, ...PAID_WIDENED_LEAGUE_IDS] } },
    select: { matchKey: true, fixtureApiId: true, leagueApiId: true, leagueName: true, homeTeam: true, awayTeam: true, kickoff: true, round: true },
  });
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 4 * 24 * H) }, prompt: { contains: `"intent":"${VIP_PREMIUM_INTENT}"` } }, select: { prompt: true, createdAt: true } });
  const attempted = new Set(jobs.map((j) => readVipPremiumAttempt(j.prompt, j.createdAt)?.fixtureApiId).filter((x): x is number => x != null));
  const quotes = new Map((await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: rows.map((r) => r.matchKey) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })).map((q) => [q.matchKey, q]));
  // Paid fixtures already published per Lagos day (for dry-day priority), known now.
  const paidByDay = new Map<string, Set<string>>();
  for (const p of await prisma.prediction.findMany({ where: { status: "PUBLISHED", kickoff: { gte: new Date(now.getTime() - 24 * H), lte: new Date(now.getTime() + 48 * H) }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } }, select: { kickoff: true, homeTeamApiId: true, awayTeamApiId: true } })) {
    if (!p.kickoff) continue;
    const d = lagosDateKey(p.kickoff);
    paidByDay.set(d, new Set([...(paidByDay.get(d) ?? []), `${p.homeTeamApiId}-${p.awayTeamApiId}`]));
  }

  const eligibleList: Array<CandidateFixture & { row: (typeof rows)[number]; facts: EligibilityFacts }> = [];
  const reasons: Record<string, number> = {};
  for (const r of rows) {
    const [h, a] = r.matchKey.split("-").map(Number);
    const live = await liveRowsOnFixture({ id: "", fixtureApiId: r.fixtureApiId, homeTeamApiId: h, awayTeamApiId: a, kickoff: r.kickoff });
    const q = quotes.get(r.matchKey);
    const odds = (q?.oddsJson as unknown as FixtureOdds | null) ?? null;
    const facts: EligibilityFacts = {
      ledgerSucceeded: true,
      hasOrdinaryRowWithContext: live.some((x) => x.provenance !== GOALS_GENERATED_PROVENANCE && !(DEDICATED_PAID_PROVENANCES as readonly string[]).includes(x.provenance ?? "")),
      alreadyAttempted: attempted.has(r.fixtureApiId!) || seen.has(r.fixtureApiId!),
      hasDedicatedPaid: live.some((x) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(x.provenance ?? "")),
      group: PAID_CORE_LEAGUE_IDS.includes(r.leagueApiId ?? -1) ? "CORE" : PAID_WIDENED_LEAGUE_IDS.includes(r.leagueApiId ?? -1) ? "SECONDARY" : null,
      hoursToKickoff: (r.kickoff.getTime() - now.getTime()) / H,
      quoteAgeMs: q?.fetchedAt ? now.getTime() - q.fetchedAt.getTime() : null,
      favouriteSignal: Math.max(lopsidednessSignal(odds)?.probability ?? 0, correctedFavouriteSignal(odds)?.probability ?? 0) || null,
      goals: goalsBandSignal(odds),
    };
    const e = eligibility(facts);
    if (!e.eligible) { reasons[e.reason] = (reasons[e.reason] ?? 0) + 1; continue; }
    const day = lagosDateKey(r.kickoff);
    eligibleList.push({ fixtureApiId: r.fixtureApiId!, matchKey: r.matchKey, leagueApiId: r.leagueApiId!, kickoff: r.kickoff, group: facts.group!, dryDay: (paidByDay.get(day)?.size ?? 0) <= ALLOCATION.DRY_DAY_MAX_PAID, row: r, facts });
  }
  console.log(`covered paid-scope fixtures 12-24h out: ${rows.length}; eligible ${eligibleList.length}; ineligible ${JSON.stringify(reasons)}`);
  const sample = sampleCandidates(eligibleList, { evaluationsLeft: CAPS.MAX_EVALUATIONS - ledger.evaluations, coreUsed: ledger.coreUsed, secondaryUsed: ledger.secondaryUsed });
  console.log(`sampled ${sample.length} (deterministic: dry days first, then sha256(${SPEC_VERSION}:fixtureId))`);

  // ── Evaluate ────────────────────────────────────────────────────────────
  const observations: Observation[] = [];
  let consecutiveErrors = 0;
  let stopped: string | null = null;
  for (const c of sample as typeof eligibleList) {
    const gate = mayCall(ledger);
    if (!gate.ok) { stopped = gate.reason; break; }
    if (consecutiveErrors >= CAPS.MAX_CONSECUTIVE_ERRORS) { stopped = `${consecutiveErrors} consecutive provider errors`; break; }
    const r = c.row;
    const [homeId, awayId] = r.matchKey.split("-").map(Number);
    const q = quotes.get(r.matchKey)!;
    const odds = (q.oddsJson as unknown as FixtureOdds | null) ?? null;
    const evaluatedAt = new Date();
    const obs: Observation = {
      spec: SPEC_VERSION, fixtureApiId: c.fixtureApiId, matchKey: r.matchKey, fixture: `${r.homeTeam} v ${r.awayTeam}`, league: r.leagueName, leagueApiId: r.leagueApiId,
      group: c.group, dryDay: c.dryDay, kickoff: r.kickoff.toISOString(), lagosDay: lagosDateKey(r.kickoff), evaluatedAt: evaluatedAt.toISOString(),
      quoteFetchedAt: q.fetchedAt?.toISOString() ?? null, quoteAgeMinutes: q.fetchedAt ? Math.round((evaluatedAt.getTime() - q.fetchedAt.getTime()) / 60000) : null,
      favouriteSignal: c.facts.favouriteSignal, goalsSignal: c.facts.goals, comparison: pricedSelections(odds, COMPARISON_SELECTIONS),
      existingPaidOnDay: paidByDay.get(lagosDateKey(r.kickoff))?.size ?? 0,
      modelRequests: 0, costUsd: 0, apiFootballRequests: 0,
    };
    const { digest, sources } = await buildGenerationDigest({ home: r.homeTeam, away: r.awayTeam, league: r.leagueName ?? "", kickoff: r.kickoff.toISOString(), homeApiId: homeId, awayApiId: awayId, leagueApiId: r.leagueApiId, round: r.round, cacheOnly: true });
    if (sources.apiCalls !== 0) throw new Error(`cache-only context reported ${sources.apiCalls} api-football calls; stopping`);
    obs.context = { homeTeam: sources.homeTeam, awayTeam: sources.awayTeam, standings: sources.standings, h2h: sources.h2h, stale: sources.stale ?? [] };
    const avoidPicks = await existingPicksOnFixture({ fixtureApiId: c.fixtureApiId, homeTeamApiId: homeId, awayTeamApiId: awayId, kickoff: r.kickoff });
    const risk = resolveGenerationRisk(["FEATURED"], r.leagueApiId);
    const request = buildPredictionRequest({
      digest, tiers: risk.promptTiers, riskCalibration: risk.calibration !== "legacy",
      marketBreadth: marketBreadthForCategories(["FEATURED"], VIP_PREMIUM_INTENT), shortPriceBlock: "",
      lowerRisk: { avoidPicks }, paidRoute: true,
    } as any);
    // Exact input size (free), so the cost ceiling is checked on the real prompt, not an assumption.
    let inputTokens: number | null = null;
    try {
      inputTokens = (await admin.messages.countTokens({ model: modelId, system: request.system, messages: [{ role: "user", content: request.user }] })).input_tokens;
    } catch { inputTokens = null; }
    const worst = (inputTokens ?? 20_000) * 0.1e-6 + 16_000 * 0.5e-6;
    obs.inputTokensCounted = inputTokens;
    if (ledger.costUsd + worst > CAPS.MAX_COST_USD) { stopped = `cost ceiling: worst case of the next request (${worst.toFixed(4)} USD) would exceed ${CAPS.MAX_COST_USD} USD`; break; }
    ledger.modelRequests++; obs.modelRequests = 1; ledger.evaluations++;
    try {
      const raw = await completeWithFallback(request, parsePredictionOutput, [primary]);
      const result = checkPredictionOutput(digest, request.label ?? "", raw);
      consecutiveErrors = 0;
      obs.model = result.model; obs.usage = result.usage;
      obs.costUsd = costOf(modelId, result.usage); ledger.costUsd += obs.costUsd as number;
      if (!String(result.model).startsWith("anthropic:")) throw new Error(`unexpected provider ${result.model}`);
      const out = result.output;
      const drafts = Array.isArray(out.predictions) ? out.predictions : [];
      const certainty = scanDraftForCertainty({ matchPreview: out.matchPreview, keyFactors: out.keyFactors, reasoning: drafts.map((p) => p.reasoning).join("\n\n") });
      const voice = scanDraftForInternalTerminology({ matchPreview: out.matchPreview, keyFactors: out.keyFactors, reasoning: drafts.map((p) => p.reasoning).join("\n\n") });
      obs.rejectedBeforePersist = certainty.length || voice.length ? { certainty: certainty.length, houseVoice: voice.length } : null;
      const live = await liveRowsOnFixture({ id: "", fixtureApiId: c.fixtureApiId, homeTeamApiId: homeId, awayTeamApiId: awayId, kickoff: r.kickoff });
      const judged = drafts.map((p, i) => {
        const valid = isValidSelection(p.marketType, p.selection);
        const marketType: MarketType = valid ? p.marketType : "OTHER";
        const selection: Selection = valid ? p.selection : null;
        const confidence = Math.min(90, Math.max(0, Math.round(p.confidence)));
        const verdict: MarketConfirmedVerdict = evaluateMarketConfirmed({ marketType, selection, confidence, odds, fetchedAt: q.fetchedAt, now: evaluatedAt });
        const repeat = repeatsExistingPick({ id: `draft-${i}`, marketType, selection }, live);
        const tier = obs.rejectedBeforePersist || repeat ? null : paidTierFor(verdict, confidence);
        const price = pickPrice(odds, marketType, selection);
        const { pick } = deriveMarketAndPick(marketType, selection, r.homeTeam, r.awayTeam, { market: "Other", pick: "" });
        return { id: `draft-${i}`, marketType, selection, pick, confidence, verdict, repeat, tier, entryPrice: price && !price.derived ? price.median : null, entryBooks: price?.bookmakers ?? null };
      });
      const passing = judged.filter((d) => d.tier).sort(compareMarketConfirmed);
      const best = passing[0] ?? null;
      obs.drafts = judged.map((d) => ({ marketType: d.marketType, selection: d.selection, pick: d.pick, confidence: d.confidence, gate: d.verdict.confirmed ? "CONFIRMED" : d.verdict.reason, marketProbability: d.verdict.marketProbability, gapPP: d.verdict.gapPP, books: d.verdict.bookmakers, repeat: d.repeat, tier: d.tier, entryPrice: d.entryPrice }));
      obs.outcome = best ? best.tier : "NONE";
      obs.best = best ? { marketType: best.marketType, selection: best.selection, pick: best.pick, confidence: best.confidence, marketProbability: best.verdict.marketProbability, entryPrice: best.entryPrice, books: best.entryBooks } : null;
      obs.existingVipOrPremiumOnFixture = live.some((x) => x.status === "PUBLISHED" && x.categories.some((k) => k.category === "VIP" || k.category === "PREMIUM"));
      obs.incremental = !!best && !obs.existingVipOrPremiumOnFixture;
    } catch (err: any) {
      consecutiveErrors++;
      obs.error = String(err?.message ?? err).slice(0, 300);
      obs.outcome = "ERROR";
      const usage = err?.usage;
      obs.costUsd = usage ? costOf(modelId, usage) : CAPS.WORST_CASE_COST_PER_REQUEST_USD;
      ledger.costUsd += obs.costUsd as number;
    }
    observations.push(obs);
    console.log(`  ${obs.lagosDay} ${obs.group} ${obs.fixture} (${obs.league}) -> ${obs.outcome}${obs.best ? ` ${(obs.best as any).pick} @ ${(obs.best as any).confidence}/${(obs.best as any).marketProbability?.toFixed?.(1)}` : ""} cost $${(obs.costUsd as number).toFixed(4)}`);
  }

  const summary = { spec: SPEC_VERSION, runAt: now.toISOString(), githubRun: process.env.GITHUB_RUN_ID ?? null, evaluated: observations.length, stopped, ledgerAfter: ledger };
  console.log(`\nsummary ${JSON.stringify(summary)}`);
  mkdirSync(OBS_DIR, { recursive: true });
  const file = join(OBS_DIR, `run-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  const payload = JSON.stringify({ summary, observations }, null, 2);
  writeFileSync(file, payload);
  console.log(`\n=====BEGIN OBSERVATIONS ${file}=====\n${payload}\n=====END OBSERVATIONS=====`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
