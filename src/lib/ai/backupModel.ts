/**
 * Was this pick written by a fallback provider rather than the primary one?
 *
 * Gemini is the primary model. When it is unavailable (out of credit, rate
 * limited) generation falls back to Groq, whose model reads the same evidence
 * less carefully: Shakhtar to win at Inter, at 55%, was a fallback pick. Such
 * picks are flagged in the admin review list so they get a closer read before
 * publishing. AIJob.model is provider-qualified ("gemini:...", "groq:...");
 * a model with no provider prefix predates the fallback and is not flagged.
 * No server imports: the admin pages are client components.
 */
export function isBackupModel(model: string | null | undefined): boolean {
  return !!model && model.includes(":") && !model.startsWith("gemini:");
}

export const BACKUP_MODEL_WARNING = "Backup AI — check carefully";
