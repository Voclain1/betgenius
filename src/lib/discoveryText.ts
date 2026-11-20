/**
 * How a typed team query is read, and nothing else. Pure; no database.
 *
 * The match finder used to hand the box's text to the database as a substring
 * of ONE team's name. That failed in four ways a reader meets at once:
 *   - two names ("arsenal chelsea", "arsenal vs chelsea") matched nothing,
 *     because no single name contains both;
 *   - a double space ("real  madrid") matched nothing;
 *   - an accent-free query ("fenerbahce") missed a stored "Fenerbahçe", though
 *     the header search finds it;
 *   - "%" and "_" were LIKE wildcards, so "%" listed everything.
 *
 * `searchPhrase` turns the box's text into one folded phrase; a row matches
 * when that phrase is inside the home name, the away name, or the two names
 * read together ("home away" / "away home"). So "real madrid" matches the club
 * and not "Real Sociedad v Atlético Madrid", "arsenal chelsea" matches the
 * fixture, and a partial like "ars" still works.
 */

/** Letters whose decomposition (NFD minus marks) is not enough, or that need a fixed fold. */
const EXTRA_FOLDS: Record<string, string> = { ı: "i", ł: "l", ø: "o", đ: "d", ð: "d", þ: "t", ħ: "h", ŧ: "t", œ: "o", æ: "a" };

/** Lowercase, no accents, one space between words, nothing at the ends. */
export function foldSearchText(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ıłøđðþħŧœæ]/g, (c) => EXTRA_FOLDS[c])
    .replace(/ß/g, "ss");
  return base.replace(/\s+/g, " ").trim();
}

/** "arsenal vs chelsea", "arsenal v chelsea", "arsenal - chelsea", "arsenal x chelsea" → "arsenal chelsea". */
const CONNECTOR = /\s+(?:vs\.?|v\.?|x|[-–—])\s+/gi;

/** The one phrase to look for in a row, or "" when the box holds nothing searchable. */
export function searchPhrase(raw: string): string {
  return foldSearchText(raw.replace(CONNECTOR, " "))
    .replace(/[^\p{L}\p{N}'’. &/+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** The folded text of a row's side(s), for matching: home, away, "home away", "away home". */
export function teamHaystacks(home: string, away: string): string[] {
  const h = foldSearchText(home);
  const a = foldSearchText(away);
  return [h, a, `${h} ${a}`, `${a} ${h}`];
}

/** True when `phrase` (from searchPhrase) is in any of the row's haystacks. */
export function matchesTeamPhrase(phrase: string, home: string | null, away: string | null): boolean {
  if (!phrase) return true;
  if (!home || !away) return false;
  return teamHaystacks(home, away).some((h) => h.includes(phrase));
}

/** A SQL LIKE pattern for `phrase` with the LIKE metacharacters escaped (ESCAPE '\'). */
export function likeContains(phrase: string): string {
  return `%${phrase.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The accent letters a database fold must cover, as parallel strings for
 * translate(): derived from foldSearchText itself, so the SQL and the JS can
 * never disagree about what a letter folds to.
 */
export function foldTranslation(): { from: string; to: string } {
  let from = "";
  let to = "";
  for (let code = 0xc0; code <= 0x24f; code++) {
    const ch = String.fromCharCode(code);
    const lower = ch.toLowerCase();
    if (lower !== ch) continue; // lowercase only; the SQL lowercases first
    const folded = foldSearchText(ch);
    if (folded.length === 1 && folded !== ch && /[a-z]/.test(folded)) {
      from += ch;
      to += folded;
    }
  }
  return { from, to };
}
