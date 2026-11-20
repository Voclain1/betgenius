/**
 * Early preparation is deliberately separate from the 12–48h final-prediction
 * lane. Nothing here changes VIP/Premium windows or publication gates.
 */
import { generationTierOf } from "@/lib/leagues";

export const EARLY_FIXTURE_POLICY = {
  CORE_DAYS: 14,
  SECONDARY_DAYS: 10,
  EARLY_GENERATION_FROM_HOURS: 48,
  EARLY_GENERATION_UNTIL_HOURS: 336,
  MAX_QUEUE_PER_DAY: 20,
  MAX_QUEUE_PER_LEAGUE: 8,
  MIN_API_QUOTA_REMAINING: 2_200,
  MAX_RUN_MS: 22_000,
} as const;

export type EarlyFixtureMode = "off" | "shadow" | "on";

/** Off by default until the new schema has been deployed and the lane verified. */
export function earlyFixtureMode(value: string | undefined = process.env.EARLY_FIXTURE_MODE): EarlyFixtureMode {
  return value === "on" || value === "shadow" ? value : "off";
}

export function discoveryHorizonDays(leagueApiId: number): number {
  const tier = generationTierOf(leagueApiId);
  return tier === "CORE" ? EARLY_FIXTURE_POLICY.CORE_DAYS
    : tier === "SECONDARY" ? EARLY_FIXTURE_POLICY.SECONDARY_DAYS
    : 0;
}

/** UTC date strings, inclusive: provider requests remain bounded to the tier. */
export function earlyDateRange(now: Date, days: number): { from: string; to: string } {
  return {
    from: now.toISOString().slice(0, 10),
    to: new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10),
  };
}

/** No early queueing at or inside the existing 48-hour final-validation band. */
export function inEarlyGenerationWindow(kickoff: Date, now: Date, leagueApiId?: number | null): boolean {
  const hours = (kickoff.getTime() - now.getTime()) / 3_600_000;
  return Number.isFinite(hours)
    && hours > EARLY_FIXTURE_POLICY.EARLY_GENERATION_FROM_HOURS
    && hours <= (leagueApiId != null ? discoveryHorizonDays(leagueApiId) * 24 : EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS);
}
