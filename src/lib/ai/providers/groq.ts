/**
 * Groq provider — the fallback.
 *
 * Plain fetch against Groq's OpenAI-compatible chat-completions endpoint. No
 * `openai` or `groq-sdk` dependency: this is one POST with a JSON body, and a
 * dependency whose only job is to build that body would be more surface than
 * the code it replaces.
 *
 * Reached only when Gemini is unavailable or out of quota (see the chain in
 * src/lib/ai/analysis.ts). It is deliberately NOT load-balanced against Gemini
 * — two models answering the same question on alternate days would make the
 * published track record a measurement of two different things.
 */
import type { AIProvider, CompletionRequest, CompletionResult } from "@/lib/ai/providers/types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq shut down llama-3.3-70b-versatile and llama-3.1-8b-instant on
 * 2026-08-16, naming gpt-oss-120b as the replacement for the 70b tier. This is
 * a "production" model in Groq's lifecycle terms (preview models can be
 * withdrawn at short notice), and supports the JSON response format this
 * prompt depends on.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Fallback must not hang behind the primary's own budget — the route's maxDuration has to cover both. */
const TIMEOUT_MS = 60_000;

type GroqResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string };
};

export const groqProvider: AIProvider = {
  name: "groq",

  isConfigured: () => !!process.env.GROQ_API_KEY,

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        // Never cached: this is a generation, and Next would otherwise be free
        // to serve a previous fixture's analysis for a matching body.
        cache: "no-store",
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          // The OpenAI-compatible equivalent of Gemini's responseMimeType. The
          // prompt already specifies the schema and says "JSON only"; this stops
          // the model wrapping it in prose or fences.
          response_format: { type: "json_object" },
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as GroqResponse;
    if (json.error) throw new Error(`Groq error: ${json.error.message ?? json.error.type ?? "unknown"}`);

    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("Groq returned an empty completion");

    return {
      text: text.trim(),
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? null,
        outputTokens: json.usage?.completion_tokens ?? null,
        totalTokens: json.usage?.total_tokens ?? null,
      },
      model: `groq:${model}`,
    };
  },
};
