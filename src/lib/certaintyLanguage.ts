/**
 * Prohibited certainty language.
 *
 * One list, three consumers, so they cannot drift apart:
 *   (a) the generation prompt, which forbids these phrasings up front;
 *   (b) a deterministic scan that REJECTS a draft containing one, before the
 *       row can reach PENDING_REVIEW;
 *   (c) static tests over the badge, explanation and promotional copy.
 *
 * The scan rejects rather than edits. Silently deleting "guaranteed" from a
 * sentence leaves prose that was written to argue certainty, minus the word
 * that made the claim checkable — the reasoning still reads as a promise, and
 * nobody reviewing it can tell it was ever touched. A rejected draft is visible
 * and re-generable; an edited one is neither.
 *
 * Matching is word-boundary based rather than substring: "lock" must not fire
 * on "locked in a tight game" or on the padlock in the UI copy, and "sure"
 * must not fire on "surely" or "pressure".
 */

export type ProhibitedTerm = {
  /** Matched case-insensitively against whole words. */
  pattern: RegExp;
  /** What it is, for the rejection message and the test output. */
  label: string;
};

/**
 * Phrasings that assert an outcome is certain, cannot lose, or carries no risk.
 *
 * Deliberately NOT a list of merely confident words. "Strong", "clear
 * favourite" and "should win" are honest descriptions of a probability; the bar
 * here is language that denies the possibility of losing.
 */
export const PROHIBITED_CERTAINTY_TERMS: ProhibitedTerm[] = [
  { pattern: /\bguarantee(d|s)?\b/i, label: "guarantee" },
  { pattern: /\bcertaint(y|ies)\b/i, label: "certainty" },
  { pattern: /\b(is|are|it'?s)\s+certain\b/i, label: "is certain" },
  { pattern: /\bsure\s+(win|thing|bet)\b/i, label: "sure win / sure thing / sure bet" },
  { pattern: /\bcan'?t\s+lose\b/i, label: "can't lose" },
  { pattern: /\bcannot\s+lose\b/i, label: "cannot lose" },
  { pattern: /\bno\s+way\s+(they|he|she|it)\s+lose(s)?\b/i, label: "no way they lose" },
  { pattern: /\bnailed\s*-?\s*on\b/i, label: "nailed on" },
  { pattern: /\brisk\s*-?\s*free\b/i, label: "risk-free" },
  { pattern: /\bno\s+risk\b/i, label: "no risk" },
  // "100%" only as a CERTAINTY claim, not as arithmetic. The badge has to be
  // able to explain that a book's raw prices "add up to more than 100%" — that
  // sentence is the opposite of a certainty claim, and a blanket ban on the
  // numeral would forbid the very explanation this feature exists to give.
  { pattern: /\b100\s*%\s*(certain|sure|safe|confident|guaranteed|nailed|win|winner)\b/i, label: "100% certain" },
  { pattern: /\b(we|i|they|it|this)('?re|'?m|\s+are|\s+is|\s+am)?\s+100\s*%/i, label: "we are 100%" },
  { pattern: /\bhundred\s+percent\b/i, label: "hundred percent" },
  { pattern: /\bbanker\s+of\s+the\s+(day|week)\b/i, label: "banker of the day/week" },
  // "Lock" only where it implies inevitability, not the padlock in tier copy.
  { pattern: /\b(a|an|the|absolute|total|complete)\s+lock\b/i, label: "a lock" },
  { pattern: /\blocked\s+in\s+(win|winner|result)\b/i, label: "locked-in win" },
  { pattern: /\bdead\s+cert(ain)?\b/i, label: "dead cert" },
  { pattern: /\bslam\s+dunk\b/i, label: "slam dunk" },
  { pattern: /\bfree\s+money\b/i, label: "free money" },
  { pattern: /\bunbeatable\b/i, label: "unbeatable" },
  { pattern: /\bimpossible\s+to\s+lose\b/i, label: "impossible to lose" },
  { pattern: /\bwill\s+definitely\s+win\b/i, label: "will definitely win" },
  { pattern: /\bzero\s+(risk|chance\s+of\s+losing)\b/i, label: "zero risk" },
];

export type CertaintyViolation = {
  /** Which field the phrase was found in — reasoning, preview, or a key factor. */
  field: string;
  label: string;
  /** The matched text, so a reviewer can see exactly what tripped it. */
  match: string;
};

/**
 * Negations that INVERT a prohibited term rather than asserting it.
 *
 * "This is not a guarantee" and "there is no sure thing here" are the opposite
 * of certainty claims — they are the honest framing the rule exists to produce.
 * Without this the scan rejects its own explanation copy, and worse, it would
 * push writers away from stating the caveat at all.
 *
 * Matched against the text immediately BEFORE the term, so only a directly
 * attached negation counts; "guaranteed" elsewhere in a sentence that happens
 * to contain "not" is still a violation.
 */
const NEGATION_BEFORE = /\b(not|never|no|isn'?t|aren'?t|nothing|without)\s+(a\s+|an\s+|any\s+)?$/i;

/** Scans one string. Returns every distinct term that fired, not just the first. */
export function findCertaintyViolations(text: string | null | undefined, field: string): CertaintyViolation[] {
  if (!text) return [];
  const out: CertaintyViolation[] = [];
  for (const term of PROHIBITED_CERTAINTY_TERMS) {
    // Global scan: an early negated use must not mask a later asserted one.
    const rx = new RegExp(term.pattern.source, term.pattern.flags.includes("g") ? term.pattern.flags : term.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (NEGATION_BEFORE.test(before)) continue;
      out.push({ field, label: term.label, match: m[0] });
      break;
    }
  }
  return out;
}

/**
 * Scans a whole generated draft — reasoning, preview and every key factor.
 *
 * Every field, not just the reasoning: the preview and key factors are rendered
 * to readers exactly as prominently, and a promise made in a bullet point is
 * still a promise.
 */
export function scanDraftForCertainty(draft: {
  reasoning?: string | null;
  matchPreview?: string | null;
  keyFactors?: readonly string[] | null;
}): CertaintyViolation[] {
  return [
    ...findCertaintyViolations(draft.reasoning, "reasoning"),
    ...findCertaintyViolations(draft.matchPreview, "matchPreview"),
    ...(draft.keyFactors ?? []).flatMap((f, i) => findCertaintyViolations(f, `keyFactors[${i}]`)),
  ];
}

/**
 * The prohibition as prompt text.
 *
 * Generated from the same list the scan uses, so a term can never be forbidden
 * by one layer and allowed by the other. The prompt explains WHY rather than
 * only listing words — a model given a blocklist reliably finds a synonym, and
 * the rule is about the claim, not the vocabulary.
 */
export function certaintyProhibitionBlock(): string {
  return `

NO CERTAINTY LANGUAGE
=====================
Never state or imply that an outcome is certain, that it cannot lose, or that
there is no risk. This applies equally to the match preview, the reasoning and
every key factor — a promise in a bullet point is still a promise.

Specifically banned, in any grammatical form: ${PROHIBITED_CERTAINTY_TERMS.map((t) => t.label).join(", ")}.

This is not a vocabulary restriction to route around with a synonym. The rule
is about the CLAIM: every pick can lose, and the writing must remain compatible
with that. Confidence is expressed as a probability and as the evidence behind
it, never as inevitability.

Saying a side is strong, is a clear favourite, has the better squad, or should
win is correct and expected. Saying it will certainly win is not.`;
}
