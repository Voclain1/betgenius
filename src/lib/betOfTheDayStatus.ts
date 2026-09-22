/**
 * Whether the tagged Bet of the Day is still a live recommendation.
 *
 * The BET_OF_THE_DAY tag stays on its pick after kickoff and after settlement.
 * That is deliberate: the row, its outcome and its tag are the history the
 * track record is built from, and nothing here deletes or untags anything.
 * The tag moves only when the next selection is made (setBetOfTheDay).
 *
 * What changes is where the pick may be SHOWN AS CURRENT. The homepage slot
 * presents it as today's recommendation, so it renders only while this
 * returns "LIVE". The dedicated page shows the other states as history,
 * never as an active tip.
 *
 * Pure and React-free so scripts/check-betofday-lifecycle.ts can assert it.
 */
export type BetOfTheDayState = "LIVE" | "STARTED" | "SETTLED" | "WITHDRAWN";

export function betOfTheDayState(
  row: { outcome: string; kickoff: Date | null; status?: string },
  now: Date = new Date(),
): BetOfTheDayState {
  if (row.status !== undefined && row.status !== "PUBLISHED") return "WITHDRAWN";
  if (row.outcome !== "PENDING") return "SETTLED";
  // No kickoff means it cannot be shown as upcoming either.
  if (!row.kickoff || new Date(row.kickoff).getTime() <= now.getTime()) return "STARTED";
  return "LIVE";
}

export function isCurrentBetOfTheDay(row: { outcome: string; kickoff: Date | null; status?: string }, now: Date = new Date()) {
  return betOfTheDayState(row, now) === "LIVE";
}
