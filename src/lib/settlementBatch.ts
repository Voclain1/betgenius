/**
 * cron-job.org disconnects after 30 seconds. Five production-safe 40-item
 * samples took 42.58-51.07s; five 18-item samples took 18.80-20.67s. Keep the
 * hard clamp here so an old scheduler URL carrying ?limit=40 cannot bypass the
 * measured safe batch size.
 */
export const SETTLEMENT_BATCH_LIMIT = 18;

export function resolveSettlementBatchLimit(raw: string | null): number {
  return Math.min(
    SETTLEMENT_BATCH_LIMIT,
    Math.max(1, Number(raw) || SETTLEMENT_BATCH_LIMIT),
  );
}
