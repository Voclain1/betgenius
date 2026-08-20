/**
 * The football evidence a prediction was generated from, persisted on
 * AIJob.context so it can be replayed.
 *
 * The point of storing this is cost asymmetry. Assembling the context costs
 * ~11 API-Football calls against a 7,500/day budget (see src/lib/football/
 * usage.ts); re-asking Gemini the same question costs one Gemini call and no
 * football quota at all. A rewrite is a writing and judgement problem — the
 * reviewer disliked the angle, tone or confidence, not the underlying data —
 * so re-fetching would spend quota to obtain the same numbers.
 *
 * VERSIONS
 *
 * v1 stored the raw api-football payloads verbatim (opaque Json, deliberately
 * unmodelled). v2 stores the MatchDigest instead — the same evidence projected
 * into the shape the model is actually prompted with, roughly 40x smaller.
 *
 * Both are readable. A v1 row is upgraded to a digest on read, because
 * buildMatchDigest is a pure function of exactly the payloads v1 kept, so no
 * information is lost that the current prompt would have used anyway. That
 * means no migration and no rewrite path breaking on old rows — and a v1
 * rewrite gets the cheaper prompt too.
 */

import { buildMatchDigest, type MatchDigest } from "@/lib/ai/digest";
import type { FixtureRow, StandingsEntry } from "@/lib/football/api-football";

/** What v1 rows hold. Retained only so they can still be read and upgraded. */
type StoredContextV1 = {
  v: 1;
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeContext: unknown;
  awayContext: unknown;
  standings: unknown;
  h2h: unknown;
};

export type StoredContextV2 = { v: 2; digest: MatchDigest };

export function buildStoredContext(digest: MatchDigest): StoredContextV2 {
  return { v: 2, digest };
}

/**
 * v1 kept no team API ids — generate.ts held them but never wrote them into
 * the context. They're recoverable by name from the payloads that DO carry
 * both an id and a name (the standings rows, then the h2h fixtures), which is
 * enough for the digest's venue splits and h2h orientation.
 *
 * Returns null per side when nothing matches; the digest degrades to no last-5
 * and no h2h for that team rather than guessing, matching the fail-closed
 * posture searchTeam/generate.ts already take on unconfident id matches.
 */
function recoverTeamId(name: string, standings: unknown, h2h: unknown): number | null {
  const target = name.trim().toLowerCase();

  const rows = Array.isArray(standings) ? (standings as StandingsEntry[]) : [];
  for (const r of rows) {
    if (r?.team?.name?.trim().toLowerCase() === target) return r.team.id;
  }

  const meetings = Array.isArray(h2h) ? (h2h as FixtureRow[]) : [];
  for (const f of meetings) {
    if (f?.teams?.home?.name?.trim().toLowerCase() === target) return f.teams.home.id;
    if (f?.teams?.away?.name?.trim().toLowerCase() === target) return f.teams.away.id;
  }
  return null;
}

function upgradeV1(c: StoredContextV1): MatchDigest {
  const homeApiId = recoverTeamId(c.home, c.standings, c.h2h);
  const awayApiId = recoverTeamId(c.away, c.standings, c.h2h);
  return buildMatchDigest({
    home: c.home,
    away: c.away,
    league: c.league,
    kickoff: c.kickoff,
    homeApiId,
    awayApiId,
    homeContext: (c.homeContext ?? null) as any,
    awayContext: (c.awayContext ?? null) as any,
    standings: Array.isArray(c.standings) ? (c.standings as StandingsEntry[]) : null,
    h2h: Array.isArray(c.h2h) ? (c.h2h as FixtureRow[]) : null,
  });
}

/**
 * Narrow an AIJob.context Json value back to a digest the rewrite path can
 * prompt from.
 *
 * Returns null for anything unusable — missing (jobs predating the column) or
 * an unrecognised version marker. Callers must treat null as "cannot rewrite
 * without re-fetching" rather than falling back to an empty digest: a rewrite
 * silently generated from no evidence would look identical to a real one while
 * being far weaker, which is exactly the failure mode contextComplete exists to
 * make visible elsewhere.
 */
export function parseStoredContext(raw: unknown): MatchDigest | null {
  if (!raw || typeof raw !== "object") return null;
  // Deliberately a loose bag rather than `Partial<V1 & V2>` — the two versions
  // disagree on the literal type of `v`, so intersecting them is `never`.
  const c = raw as { v?: unknown; digest?: unknown } & Partial<Omit<StoredContextV1, "v">>;

  if (c.v === 2) {
    const d = c.digest as MatchDigest | undefined;
    if (!d || typeof d !== "object" || !d.fixture || !d.teams) return null;
    return d;
  }

  if (c.v === 1) {
    if (typeof c.home !== "string" || typeof c.away !== "string") return null;
    if (typeof c.league !== "string" || typeof c.kickoff !== "string") return null;
    return upgradeV1(c as StoredContextV1);
  }

  return null;
}
