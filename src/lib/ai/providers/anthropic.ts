/**
 * Anthropic provider — Claude Haiku 5.5, the primary (see PROVIDER_CHAIN in
 * src/lib/ai/analysis.ts for why, and at what effort). The model comparison
 * (scripts/compare-models.ts) goes through the same provider.
 *
 * Plain prompt-for-JSON, like the other providers: parsing and every check stay
 * in analysis.ts, so a comparison measures the models, not two pipelines.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/providers/types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export type AnthropicEffort = "low" | "medium" | "high";

/**
 * A provider at a given effort for the model's adaptive thinking. Haiku 5.5
 * defaults to medium; the comparison runs more than one setting side by side.
 * Without an explicit effort, ANTHROPIC_EFFORT applies, else the model default.
 */
export function makeAnthropicProvider(opts: { effort?: AnthropicEffort } = {}): AIProvider {
  return {
    name: "anthropic",
    isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
    complete: (req) => completeAnthropic(req, opts.effort ?? (process.env.ANTHROPIC_EFFORT as AnthropicEffort | undefined)),
  };
}

export const anthropicProvider: AIProvider = makeAnthropicProvider();

async function completeAnthropic(req: CompletionRequest, e: AnthropicEffort | undefined): Promise<CompletionResult> {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  // 90s per attempt: a high-effort call measured ~21s at p50, and the route's
  // maxDuration has to leave room for the fallback after a hung request.
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });

  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    ...(e ? { output_config: { effort: e } } : {}),
  });

  if (res.stop_reason === "refusal") {
    throw Object.assign(new Error(`anthropic refused (${res.stop_details?.category ?? "no category"})`), { name: "ModelRefusalError" });
  }
  if (res.stop_reason === "max_tokens") {
    throw Object.assign(new Error("anthropic output hit max_tokens"), { name: "NonJsonOutputError" });
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    text,
    usage: {
      promptTokens: res.usage.input_tokens ?? null,
      // Thinking is billed as output and already included in output_tokens.
      outputTokens: res.usage.output_tokens ?? null,
      totalTokens: (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0) || null,
    },
    model: `anthropic:${model}`,
  };
}
