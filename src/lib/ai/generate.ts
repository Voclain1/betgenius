import { prisma } from "@/lib/prisma";
import { evaluateHandicapEdge, type SourcedHandicapLine } from "@/lib/handicapLine";
import { Prisma } from "@prisma/client";
import { generatePredictionForFixture } from "@/lib/ai/analysis";
import { buildStoredContext } from "@/lib/ai/context";
import { hasSubstantiveFootballEvidence, FootballEvidenceUnavailableError, unavailableEvidenceReason } from "@/lib/ai/evidenceReadiness";
import { buildAnalysis } from "@/lib/predictionAnalysis";
import { searchTeam } from "@/lib/football/api-football";
import { buildGenerationDigest } from "@/lib/ai/generationContext";
import { setPredictionCategories } from "@/lib/predictions";
import { isValidSelection, deriveMarketAndPick, deriveOverUnderText, type MarketType, type Selection, isGeneratableTeamTotal } from "@/lib/markets";
import { normalizeName, matchKey } from "@/lib/slug";
import type { FixtureOdds } from "@/lib/odds";
import { earlyMarketGuidance } from "@/lib/generation/earlyMarketGuidance";
import { EARLY_FREE_GENERATION_INTENT } from "@/lib/ai/generationRisk";
import { shortPriceSides, shortPriceBlock, shortPriceRetryBlock, isUnpayableDoubleChance } from "@/lib/shortPriceGuard";
import { betterMarketBlock } from "@/lib/marketPricePolicy";
import { automaticOddsFailure, automaticOddsRetryBlock, AutoOddsFloorError, type AutoOddsFailure } from "@/lib/autoOddsFloor";
import { farAboveMarket, marketSanityRetryBlock, MarketSanityError } from "@/lib/marketSanity";
import { recordGenerationFailure, resolveGenerationFailures } from "@/lib/generationFailures";
import { resolveGenerationRisk } from "@/lib/ai/generationRisk";
import { marketBreadthForCategories, REGULAR_COMBO_INTENT, SAME_GAME_DOUBLE } from "@/lib/doublesTargeting";
import { marketSelectionMode, type SelectionRecord } from "@/lib/marketSelection";
import { applyMarketSelection } from "@/lib/ai/marketSelectionStep";
import { assembleGeneratedSameGameDouble } from "@/lib/sameGameDoubleAssembly";
import { scanDraftForCertainty, type CertaintyViolation } from "@/lib/certaintyLanguage";
import { scanDraftForInternalTerminology, type InternalTerminologyViolation } from "@/lib/houseVoice";
import { normalizeLeagueName } from "@/lib/leagues";
import { VIP_ROUTE_PROVENANCE, BANKER_INTENT_PROVENANCE, STANDARD_CURATED_PROVENANCE } from "@/lib/geniusCuration";
import { GOALS_INTENT, GOALS_GENERATED_PROVENANCE, GOALS_PERSISTED_CATEGORIES, pickGoalsDraft, type GoalsDraftRejection } from "@/lib/goalsGeneration";

/**
 * Thrown when a draft asserts certainty. Carries the violations so the failure
 * is actionable — which phrase, in which field — rather than a bare rejection.
 */
/**
 * Thrown when a draft narrates our own machinery at the reader — a tier name,
 * a calibration, a guideline. Same reject-don't-edit stance as the certainty
 * scan: the sentence was built around the house concept, so removing the words
 * leaves prose arguing from a rule the reader still cannot see.
 */
export class HouseVoiceError extends Error {
  readonly violations: InternalTerminologyViolation[];
  constructor(violations: InternalTerminologyViolation[]) {
    super(`Draft rejected — internal terminology leaked to the reader: ${violations.map((v) => `${v.field}:"${v.match}"`).join(", ")}`);
    this.name = "HouseVoiceError";
    this.violations = violations;
  }
}

export class CertaintyLanguageError extends Error {
  readonly violations: CertaintyViolation[];
  constructor(violations: CertaintyViolation[]) {
    super(`Draft rejected — prohibited certainty language: ${violations.map((v) => `${v.field}:"${v.match}"`).join(", ")}`);
    this.name = "CertaintyLanguageError";
    this.violations = violations;
  }
}

export type GenerateFixtureInput = {
  /** Internal immutable attribution; never a qualification bypass. */
  quotaExperiment?: string;
  /** Dedicated early FREE row cannot auto-publish if generation-time price checks flagged it. */
  earlyPriceUnsafe?: boolean;
  fixtureId?: string;
  /**
   * Provider fixture id. Supplied by the scheduled worker, which already has it
   * on the discovery row; absent when an admin types a fixture in by hand.
   * Persisted so settlement can resolve by id and so generation dedupe survives
   * a reschedule (see Prediction.fixtureApiId in schema.prisma).
   */
  fixtureApiId?: number;
  /**
   * A real, quoted European Handicap line for this fixture. Supplied only by a
   * caller that sourced it from live odds (src/lib/handicapLine.ts). Its
   * presence is what switches generation to the handicap market at all.
   */
  handicapLine?: SourcedHandicapLine;
  home: string;
  away: string;
  league: string;
  leagueApiId?: number;
  kickoff: string;
  categories: string[]; // at least one; categories[0] becomes the primary `category`
  authorId: string;
  /**
   * Pre-resolved api-football team ids, when the caller already has them.
   *
   * The scheduled worker and the bulk route both read fixtures straight from
   * /fixtures, whose rows already carry `teams.home.id` — passing them here
   * skips two searchTeam calls (plus their retry variants) per fixture that
   * were being spent re-deriving ids the caller was already holding. The manual
   * single-fixture form has only names, so it still falls back to searchTeam.
   */
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  /** API-Football knockout round, supplied by fixture-list generation paths. */
  round?: string | null;
  /**
   * What this job is FOR, when that is not simply its categories.
   *
   * Recorded because the whole input object is persisted as AIJob.prompt, which
   * is how daily quotas are counted. Market-Confirmed generation cannot be
   * identified by categories the way doubles can — its rows are tagged
   * VIP/PREMIUM only AFTER they pass the odds gate, and a job that generated a
   * pick which then failed the gate still spent its slot and its money. The
   * quota has to count attempts, so the attempt has to be labelled.
   */
  intent?: string;
  /**
   * An admin's own generation (single match or bulk, /admin): the short-price
   * rule does not apply. The admin chose the match and reviews the pick.
   */
  manual?: boolean;
  /**
   * The categories an assembled double is published under, besides
   * SAME_GAME_DOUBLE. Kept apart from `categories`, which still drives
   * calibration: the scheduled worker generates combos under ["FEATURED"]
   * calibration but passes only the categories the run was explicitly asked
   * for here, so an ordinary double is not tagged FEATURED by default.
   * Absent means "use `categories`", the admin routes' behaviour.
   */
  comboCategories?: string[];
  /**
   * Dedicated VIP/PREMIUM pass only: the selections already live on this
   * fixture, as "Market: Pick" labels. The model is told not to repeat them
   * and to look for a lower-risk market instead (lowerRiskPickBlock), and the
   * odds gate refuses a repeat regardless (src/lib/vipPremiumOverlay.ts).
   */
  avoidPicks?: string[];
};

/**
 * Resolves live context (form, injuries, standings, head-to-head) where possible,
 * asks the model for a prediction, and persists it as PENDING_REVIEW across all
 * requested categories. Shared by the single-fixture and bulk-generate routes.
 *
 * Which provider answered is recorded on the AIJob (`model`, e.g.
 * "gemini:gemini-2.5-flash" or "groq:openai/gpt-oss-120b") — see
 * src/lib/ai/analysis.ts for the fallback chain.
 */
export async function generateAndPersistPrediction(rawInput: GenerateFixtureInput) {
  // Every failure, from every path, lands in the failed-generation log the
  // admin sees (src/lib/generationFailures.ts); a later success for the same
  // match closes it.
  try {
    const result = await generateUnlogged(rawInput);
    const first = result.predictions[0];
    if (first) await resolveGenerationFailures(rawInput, { home: first.homeTeamApiId ?? null, away: first.awayTeamApiId ?? null });
    return result;
  } catch (err) {
    await recordGenerationFailure(rawInput, err);
    throw err;
  }
}

async function generateUnlogged(rawInput: GenerateFixtureInput) {
  const leagueName = normalizeLeagueName(rawInput.league);
  if (!leagueName) {
    throw new Error("Prediction generation requires a real league name; placeholders cannot be persisted");
  }
  // Trim/collapse whitespace up front so both the live-context lookups below
  // and the persisted row use the same team/league text (src/lib/slug.ts
  // computes read-time slugs from these fields — a stray double-space
  // shouldn't produce a second slug for what's really the same team/league).
  const input: GenerateFixtureInput = {
    ...rawInput,
    home: normalizeName(rawInput.home),
    away: normalizeName(rawInput.away),
    league: normalizeName(leagueName),
  };

  const kickoffDate = new Date(input.kickoff);

  // Ids first. A caller that already holds them (any fixture-list-driven path)
  // passes them straight through; only the manual form pays for a name lookup.
  let homeApiId = rawInput.homeTeamApiId ?? null;
  let awayApiId = rawInput.awayTeamApiId ?? null;
  let homeTeamName = input.home;
  let awayTeamName = input.away;

  if ((homeApiId == null || awayApiId == null) && input.leagueApiId && input.intent !== EARLY_FREE_GENERATION_INTENT) {
    const [homeMatch, awayMatch] = await Promise.all([
      homeApiId == null ? searchTeam(input.home) : Promise.resolve(null),
      awayApiId == null ? searchTeam(input.away) : Promise.resolve(null),
    ]);
    // One policy for one confidence signal: an unconfident match yields neither
    // an id nor a name. Writing the id anyway attaches another team's stats,
    // form, injuries and h2h to the prediction and seeds the enrichment cache
    // with them — a wrong-but-plausible id is strictly worse than a null one,
    // because nothing downstream can tell it was a bad guess.
    if (homeApiId == null && homeMatch?.confident) {
      homeApiId = homeMatch.id;
      // Prefer the API's own spelling, but only when the lookup was unambiguous.
      homeTeamName = homeMatch.name;
    }
    if (awayApiId == null && awayMatch?.confident) {
      awayApiId = awayMatch.id;
      awayTeamName = awayMatch.name;
    }
  }

  // Cache-first assembly. With warm enrichment this spends no api-football
  // quota at all; on a miss it refreshes through the cron's own writers so the
  // next reader is warm too. See src/lib/ai/generationContext.ts.
  const { digest, sources } = await buildGenerationDigest({
    home: homeTeamName,
    away: awayTeamName,
    league: input.league,
    kickoff: input.kickoff,
    homeApiId,
    awayApiId,
    leagueApiId: input.leagueApiId ?? null,
    round: input.round ?? null,
    // Early analysis NEVER refreshes missing team/standings/H2H caches.
    // The ordinary and paid pipelines retain their existing cache-filling behavior.
    cacheOnly: input.intent === EARLY_FREE_GENERATION_INTENT,
  });

  // No model can support match statistics or confidence when there is zero
  // sporting evidence. Deferring BEFORE the model call prevents fabricated
  // recent scores from becoming reviewable tips and saves model tokens.
  // The generation ledger retains the fixture for a later evidence retry.
  const cacheOnly = input.intent === EARLY_FREE_GENERATION_INTENT;
  if (!hasSubstantiveFootballEvidence(digest)) {
    throw new FootballEvidenceUnavailableError(unavailableEvidenceReason({
      homeId: homeApiId, awayId: awayApiId, cacheOnly,
    }, sources));
  }

  const startedAt = Date.now();
  const riskRoute = resolveGenerationRisk(input.categories, input.leagueApiId, input.intent);
  /**
   * The calibration route this row was ACTUALLY generated under, recorded on
   * the row itself.
   *
   * Derived here, one line from resolveGenerationRisk, precisely so the marker
   * and the route cannot drift apart. Reconstructing it later — replaying
   * AIJob.prompt.categories against league priority, which is how the mismatch
   * was found — works but is archaeology; a row should carry its own history.
   *
   * A row from the dedicated VIP/PREMIUM pass may be re-stamped VIP_GENERATED
   * or PREMIUM_GENERATED later by its odds gate. That is a stricter, more
   * specific classification of the same row and is meant to win. A draft that
   * is not promoted is archived by the gate: that pass now runs on fixtures
   * ordinary generation already covered, so its other drafts would only
   * duplicate the ordinary picks (see src/lib/vipPremiumOverlay.ts).
   */
  // The dedicated Goals pass (src/lib/goalsGeneration.ts): one market, fixed in
  // the prompt and enforced again below by pickGoalsDraft.
  const goalsOnly = input.intent === GOALS_INTENT;
  const earlyFree = input.intent === EARLY_FREE_GENERATION_INTENT;
  const provenance = goalsOnly
    ? GOALS_GENERATED_PROVENANCE
    : riskRoute.calibration === "legacy"
      ? BANKER_INTENT_PROVENANCE
      : riskRoute.calibration === "vip"
        ? VIP_ROUTE_PROVENANCE
        : STANDARD_CURATED_PROVENANCE;
  // A regular-combo or legacy doubles job asks for several markets so a
  // same-game double can be assembled from independently-reasoned rows.
  // The dedicated VIP/PREMIUM pass also uses multi breadth for its odds gate.
  const marketBreadth = goalsOnly ? "single" : marketBreadthForCategories(input.categories, input.intent);
  // Quote checks run on ordinary AND dedicated Goals generation. The European
  // Handicap lane has its own sourced-line/value gate and VIP/PREMIUM has its
  // own stricter fair-odds and independent confirmation gate.
  // Admin/manual generation remains exempt from the automatic price floor.
  const checksMarket = !input.handicapLine && input.intent !== "VIP_PREMIUM";
  const guardsShortPrice = !input.manual && !input.handicapLine && input.intent !== "VIP_PREMIUM";
  const quote = checksMarket ? await loadFixtureOdds(homeApiId, awayApiId, input.kickoff, input.fixtureApiId,
    input.intent === EARLY_FREE_GENERATION_INTENT) : null;
  const odds = quote?.odds ?? null;
  // Our cache fetch time for this quote, recorded with any selection decision.
  const quoteFetchedAt = quote?.fetchedAt ?? null;
  const priceOdds = guardsShortPrice ? odds : null;
  // A priced-market shortlist is useful context for EARLY FREE alone.
  // It is never a recommendation, a probability estimate or a publication
  // bypass. Normal, paid, Goals and admin prompts remain unchanged.
  const pricedEarlyMarkets = input.intent === EARLY_FREE_GENERATION_INTENT && odds
    ? earlyMarketGuidance(odds, new Date(input.kickoff), new Date()) : [];
  // Market selection (src/lib/marketSelection.ts): ordinary and early single-
  // market generation only. The paid pass, European lane, Goals, handicap,
  // combos and Banker keep their own dedicated gates and prompts unchanged.
  const selectionMode = marketSelectionMode();
  const selectionApplies = selectionMode !== "off" && !goalsOnly && !input.handicapLine && marketBreadth === "single"
    && riskRoute.calibration !== "legacy" && !["VIP_PREMIUM", "EUROPEAN_CLUB", "MARKET_CONFIRMED", REGULAR_COMBO_INTENT].includes(String(input.intent ?? ""));
  const callModel = (block: string) =>
    generatePredictionForFixture({
      digest,
      tiers: riskRoute.promptTiers,
      riskCalibration: riskRoute.calibration !== "legacy",
      marketBreadth,
      handicapLine: input.handicapLine,
      shortPriceBlock: block + (pricedEarlyMarkets.length ?
        "\nEarly bookmaker market availability (context, NOT confidence):\n" +
        pricedEarlyMarkets.join("\n") +
        "\nOnly choose a quoted selection if football evidence supports it; otherwise provide a separately justified unpriced pick for admin review.\n" : ""),
      ...(goalsOnly ? { goalsOnly: true } : {}),
      ...(input.intent === "VIP_PREMIUM" ? { lowerRisk: { avoidPicks: input.avoidPicks ?? [] } } : {}),
      ...(riskRoute.calibration === "vip" || input.intent === "VIP_PREMIUM" ? { paidRoute: true } : {}),
      ...(selectionApplies ? { marketSelection: selectionMode as "shadow" | "on" } : {}),
      ...(process.env.FREE_TIER_NEUTRAL_BANDS === "on" && riskRoute.calibration === "genius" && input.intent !== "VIP_PREMIUM" ? { freeTierNeutral: true } : {}),
    });
  // The real priced menu and the "choose a market that pays" rule. The early
  // lane already lists its priced markets (pricedEarlyMarkets) and the Goals
  // pass is fixed to one market, so neither gets a second list.
  const priceMenu = !goalsOnly && pricedEarlyMarkets.length === 0 ? betterMarketBlock(priceOdds, input.home, input.away) : "";
  const shortBlock = shortPriceBlock(shortPriceSides(priceOdds, input.home, input.away));
  const firstBlock = shortBlock + priceMenu;
  // A call that was paid for and then rejected inside generatePredictionForFixture
  // carries its usage on the error; it is recorded as a REJECTED job so the
  // generation panel's spend includes it.
  const recordRejectedCall = async (err: unknown) => {
    const e = err as { usage?: { promptTokens: number | null; outputTokens: number | null }; model?: string; name?: string; message?: string };
    if (!e?.usage || !e.model) return;
    await prisma.aIJob
      .create({
        data: {
          userId: input.authorId,
          prompt: JSON.stringify(input),
          model: e.model,
          rawOutput: `${e.name ?? "Error"}: ${(e.message ?? "").slice(0, 500)}`,
          status: "REJECTED",
          promptTokens: e.usage.promptTokens,
          outputTokens: e.usage.outputTokens,
          durationMs: Date.now() - startedAt,
        },
      })
      .catch(() => {});
  };
  let firstCall: Awaited<ReturnType<typeof callModel>>;
  try {
    firstCall = await callModel(firstBlock);
  } catch (err) {
    await recordRejectedCall(err);
    throw err;
  }
  let { output, usage, model } = firstCall;
  type Draft = (typeof output.predictions)[number];
  const autoPriceIssue = (p: Draft): AutoOddsFailure | null =>
    guardsShortPrice ? automaticOddsFailure(priceOdds, p.marketType, p.selection) : null;
  const tooShortDc = (p: Draft) => isUnpayableDoubleChance(priceOdds, p.marketType, p.selection);
  const unpayable = (p: Draft) => tooShortDc(p) || autoPriceIssue(p) !== null;
  const offMarket = (p: Draft) => farAboveMarket(odds, p);
  // One bounded second attempt for ordinary (non-Goals) generation if every
  // draft was too cheap, an unpriced TEAM_TOTAL or far above market evidence.
  // The Goals pass allows only a fixed 1.5/2.5 OVER pick, and its prompt
  // intentionally ignores general short-price retry blocks: do not pay for a
  // second identical call there. Reject the priced-out Goals pick instead.
  const first = Array.isArray(output.predictions) ? output.predictions : [];
  // The early lane retries too: it used to save a too-short or unpriced pick for
  // review without ever looking for a better market, and reviewers then
  // published them (a team Under 2.5 at ~1.03, Double Chances at 1.03-1.05).
  if (!goalsOnly && first.length > 0 && first.every((p) => unpayable(p) || offMarket(p))) {
    const dc = first.filter(tooShortDc);
    const floor: AutoOddsFailure[] = first.filter((p) => !tooShortDc(p))
      .map((p) => autoPriceIssue(p))
      .filter((issue): issue is AutoOddsFailure => issue !== null);
    const off = first.filter((p) => !unpayable(p));
    const retryBlock =
      (dc.length > 0 ? shortPriceRetryBlock(priceOdds, dc, input.home, input.away) : shortBlock) +
      automaticOddsRetryBlock(floor) +
      (off.length > 0 ? marketSanityRetryBlock(odds, off, input.home, input.away) : "") +
      betterMarketBlock(priceOdds, input.home, input.away);
    let retry: Awaited<ReturnType<typeof callModel>>;
    try {
      retry = await callModel(retryBlock);
    } catch (err) {
      await recordRejectedCall(err);
      throw err;
    }
    output = retry.output;
    model = retry.model;
    const add = (x: number | null, y: number | null) => (x == null && y == null ? null : (x ?? 0) + (y ?? 0));
    usage = {
      promptTokens: add(usage.promptTokens, retry.usage.promptTokens),
      outputTokens: add(usage.outputTokens, retry.usage.outputTokens),
      totalTokens: add(usage.totalTokens, retry.usage.totalTokens),
    };
  }
  // Do NOT discard an early selection only because its available odds are
  // too short, anomalous, or in an unsupported market. Persist it for the
  // hold/review lane, with an immutable warning in the dedicated job prompt.
  // That warning independently prohibits automatic publication.
  // Decided on the draft that will be persisted (one per single-market job),
  // not on any extra draft the model returned: an unsafe second draft must
  // not block a first draft that passed, and is never persisted anyway.
  if (earlyFree && Array.isArray(output.predictions) && output.predictions.length > 0 &&
      (unpayable(output.predictions[0]) || offMarket(output.predictions[0]))) {
    input.earlyPriceUnsafe = true;
  }
  const durationMs = Date.now() - startedAt;

  // A league was specified (live context was expected) but nothing resolved —
  // no stats, form, availability, h2h or standings for either side. Usually
  // means the football API failed silently (bad key, plan restriction, rate
  // limit) rather than the fixture genuinely having no data.
  const contextComplete = hasSubstantiveFootballEvidence(digest) &&
    (input.intent !== EARLY_FREE_GENERATION_INTENT || !sources.stale?.length);

  // Market selection (src/lib/ai/marketSelectionStep.ts): alternatives must
  // pass the same evidence, structure, certainty and voice gates as the
  // primary; the decision uses the quote loaded above with its timestamps;
  // only "on" may switch (never admin-requested generation); and early
  // publication safety is decided on the draft that will be persisted.
  let marketSelection: SelectionRecord | null = null;
  if (selectionApplies && Array.isArray(output.predictions) && output.predictions.length > 0) {
    const step = applyMarketSelection({
      output, digest, odds, quoteFetchedAt, contextComplete, mode: selectionMode as "shadow" | "on",
      manual: !!input.manual, earlyFree, failsPriceChecks: (d) => unpayable(d) || !!offMarket(d),
    });
    output = step.output;
    marketSelection = step.record;
    if (earlyFree) input.earlyPriceUnsafe = step.earlyPriceUnsafe || undefined;
  }

  const job = await prisma.aIJob.create({
    data: {
      userId: input.authorId,
      prompt: JSON.stringify(input),
      model,
      rawOutput: JSON.stringify(marketSelection ? { ...output, marketSelection } : output),
      status: "COMPLETED",
      contextComplete,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      durationMs,
      // Exactly what the model was shown, so a rewrite reproduces the same
      // evidence without re-hitting API-Football. Storing the digest rather
      // than the raw payloads means the replay is byte-identical to the
      // original prompt instead of merely equivalent.
      // Cast: MatchDigest is a plain JSON-serialisable object, but Prisma's
      // InputJsonValue won't accept a named interface without it.
      context: buildStoredContext(digest, sources.provenance) as unknown as Prisma.InputJsonValue,
    },
  });

  // The drafts that may be persisted. Ordinary generation: all of them, as
  // before. Goals pass: at most one, and only an Over 1.5 / Over 2.5 at or
  // above GOALS_MIN_CONFIDENCE — whatever the model returned. The scans below
  // read only these, so a discarded draft's prose cannot sink the kept one.
  const goalsSelection = goalsOnly ? pickGoalsDraft(Array.isArray(output.predictions) ? output.predictions : []) : null;
  const goalsRejections: GoalsDraftRejection[] = goalsSelection?.rejected ?? [];
  const modelDrafts = goalsSelection ? (goalsSelection.pick ? [goalsSelection.pick] : []) : output.predictions;
  // Reject every mapped selection with median quoted odds below 1.12,
  // including Double Chance and Goals picks. TEAM_TOTAL is held until its
  // exact prices can be cached; it cannot evade the price check by being absent
  // from the current trimmed feed. Market-sanity rejects remain independent.
  const payable = modelDrafts.filter((p) => !unpayable(p));
  const drafts = payable.filter((p) => !offMarket(p));
  // One fixture, one canonical row, whenever a single market was asked for.
  // The model sometimes returns extra drafts anyway (the early lane's guidance
  // invited "a separately justified unpriced pick"), and every one was being
  // persisted: Leipzig v Lens reached FEATURED twice from one job. Extra drafts
  // stay in the job record; they are never a second public pick.
  const persistedDrafts = (earlyFree ? modelDrafts : drafts).slice(0, marketBreadth === "single" ? 1 : undefined);
  // From here a rejection throws away a job that was paid for and already
  // recorded; it is marked REJECTED so the panel shows that spend apart from
  // the jobs that produced picks.
  const rejected = async (err: Error) => {
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "REJECTED" } }).catch(() => {});
    return err;
  };
  if (!earlyFree && modelDrafts.length > 0 && payable.length === 0) {
    throw await rejected(new AutoOddsFloorError(`${input.home} v ${input.away}`));
  }
  if (!earlyFree && payable.length > 0 && drafts.length === 0) {
    throw await rejected(new MarketSanityError(`${input.home} v ${input.away}`, offMarket(payable[0])!));
  }

  // Deterministic certainty scan, BEFORE anything is persisted.
  //
  // The prompt has forbidden certainty language since the beginning, with
  // nothing behind it but the model's compliance. This rejects rather than
  // edits: stripping the offending word would leave prose written to argue
  // inevitability, minus the one token that made the claim reviewable.
  const certaintyViolations = scanDraftForCertainty({
    matchPreview: output.matchPreview,
    keyFactors: output.keyFactors,
    reasoning: persistedDrafts.map((p) => p.reasoning).join("\n\n"),
  });
  if (certaintyViolations.length > 0) {
    throw await rejected(new CertaintyLanguageError(certaintyViolations));
  }

  // Same gate, different failure: reasoning that explains our pipeline instead
  // of the football. Real published output said "In line with the Genius tier
  // risk calibration..." — a sentence about us, printed where the analysis
  // should be.
  const voiceViolations = scanDraftForInternalTerminology({
    matchPreview: output.matchPreview,
    keyFactors: output.keyFactors,
    reasoning: persistedDrafts.map((p) => p.reasoning).join("\n\n"),
  });
  if (voiceViolations.length > 0) {
    throw await rejected(new HouseVoiceError(voiceViolations));
  }

  // Handicap picks the value gate turned away. Surfaced rather than silently
  // dropped: "no pick today" and "a pick we rejected" look identical from the
  // outside, and only one of them means the market is working.
  const handicapRejections: Array<{ selection: string; line: number; confidence: number; reason: string }> = [];

  const created = (await Promise.all(
    persistedDrafts.map(async (p) => {
      // Defensive: even with a schema in the prompt, the model can still emit
      // a malformed marketType/selection. Fall back to OTHER (manual-only)
      // rather than persist a settlement field that doesn't match its shape.
      // A TEAM_TOTAL on a line generation may not use is treated as malformed,
      // not silently accepted. The prompt states the rule; this is what makes
      // it true. Same reasoning as the certainty scan above — a prompt alone
      // has already proven insufficient once.
      const generatableLine = p.marketType !== "TEAM_TOTAL" || isGeneratableTeamTotal(p.selection);

      // FORCE the sourced handicap line back onto the selection.
      //
      // The prompt tells the model the line is fixed, but a prompt alone has
      // already proven insufficient twice in this file (the certainty scan and
      // the TEAM_TOTAL line check exist for the same reason). Re-applying the
      // number we read from live prices makes an invented line structurally
      // impossible rather than merely discouraged: whatever the model echoes,
      // what gets persisted is what a bookmaker actually quoted.
      //
      // A handicap marketType with no sourced line cannot occur through
      // generation — EUROPEAN_HANDICAP is absent from AUTO_MARKET_TYPES — but
      // if it ever did it falls through to OTHER below rather than being
      // persisted on a line from nowhere.
      if (input.handicapLine && p.marketType === "EUROPEAN_HANDICAP" && p.selection && typeof p.selection === "object") {
        (p.selection as { line?: number }).line = input.handicapLine.line;
      }

      // VALUE GATE for handicap, applied here because it needs the model's
      // confidence for the side it actually chose — sourcing fixes the line,
      // not the selection. A failure is not an error: the fixture produces no
      // pick, exactly as a thin book does, just one step later.
      //
      // Real case this exists for: Ipswich vs Liverpool priced AWAY at 1.15 on
      // the -1 line (implied ~87%) while the model returned 84% confidence — a
      // NEGATIVE edge, published as an 84% call. Sourcing a genuine line does
      // not make backing a short-priced favourite a value selection.
      if (input.handicapLine && p.marketType === "EUROPEAN_HANDICAP") {
        const value = (p.selection as { value?: string } | null)?.value ?? "";
        const confidence = Math.min(90, Math.max(0, Math.round(p.confidence)));
        const edge = evaluateHandicapEdge(input.handicapLine, value, confidence);
        if (!edge.passes) {
          handicapRejections.push({ selection: value, line: input.handicapLine.line, confidence, reason: edge.reason ?? "failed the value gate" });
          return null;
        }
      }

      const validStructured = isValidSelection(p.marketType, p.selection) && generatableLine;
      const marketType: MarketType = validStructured ? p.marketType : "OTHER";
      const selection: Selection = validStructured ? p.selection : null;
      // Fallback only matters if Gemini emits something malformed despite the
      // schema — there's no usable free-text market/pick to recover in that
      // case, so this becomes a clearly-incomplete row for the admin to fix.
      const { market, pick } = deriveMarketAndPick(marketType, selection, homeTeamName, awayTeamName, {
        market: "Other",
        pick: "",
      });

      const validOU = typeof p.overUnderLine === "number" && (p.overUnderDirection === "OVER" || p.overUnderDirection === "UNDER");
      const ouLine = validOU ? p.overUnderLine : null;
      const ouDirection = validOU ? p.overUnderDirection : null;

      const isolatesComboLegs = input.intent === REGULAR_COMBO_INTENT || input.categories.includes(SAME_GAME_DOUBLE);
      // A Goals pick is filed under GOALS alone — never FEATURED — and GOALS is
      // still derived from the market by setPredictionCategories below.
      // BET_OF_THE_DAY is never persisted at generation: the tag is only ever
      // set by setBetOfTheDay (auto-selection behind the odds gate, or an
      // admin pin). A generated row carrying it skipped both the 2.20-4.50
      // price gate and the today-only rule, and reached the homepage slot
      // (a Sunday Double Chance at 1.18 shown on Saturday).
      const requested = input.categories.filter((c) => c !== "BET_OF_THE_DAY");
      const persistedCategories = goalsOnly ? [...GOALS_PERSISTED_CATEGORIES] : isolatesComboLegs ? [SAME_GAME_DOUBLE] : requested.length ? requested : ["FEATURED"];
      const pred = await prisma.prediction.create({
        data: {
          fixtureId: input.fixtureId,
          fixtureApiId: input.fixtureApiId,
          category: persistedCategories[0],
          leagueApiId: input.leagueApiId,
          leagueName: input.league,
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          homeTeamApiId: homeApiId,
          awayTeamApiId: awayApiId,
          kickoff: isNaN(kickoffDate.getTime()) ? undefined : kickoffDate,
          status: "PENDING_REVIEW",
          marketType,
          selection: selection ?? undefined,
          manualSettlementOnly: marketType === "OTHER",
          market,
          pick,
          ouLine,
          ouDirection,
          overUnder: deriveOverUnderText(ouLine, ouDirection),
          odds: null,
          confidence: Math.min(90, Math.max(0, Math.round(p.confidence))),
          reasoning: p.reasoning,
          matchPreview: output.matchPreview,
          // keyFactors has been generated since the beginning and dropped here.
          // Shared across this job's rows exactly as matchPreview is — one
          // analysis, several market rows.
          analysisJson: { ...buildAnalysis(output), ...(marketSelection ? { selectionQuality: selectionQualityFor(marketSelection, p) } : {}) } as unknown as Prisma.InputJsonValue,
          contextComplete,
          provenance,
          authorId: input.authorId,
          aiJobId: job.id,
        },
      });
      // GOALS is derived from this market inside setPredictionCategories; the
      // isolated combo legs above carry SAME_GAME_DOUBLE and so never get it.
      await setPredictionCategories(pred.id, persistedCategories, { marketType, selection });
      return pred;
    }),
  )).filter((p): p is NonNullable<typeof p> => p !== null);

  // The dedicated paid passes ask for several markets so their odds gate has
  // more than one selection to judge, not so a double can be built: their
  // fixture already carries ordinary coverage, and a double is never a paid
  // pick. The European-club lane asks for several for the same reason and
  // keeps at most one. Regular-combo and doubles jobs assemble exactly as before.
  const combo = marketBreadth === "multi" && input.intent !== "MARKET_CONFIRMED" && input.intent !== "VIP_PREMIUM" && input.intent !== "EUROPEAN_CLUB"
    ? await assembleGeneratedSameGameDouble(created.map((prediction) => prediction.id), input.comboCategories ?? input.categories)
    : null;

  return { job, preview: output.matchPreview, predictions: created, combo, sources, durationMs, handicapRejections, goalsRejections };
}

/**
 * The fixture's bookmaker prices for the odds checks: the cached quote,
 * or one api-football call to fetch it when the fixture has never been priced
 * (a failed attempt in the last 6 hours is not retried). Null when there is no
 * quote; generation then runs without the odds checks.
 */
async function loadFixtureOdds(
  homeTeamApiId: number | null,
  awayTeamApiId: number | null,
  kickoff: string,
  fixtureApiId: number | undefined,
  cacheOnly = false,
): Promise<{ odds: FixtureOdds; fetchedAt: Date | null } | null> {
  const key = matchKey({ homeTeamApiId, awayTeamApiId, kickoff });
  if (!key) return null;
  try {
    const cached = await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true, lastAttemptAt: true } });
    if (cached?.fetchedAt && cached.oddsJson) return { odds: cached.oddsJson as unknown as FixtureOdds, fetchedAt: cached.fetchedAt };
    const kickoffDate = new Date(kickoff);
    const triedRecently = cached?.lastAttemptAt && Date.now() - cached.lastAttemptAt.getTime() < 6 * 3_600_000;
    if (cacheOnly || fixtureApiId == null || triedRecently || isNaN(kickoffDate.getTime())) return null;
    // Dynamic: enrichment is a large module the rest of generation never needs.
    const { refreshOddsCache } = await import("@/lib/enrichment");
    const res = await refreshOddsCache({ matchKey: key, fixtureApiId, kickoff: kickoffDate, kind: "candidate" });
    if (res.result !== "ok") return null;
    const fresh = await prisma.fixtureOddsCache.findUnique({ where: { matchKey: key }, select: { oddsJson: true, fetchedAt: true } });
    return fresh?.oddsJson ? { odds: fresh.oddsJson as unknown as FixtureOdds, fetchedAt: fresh.fetchedAt } : null;
  } catch (err) {
    console.warn("[generate] odds lookup failed; odds checks skipped", err);
    return null;
  }
}


/**
 * The persisted row's own price-quality snapshot, fixed at generation so later
 * ranking is stable and outcome-blind (homepage / Genius read it; it never
 * changes after this point and is never shown to readers).
 */
function selectionQualityFor(rec: SelectionRecord, draft: { marketType: string; selection: unknown }) {
  const own = rec.candidates.find((c) => c.marketType === draft.marketType && JSON.stringify(c.selection) === JSON.stringify(draft.selection));
  return { policyVersion: rec.policyVersion, mode: rec.mode, decision: rec.decision, holdReason: rec.holdReason,
    tier: own?.tier ?? "UNPRICED", median: own?.median ?? null, books: own?.books ?? null, fair: own?.fair ?? null, blended: own?.blended ?? null };
}
