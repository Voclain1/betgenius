/**
 * The answer paragraph under an H1.
 *
 * One plain <p> of plain text, deliberately: it sits directly under the
 * heading, before any card, table or day filter, so it is the first thing a
 * skimming reader reads and the first block of prose an extraction pass finds.
 * Splitting it into styled spans or stacking it with a second tagline would
 * cost exactly that — a single quotable sentence.
 *
 * The text itself is built in src/lib/answerSummary.ts from data the page has
 * already loaded, never hardcoded here.
 */
export function AnswerSummary({ text }: { text: string }) {
  return <p className="max-w-3xl text-sm leading-relaxed text-gray-300">{text}</p>;
}
