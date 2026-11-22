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
 * A match that kicked off at least this long ago is ELIGIBLE to be resolved as
 * played. Kickoff time alone never proves it was played: see resolveKnownMatch.
 */
export const PLAYED_AFTER_KICKOFF_MS = 150 * 60_000;
/** last5 dates and kickoffs come from the same provider field; allow rounding. */
const SAME_MATCH_SLACK_MS = 60 * 60_000;
/** A delayed or re-timed match against the same opponent within this window is the same match. */
const SAME_FIXTURE_WINDOW_MS = 72 * 60 * 60_000;

/** Provider statuses that prove a result exists. */
export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
/**
 * Provider statuses that prove no football result to learn from: postponed,
 * cancelled, abandoned, awarded or walkover. (An awarded result is a
 * disciplinary score, not form evidence.)
 */
export const NOT_PLAYED_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

/**
 * A fixture of one of the teams that we captured. `status` is the LAST status
 * we observed, which for a past match is usually its pre-kickoff "NS":
 * discovery only stores future fixtures and only the reassessment worker
 * refreshes a fixture after kickoff. So status is evidence only when it is a
 * terminal one; anything else is unresolved until confirmed another way.
 */
export type KnownKickoff = {
  teamApiId: number;
  kickoff: Date;
  status?: string | null;
  /** The other side in that fixture, when known — used to match it to evidence and to confirm it. */
  opponentApiId?: number | null;
  /** Set by resolveKnownMatch from independent evidence (a current team cache listing the result). */
  confirmedPlayed?: boolean;
};

export type MatchResolution = "played" | "not-played" | "unresolved";

/**
 * Was this known match actually played?
 *   played      — terminal finished status, or a current team cache lists it
 *   not-played  — postponed / cancelled / abandoned / awarded / walkover
 *   unresolved  — anything else: a stale "NS"/"TBD", a delayed kickoff, live,
 *                 suspended ("SUSP") or interrupted ("INT") states, unknown.
 * Pure; unit-checked.
 */
export function resolveKnownMatch(k: Pick<KnownKickoff, "status" | "confirmedPlayed">): MatchResolution {
  const status = (k.status ?? "").toUpperCase();
  if (NOT_PLAYED_STATUSES.has(status)) return "not-played";
  if (FINISHED_STATUSES.has(status) || k.confirmedPlayed) return "played";
  return "unresolved";
}

/** The most recent match the digest actually contains. */
export function latestObservedMatch(team: Pick<TeamDigest, "last5"> | null | undefined): Date | null {
  let best: number | null = null;
  for (const m of team?.last5 ?? []) {
    const t = Date.parse(m.date);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}

export type Supersession = {
  /** Earliest known match CONFIRMED played but missing from the evidence. */
  superseded: Date | null;
  /** Earliest known past match we cannot confirm either way; evidence currency unverified. */
  unverified: Date | null;
};

/**
 * Matches of `teamApiId` that the evidence should contain but does not.
 *
 * A known fixture counts only when it kicked off after the latest match in
 * the evidence (`evidenceAsOf`), at least PLAYED_AFTER_KICKOFF_MS ago, is not
 * the fixture being predicted, and is not already in the evidence under a
 * shifted date (same opponent within 72h). It is then classified by
 * resolveKnownMatch: played → superseded; unresolved → unverified;
 * not played → ignored.
 */
export function assessSupersession(input: {
  teamApiId: number | null;
  evidenceAsOf: Date | null;
  known: readonly KnownKickoff[];
  now: Date;
  fixtureKickoff?: Date | null;
  evidenceMatches?: ReadonlyArray<{ date: string; opponentApiId?: number | null }>;
}): Supersession {
  const out: Supersession = { superseded: null, unverified: null };
  const { teamApiId, evidenceAsOf, known, now, fixtureKickoff } = input;
  if (teamApiId == null || !evidenceAsOf) return out;
  const earliest = (cur: Date | null, t: number) => (cur === null || t < cur.getTime() ? new Date(t) : cur);
  for (const k of known) {
    if (k.teamApiId !== teamApiId) continue;
    const t = k.kickoff.getTime();
    if (fixtureKickoff && Math.abs(t - fixtureKickoff.getTime()) < SAME_MATCH_SLACK_MS) continue;
    if (t <= evidenceAsOf.getTime() + SAME_MATCH_SLACK_MS) continue;
    if (t > now.getTime() - PLAYED_AFTER_KICKOFF_MS) continue;
    if (k.opponentApiId != null && (input.evidenceMatches ?? []).some(m =>
      m.opponentApiId === k.opponentApiId && Math.abs(Date.parse(m.date) - t) <= SAME_FIXTURE_WINDOW_MS)) continue;
    const r = resolveKnownMatch(k);
    if (r === "played") out.superseded = earliest(out.superseded, t);
    else if (r === "unresolved") out.unverified = earliest(out.unverified, t);
  }
  return out;
}

/** Back-compatible: the earliest CONFIRMED superseding kickoff, or null. */
export function supersedingKickoff(input: Parameters<typeof assessSupersession>[0]): Date | null {
  return assessSupersession(input).superseded;
}

/**
 * Mark known matches confirmed as played when a team cache (fetched after
 * kickoff) lists a result against that opponent within a day. Pure.
 */
export function confirmFromTeamCaches(
  known: readonly KnownKickoff[],
  caches: ReadonlyMap<number, ReadonlyArray<{ date: string; opponentApiId?: number | null }>>,
): KnownKickoff[] {
  const DAY = 24 * 60 * 60_000;
  return known.map(k => {
    if (k.opponentApiId == null) return k;
    const listed = (team: number, opp: number) => (caches.get(team) ?? []).some(m =>
      m.opponentApiId === opp && Math.abs(Date.parse(m.date) - k.kickoff.getTime()) <= DAY);
    return listed(k.teamApiId, k.opponentApiId) || listed(k.opponentApiId, k.teamApiId) ? { ...k, confirmedPlayed: true } : k;
  });
}

export type EvidencePartStatus =
  /** Verified and inside the lead-time tolerance, with no newer match known. */
  | "fresh"
  /** Verified, but older than the tolerance for this kickoff distance. */
  | "aged"
  /** Verified, but a match the team has since played is missing from it. */
  | "superseded"
  /**
   * Verified and within tolerance, but a later known fixture's outcome could
   * not be confirmed (stale status, postponement not yet observed, delay).
   * NOT stale at generation; publication re-checks with current data.
   */
  | "unverified"
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
  /** Kickoff of a later known match whose outcome is unconfirmed (team parts only). */
  unverifiedMatch?: string | null;
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
  unverifiedMatch?: Date | null;
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
    ...(input.unverifiedMatch !== undefined ? { unverifiedMatch: input.unverifiedMatch?.toISOString() ?? null } : {}),
  };
  if (!present) return base;
  if (input.supersededBy) return { ...base, status: "superseded" };
  if (toleranceMs !== null && (ageMs === null || ageMs > toleranceMs)) return { ...base, status: "aged" };
  if (input.unverifiedMatch) return { ...base, status: "unverified" };
  return { ...base, status: "fresh" };
}

/** Parts that must not support an automatically published early pick. */
export function staleParts(p: Pick<EvidenceProvenance, "homeTeam" | "awayTeam" | "standings" | "h2h">): string[] {
  return (["homeTeam", "awayTeam", "standings", "h2h"] as const)
    .filter(k => p[k].status === "aged" || p[k].status === "superseded");
}

/**
 * Publication-time recheck of the SAVED digest: has either team played since
 * the evidence the reasoning was written from (superseded), or is there a
 * later match whose outcome we cannot confirm (unverified)? Used by early
 * publication so a pick generated days ago cannot go live describing form
 * that may no longer be current.
 */
export function savedEvidenceSupersession(
  digest: MatchDigest,
  known: readonly KnownKickoff[],
  now: Date,
): { home: Supersession; away: Supersession } {
  const fixtureKickoff = new Date(digest.fixture.kickoff);
  const fk = Number.isFinite(fixtureKickoff.getTime()) ? fixtureKickoff : null;
  const side = (team: TeamDigest | undefined) => assessSupersession({
    teamApiId: team?.apiId ?? null, evidenceAsOf: latestObservedMatch(team), known, now, fixtureKickoff: fk,
    evidenceMatches: team?.last5 ?? [],
  });
  return { home: side(digest.teams.home), away: side(digest.teams.away) };
}

/** Narrow a stored provenance blob (AIJob.context.provenance). Null when absent or unrecognised. */
export function parseEvidenceProvenance(raw: unknown): EvidenceProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<EvidenceProvenance>;
  if (p.v !== 1 || !p.homeTeam || !p.awayTeam || !p.standings || !p.h2h) return null;
  return p as EvidenceProvenance;
}
