/**
 * Managers named in AI-written prose.
 *
 * Models answer "who manages Chelsea" from training data, which goes stale
 * every window: a preview can confidently name a coach who left months ago.
 * The digest now carries each team's current coach (TeamDigest.coach) and the
 * prompt forbids naming anyone else, but text published before that rule, or
 * a model that ignores it, still has to be caught. This is that check.
 *
 * Deterministic and deliberately narrow: it only looks at a person named in a
 * managerial role ("manager X", "under X", "X's side", "X, the ... boss"). A
 * name is supported when one of its words matches a word of a coach we hold
 * for one of the two teams. With no coach on record, every such name is
 * unsupported — "real data only" means we do not print one we cannot verify.
 */

const NAME = String.raw`(\p{Lu}[\p{L}'’-]+(?:\s+(?:(?:de|da|di|del|dos|van|von|der|ten|ter|le|la)\s+)?\p{Lu}[\p{L}'’-]+){0,2})`;
const ROLE = String.raw`(?:[Hh]ead [Cc]oach|[Mm]anager|[Cc]oach|[Bb]oss|[Gg]affer|[Tt]actician)`;

const PATTERNS: RegExp[] = [
  // "manager Enzo Maresca", "head coach Xabi Alonso"
  new RegExp(String.raw`\b${ROLE}\s+${NAME}`, "gu"),
  // "under Maresca", "Under Enzo Maresca, Chelsea ..."
  new RegExp(String.raw`\b[Uu]nder\s+(?:(?:manager|head coach|coach)\s+)?${NAME}`, "gu"),
  // "Maresca's side", "Alonso's men"
  new RegExp(String.raw`${NAME}(?:'s|’s)\s+(?:side|men|team|charges|squad|tactics|system|approach|outfit|players)\b`, "gu"),
  // "Enzo Maresca, the Chelsea manager", "Maresca, whose side ..." is caught above
  new RegExp(String.raw`${NAME},?\s+(?:the|their|whose)\s+(?:[\p{L}.'’-]+\s+){0,3}${ROLE}\b`, "gu"),
];

/** Capitalised words that start a match but are never a person. */
const NOT_A_NAME = new Set([
  "the", "their", "this", "that", "these", "those", "his", "her", "its", "both", "each", "with", "under", "home", "away",
  "premier", "league", "cup", "champions", "europa", "conference", "uefa", "fa", "serie", "la", "liga", "ligue", "bundesliga", "eredivisie",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
]);

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) => fold(s).split(/[\s'’-]+/).filter((w) => w.length > 1);

export type StaffContext = {
  /** Current coaches we hold for the two teams (any form of the name). */
  coaches: Array<string | null | undefined>;
  /** Team names, so "Chelsea's side" is not read as a person. */
  teams: Array<string | null | undefined>;
};

/** Sentences of `text` that name a manager the context does not support. */
export function unsupportedStaffSentences(text: string, ctx: StaffContext): string[] {
  const coachWords = new Set(ctx.coaches.flatMap((c) => (c ? words(c) : [])));
  const teamWords = new Set(ctx.teams.flatMap((t) => (t ? words(t) : [])));
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const flagged = PATTERNS.some((re) =>
      [...sentence.matchAll(re)].some((m) => {
        const name = m[1];
        const w = words(name);
        // A club name anywhere in the capture ("Back Chelsea's side") means it is not a person.
        if (!w.length || w.some((x) => teamWords.has(x)) || w.every((x) => NOT_A_NAME.has(x))) return false;
        return !w.some((x) => coachWords.has(x));
      }),
    );
    if (flagged) out.push(sentence);
  }
  return out;
}

/**
 * The text with every unsupported-manager sentence removed, for display.
 * Removal rather than withholding the whole analysis: the rest of the prose is
 * still sourced from the evidence, and one dropped sentence is the honest fix.
 */
export function stripUnsupportedStaff(text: string, ctx: StaffContext): string {
  return removeSentences(text, new Set(unsupportedStaffSentences(text, ctx)));
}

/**
 * `text` without the given sentences, split the same way the checks split it.
 * Paragraph breaks survive; a paragraph left empty is dropped.
 */
export function removeSentences(text: string, bad: Set<string>): string {
  if (!bad.size) return text;
  return text
    .split(/\n/)
    .map((para) => para.split(/(?<=[.!?])\s+/).filter((s) => !bad.has(s)).join(" "))
    .filter((para, i, all) => para.trim() || (i > 0 && all[i - 1].trim()))
    .join("\n")
    .trim();
}
