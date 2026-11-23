/**
 * Internal terminology that must never reach the reader.
 *
 * Same three-consumer shape as certaintyLanguage.ts, for the same reason —
 * one list feeding (a) the generation prompt, (b) a deterministic scan that
 * rejects a draft before it can reach PENDING_REVIEW, and (c) static tests —
 * so the three cannot drift apart.
 *
 * The leak this exists to stop, found in real published output:
 *
 *   "In line with the Genius tier risk calibration for cup knockout fixtures
 *    with limited sample data, backing Os Limianos with the double chance
 *    hedge..."
 *
 * The reader has no idea what a "Genius tier risk calibration" is. It is the
 * name of an instruction WE gave the model, echoed back as though it were a
 * fact about the football. Every such sentence spends the reader's attention
 * explaining our pipeline to them instead of the match.
 *
 * Like the certainty scan, this REJECTS rather than edits. Deleting "under
 * GENIUS calibration" from a sentence leaves a clause that was built around
 * it — the prose still reads as though it is justifying a house rule, minus
 * the words that made that visible to a reviewer.
 *
 * FALSE POSITIVES ARE THE REAL RISK HERE, more than in the certainty list,
 * because several of these words have ordinary football meanings:
 *
 *   - "tier" is banned only when OUR tier names precede it. "Second-tier
 *     football" and "a tier below the champions" are normal writing.
 *   - "system" is not banned at all. "The system Arteta plays" is football.
 *   - "premium" alone is not banned — "a premium finisher" is a compliment.
 *     Only "Premium tier"/"Premium calibration" style usage is.
 *   - "genius" alone is not banned — "a moment of genius" is football writing.
 */

export type ProhibitedTerm = {
  /** Matched case-insensitively against whole words. */
  pattern: RegExp;
  /** What it is, for the rejection message and the test output. */
  label: string;
};

export const PROHIBITED_INTERNAL_TERMS: ProhibitedTerm[] = [
  // "Calibration" has no football meaning in this context. Every occurrence
  // found in real output was the model narrating its own instructions.
  { pattern: /\bcalibrations?\b/i, label: "calibration" },
  { pattern: /\brisk[-\s]calibrated\b/i, label: "risk-calibrated" },

  // Tier names used as system concepts rather than as prose.
  // Regex LITERALS, not new RegExp(`...`). As template strings these read \b as
  // the backspace control character instead of a word boundary, so all three
  // matched nothing and the "calibration" rule below was silently carrying the
  // entire list. checkPatternsAreWordBoundaryRegexes() in the test guards this.
  { pattern: /\b(genius|vip|premium|banker|featured)\s+(tier|calibration|band|category|mode|guidelines?)\b/i, label: "Genius/VIP tier as a system concept" },
  { pattern: /\bunder\s+(the\s+)?(genius|vip|premium|banker|featured)\b/i, label: "under the <tier>" },
  { pattern: /\bin\s+(line|accordance)\s+with\s+(the\s+)?(genius|vip|premium|banker|featured|risk)\b/i, label: "in line with the <tier>/risk" },

  // Mechanics of how a pick is produced.
  { pattern: /\bconfidence\s+(band|threshold|mechanic)\b/i, label: "confidence band/threshold" },
  { pattern: /\brisk\s+(profile|management|moderation|mitigation|posture)\b/i, label: "risk profile/management" },
  { pattern: /\b(safety|risk)\s+calibrations?\b/i, label: "safety calibrations" },
  { pattern: /\bmarket\s+breadth\b/i, label: "market breadth" },
  { pattern: /\bhedg(e|ing)\s+(guidelines?|rules?|policy)\b/i, label: "hedging guidelines" },
  { pattern: /\bper\s+(the\s+)?(guidelines?|instructions?|rules?|brief)\b/i, label: "per the guidelines" },
  { pattern: /\bas\s+(instructed|specified|directed)\b/i, label: "as instructed" },

  // The machinery itself. "system" is deliberately absent — see the header.
  { pattern: /\b(our|the|this)\s+(algorithm|pipeline|prompt|generator)\b/i, label: "our algorithm/pipeline/prompt" },
  { pattern: /\bpending[_\s]review\b/i, label: "PENDING_REVIEW" },
  { pattern: /\bmarket[_\s]type\b/i, label: "marketType" },
  { pattern: /\bselection\s+schema\b/i, label: "selection schema" },

  // ---- The evidence machinery (editorial standards, 2026-11). These are the
  // names of things WE hand the model; a reader meeting them is reading an
  // internal report, not a match preview. Each is phrase-bound so football
  // usage of the same words stays legal: "a snapshot of their season",
  // "Sky's live coverage", "fed the striker", "an unchanged XI", "VAR review",
  // "drafted in", "the data shows" are all still allowed.
  { pattern: /\b(evidence\s+)?digests?\b/i, label: "digest" },
  { pattern: /\b(evidence|data|monitoring|generation)\s+snapshots?\b/i, label: "evidence snapshot" },
  { pattern: /\bavailability\s+(lists?|data|feeds?|fields?|records?|section|information)\b/i, label: "availability list" },
  { pattern: /\b(data|evidence|team[-\s]news|availability|injury|statistical|stats|standings|form)\s+coverage\b/i, label: "coverage (of the data)" },
  { pattern: /\bcoverage\s+(flags?|objects?|fields?|gaps?|is\s+(?:false|true|missing|incomplete|limited))\b/i, label: "coverage flag" },
  { pattern: /\b(provides?|offers?|gives?|adds?)\s+(extra\s+|some\s+|added\s+)?coverage\b/i, label: "provides coverage" },
  { pattern: /\b(data|news|team[-\s]news|injury|stats|odds)\s+feeds?\b/i, label: "data feed" },
  { pattern: /\b(feed|data|coverage|lookup)\s+(did\s+not|didn't|failed\s+to|could\s+not)\s+(resolve|load|return)\b/i, label: "data did not resolve" },
  { pattern: /\b(the\s+)?(supplied|provided)\s+(data|evidence|information|stats|statistics)\b/i, label: "the supplied data" },
  // "information provided by the club" is reporting; only OUR data is banned.
  { pattern: /\b(data|evidence)\s+(supplied|provided)\b(?!\s+by\b)/i, label: "the data provided" },
  { pattern: /\b(according\s+to|based\s+on|in)\s+the\s+(data|evidence|digest|dataset)\s+(supplied|provided|given|available|we\s+have)\b/i, label: "according to the data provided" },
  { pattern: /\b(null|undefined|n\/a)\s+(fields?|values?|data)\b/i, label: "null field" },
  { pattern: /\b(availabilityAsOf|keyPlayers|isFixtureTeam|goalsForAvg|goalsAgainstAvg|lastEvidence|competitionType|overUnderLine|neighbourhood\s+rows?)\b/, label: "field name (e.g. keyPlayers)" },
  { pattern: /\bJSON\b/, label: "JSON" },

  // ---- Review and rewrite mechanics. "review" alone is football (a VAR
  // review); only the editorial workflow is banned.
  { pattern: /\breviewers?\b/i, label: "reviewer" },
  { pattern: /\b(editor'?s?|editorial|admin(?:istrator)?'?s?|human)\s+(note|notes|direction|instruction|request|feedback|check|brief)\b/i, label: "editor's note" },
  { pattern: /\bas\s+requested\b/i, label: "as requested" },
  // "version" only after previous/earlier/...: "this version of Liverpool" is journalism.
  { pattern: /\b(previous|earlier|original|prior|revised)\s+(draft|version|write-?up)\b|\b(this|first|the\s+new)\s+(draft|write-?up)\b/i, label: "previous draft" },
  { pattern: /\b(this|the)\s+(rewrite|revision|re-?draft)\b/i, label: "this rewrite" },
  { pattern: /\b(originally\s+published|published\s+(pick|selection|prediction|text|analysis))\b/i, label: "originally published" },
  { pattern: /\b(explanation|analysis|preview|reasoning)\s+(updated|revised|rewritten)\b/i, label: "explanation updated" },
  // The audit wording, not football: "Arteta's selection was unchanged" stays legal.
  { pattern: /\bselection,?\s+(and\s+)?confidence\b|\bconfidence\s+and\s+odds\b/i, label: "selection, confidence and odds" },
  { pattern: /\b(new|latest|updated)\s+evidence\s+(alerts?|signals?|update)\b/i, label: "evidence alert" },
  { pattern: /\b(material|monitoring)\s+(signals?|change\s+signature|alerts?)\b/i, label: "monitoring signal" },

  // ---- AI wording never appears in public BetGenius copy (AGENTS.md).
  // Case-sensitive on purpose: "AI" the acronym, not the letters in "Aidan".
  { pattern: /\bAI\b/, label: "AI" },
  { pattern: /\b(artificial\s+intelligence|machine\s+learning|language\s+model|LLM)\b/i, label: "artificial intelligence" },
];

/**
 * The terms the PUBLISHED-ROW backfill (scripts/backfill-house-voice.ts) may
 * act on: exactly the list as it stood before the 2026-11 editorial standards.
 * The expanded list gates NEW drafts and rewrites only. Published copy is never
 * edited for the new terms automatically; it changes only through explicit
 * administrator review and approval.
 */
export const BACKFILL_TERM_LABELS: ReadonlySet<string> = new Set([
  "calibration", "risk-calibrated", "Genius/VIP tier as a system concept", "under the <tier>", "in line with the <tier>/risk",
  "confidence band/threshold", "risk profile/management", "safety calibrations", "market breadth", "hedging guidelines",
  "per the guidelines", "as instructed", "our algorithm/pipeline/prompt", "PENDING_REVIEW", "marketType", "selection schema",
]);

export type InternalTerminologyViolation = {
  field: string;
  label: string;
  match: string;
};

/** Every prohibited term present in one field, with the text that matched. */
export function findInternalTerminologyViolations(
  text: string | null | undefined,
  field: string,
): InternalTerminologyViolation[] {
  if (!text) return [];
  const violations: InternalTerminologyViolation[] = [];
  for (const term of PROHIBITED_INTERNAL_TERMS) {
    const found = text.match(term.pattern);
    if (found) violations.push({ field, label: term.label, match: found[0] });
  }
  return violations;
}

/** Scan every reader-facing field of a draft. */
export function scanDraftForInternalTerminology(draft: {
  matchPreview?: string | null;
  keyFactors?: string[] | null;
  reasoning?: string | null;
}): InternalTerminologyViolation[] {
  return [
    ...findInternalTerminologyViolations(draft.matchPreview, "matchPreview"),
    ...findInternalTerminologyViolations((draft.keyFactors ?? []).join("\n"), "keyFactors"),
    ...findInternalTerminologyViolations(draft.reasoning, "reasoning"),
  ];
}

/** The prompt section, generated from the list above so the two agree. */
export function internalTerminologyProhibitionBlock(): string {
  return `

WRITE FOR A READER WHO CANNOT SEE THESE INSTRUCTIONS.
The preview, key factors and reasoning are football writing. They must never
describe how the pick was produced, or name any concept from these
instructions or from the shape of the data you were given. Never write
phrases like:
${PROHIBITED_INTERNAL_TERMS.map((t) => `  - ${t.label}`).join("\n")}
Do not say a pick follows a rule, tier, calibration, guideline or instruction.
Do not name the category a pick belongs to. Justify the pick ONLY with evidence
about these teams: form, goals, head-to-head, table position, absences, venue.

BAD:  "In line with the Genius tier risk calibration, backing the double chance
       hedge provides coverage."
GOOD: "Sarajevo have kept clean sheets in both league games and scored once;
       their last ten meetings with Zrinjski produced under 2.5 goals eight
       times."`;
}


/**
 * Editorial standards for the two reader-facing prose fields (2026-11).
 *
 * The preview had been drifting into an internal evidence report ("the
 * availability list is incomplete", "coverage for team news is false") and
 * the reasoning into technical betting assessment. The fix is a distinct
 * brief per field, plus a rule for turning UNCERTAINTY into football language
 * without inventing facts. Appended to every generation and rewrite prompt by
 * buildSystemPrompt, beside the terminology block above.
 */
export function editorialStandardsBlock(): string {
  return `

EDITORIAL STANDARDS. Two fields, two different jobs.

"matchPreview" is MATCH JOURNALISM for a football fan.
- Write 2-4 natural, polished paragraphs, separated by a blank line, in the
  voice of a good newspaper preview: present tense for the build-up, past
  tense for results.
- Cover, wherever the data credibly supports it: recent form; home and away
  records; relevant team news; each side's tactical strengths and weaknesses
  (how they score, how they concede, set pieces, clean sheets); what is at
  stake in the table or the round; and how the match is likely to unfold.
- Lead with the most interesting football story of the fixture, not with a
  list of statistics. Use numbers to support a point, a few at a time.
- Leave a topic out entirely when the data says nothing credible about it.
  Never fill the space by describing the data itself.
- No betting talk in the preview: no markets, picks, odds, confidence figures
  or stakes. That belongs in the reasoning.

"reasoning" is the ANALYTICAL CASE for the one pick.
- Explain, specifically for this market, why the pick is the most likely
  outcome: the two or three pieces of football evidence that carry it, and
  the main risk to it.
- Analytical, not technical. Write "they have conceded in nine of their last
  ten away games", not "their defensive xGA variance profile". Plain betting
  words (double chance, over 2.5 goals, both teams to score, clean sheet) are
  fine; jargon about how picks are produced is not.
- Do not repeat the preview; refer to it only through the evidence itself.

UNCERTAINTY, IN FOOTBALL LANGUAGE. Never invent injuries, recoveries,
confirmed lineups, quotes or results to fill a gap. When the data is thin,
say so the way a football writer would, or say nothing:
- No team news in the data: do not discuss absences at all. Never imply a
  full-strength squad, and never call a player fit, doubtful or returning.
- Absence information that is old: "X missed their last match through injury",
  not "X is out". Never upgrade an old absence to a confirmed one.
- Few games this season: "only a handful of games into the campaign" or
  "early-season form", not "limited sample data".
- Lineups: never describe a starting XI as confirmed unless the data contains
  the confirmed lineup.
- Missing head-to-head or table information: leave it out; never write that it
  is missing or unavailable.

THE WORDS IN THESE INSTRUCTIONS ARE NOT FOR THE READER. Terms such as
digest, coverage, availability list, data feed, snapshot, field names,
reviewer, draft, revision, calibration and tier describe our working
materials. Readers must never see them.`;
}

/**
 * How an editor's private direction is handed to the model on a rewrite.
 * The direction steers the analysis; it is never quoted, acknowledged or
 * narrated ("as requested", "the reviewer noted"), because the reader has no
 * idea an editor was involved.
 */
export function reviewerDirectionBlock(note: string): string {
  return `
PRIVATE EDITORIAL DIRECTION from a human editor. It takes priority over your
own stylistic preferences and should change what you emphasise, how you weigh
the evidence and how confident you are:

"${note}"

Act on it silently. The published text must read as if written from scratch:
never quote, paraphrase, acknowledge or answer this direction, and never
mention an editor, a reviewer, a request, a note or a previous version. If the
direction asks for something the data does not support (a fact that is not in
the data, a guarantee, a certainty), follow the data and these rules instead.
Still obey every formatting, data-grounding and editorial rule above; the
direction changes emphasis, tone and judgement, never the output schema.
`;
}

/**
 * An administrator's request to rewrite a PUBLISHED pick's prose after new
 * football evidence (the Prediction Updates workspace). The football has moved
 * on; the reader sees an analysis written as of now, never an "update".
 */
export function evidenceUpdateBlock(): string {
  return `
CURRENT-EVIDENCE REWRITE. This fixture's analysis is being written again
because the football has moved on since the earlier text: there may be new
results, table changes or team news in the data. Write the preview and the
reasoning as they should read TODAY, for the same pick
(market and selection) as the earlier text, using what has happened as
ordinary football facts ("Leeds lost 2-0 at Burnley on Saturday").
- Never describe the text as an update, a revision or a correction, and never
  say that evidence, data or information has changed, arrived or been checked.
- Keep the same market and selection. If the evidence no longer supports it,
  still return your honest pick and confidence: they are compared privately
  and are never applied as an edit.
`;
}
