/**
 * One pick per match, for the surfaces that must never show a match twice:
 * the homepage (Genius, Bet of the Day and Featured together) and the Banker
 * feed. The full category feeds (Genius, Featured, Today...) list every pick
 * and do not use this.
 *
 * A match is identified by EVERY identity a row carries, and two rows are the
 * same match when they share ANY of them:
 *
 *   - the provider fixture id (fixtureApiId), when resolved;
 *   - the team-id pair, when both ids are known;
 *   - the team-name pair, normalised.
 *
 * Matching on one key alone missed duplicates: one pick on a match can have
 * its fixtureApiId resolved while another on the same match does not, and
 * Bet of the Day rows carry team ids but no fixture id. The surfaces using this
 * each cover a single Lagos day, so a team pair is one match. Kickoff is not
 * part of it: settlement rewrites kickoff on a reschedule.
 */

export type FixtureIdentity = {
  id: string;
  fixtureApiId?: number | null;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
};

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every key a row is known by. A row with none falls back to its own id, so it is never merged. Pure. */
export function fixtureKeys(row: FixtureIdentity): string[] {
  const keys: string[] = [];
  if (row.fixtureApiId != null) keys.push(`fx:${row.fixtureApiId}`);
  if (row.homeTeamApiId != null && row.awayTeamApiId != null) keys.push(`ids:${row.homeTeamApiId}-${row.awayTeamApiId}`);
  if (row.homeTeam && row.awayTeam) {
    const h = norm(row.homeTeam);
    const a = norm(row.awayTeam);
    if (h && a) keys.push(`names:${h}|${a}`);
  }
  return keys.length ? keys : [`row:${row.id}`];
}

/** Has a match with any of this row's identities already been taken? Pure. */
export function isFixtureTaken(row: FixtureIdentity, taken: ReadonlySet<string>): boolean {
  return fixtureKeys(row).some((k) => taken.has(k));
}

/** Mark this row's match as taken. Mutates `taken`. */
export function takeFixture(row: FixtureIdentity, taken: Set<string>): void {
  for (const k of fixtureKeys(row)) taken.add(k);
}

/**
 * The first row for each match, in the order given (rank first, then call
 * this). `taken` carries matches already shown elsewhere on the page and is
 * updated with the ones kept here.
 */
export function onePerFixture<T extends FixtureIdentity>(rows: readonly T[], taken: Set<string> = new Set()): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (isFixtureTaken(r, taken)) continue;
    takeFixture(r, taken);
    out.push(r);
  }
  return out;
}
