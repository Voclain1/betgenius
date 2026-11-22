/**
 * Lead-time-aware and event-aware freshness for cached football evidence.
 *
 * WHY THIS EXISTS (Early Engine audit, 22 Nov 2026 — docs/EARLY_ENGINE_DEEP_AUDIT.md).
 *
 * The cache-only early lane used ONE age floor for every fixture: a team digest
 * older than 12h (TEAM_DIGEST_MAX_AGE_MS) or standings older than 24h were
 * marked `stale`, which set AIJob/Prediction.contextComplete=false for ever.
 * But the enrichment cron that fills those caches deliberately refreshes a team
 * whose next fixture is more than 72h away only every 48h (REFRESH_TIERS "C"
 * in src/lib/enrichment.ts). The two rules contradict each other: for a fixture
 * 3–14 days out the cache is, by design, usually 12–48h old, so almost every
 * early draft was frozen as "incomplete" and could never auto-publish however
 * good its evidence, confidence and price were.
 *
 * Age alone is also the wrong question. A 40-hour-old team digest is current if
 * the team has not played since; a 6-hour-old one is out of date if the team
 * played three hours ago. So freshness here has two parts:
 *
 *   1. AGE TOLERANCE by kickoff distance — the same tolerance the site's own
 *      refresh policy applies to that team (3h inside 24h, 12h inside 72h,
 *      48h beyond). Standings move once per matchday: 24h inside 72h, 48h beyond.
 *   2. SUPERSESSION — a known fixture of the team has kicked off (and should
 *      have finished) after the latest match the evidence contains. Then the
 *      evidence is missing a real result and is NOT current, whatever its age.
 *
 * Everything here is pure; the caller supplies kickoffs it already holds
 * (UpcomingFixture), so this never costs an API-Football request.
 */
import type { MatchDigest, TeamDigest } from "@/lib/ai/digest";

const HOUR = 3_600_000;

/** Mirrors REFRESH_TIERS in src/lib/enrichment.ts (asserted equal by scripts/check-early-evidence-freshness.ts). */
export const TEAM_TOLERANCE_BY_LEAD = [
  { withinHours: 24, maxAgeMs: 3 * HOUR },
  { withinHours: 72, maxAgeMs: 12 * HOUR },
  { withinHours: Infinity, maxAgeMs: 48 * HOUR },
] as const;

/** Inside 72h: the existing 24h standings floor (STANDINGS_MAX_AGE_MS). Beyond: 48h. */
export function standingsToleranceMs(leadHours: number): number {
  return leadHours <= 72 ? 24 * HOUR : 48 * HOUR;
}

export function teamToleranceMs(leadHours: number): number {
  return (TEAM_TOLERANCE_BY_LEAD.find(t => leadHours <= t.withinHours) ?? TEAM_TOLERANCE_BY_LEAD[2]).maxAgeMs;
}

/**
 * A match that kicked off at least this long ago is treated as played. Covers
 * 90 minutes, half-time, stoppages and the provider's result latency.
 */
export const PLAYED_AFTER_KICKOFF_MS = 150 * 60_000;
/** last5 dates and kickoffs come from the same provider field; allow rounding. */
const SAME_MATCH_SLACK_MS = 60 * 60_000;

/** Provider statuses that mean the fixture did not produce a result. */
const NOT_PLAYED = new Set(["PST", "CANC", "ABD", "SUSP", "TBD"]);

export type KnownKickoff = { teamApiId: number; kickoff: Date; status?: string | null };

/** The most recent match the digest actually contains. */
export function latestObservedMatch(team: Pick<TeamDigest, "last5"> | null | undefined): Date | null {
  let best: number | null = null;
  for (const m of team?.last5 ?? []) {
    const t = Date.parse(m.date);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}

/**
 * The earliest known kickoff of `teamApiId` that the evidence should contain
 * but does not, or null when the evidence is current as far as we can tell.
 *
 * `evidenceAsOf` is the latest observed match, falling back to the cache's
 * fetch time when the digest has no recent matches at all.
 */
export function supersedingKickoff(input: {
  teamApiId: number | null;
  evidenceAsOf: Date | null;
  known: readonly KnownKickoff[];
  now: Date;
  fixtureKickoff?: Date | null;
}): Date | null {
  const { teamApiId, evidenceAsOf, known, now, fixtureKickoff } = input;
  if (teamApiId == null || !evidenceAsOf) return null;
  let best: number | null = null;
  for (const k of known) {
    if (k.teamApiId !== teamApiId) continue;
    if (k.status && NOT_PLAYED.has(k.status)) continue;
    const t = k.kickoff.getTime();
    // The fixture being predicted is never evidence about itself.
    if (fixtureKickoff && Math.abs(t - fixtureKickoff.getTime()) < SAME_MATCH_SLACK_MS) continue;
    if (t <= evidenceAsOf.getTime() + SAME_MATCH_SLACK_MS) continue;
    if (t > now.getTime() - PLAYED_AFTER_KICKOFF_MS) continue;
    if (best === null || t < best) best = t;
  }
  return best === null ? null : new Date(best);
}

export type EvidencePartStatus =
  /** Verified and inside the lead-time tolerance, with no newer match known. */
  | "fresh"
  /** Verified, but older than the tolerance for this kickoff distance. */
  | "aged"
  /** Verified, but a match the team has since played is missing from it. */
  | "superseded"
  /** No cached evidence for this part. */
  | "missing";

export type PartProvenance = {
  status: EvidencePartStatus;
  fetchedAt: string | null;
  ageHours: number | null;
  toleranceHours: number | null;
  /** Latest match contained in the evidence (team parts only). */
  latestObservedMatch?: string | null;
  /** Kickoff of a known match missing from the evidence (team parts only). */
  supersededBy?: string | null;
};

export type EvidenceProvenance = {
  v: 1;
  assessedAt: string;
  leadHours: number | null;
  cacheOnly: boolean;
  homeTeam: PartProvenance;
  awayTeam: PartProvenance;
  standings: PartProvenance;
  h2h: PartProvenance;
};

export function classifyPart(input: {
  present: boolean;
  fetchedAt: Date | null;
  toleranceMs: number | null;
  now: Date;
  supersededBy?: Date | null;
  latestObserved?: Date | null;
}): PartProvenance {
  const { present, fetchedAt, toleranceMs, now } = input;
  const ageMs = fetchedAt ? Math.max(0, now.getTime() - fetchedAt.getTime()) : null;
  const base: PartProvenance = {
    status: "missing",
    fetchedAt: fetchedAt?.toISOString() ?? null,
    ageHours: ageMs === null ? null : Math.round((ageMs / HOUR) * 10) / 10,
    toleranceHours: toleranceMs === null ? null : toleranceMs / HOUR,
    ...(input.latestObserved !== undefined ? { latestObservedMatch: input.latestObserved?.toISOString() ?? null } : {}),
    ...(input.supersededBy !== undefined ? { supersededBy: input.supersededBy?.toISOString() ?? null } : {}),
  };
  if (!present) return base;
  if (input.supersededBy) return { ...base, status: "superseded" };
  if (toleranceMs !== null && (ageMs === null || ageMs > toleranceMs)) return { ...base, status: "aged" };
  return { ...base, status: "fresh" };
}

/** Parts that must not support an automatically published early pick. */
export function staleParts(p: Pick<EvidenceProvenance, "homeTeam" | "awayTeam" | "standings" | "h2h">): string[] {
  return (["homeTeam", "awayTeam", "standings", "h2h"] as const)
    .filter(k => p[k].status === "aged" || p[k].status === "superseded");
}

/**
 * Publication-time recheck of the SAVED digest: has either team played since
 * the evidence the reasoning was written from? Used by early publication so a
 * pick generated days ago cannot go live describing form that is out of date.
 */
export function savedEvidenceSupersession(
  digest: MatchDigest,
  known: readonly KnownKickoff[],
  now: Date,
): { home: Date | null; away: Date | null } {
  const fixtureKickoff = new Date(digest.fixture.kickoff);
  const fk = Number.isFinite(fixtureKickoff.getTime()) ? fixtureKickoff : null;
  return {
    home: supersedingKickoff({ teamApiId: digest.teams.home?.apiId ?? null, evidenceAsOf: latestObservedMatch(digest.teams.home), known, now, fixtureKickoff: fk }),
    away: supersedingKickoff({ teamApiId: digest.teams.away?.apiId ?? null, evidenceAsOf: latestObservedMatch(digest.teams.away), known, now, fixtureKickoff: fk }),
  };
}

/** Narrow a stored provenance blob (AIJob.context.provenance). Null when absent or unrecognised. */
export function parseEvidenceProvenance(raw: unknown): EvidenceProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<EvidenceProvenance>;
  if (p.v !== 1 || !p.homeTeam || !p.awayTeam || !p.standings || !p.h2h) return null;
  return p as EvidenceProvenance;
}
