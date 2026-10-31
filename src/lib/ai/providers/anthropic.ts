/**
 * Anthropic provider — Claude Haiku 5.5 by default.
 *
 * NOT in the production chain (src/lib/ai/analysis.ts PROVIDER_CHAIN). It is
 * here so the model comparison (scripts/compare-models.ts) sends the exact
 * production prompt through the same provider contract Gemini and Groq use,
 * and so that switching, if the comparison supports it, is a one-line change
 * to the chain rather than new code written under pressure.
 *
 * Plain prompt-for-JSON, like the other providers: parsing and every check stay
 * in analysis.ts, so a comparison measures the models, not two pipelines.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/providers/types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/**
 * Effort for the model's adaptive thinking ("low" | "medium" | "high"). Haiku
 * 5.5 defaults to medium; ANTHROPIC_EFFORT lets the comparison measure whether
 * a lower setting holds quality for less output.
 */
const effort = () => process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | undefined;

export const anthropicProvider: AIProvider = {
  name: "anthropic",

  isConfigured: () => !!process.env.ANTHROPIC_API_KEY,

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const client = new Anthropic();
    const e = effort();

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
  },
};
