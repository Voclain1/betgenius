/**
 * Structured AI analysis stored on Prediction.analysisJson.
 *
 * Same build/parse pair as src/lib/ai/context.ts, and for the same reason: the
 * column is opaque Json, so the only thing keeping writers and readers agreed
 * is that both go through here.
 *
 * Scope is deliberately narrow. This holds the AI's *interpretation* only —
 * bullet points it wrote about evidence it was shown. Every fact on the match
 * page (form, availability, standings, h2h, statistics) is rendered from the
 * enrichment caches instead, so nothing here is load-bearing: a prediction with
 * no analysisJson renders a slightly shorter page, never a wrong one.
 */

/** Bullets are the model's own reading of the digest — capped so one long list can't become the page. */
const MAX_KEY_FACTORS = 6;
/** Longer than this is a paragraph, not a factor, and is dropped rather than truncated mid-sentence. */
const MAX_FACTOR_LENGTH = 240;

export type PredictionAnalysis = {
  /** Schema marker, so a future shape change is detectable rather than mis-read. */
  v: 1;
  keyFactors: string[];
};

/** Narrow whatever the model returned into the stored shape. Junk entries are dropped, not repaired. */
export function buildAnalysis(output: { keyFactors?: unknown }): PredictionAnalysis {
  const raw = Array.isArray(output.keyFactors) ? output.keyFactors : [];
  const keyFactors = raw
    .filter((f): f is string => typeof f === "string")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.length <= MAX_FACTOR_LENGTH)
    .slice(0, MAX_KEY_FACTORS);
  return { v: 1, keyFactors };
}

/**
 * Read Prediction.analysisJson back.
 *
 * Returns null for anything unusable — absent (rows predating the column, or
 * predating the backfill), a different version marker, or an empty factor list.
 * Callers render nothing for null rather than an empty block: "no key factors"
 * is not a statement worth making on the page.
 */
export function parseAnalysis(raw: unknown): PredictionAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<PredictionAnalysis>;
  if (a.v !== 1) return null;
  if (!Array.isArray(a.keyFactors)) return null;
  const keyFactors = a.keyFactors.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
  if (keyFactors.length === 0) return null;
  return { v: 1, keyFactors };
}
