/**
 * Turning a MatchDigest into a prediction — prompt construction, provider
 * selection, parsing.
 *
 * Provider-agnostic on purpose. Everything that decides WHAT a prediction says
 * lives here and runs identically whoever answers; the providers under
 * ./providers only carry bytes to a model and back. That is what makes the
 * Groq fallback safe to enable: a failed-over generation is the same question,
 * parsed the same way, not a second pipeline that happens to produce
 * similar-looking rows.
 */
import { AUTO_MARKET_TYPES, type MarketType, type Selection } from "@/lib/markets";
import { certaintyProhibitionBlock } from "@/lib/certaintyLanguage";
import { isModelUnavailable, isQuotaExhausted } from "@/lib/ai/retry";
import type { MatchDigest } from "@/lib/ai/digest";
import { geminiProvider } from "@/lib/ai/providers/gemini";
import { groqProvider } from "@/lib/ai/providers/groq";
import { AllProvidersFailedError, type AIProvider, type AIUsage, type CompletionRequest } from "@/lib/ai/providers/types";

export type { AIUsage } from "@/lib/ai/providers/types";

/**
 * Gemini first, Groq only as a fallback — a deliberate ordering, not a race.
 * Gemini is the model the published track record was built on; Groq exists so
 * an outage or an exhausted quota degrades the service instead of stopping it.
 */
const PROVIDER_CHAIN: AIProvider[] = [geminiProvider, groqProvider];

/**
 * Should the next provider be tried, or is this request simply wrong?
 *
 * Only transient, provider-specific conditions fail over: exhausted retries on
 * a 503, an exhausted quota/rate limit, or a transport failure (DNS, TLS,
 * timeout — the shape a network-level block takes). A 400 means the prompt is
 * malformed and a 401/403 means the key is bad; both would fail identically on
 * every provider, so they surface immediately rather than burning the fallback
 * and reporting a confusing second error.
 *
 * Exported for scripts/check-providers.ts — this policy is the whole behaviour
 * of the fallback, and a copy of it in the checks could silently drift from the
 * copy that runs.
 */
export function shouldFailOver(err: unknown): boolean {
  if (isModelUnavailable(err) || isQuotaExhausted(err)) return true;
  const e = err as { name?: unknown; message?: unknown; cause?: unknown };
  // NonJsonOutputError: the request was fine, this provider just wrote prose.
  // Worth asking the other one rather than failing the generation.
  if (e?.name === "ModelUnavailableError" || e?.name === "AbortError" || e?.name === "NonJsonOutputError") return true;
  const msg = typeof e?.message === "string" ? e.message : "";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket disconnected|network/i.test(msg)) return true;
  // A 5xx from any provider is worth trying elsewhere; a 4xx is not.
  return /\b5\d\d\b/.test(msg);
}

export type AIPredictionOutput = {
  matchPreview: string; // markdown
  predictions: Array<{
    marketType: MarketType;
    selection: Selection;
    overUnderLine: number;
    overUnderDirection: "OVER" | "UNDER";
    confidence: number; // 0-100
    reasoning: string; // markdown
  }>;
  keyFactors: string[];
};

/**
 * `usage` is what the call actually cost, as the answering provider reported
 * it; `model` is provider-qualified ("gemini:gemini-2.5-flash"). Both are
 * persisted on AIJob so cost and provider are recoverable per job — see the
 * token columns in schema.prisma.
 */
export type AIPredictionResult = { output: AIPredictionOutput; usage: AIUsage; model: string };

const BASE_SYSTEM_PROMPT = `You are BetGenius, an expert football analyst.
You produce probabilistic match analyses grounded in the data you are given.

Rules:
1. Only use the fixture, form, availability and standings data provided in the user message.
   Do NOT invent players, transfers, or scores. Every player name, number, scoreline
   and percentage you write must appear in that data. If you want to say something the
   data does not support, leave it out.
1b. The data is a DIGEST with a "coverage" object saying which parts resolved. Where
   coverage is false, that section is UNKNOWN, not empty — say nothing about it rather
   than treating it as an absence. In particular: coverage.availability false means the
   team-news feed did not resolve, NOT that both squads are fully fit. An empty
   "availability" list WITH coverage.availability true does mean nobody is reported out.
1c. "availability" lists players unavailable for the upcoming match, each with a kind:
   "injury" (fitness), "suspension" (certain, serves out), "unavailable" (not selected —
   do not describe these as injured). "availabilityAsOf" is the matchday the list was
   read from; if it is well before kickoff, treat it as indicative rather than current.
1d. "standings.neighbourhood" is only the rows around the two teams, not the whole
   table — the two sides are flagged with "isFixtureTeam", and "zone" carries the
   competition's own label for that position (relegation, European qualification).
   Use it for what is at stake; do not extrapolate positions it does not contain.
1e. A null field means "not available", never zero. Fields are omitted rather than
   zero-filled when a season has not started, so do not read a missing average as
   a team that cannot score.
1f. When fixture.competitionType is "CUP", analyse it as a knockout cup tie.
   Standings and league-position evidence do not apply and must never be mentioned.
   Cup-specific team statistics may be based on a small, uneven sample against
   opponents from different divisions, so treat them cautiously and prefer robust
   recent all-competition form, availability and head-to-head evidence when present.
   Use fixture.round when supplied, but do not invent aggregate scores, legs, replay
   rules or qualification scenarios that are absent from the evidence digest.
2. Return CONFIDENCE as a probability estimate (0-100). Be conservative — do not exceed 90
   unless the data is overwhelming.
3. Never claim a prediction is guaranteed. Frame outputs as probabilities.
4. Every prediction has a primary pick, expressed as "marketType" + "selection", using ONLY
   one of these six marketType values and the EXACT matching selection shape:

   - "MATCH_WINNER"   -> selection: { "value": "HOME" | "DRAW" | "AWAY" }
   - "DOUBLE_CHANCE"  -> selection: { "value": "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "HOME_OR_AWAY" }
   - "OVER_UNDER"     -> selection: { "line": number, "direction": "OVER" | "UNDER" }   // e.g. line 2.5
   - "BTTS"           -> selection: { "value": "YES" | "NO" }
   - "CORRECT_SCORE"  -> selection: { "home": integer >= 0, "away": integer >= 0 }
   - "WIN_EITHER_HALF" -> selection: { "value": "HOME" | "AWAY" }
     Wins if the chosen side outscores the opponent in the first half OR in the
     second half taken on its own. Losing the other half, or the match overall,
     does not matter. There is no draw option — the bet is on a side.

   Do not invent other marketType values and do not deviate from these selection shapes.
5. Every prediction ALSO has a separate, always-present total-goals over/under call —
   "overUnderLine" (a number, e.g. 2.5) and "overUnderDirection" ("OVER" | "UNDER") —
   independent of whatever the primary marketType/selection is about.
6. Output STRICT JSON matching this TypeScript type — no markdown fences, no commentary:

{
  "matchPreview": string,          // 2-4 short paragraphs in markdown
  "predictions": [
    {
      "marketType": "MATCH_WINNER" | "DOUBLE_CHANCE" | "OVER_UNDER" | "BTTS" | "CORRECT_SCORE" | "WIN_EITHER_HALF",
      "selection": { ... shape per marketType, see rule 4 ... },
      "overUnderLine": number,
      "overUnderDirection": "OVER" | "UNDER",
      "confidence": number,
      "reasoning": string
    }
  ],
  "keyFactors": string[]           // 3-6 bullet points
}`;

export type GenerationTier = "FEATURED" | "GENIUS" | "BANKER" | "VIP" | "PREMIUM" | "TODAY";

/**
 * Market-risk calibration modes.
 *
 * "off"        reproduces the pre-calibration prompt (comparison harness only).
 * "tiered"     the original calibration: hedging preference keyed to the TIER.
 * "margin"     the current rule: hedging keyed to the fixture's actual MARGIN,
 *              with tier only moving where the bar sits.
 *
 * Kept as three explicit modes rather than a boolean so the harness can put
 * "tiered" and "margin" side by side on the same stored evidence — the only way
 * to show what a prompt change actually does, rather than asserting it.
 */
export type RiskCalibrationMode = "off" | "tiered" | "margin";

/**
 * The original tier-keyed calibration. Retained verbatim for comparison; not
 * used in production.
 *
 * Its defect is the VIP/PREMIUM clause, which instructs the model to hedge
 * "even for a strongly lopsided fixture". Measured against real market prices,
 * that is exactly what it did: on fixtures where the book made the favourite
 * 65%+, VIP-tier drafts took the straight winner 35.7% of the time against
 * GENIUS-tier's 72.7% — a 37pp gap on fixtures of the same lopsidedness
 * (mean favourite 72.1% vs 73.2%).
 */
function tieredCalibrationBlock(tiers: GenerationTier[]): string {
  return `

7. TIER-AWARE MARKET RISK CALIBRATION. The active tier context for this draft is:
   ${tiers.length ? tiers.join(", ") : "UNSPECIFIED"}.
   Apply the strictest applicable rule when more than one tier is active:
   - GENIUS (safer): prefer a supported hedged market such as DOUBLE_CHANCE or a
     conservative OVER_UNDER/BTTS position whenever the evidence does not show an
     overwhelming mismatch. Do not use MATCH_WINNER merely because one side is a
     moderate favorite. A straight MATCH_WINNER is acceptable only when the supplied
     evidence shows a genuinely extreme, multi-signal advantage; explain why that high
     bar is met in the reasoning.
   - VIP or PREMIUM (more safer): use an even stricter safety bar. Default to
     DOUBLE_CHANCE or a conservative OVER_UNDER/BTTS position even for a strongly
     lopsided fixture. MATCH_WINNER should be genuinely exceptional, not the normal
     recommendation for a heavy favorite.
   - FEATURED, BANKER and TODAY: do not add any tier-specific hedging preference.
     Choose the best-supported market under the original rules.
   Market choice and reasoning must be made together from the evidence. Never change
   or mechanically substitute a market after deciding the analysis.`;
}

/**
 * Margin-keyed calibration.
 *
 * The rule the hedging policy was always meant to express: how much to hedge
 * follows the SIZE OF THE MISMATCH in the evidence, not the tier alone. Three
 * bands, stated as bands so the model has to place the fixture in one rather
 * than defaulting to a single safe market for everything.
 *
 * Tier still matters, but only as a modifier on where the bar sits — it can no
 * longer instruct hedging a fixture the evidence calls overwhelming, which is
 * what the tiered version did for VIP/PREMIUM.
 */
function marginCalibrationBlock(tiers: GenerationTier[]): string {
  const cautious = tiers.some((t) => t === "GENIUS" || t === "VIP" || t === "PREMIUM");
  return `

7. MARKET RISK CALIBRATION BY MARGIN. The active tier context for this draft is:
   ${tiers.length ? tiers.join(", ") : "UNSPECIFIED"}.

   First judge HOW LOPSIDED this fixture is from the supplied evidence — league
   position and points gap, recent form and scoring rates, home/away splits,
   head-to-head, and the injury/suspension picture. Then choose the market that
   matches that margin. The three bands are:

   - EXTREME MISMATCH (an overwhelming, multi-signal advantage: a large table and
     points gap, clearly stronger form and goal difference, no offsetting injury
     or fixture-congestion story). Take the straight MATCH_WINNER. Hedging a
     fixture this one-sided gives away nearly all of the value for almost no
     reduction in risk, and it is not the safer choice merely because it sounds
     safer. State in the reasoning which signals put the fixture in this band.

   - MODERATE FAVOURITE (one side is clearly better, but the evidence is mixed:
     a narrower gap, patchy form, a significant absence, or a strong away record
     against them). Hedge. Use DOUBLE_CHANCE, WIN_EITHER_HALF, or a conservative
     OVER_UNDER or BTTS position where the goal-scoring evidence supports it
     better than the result does.

     WIN_EITHER_HALF is a hedge on a DIFFERENT axis from DOUBLE_CHANCE, and the
     two suit different evidence. DOUBLE_CHANCE protects against losing the
     match; WIN_EITHER_HALF protects against not winning it across ninety
     minutes, and pays on a side that dominates a period without seeing it out.
     Prefer WIN_EITHER_HALF over DOUBLE_CHANCE when the evidence points to a
     side that scores in bursts, starts fast, or finishes strongly — a good
     scoring rate paired with defensive lapses or late goals conceded. Prefer
     DOUBLE_CHANCE when the side is solid but low-scoring, since a team that
     wins 1-0 on an early goal has still won a half only if it outscores the
     opponent within one of them.

   - CLOSE FIXTURE (the sides are comparable, or the evidence disagrees with
     itself). Either hedge with DOUBLE_CHANCE or a conservative OVER_UNDER/BTTS
     position, or take a narrower position with a CORRESPONDINGLY LOWER
     CONFIDENCE. Do not report high confidence on a fixture the evidence does not
     separate — a close game honestly marked at 55% is more useful than the same
     game dressed up at 75%.

   ${cautious
     ? `This draft is for a cautious tier (${tiers.join(", ")}). Set the bar for
   "extreme" HIGHER than you otherwise would, and when a fixture sits on the
   boundary between two bands, choose the more hedged one. This raises the bar;
   it does NOT authorise hedging a fixture the evidence genuinely shows to be
   overwhelming.`
     : `This draft is for a standard tier. Apply the bands as written, with no
   additional hedging preference.`}

   Market choice and reasoning must be made together from the evidence. Never change
   or mechanically substitute a market after deciding the analysis.`;
}

/**
 * How many market calls one analysis should produce.
 *
 * "single" is production: one primary pick per fixture, which is what the
 * pipeline has always emitted in practice (171 of 174 real jobs).
 *
 * "multi" asks for 2-3 picks on DISTINCT markets so a same-game double can be
 * assembled from two independently-reasoned rows. It is deliberately opt-in and
 * NOT yet wired into generation: every row created by one job inherits the same
 * categories (see generate.ts), so switching production to "multi" would put
 * two or three rows for the SAME fixture into every feed. That is a separate
 * decision from whether the model can produce usable pairs at all, which is
 * what this mode exists to measure.
 */
export type MarketBreadth = "single" | "multi";

/**
 * Asks for several markets on one fixture, and — more importantly — rules out
 * the pairs that look like combos but are not.
 *
 * The ban list is not stylistic. Two picks on one fixture can relate three
 * ways: they can contradict (impossible together), they can NEST (one logically
 * implies the other, so the pair is really just the stricter pick under a
 * longer name), or they can genuinely both constrain. Only the third is a
 * combo. Real generated data shows the model reaches for the nested case
 * unprompted — 2 of the 3 historical multi-market fixtures paired MATCH_WINNER
 * Home with DOUBLE_CHANCE Home-or-Draw, which is implied by it and adds nothing.
 *
 * Stated as evidence rules rather than as a lookup table because the model is
 * choosing markets from analysis, and a bare table invites it to satisfy the
 * table instead of the reasoning.
 */
function multiMarketBlock(): string {
  return `

MULTIPLE MARKET CALLS
=====================
Return 2 or 3 entries in "predictions" for this fixture, each on a DIFFERENT
marketType, each independently reasoned from the evidence with its own
"confidence" and its own "reasoning". Do not restate one pick's reasoning for
another. Return fewer entries — even just one — if the evidence only supports
one honest call. A thin or contradictory digest should produce one pick, never
padding.

The entries must be able to stand together as separate statements about the
match. Two rules make that true, and both are absolute:

1. NEVER pair picks where one already guarantees the other. The pair would be
   the stricter pick alone, dressed up. Specifically:
   - MATCH_WINNER with DOUBLE_CHANCE — banned in every combination. Backing a
     side to win already covers "that side or draw" and "either side"; backing a
     side to win contradicts "the other side or draw". There is no usable pair.
   - MATCH_WINNER with WIN_EITHER_HALF on the same side — banned. A side that
     wins the match must have outscored the opponent in at least one half.
   - BTTS "YES" with OVER_UNDER at line 1.5 or lower — banned. Both teams
     scoring already means at least two goals.
   - CORRECT_SCORE with anything — banned. An exact score already fixes the
     result, the goal total and whether both teams scored.
   - The same marketType twice — banned.

2. NEVER pair picks that cannot both be true:
   - BTTS "YES" with OVER_UNDER "UNDER" at line 1.5 or lower is impossible.
   - Opposite sides across two markets is contradictory.

Good pairings put the picks on different DIMENSIONS of the match — the result,
the goal total, whether both teams score, or how a single half goes. For
example a result call plus a goals call, or a goals call plus a both-teams-
to-score call at a line that does not already follow from it.

Order the entries with your highest-conviction call FIRST.`;
}

export function buildSystemPrompt(
  tiers: GenerationTier[],
  calibration: RiskCalibrationMode | boolean = "margin",
  breadth: MarketBreadth = "single",
): string {
  // Back-compat with the original boolean: false meant "no calibration", true
  // meant the tiered block that was current at the time.
  const mode: RiskCalibrationMode =
    calibration === false ? "off" : calibration === true ? "tiered" : calibration;

  // Appended last so the market-count instruction is read after the risk
  // calibration has already narrowed which markets are appropriate.
  const breadthBlock = breadth === "multi" ? multiMarketBlock() : "";

  // Appended to EVERY prompt, including the "off" comparison mode. The ban is
  // not a feature of one calibration or one pipeline — no draft may assert
  // certainty — and generation now rejects a draft that breaks it, so the
  // prompt and the scan have to agree in all modes.
  const certaintyBlock = certaintyProhibitionBlock();

  if (mode === "off") return `${BASE_SYSTEM_PROMPT}${breadthBlock}${certaintyBlock}`;
  return `${BASE_SYSTEM_PROMPT}${mode === "tiered" ? tieredCalibrationBlock(tiers) : marginCalibrationBlock(tiers)}${breadthBlock}${certaintyBlock}`;
}

/** The draft being replaced, shown to the model on a rewrite so it can't simply restate it. */
export type PreviousDraft = { matchPreview?: string | null; reasoning?: string | null; pick?: string | null; confidence?: number | null };

export async function generatePredictionForFixture(input: {
  /** The trimmed football evidence — see src/lib/ai/digest.ts for what it keeps and why. */
  digest: MatchDigest;
  /** Free-text admin direction for a rewrite, e.g. "the confidence feels too high given the h2h". */
  reviewerNote?: string | null;
  /** Present only on a rewrite — triggers the revision framing and higher sampling temperature. */
  previousDraft?: PreviousDraft | null;
  /** Category context conditions market-risk selection in the system prompt. */
  tiers: GenerationTier[];
  /**
   * Which market-risk calibration to prompt with. Defaults to "margin", the
   * production rule. The harness (scripts/compare-market-calibration.ts) passes
   * "tiered" or "off" to render the earlier prompts against the same evidence.
   */
  riskCalibration?: RiskCalibrationMode | boolean;
  /**
   * How many market calls to ask for. Defaults to "single", which is what
   * production generation uses. Only the same-game-double research harness
   * (scripts/measure-market-breadth.ts) passes "multi" — see MarketBreadth.
   */
  marketBreadth?: MarketBreadth;
}): Promise<AIPredictionResult> {
  // No eager key check here, deliberately. This function predates the provider
  // chain and used to guard on GEMINI_API_KEY directly — which silently defeated
  // the whole point of the fallback: a missing or revoked Gemini key threw
  // before Groq was ever consulted, exactly when failing over matters most.
  // Configuration is now the chain's business (AIProvider.isConfigured), and
  // completeWithFallback raises a clear error when NOTHING is configured.

  const isRewrite = !!input.previousDraft;

  // A rewrite without direction must still produce a genuinely new analysis,
  // not a paraphrase. Two things force that: the previous draft is shown with
  // an explicit instruction not to restate it, and temperature is raised below.
  // Showing the old draft matters more than temperature — at default sampling
  // the same prompt over the same context reliably returns near-identical text.
  const revisionBlock = isRewrite
    ? `
This is a REVISION of an earlier draft for the same fixture, using the same
underlying data. The previous draft was:

Pick: ${input.previousDraft?.pick ?? "(none)"} at ${input.previousDraft?.confidence ?? "?"}% confidence
Preview: ${input.previousDraft?.matchPreview ?? "(none)"}
Reasoning: ${input.previousDraft?.reasoning ?? "(none)"}

Produce a genuinely different analysis: re-examine the evidence, take a
different angle, and do not restate the sentences above. You may keep the same
pick if the data still supports it, but the preview and reasoning must be newly
written, and reconsider whether the confidence level is right.
`
    : "";

  const directionBlock = input.reviewerNote?.trim()
    ? `
REVIEWER DIRECTION — this is an explicit instruction from a human editor and
takes priority over your own stylistic preferences. Address it directly and
visibly in the new draft:

"${input.reviewerNote.trim()}"

Still obey every formatting and data-grounding rule above; the direction changes
emphasis, tone and judgement, never the output schema or the ban on inventing
facts not present in the data.
`
    : "";

  const d = input.digest;

  // Compact, NOT pretty-printed. Indentation alone roughly doubled the payload
  // (a live mid-season fixture measured 253KB pretty vs 155KB compact before
  // trimming), and buys the model nothing — it is not reading it as a document.
  const userPrompt = `Analyse this fixture and return JSON only.

Fixture:
- ${d.fixture.home} (home) vs ${d.fixture.away} (away)
- League: ${d.fixture.league}
- Kickoff: ${d.fixture.kickoff}

Evidence digest (JSON):
${JSON.stringify(d)}
${revisionBlock}${directionBlock}
Return JSON only. marketType must be one of: ${AUTO_MARKET_TYPES.join(", ")}.`;

  const label = `${d.fixture.home} vs ${d.fixture.away}`;
  const request = {
    system: buildSystemPrompt(input.tiers, input.riskCalibration ?? "margin", input.marketBreadth ?? "single"),
    user: userPrompt,
    label,
    // Raised only for rewrites. First-pass generation stays on the model
    // default, where consistency is what's wanted; a rewrite is explicitly a
    // request for a different take, so the extra variance is the point.
    ...(isRewrite ? { temperature: 1.0 } : {}),
  };

  return completeWithFallback(request, parsePredictionOutput, PROVIDER_CHAIN);
}

/**
 * Strip accidental code fences and parse. Fences appear despite both providers
 * being asked for JSON natively, so this stays in the shared path rather than
 * per provider.
 */
function parsePredictionOutput(text: string): AIPredictionOutput {
  const cleaned = text.replace(/^```json\s*|^```\s*|```$/gim, "").trim();
  return JSON.parse(cleaned) as AIPredictionOutput;
}

/**
 * Walk the provider chain until one returns output that parses.
 *
 * Separated from prompt construction so the fallback behaviour can be exercised
 * with injected providers (scripts/check-providers.ts) rather than only against
 * a live outage — the branch that matters most here is the one that is hardest
 * to reproduce on demand.
 *
 * Unconfigured providers are skipped, not attempted: a missing GROQ_API_KEY
 * means "no fallback available", which must not itself become a failure.
 */
export async function completeWithFallback<T>(
  request: CompletionRequest,
  parse: (text: string) => T,
  providers: AIProvider[],
): Promise<{ output: T; usage: AIUsage; model: string }> {
  const attempts: Array<{ provider: string; error: string }> = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;

    try {
      const res = await provider.complete(request);

      let output: T;
      try {
        output = parse(res.text);
      } catch {
        // Unparseable output is a provider-quality problem, not a bad request,
        // so it fails over like any other provider failure rather than ending
        // the run — the fallback may well return valid JSON for this prompt.
        // Worded to match shouldFailOver's 5xx-free transient set explicitly.
        throw Object.assign(new Error(`${provider.name} returned non-JSON output: ${res.text.slice(0, 200)}`), {
          name: "NonJsonOutputError",
        });
      }

      if (attempts.length > 0) {
        console.warn(`[ai] ${request.label}: answered by fallback ${res.model} after ${attempts.map((a) => a.provider).join(", ")} failed`);
      }
      return { output, usage: res.usage, model: res.model };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      attempts.push({ provider: provider.name, error: message });

      if (!shouldFailOver(err)) throw err;
      console.warn(`[ai] ${request.label}: ${provider.name} failed (${message.slice(0, 160)}) — trying next provider`);
    }
  }

  if (attempts.length === 0) {
    throw new Error("No AI provider is configured — set GEMINI_API_KEY (and optionally GROQ_API_KEY for fallback)");
  }
  throw new AllProvidersFailedError(attempts);
}
