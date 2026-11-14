import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { foldTranslation, likeContains, searchPhrase } from "./discoveryText";

/** More than this many candidate ids in one day window is not a real day; the main query bounds the rest. */
const TEAM_ID_LIMIT = 1000;
const { from: FOLD_FROM, to: FOLD_TO } = foldTranslation();

/**
 * The ids of published predictions in [start, end) whose home name, away name,
 * or the two read together contain the typed phrase — accents, case, spacing
 * and wildcard characters handled (see src/lib/discoveryText.ts).
 *
 * A PREFILTER only: the discovery query still applies every access, category,
 * market and status rule to these ids, so an id for a row the reader may not
 * see is never returned or counted. One indexed, parameterised read; at most
 * TEAM_ID_LIMIT ids; nothing is built from the text except bound parameters.
 * Returns null when the box is empty (no filter), and [] when it holds only
 * symbols (nothing to look for, so nothing matches).
 */
export async function teamSearchIds(rawTeam: string, bounds: { start: Date; end: Date }): Promise<string[] | null> {
  const phrase = searchPhrase(rawTeam);
  // Nothing typed: no filter. Only symbols typed ("%", "___"): there is nothing to look for, so nothing matches.
  if (!phrase) return rawTeam.trim() ? [] : null;
  const pattern = likeContains(phrase);
  const fold = (col: Prisma.Sql) => Prisma.sql`translate(lower(${col}), ${FOLD_FROM}, ${FOLD_TO})`;
  const home = fold(Prisma.raw('"homeTeam"'));
  const away = fold(Prisma.raw('"awayTeam"'));
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Prediction"
    WHERE "status" = 'PUBLISHED'
      AND "kickoff" >= ${bounds.start} AND "kickoff" < ${bounds.end}
      AND "homeTeam" IS NOT NULL AND "awayTeam" IS NOT NULL
      AND (
        regexp_replace(${home}, '\\s+', ' ', 'g') LIKE ${pattern}
        OR regexp_replace(${away}, '\\s+', ' ', 'g') LIKE ${pattern}
        OR regexp_replace(${home} || ' ' || ${away}, '\\s+', ' ', 'g') LIKE ${pattern}
        OR regexp_replace(${away} || ' ' || ${home}, '\\s+', ' ', 'g') LIKE ${pattern}
      )
    LIMIT ${TEAM_ID_LIMIT}`;
  return rows.map((r) => r.id);
}
