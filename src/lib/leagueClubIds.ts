/**
 * Standings fetched from API-Football or retained in older cached JSON can
 * contain null team IDs despite the narrower TypeScript-facing shape.
 * Prisma's Int[] 'in' selector rejects null and causes a server-side HTTP 500.
 *
 * Keep all clubs in the grid, but only use valid IDs for optional crest lookup.
 * Pure; does not issue database or API-Football calls.
 */
export function missingLeagueCrestTeamIds(
  standings: ReadonlyArray<{ teamId: number | null | undefined; teamLogo: string | null }>,
): number[] {
  const ids = new Set<number>();
  for (const row of standings) {
    const id = row.teamId;
    if (!row.teamLogo && typeof id === "number" && Number.isInteger(id) && id > 0) {
      ids.add(id);
    }
  }
  return [...ids];
}
