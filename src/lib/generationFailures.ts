import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { matchKey, kickoffDay, normalizeName } from "@/lib/slug";
import { bulkFailureReason } from "@/lib/generation/bulkRun";

/**
 * The failed-generation log (GenerationFailure in schema.prisma).
 *
 * Every failure of generateAndPersistPrediction, from any path, is written
 * here, and listed at /admin/failed-generations with a count in the admin
 * sidebar. A failure stays open until a later generation for the same match
 * succeeds (resolved automatically) or an admin dismisses it. A failure for a
 * match that has already kicked off is no longer actionable: it leaves the
 * open list and the count, and shows under "Kicked off" for a week.
 *
 * Recording never throws: a failure to log a failure must not replace the
 * error the caller is about to see.
 */

/** How long resolved, dismissed and kicked-off failures stay on the page. */
export const FAILURE_HISTORY_MS = 7 * 86_400_000;

/** The fields of GenerateFixtureInput this log reads. */
export type FailureInput = {
  home: string;
  away: string;
  league: string;
  leagueApiId?: number;
  kickoff: string;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  intent?: string;
  manual?: boolean;
  handicapLine?: unknown;
};

const INTENT_LABELS: Record<string, string> = {
  GOALS: "Goals",
  VIP_PREMIUM: "VIP/Premium",
  BANKER: "Banker",
  REGULAR_COMBO: "Doubles",
  EUROPEAN_CLUB: "European clubs",
};

/** Which path the generation came from, in admin words. Pure. */
export function generationSourceOf(input: FailureInput): string {
  if (input.manual) return "Manual";
  if (input.handicapLine) return "Handicap";
  if (input.intent) return INTENT_LABELS[input.intent] ?? input.intent;
  return "Scheduled";
}

/**
 * One key per match: the matchKey when both team ids are known, otherwise the
 * normalised names and the kickoff day, so a hand-typed match still groups. Pure.
 */
export function failureFixtureKey(input: FailureInput): string {
  const key = matchKey({ homeTeamApiId: input.homeTeamApiId, awayTeamApiId: input.awayTeamApiId, kickoff: input.kickoff });
  if (key) return key;
  const day = isNaN(new Date(input.kickoff).getTime()) ? "unknown" : kickoffDay(input.kickoff);
  return `${normalizeName(input.home).toLowerCase()}|${normalizeName(input.away).toLowerCase()}|${day}`;
}

/** Both keys a match may have been logged under, for resolving on success. Pure. */
function keysFor(input: FailureInput, resolvedIds?: { home: number | null; away: number | null }): string[] {
  const keys = new Set([failureFixtureKey(input), failureFixtureKey({ ...input, homeTeamApiId: null, awayTeamApiId: null })]);
  if (resolvedIds) keys.add(failureFixtureKey({ ...input, homeTeamApiId: resolvedIds.home, awayTeamApiId: resolvedIds.away }));
  return [...keys];
}

export async function recordGenerationFailure(input: FailureInput, err: unknown): Promise<void> {
  try {
    const kickoff = new Date(input.kickoff);
    await prisma.generationFailure.create({
      data: {
        fixtureKey: failureFixtureKey(input),
        source: generationSourceOf(input),
        homeTeam: normalizeName(input.home),
        awayTeam: normalizeName(input.away),
        leagueName: input.league ? normalizeName(input.league) : null,
        leagueApiId: input.leagueApiId ?? null,
        kickoff: isNaN(kickoff.getTime()) ? null : kickoff,
        errorName: (err as { name?: string } | null)?.name || "Error",
        reason: bulkFailureReason(err),
        detail: String((err as { message?: string } | null)?.message ?? err).slice(0, 500),
        input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      },
    });
  } catch (logErr) {
    console.error("[generation-failures] could not record a failure", logErr);
  }
}

/** A generation for this match succeeded: its open failures are resolved. Never throws. */
export async function resolveGenerationFailures(input: FailureInput, resolvedIds?: { home: number | null; away: number | null }): Promise<void> {
  try {
    await prisma.generationFailure.updateMany({
      where: { fixtureKey: { in: keysFor(input, resolvedIds) }, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  } catch (err) {
    console.error("[generation-failures] could not resolve failures", err);
  }
}

/** Open and actionable: not resolved, not dismissed, kickoff still ahead (or unknown). */
export function openFailureWhere(now: Date = new Date()): Prisma.GenerationFailureWhereInput {
  return { resolvedAt: null, dismissedAt: null, OR: [{ kickoff: null }, { kickoff: { gt: now } }] };
}

/** Matches with an open failure, for the admin sidebar. Never throws: 0 when unknown. */
export async function openFailureCount(now: Date = new Date()): Promise<number> {
  try {
    const rows = await prisma.generationFailure.findMany({ where: openFailureWhere(now), distinct: ["fixtureKey"], select: { id: true } });
    return rows.length;
  } catch {
    return 0;
  }
}

export type FailureGroup = {
  fixtureKey: string;
  /** The latest failure's id: Retry and Dismiss act on the whole match through it. */
  id: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string | null;
  kickoff: Date | null;
  source: string;
  reason: string;
  detail: string | null;
  failures: number;
  firstAt: Date;
  lastAt: Date;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
};

/** One entry per match, latest failure first. Rows must be newest first. Pure. */
export function groupFailures(
  rows: ReadonlyArray<{
    id: string; fixtureKey: string; homeTeam: string; awayTeam: string; leagueName: string | null; kickoff: Date | null;
    source: string; reason: string; detail: string | null; createdAt: Date; resolvedAt: Date | null; dismissedAt: Date | null;
  }>,
): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const r of rows) {
    const g = groups.get(r.fixtureKey);
    if (g) {
      g.failures++;
      g.firstAt = r.createdAt;
      continue;
    }
    groups.set(r.fixtureKey, {
      fixtureKey: r.fixtureKey, id: r.id, homeTeam: r.homeTeam, awayTeam: r.awayTeam, leagueName: r.leagueName,
      kickoff: r.kickoff, source: r.source, reason: r.reason, detail: r.detail, failures: 1,
      firstAt: r.createdAt, lastAt: r.createdAt, resolvedAt: r.resolvedAt, dismissedAt: r.dismissedAt,
    });
  }
  return [...groups.values()];
}

/** The page's three lists: open, kicked off unresolved, and recently resolved or dismissed. */
export async function loadFailureLists(now: Date = new Date()) {
  const since = new Date(now.getTime() - FAILURE_HISTORY_MS);
  const select = {
    id: true, fixtureKey: true, homeTeam: true, awayTeam: true, leagueName: true, kickoff: true,
    source: true, reason: true, detail: true, createdAt: true, resolvedAt: true, dismissedAt: true,
  } as const;
  const [open, missed, closed] = await Promise.all([
    prisma.generationFailure.findMany({ where: openFailureWhere(now), orderBy: { createdAt: "desc" }, select, take: 500 }),
    prisma.generationFailure.findMany({
      where: { resolvedAt: null, dismissedAt: null, kickoff: { lte: now, gt: since } },
      orderBy: { createdAt: "desc" }, select, take: 200,
    }),
    prisma.generationFailure.findMany({
      where: { createdAt: { gt: since }, OR: [{ resolvedAt: { not: null } }, { dismissedAt: { not: null } }] },
      orderBy: { createdAt: "desc" }, select, take: 200,
    }),
  ]);
  return { open: groupFailures(open), missed: groupFailures(missed), closed: groupFailures(closed) };
}
