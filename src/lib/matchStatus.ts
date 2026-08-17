// API-Football status short-codes, classified into the 3 buckets the
// Livescores/Fixtures tab bar filters by. Reference: api-football.com docs.
export type MatchStatusGroup = "live" | "upcoming" | "finished";

const LIVE_CODES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const UPCOMING_CODES = new Set(["NS", "TBD"]);
// Not live, not upcoming — no further score updates coming, so they bucket
// under "Finished" for filtering purposes, but render their own label
// instead of a score (see isIrregular).
const IRREGULAR_CODES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

export function classifyStatus(short: string): MatchStatusGroup {
  if (LIVE_CODES.has(short)) return "live";
  if (UPCOMING_CODES.has(short)) return "upcoming";
  return "finished";
}

export function isIrregular(short: string): boolean {
  return IRREGULAR_CODES.has(short);
}

/**
 * Which tab a fixture belongs in, or `null` for none.
 *
 * classifyStatus answers "is a score still coming?", which is the right
 * question for rendering a row but the wrong one for a Finished tab: a
 * cancelled or postponed match has no score coming and never will, so it
 * classifies as finished while plainly not being a result. Listing it under
 * Finished tells a reader a match was played that wasn't.
 *
 * So irregular codes belong to no tab. They still render their own label
 * (see MatchRow) wherever something else puts them on screen — this only
 * governs tab membership and the counts beside the tab names.
 */
export function tabOfStatus(short: string): MatchStatusGroup | null {
  const group = classifyStatus(short);
  return group === "finished" && isIrregular(short) ? null : group;
}

const STATUS_LABELS: Record<string, string> = {
  PST: "Postponed",
  CANC: "Cancelled",
  ABD: "Abandoned",
  AWD: "Awarded",
  WO: "Walkover",
  HT: "HT",
  ET: "ET",
  BT: "Break",
  P: "Pens",
  SUSP: "Suspended",
  INT: "Interrupted",
  FT: "FT",
  AET: "FT (AET)",
  PEN: "FT (Pens)",
  TBD: "TBD",
};

export function statusLabel(short: string): string {
  return STATUS_LABELS[short] ?? short;
}
