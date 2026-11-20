/**
 * The shared ledger contains both ordinary 48h rows and opt-in early fixtures.
 * Only an explicit, non-empty matchKey allowlist may consume the latter.
 * This pure helper keeps ordinary/paid generation inside its original scope.
 */
import { GENERATE_UNTIL_HOURS } from "./window";

export function maxQueuedKickoff(now: Date, explicitKeys?: readonly string[]): Date | undefined {
  return explicitKeys?.length
    ? undefined
    : new Date(now.getTime() + GENERATE_UNTIL_HOURS * 3_600_000);
}
