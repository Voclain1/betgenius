/**
 * Paid-feed operations: why a VIP/Premium day looked the way it did. Pure.
 *
 * A thin paid feed has five different causes that need five different
 * responses, and from the feed alone they look the same:
 *
 *   MISSING_FIXTURES     discovery found nothing (or almost nothing) to cover
 *   GENERATION_FAILURE   fixtures were found but generation failed on them
 *   PRICING_FAILURE      paid-scope fixtures had no pre-kickoff quote to judge
 *   PUBLICATION_FAILURE  promoted picks never published, or the paid pass
 *                        stopped running for hours (scheduler)
 *   LOW_OPPORTUNITY      everything ran; few fixtures cleared the bar
 *   OK                   the feed carried at least PAID_DAY_OK_PICKS picks
 *
 * Checked in that order: an operational failure is reported before "low
 * opportunity", so a broken day is never written off as a quiet one.
 */

export type PaidDayStatus = "OK" | "LOW_OPPORTUNITY" | "MISSING_FIXTURES" | "GENERATION_FAILURE" | "PRICING_FAILURE" | "PUBLICATION_FAILURE";

export type PaidDayInputs = {
  day: string;
  /** Fixtures in the generation ledger kicking off that day. */
  discovered: number;
  /** ...of which ordinary generation covered (ledger SUCCEEDED). */
  covered: number;
  /** ...of which failed or were abandoned. */
  failed: number;
  /** Covered fixtures inside the paid competitions (core + widened). */
  paidScope: number;
  /** ...of which had a pre-kickoff quote. */
  paidScopePriced: number;
  /** Dedicated-pass attempts for fixtures kicking off that day. */
  attempts: number;
  /** Dedicated-pass generation errors for that day's fixtures. */
  attemptErrors: number;
  /** Dedicated picks promoted for the day, and how many of them were published. */
  promoted: number;
  published: number;
  /** Longest gap, in minutes, between dedicated-pass runs during the hours that mattered for the day; null when unknown. */
  maxRunGapMinutes: number | null;
  /** Published picks in the VIP feed for the day. */
  vipPicks: number;
};

export const PAID_DAY_OK_PICKS = 2;
/** A discovery result under this is treated as missing fixtures, not a quiet day. */
export const PAID_DAY_MIN_DISCOVERED = 3;
/** Ledger failures above this share of discovered fixtures is a generation failure. */
export const PAID_DAY_MAX_FAILED_SHARE = 0.3;
/** Paid-scope fixtures priced below this share (with at least 3 in scope) is a pricing failure. */
export const PAID_DAY_MIN_PRICED_SHARE = 0.5;
/** The paid pass runs every 15 minutes; a gap above this is a scheduling failure. */
export const PAID_DAY_MAX_RUN_GAP_MINUTES = 120;

export function classifyPaidDay(d: PaidDayInputs): { status: PaidDayStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (d.discovered < PAID_DAY_MIN_DISCOVERED) reasons.push(`MISSING_FIXTURES: ${d.discovered} fixtures discovered`);
  if (d.discovered > 0 && d.failed / d.discovered > PAID_DAY_MAX_FAILED_SHARE) reasons.push(`GENERATION_FAILURE: ${d.failed}/${d.discovered} fixtures failed generation`);
  if (d.attemptErrors >= 2) reasons.push(`GENERATION_FAILURE: ${d.attemptErrors} paid-pass generation errors`);
  if (d.paidScope >= 3 && d.paidScopePriced / d.paidScope < PAID_DAY_MIN_PRICED_SHARE) reasons.push(`PRICING_FAILURE: ${d.paidScopePriced}/${d.paidScope} paid-scope fixtures priced`);
  if (d.promoted > d.published) reasons.push(`PUBLICATION_FAILURE: ${d.promoted - d.published} promoted pick(s) never published`);
  if (d.maxRunGapMinutes != null && d.maxRunGapMinutes > PAID_DAY_MAX_RUN_GAP_MINUTES) reasons.push(`PUBLICATION_FAILURE: paid pass silent for ${d.maxRunGapMinutes} minutes`);
  const first = reasons[0]?.split(":")[0] as PaidDayStatus | undefined;
  if (first) return { status: first, reasons };
  if (d.vipPicks < PAID_DAY_OK_PICKS) return { status: "LOW_OPPORTUNITY", reasons: [`LOW_OPPORTUNITY: ${d.vipPicks} pick(s) from ${d.paidScope} paid-scope fixtures, ${d.attempts} attempts`] };
  return { status: "OK", reasons: [] };
}

/** Statuses that need someone to look, as opposed to a quiet market. */
export const PAID_DAY_ALERT_STATUSES: readonly PaidDayStatus[] = ["MISSING_FIXTURES", "GENERATION_FAILURE", "PRICING_FAILURE", "PUBLICATION_FAILURE"];

/** Longest gap in minutes between consecutive run times inside [from, to]; edges count as gaps. Pure. */
export function maxGapMinutes(runs: readonly Date[], from: Date, to: Date): number {
  const ts = [from.getTime(), ...runs.map((r) => r.getTime()).filter((t) => t >= from.getTime() && t <= to.getTime()).sort((a, b) => a - b), to.getTime()];
  let gap = 0;
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i] - ts[i - 1]);
  return Math.round(gap / 60_000);
}
