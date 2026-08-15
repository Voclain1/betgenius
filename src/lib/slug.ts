// Shared slug/normalization helpers for the programmatic league/team pages
// (/predictions/league/[slug], /predictions/team/[slug]). Prediction stores
// leagueName/homeTeam/awayTeam as free text (see schema.prisma comments —
// there's no Fixture-ingestion pipeline these are tied to), so slugs are
// derived from that text at read time rather than stored. The same functions
// are used at write time (see src/app/api/admin/predictions/route.ts and
// src/lib/ai/generate.ts) to trim/collapse whitespace before saving, so a
// stray double-space or trailing space can't silently produce a second slug
// for what's really the same league/team.

/** Trims and collapses internal whitespace — applied before saving free-text match fields. */
export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/** Lowercase, diacritic-stripped, hyphenated slug of a display string. */
export function slugify(input: string): string {
  return normalizeName(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * League names collide across countries (e.g. "Premier League" is England,
 * Kazakhstan, and Belarus — see MAJOR_LEAGUES in src/lib/leagues.ts), so the
 * slug includes Prediction.leagueApiId when present to disambiguate. Rows
 * without a leagueApiId (manually entered "Other" leagues) fall back to a
 * name-only slug — a real, if rare, collision gap.
 */
export function leagueSlug(name: string, leagueApiId?: number | null): string {
  const base = slugify(name);
  return leagueApiId != null ? `${base}-${leagueApiId}` : base;
}

/**
 * Team names have no API id on Prediction to disambiguate with, so this is a
 * plain name slug. Real-world spelling variants (e.g. "Man Utd" vs
 * "Manchester United") will produce different slugs and split that team's
 * history across two pages — a known gap, not handled here.
 */
export function teamSlug(name: string): string {
  return slugify(name);
}

/**
 * Identity of a TEAM PAIR, independent of which side is at home and of any
 * particular fixture — the head-to-head equivalent of matchKey.
 *
 * Both orderings of a pair are the same head-to-head record, so the two ids
 * are sorted numerically: the pair is stored and looked up once, not twice.
 * Returns null if either id is missing, same contract as matchKey.
 */
export function h2hPairKey(teamAApiId?: number | null, teamBApiId?: number | null): string | null {
  if (teamAApiId == null || teamBApiId == null || teamAApiId === teamBApiId) return null;
  const [lo, hi] = teamAApiId < teamBApiId ? [teamAApiId, teamBApiId] : [teamBApiId, teamAApiId];
  return `${lo}-${hi}`;
}

/**
 * Readable URL projection of h2hPairKey — "arsenal-vs-chelsea" — for
 * /predictions/h2h/[slug]. Same construction as matchSlug (teamSlug on each
 * side, joined by "-vs-") minus the date component, since a head-to-head
 * record spans every meeting rather than one fixture.
 *
 * Sorted alphabetically by slug rather than by the order the caller passed, so
 * a link built from either team's page lands on the same canonical URL. That
 * ordering is presentational only — which team hosted which is read from the
 * meetings themselves, never from the slug.
 */
export function h2hSlug(teamA?: string | null, teamB?: string | null): string | null {
  if (!teamA || !teamB) return null;
  const a = teamSlug(teamA);
  const b = teamSlug(teamB);
  if (!a || !b || a === b) return null;
  return a < b ? `${a}-vs-${b}` : `${b}-vs-${a}`;
}

/** UTC calendar day of a kickoff, "YYYY-MM-DD" — the date component of both matchKey and matchSlug. */
export function kickoffDay(kickoff: Date | string): string {
  return new Date(kickoff).toISOString().slice(0, 10);
}

/**
 * Identity of a single fixture, for tying market-specific Prediction rows
 * together into one match: the two API-Football team ids plus the kickoff's
 * UTC day.
 *
 * The day rather than the exact timestamp is deliberate. Rows for the same
 * fixture are written by separate generation runs and their `kickoff` values
 * are not guaranteed identical — in today's published data every multi-market
 * match has rows whose timestamps differ by hours while agreeing on the teams
 * and the day. Keying on the exact DateTime would file those as two different
 * matches, which is precisely the aggregation this is meant to perform. Two
 * given teams don't meet twice in one day, so the day is enough to be unique
 * and is the coarsest key that's still correct.
 *
 * Returns null when either team id or the kickoff is missing — such a row
 * can't be placed on a match page and callers skip it rather than inventing
 * an identity for it.
 */
export function matchKey(input: {
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  kickoff?: Date | string | null;
}): string | null {
  if (input.homeTeamApiId == null || input.awayTeamApiId == null || !input.kickoff) return null;
  return `${input.homeTeamApiId}-${input.awayTeamApiId}-${kickoffDay(input.kickoff)}`;
}

/**
 * Readable URL projection of matchKey() — "arsenal-vs-chelsea-2026-08-16" —
 * used for /predictions/match/[slug]. Team names rather than ids because this
 * is a public, indexable URL, and the same day component so slug and key stay
 * one-to-one.
 *
 * Resolution works the way leagueSlug/teamSlug already do: computed per row at
 * read time and compared, never parsed back apart. It inherits teamSlug's
 * spelling-variant gap, plus one of its own — a fixture whose rows straddle
 * UTC midnight (one row 23:50Z, another 00:10Z the next day) would produce two
 * slugs and split into two pages. Both are narrow and neither is handled here.
 */
export function matchSlug(input: {
  homeTeam?: string | null;
  awayTeam?: string | null;
  kickoff?: Date | string | null;
}): string | null {
  if (!input.homeTeam || !input.awayTeam || !input.kickoff) return null;
  const home = teamSlug(input.homeTeam);
  const away = teamSlug(input.awayTeam);
  if (!home || !away) return null;
  return `${home}-vs-${away}-${kickoffDay(input.kickoff)}`;
}
