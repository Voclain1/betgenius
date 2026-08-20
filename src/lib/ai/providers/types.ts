/**
 * The narrow contract every model provider implements.
 *
 * Providers move bytes and nothing else: they take a system prompt and a user
 * prompt, return text and what it cost. All the domain logic — building the
 * prompt from a MatchDigest, parsing the JSON, validating the market/selection
 * shapes — stays in src/lib/ai/analysis.ts, in ONE place, so adding a provider
 * can never fork the way a prediction is produced.
 *
 * That split is what makes the fallback safe. A request answered by Groq goes
 * through exactly the same prompt construction and the same parsing as one
 * answered by Gemini; only the transport differs.
 */

/** Token accounting, as the provider reports it. Null where a provider doesn't say. */
export type AIUsage = { promptTokens: number | null; outputTokens: number | null; totalTokens: number | null };

export type CompletionRequest = {
  system: string;
  user: string;
  /** Omitted means the provider default. Raised only for rewrites — see analysis.ts. */
  temperature?: number;
  /** A label for logs, e.g. "Sirius vs BK Hacken". Never sent to the model. */
  label: string;
};

export type CompletionResult = {
  text: string;
  usage: AIUsage;
  /**
   * Provider-qualified model id, e.g. "gemini:gemini-2.5-flash" or
   * "groq:openai/gpt-oss-120b". Written to AIJob.model, which is already a free
   * text column — so which provider actually answered is recoverable per job
   * without a schema change.
   */
  model: string;
};

export interface AIProvider {
  /** Short stable id used as the AIJob.model prefix and in logs. */
  readonly name: string;
  /** False when the provider isn't configured (no API key) — the chain skips it rather than throwing. */
  isConfigured(): boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Thrown when every configured provider failed, carrying each failure for the admin-facing error. */
export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Array<{ provider: string; error: string }>) {
    super(`Every AI provider failed: ${attempts.map((a) => `${a.provider} (${a.error})`).join("; ")}`);
    this.name = "AllProvidersFailedError";
  }
}
