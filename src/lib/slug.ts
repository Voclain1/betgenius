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
