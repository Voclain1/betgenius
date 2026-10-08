import { toParagraphs } from "@/components/Prose";

/** Longest excerpt shown before "Show full reasoning": about two short sentences. */
const MAX_CHARS = 200;

/**
 * The opening of a pick's reasoning for a collapsed card: the first sentence,
 * plus the second when both fit in MAX_CHARS. A first sentence longer than
 * that is cut at a word boundary with an ellipsis. `truncated` says whether
 * anything was left out, i.e. whether a "show more" control is needed.
 *
 * Pure, so it is unit-checked.
 */
export function reasoningExcerpt(text: string | null | undefined): { excerpt: string; truncated: boolean } {
  const full = toParagraphs(text).join(" ");
  if (!full) return { excerpt: "", truncated: false };

  const sentences = full.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/);
  let excerpt = sentences[0];
  if (sentences.length > 1 && `${excerpt} ${sentences[1]}`.length <= MAX_CHARS) excerpt = `${excerpt} ${sentences[1]}`;

  if (excerpt.length > MAX_CHARS) {
    const cut = excerpt.slice(0, MAX_CHARS);
    excerpt = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX_CHARS * 0.6)).replace(/[\s,;:–-]+$/, "")}…`;
  }
  return { excerpt, truncated: excerpt.length < full.length };
}
