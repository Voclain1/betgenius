/**
 * Was this pick written by the last-resort provider rather than a main one?
 *
 * Claude Haiku is the primary model and Gemini its first fallback; both were
 * measured on the same settled fixtures (scripts/compare-models.ts) and read
 * the evidence equally well, so neither is flagged. When both are unavailable
 * generation falls back to Groq, whose model reads the same evidence less
 * carefully: Shakhtar to win at Inter, at 55%, was a Groq pick. Such picks are
 * flagged in the admin review list so they get a closer read before
 * publishing. AIJob.model is provider-qualified ("anthropic:...", "gemini:...",
 * "groq:..."); a model with no provider prefix predates the fallback and is not
 * flagged. No server imports: the admin pages are client components.
 */
const MAIN_PROVIDERS = ["anthropic:", "gemini:"];

export function isBackupModel(model: string | null | undefined): boolean {
  return !!model && model.includes(":") && !MAIN_PROVIDERS.some((p) => model.startsWith(p));
}

export const BACKUP_MODEL_WARNING = "Backup AI — check carefully";
