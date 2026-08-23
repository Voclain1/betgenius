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
   one of these five marketType values and the EXACT matching selection shape:

   - "MATCH_WINNER"   -> selection: { "value": "HOME" | "DRAW" | "AWAY" }
   - "DOUBLE_CHANCE"  -> selection: { "value": "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "HOME_OR_AWAY" }
   - "OVER_UNDER"     -> selection: { "line": number, "direction": "OVER" | "UNDER" }   // e.g. line 2.5
   - "BTTS"           -> selection: { "value": "YES" | "NO" }
   - "CORRECT_SCORE"  -> selection: { "home": integer >= 0, "away": integer >= 0 }

   Do not invent other marketType values and do not deviate from these selection shapes.
5. Every prediction ALSO has a separate, always-present total-goals over/under call —
   "overUnderLine" (a number, e.g. 2.5) and "overUnderDirection" ("OVER" | "UNDER") —
   independent of whatever the primary marketType/selection is about.
6. Output STRICT JSON matching this TypeScript type — no markdown fences, no commentary:

{
  "matchPreview": string,          // 2-4 short paragraphs in markdown
  "predictions": [
    {
      "marketType": "MATCH_WINNER" | "DOUBLE_CHANCE" | "OVER_UNDER" | "BTTS" | "CORRECT_SCORE",
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

export function buildSystemPrompt(tiers: GenerationTier[], riskCalibration = true): string {
  if (!riskCalibration) return BASE_SYSTEM_PROMPT;

  return `${BASE_SYSTEM_PROMPT}

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
  /** Comparison harness only: false reproduces the pre-calibration prompt. */
  riskCalibration?: boolean;
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
    system: buildSystemPrompt(input.tiers, input.riskCalibration !== false),
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
