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
 * Stored as an opaque Json column: these are api-football response shapes that
 * this app deliberately does not model (generate.ts passes them to Gemini as
 * raw JSON), so narrowing them here would invent a contract nothing enforces.
 */

export type StoredContext = {
  /** Schema marker — lets a future shape change be detected rather than mis-read. */
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

export function buildStoredContext(input: Omit<StoredContext, "v">): StoredContext {
  return { v: 1, ...input };
}

/**
 * Narrow an AIJob.context Json value back to a StoredContext.
 *
 * Returns null for anything unusable — missing (jobs predating the column),
 * a different version marker, or missing fixture identifiers. Callers must
 * treat null as "cannot rewrite without re-fetching" rather than falling back
 * to an empty context: a rewrite silently generated from no evidence would
 * look identical to a real one while being far weaker, which is exactly the
 * failure mode contextComplete exists to make visible elsewhere.
 */
export function parseStoredContext(raw: unknown): StoredContext | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<StoredContext>;
  if (c.v !== 1) return null;
  if (typeof c.home !== "string" || typeof c.away !== "string") return null;
  if (typeof c.league !== "string" || typeof c.kickoff !== "string") return null;
  return {
    v: 1,
    home: c.home,
    away: c.away,
    league: c.league,
    kickoff: c.kickoff,
    homeContext: c.homeContext ?? null,
    awayContext: c.awayContext ?? null,
    standings: c.standings ?? null,
    h2h: c.h2h ?? null,
  };
}
