/**
 * Offline self-checks for the provider fallback chain.
 *
 * No network and no API keys: the chain's decisions are driven entirely by the
 * shape of the error it catches, so injected failures exercise it exactly as a
 * live outage would. What's being pinned down here is the rule that matters —
 * a transient or provider-specific failure fails OVER, a malformed request or
 * bad key fails FAST. Getting that backwards either burns the fallback on
 * requests that can never succeed, or silently stops generating when Gemini has
 * a bad hour.
 *
 * Run: npx tsx scripts/check-providers.ts
 */
import { isModelUnavailable, isQuotaExhausted, ModelUnavailableError } from "../src/lib/ai/retry";
import { shouldFailOver, completeWithFallback } from "../src/lib/ai/analysis";
import { AllProvidersFailedError, type AIProvider } from "../src/lib/ai/providers/types";
import { DEFAULT_GEMINI_MODEL } from "../src/lib/ai/providers/gemini";
import { DEFAULT_GROQ_MODEL } from "../src/lib/ai/providers/groq";

let passed = 0;
const failures: string[] = [];
const check = (label: string, cond: boolean, got?: unknown) => {
  if (cond) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`}`);
};
const eq = (label: string, a: unknown, b: unknown) => check(label, JSON.stringify(a) === JSON.stringify(b), a);

// --- Error classification -------------------------------------------------
// Shapes taken from what the @google/genai SDK and a raw fetch actually throw.
check("503 by numeric status", isModelUnavailable({ status: 503 }));
check("503 nested in error.code", isModelUnavailable({ error: { code: 503 } }));
check("UNAVAILABLE by status string", isModelUnavailable({ error: { status: "UNAVAILABLE" } }));
check("overloaded in message text", isModelUnavailable({ message: "The model is overloaded. Try again later." }));
check("429 is NOT treated as unavailable", !isModelUnavailable({ status: 429 }));

check("429 by numeric status", isQuotaExhausted({ status: 429 }));
check("RESOURCE_EXHAUSTED by status string", isQuotaExhausted({ error: { status: "RESOURCE_EXHAUSTED" } }));
check("quota wording in message", isQuotaExhausted({ message: "You exceeded your current quota" }));
check("rate limit wording in message", isQuotaExhausted({ message: "Rate limit reached for model" }));
check("503 is NOT treated as quota", !isQuotaExhausted({ status: 503 }));
check("400 is neither unavailable nor quota", !isModelUnavailable({ status: 400 }) && !isQuotaExhausted({ status: 400 }));

// --- Fail-over policy -----------------------------------------------------
// The REAL policy from analysis.ts, not a copy — a reimplementation here could
// pass while the shipped chain behaves differently.
check("fails over: retries exhausted on 503", shouldFailOver(new ModelUnavailableError(4, null)));
check("fails over: quota exhausted", shouldFailOver({ status: 429 }));
check("fails over: transport failure", shouldFailOver(new TypeError("fetch failed")));
check("fails over: TLS reset (the SNI-block shape)", shouldFailOver({ message: "Client network socket disconnected before secure TLS connection was established" }));
check("fails over: request timeout abort", shouldFailOver(Object.assign(new Error("aborted"), { name: "AbortError" })));
check("fails over: provider 500", shouldFailOver(new Error("Groq 500: internal error")));
check("fails over: unparseable model output", shouldFailOver(new Error("gemini 503 returned non-JSON output")));

check("fails FAST: malformed request", !shouldFailOver(new Error("Groq 400: invalid model")));
check("fails FAST: bad api key", !shouldFailOver(new Error("Groq 401: invalid api key")));
check("fails FAST: forbidden", !shouldFailOver({ status: 403, message: "403 permission denied" }));
check("fails FAST: ordinary programming error", !shouldFailOver(new TypeError("x is not a function")));

// --- Configuration gating -------------------------------------------------
// isConfigured is what lets the chain skip an unconfigured provider instead of
// throwing, so "no GROQ_API_KEY" means "no fallback", not "generation fails".
const savedGemini = process.env.GEMINI_API_KEY;
const savedGroq = process.env.GROQ_API_KEY;
try {
  // Imported lazily so the env edits above are visible to isConfigured().
  const { geminiProvider } = require("../src/lib/ai/providers/gemini");
  const { groqProvider } = require("../src/lib/ai/providers/groq");

  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  check("gemini reports unconfigured without a key", !geminiProvider.isConfigured());
  check("groq reports unconfigured without a key", !groqProvider.isConfigured());

  process.env.GEMINI_API_KEY = "x";
  process.env.GROQ_API_KEY = "y";
  check("gemini reports configured with a key", geminiProvider.isConfigured());
  check("groq reports configured with a key", groqProvider.isConfigured());
} finally {
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGemini;
  if (savedGroq === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedGroq;
}

// --- Model defaults -------------------------------------------------------
// The durable invariant: no alias, ever. A "-latest" default silently repoints
// the app at a new model — it has already done so once here, moving generation
// onto 3.7 Flash with no code change. The exact version below will churn as
// models retire; this first assertion must not.
check("gemini default is pinned, not a -latest alias", !DEFAULT_GEMINI_MODEL.includes("latest"));
check("gemini default names a concrete version", /^gemini-\d+(\.\d+)?-/.test(DEFAULT_GEMINI_MODEL), DEFAULT_GEMINI_MODEL);
// Gemini 2.5 retires from 2026-10-16, so the default must have moved past it.
check("gemini default is not a 2.5 model, which is retiring", !DEFAULT_GEMINI_MODEL.startsWith("gemini-2.5"), DEFAULT_GEMINI_MODEL);
eq("gemini default", DEFAULT_GEMINI_MODEL, "gemini-3.7-flash");
// Groq shut these down on 2026-08-16 (console.groq.com/docs/deprecations).
check("groq default is not a decommissioned llama model", !/llama-3\.[13]/.test(DEFAULT_GROQ_MODEL));
eq("groq default", DEFAULT_GROQ_MODEL, "openai/gpt-oss-120b");

// --- The fallback loop itself, with injected providers --------------------
// This is the branch a live outage exercises and a happy-path deploy never
// does, so it's driven here with fake providers instead of a real key.
const req = { system: "s", user: "u", label: "Test vs Test" };
const parseJson = (t: string) => JSON.parse(t) as { ok: boolean };

const fake = (name: string, behaviour: () => Promise<any>, configured = true): AIProvider => ({
  name,
  isConfigured: () => configured,
  complete: behaviour,
});
const ok = (name: string, text = '{"ok":true}') =>
  fake(name, async () => ({ text, usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15 }, model: `${name}:m` }));
const fails = (name: string, err: unknown) => fake(name, async () => { throw err; });

// Quieten the chain's expected fail-over warnings so the check output stays readable.
const realWarn = console.warn;
console.warn = () => {};

async function loopChecks() {
  const primaryWins = await completeWithFallback(req, parseJson, [ok("gemini"), ok("groq")]);
  eq("loop: primary answers when healthy", primaryWins.model, "gemini:m");
  eq("loop: usage passed through from the answering provider", primaryWins.usage.promptTokens, 10);

  const failedOver = await completeWithFallback(req, parseJson, [fails("gemini", new ModelUnavailableError(4, null)), ok("groq")]);
  eq("loop: falls over to groq on exhausted 503 retries", failedOver.model, "groq:m");

  // The regression this guards: generatePredictionForFixture used to check
  // GEMINI_API_KEY itself and throw before the chain ran, so a missing or
  // revoked primary key defeated the fallback entirely — failing exactly when
  // failing over matters most. Configuration belongs to isConfigured() alone.
  const primaryUnconfigured = await completeWithFallback(req, parseJson, [ok("gemini", '{"ok":true}') && fake("gemini", async () => { throw new Error("should never be called"); }, false), ok("groq")]);
  eq("loop: an UNCONFIGURED primary is skipped, not fatal", primaryUnconfigured.model, "groq:m");

  const quotaOver = await completeWithFallback(req, parseJson, [fails("gemini", { status: 429, message: "429 quota" }), ok("groq")]);
  eq("loop: falls over on exhausted quota", quotaOver.model, "groq:m");

  const blockedOver = await completeWithFallback(req, parseJson, [fails("gemini", new TypeError("fetch failed")), ok("groq")]);
  eq("loop: falls over when the primary is unreachable", blockedOver.model, "groq:m");

  // Non-JSON from the primary must reach the fallback, not end the run.
  const badJsonOver = await completeWithFallback(req, parseJson, [ok("gemini", "Here is my analysis:"), ok("groq")]);
  eq("loop: falls over when the primary returns prose", badJsonOver.model, "groq:m");

  // An unconfigured primary is skipped silently.
  const skipped = await completeWithFallback(req, parseJson, [fake("gemini", async () => { throw new Error("should not be called"); }, false), ok("groq")]);
  eq("loop: skips an unconfigured provider without attempting it", skipped.model, "groq:m");

  // A bad request must NOT consume the fallback.
  let fastFailed: string | null = null;
  let groqCalled = false;
  try {
    await completeWithFallback(req, parseJson, [
      fails("gemini", new Error("Gemini 400: invalid argument")),
      fake("groq", async () => { groqCalled = true; return { text: '{"ok":true}', usage: {}, model: "groq:m" }; }),
    ]);
  } catch (e: any) { fastFailed = e.message; }
  check("loop: a 400 fails fast", fastFailed?.includes("400") ?? false, fastFailed);
  check("loop: a 400 does NOT burn the fallback", !groqCalled);

  // Both down.
  let bothMsg: string | null = null;
  let bothName: string | null = null;
  try {
    await completeWithFallback(req, parseJson, [fails("gemini", { status: 503 }), fails("groq", { status: 429 })]);
  } catch (e: any) { bothMsg = e.message; bothName = e.name; }
  eq("loop: both failing raises AllProvidersFailedError", bothName, "AllProvidersFailedError");
  check("loop: aggregate names both providers", (bothMsg?.includes("gemini") && bothMsg?.includes("groq")) ?? false, bothMsg);

  // Nothing configured at all is a distinct, actionable message.
  let noneMsg: string | null = null;
  try {
    await completeWithFallback(req, parseJson, [fake("gemini", async () => ({}) as any, false)]);
  } catch (e: any) { noneMsg = e.message; }
  check("loop: no configured provider gives an actionable error", noneMsg?.includes("GEMINI_API_KEY") ?? false, noneMsg);

  // An empty chain is the same condition, not a crash.
  let emptyMsg: string | null = null;
  try { await completeWithFallback(req, parseJson, []); } catch (e: any) { emptyMsg = e.message; }
  check("loop: empty chain is handled", emptyMsg?.includes("No AI provider") ?? false, emptyMsg);
}

// --- Aggregate error ------------------------------------------------------
const all = new AllProvidersFailedError([
  { provider: "gemini", error: "503 UNAVAILABLE" },
  { provider: "groq", error: "429 rate limit" },
]);
check("aggregate error names every provider tried", all.message.includes("gemini") && all.message.includes("groq"));
check("aggregate error keeps each underlying cause", all.message.includes("503 UNAVAILABLE") && all.message.includes("429 rate limit"));
eq("aggregate error is identifiable by name", all.name, "AllProvidersFailedError");

loopChecks().then(() => {
  console.warn = realWarn;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("All provider-chain checks passed.");
});
