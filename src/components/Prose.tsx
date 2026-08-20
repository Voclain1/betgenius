/**
 * Renders AI-written prose as real paragraphs.
 *
 * The model's output was previously dropped into a single <p> with
 * `whitespace-pre-wrap`, which made a three-paragraph preview one paragraph
 * containing blank lines — visually close, semantically wrong, and worse for
 * anything parsing the page.
 *
 * Deliberately NOT a markdown renderer. Checked against the stored output: of
 * eight previews and eight reasonings, the only construct present was the
 * blank-line paragraph break. No bold, headings, bullets, links or code — so a
 * markdown library (or a hand-rolled parser) would be machinery for syntax that
 * does not occur, plus a dependency and an escaping surface this doesn't need.
 *
 * The prompt does say "markdown", so a future model could start emitting it.
 * stripInlineMarkers handles that case by removing the markers rather than
 * printing them raw — a wrong-but-clean paragraph beats literal `##` on the
 * page. If real markdown ever becomes common in the output, this is the one
 * place that changes.
 */

/**
 * Strip the inline markers a model might emit despite producing none today.
 *
 * Only unambiguous, paired constructs are touched: bold/italic runs and leading
 * heading hashes. Nothing here tries to interpret tables, links or code —
 * anything more ambitious would be the parser this component exists to avoid.
 */
export function stripInlineMarkers(text: string): string {
  return text
    // Spaces and tabs only, never \s, for both the indent and the separator.
    // \s matches newlines, so a heading after a blank line had that blank line
    // consumed along with the hashes, silently merging two paragraphs into one.
    // Surfaced by the Groq fallback, which emits markdown where the Gemini
    // primary does not.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "") // leading heading hashes
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2") // *italic*
    .replace(/`([^`]+)`/g, "$1"); // `code`
}

/**
 * Split on blank lines. A single trailing/leading newline is NOT a paragraph
 * break — the model uses "\n\n" for that, and treating a soft wrap as a break
 * would shatter a paragraph into fragments.
 */
export function toParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return stripInlineMarkers(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s*\n\s*/g, " "))
    .filter((p) => p.length > 0);
}

export function Prose({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const paragraphs = toParagraphs(text);
  if (paragraphs.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-gray-300">
          {p}
        </p>
      ))}
    </div>
  );
}
