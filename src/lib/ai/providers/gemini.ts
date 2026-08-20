/**
 * Gemini provider — the primary.
 *
 * Keeps the 503 retry policy from src/lib/ai/retry.ts wrapped around ONLY the
 * model request, for the same reason it always was: the prompt it retries was
 * built from ~11 metered api-football calls, and retrying a level up would
 * re-buy all of them. The retry stays here rather than in the chain because it
 * is Gemini-specific — a 503 from Gemini means "under load, try again", which
 * is not a claim any other provider's 503 makes.
 */
import { GoogleGenAI } from "@google/genai";
import { withUnavailableRetry } from "@/lib/ai/retry";
import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/providers/types";

/**
 * The model this app is pinned to. NEVER an alias.
 *
 * "gemini-flash-latest" silently repoints at a new model, changing price,
 * latency and output shape underneath a running app — a change that should be a
 * deploy, not a Tuesday. It has already done so twice here: it moved to 3.7
 * Flash without a code change, and 3.7 Flash's introductory pricing doubles on
 * 2027-01-01. Both are fine as *decisions* and unacceptable as surprises.
 *
 * Why 3.7 rather than the cheaper 2.5 Flash:
 *   - Gemini 2.5 Flash retires no earlier than 2026-10-16, so pinning to it
 *     buys a forced migration within weeks to save a few dollars a month.
 *   - Every measurement and prompt validation in this codebase was taken on
 *     3.7 Flash (3,788 input / 1,400 output tokens on a real fixture), so
 *     pinning here is behaviourally a no-op — which is exactly what a pin
 *     should be.
 *   - At ~40 fixtures/day the difference is roughly $5/month now and $14/month
 *     after the January price change: immaterial next to the risk of an
 *     unvalidated model regressing strict-JSON adherence or the grounding rules.
 *
 * Revisit before 2027-01-01 when the introductory pricing ends. If cost matters
 * then, A/B a replacement with scripts/validate-digest.ts rather than switching
 * blind — the harness already reports tokens, latency and both outputs.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

export const geminiProvider: AIProvider = {
  name: "gemini",

  isConfigured: () => !!process.env.GEMINI_API_KEY,

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    // Constructed per call rather than at module load: the old module-level
    // client captured the key at import time, which made the provider
    // untestable and broke if the env was populated late.
    const client = new GoogleGenAI({ apiKey });

    const res = await withUnavailableRetry(
      () =>
        client.models.generateContent({
          model,
          contents: req.user,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          },
        }),
      req.label,
    );

    const meta = res.usageMetadata;
    return {
      text: (res.text ?? "").trim(),
      usage: {
        promptTokens: meta?.promptTokenCount ?? null,
        // Thinking tokens are billed as output but reported separately, so a
        // bare candidatesTokenCount under-reports what the call really cost.
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0) || null,
        totalTokens: meta?.totalTokenCount ?? null,
      },
      model: `gemini:${model}`,
    };
  },
};
