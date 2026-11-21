/**
 * Early preparation is deliberately separate from the 12–48h final-prediction
 * lane. Nothing here changes VIP/Premium windows or publication gates.
 */
import { generationTierOf } from "@/lib/leagues";

export const EARLY_FIXTURE_POLICY = {
  CORE_DAYS: 14,
  SECONDARY_DAYS: 10,
  FALLBACK_DAYS: 7,
  DEEP_FALLBACK_DAYS: 5,
  EARLY_GENERATION_FROM_HOURS: 48,
  EARLY_GENERATION_UNTIL_HOURS: 336,
  // No daily or league fixture quota. Cron calls are finite for runtime/API
  // safety, but the backlog continues every cycle without an exhaustion cap.
  MIN_API_QUOTA_REMAINING: 2_200,
  MAX_RUN_MS: 22_000,
} as const;

/**
 * Strong regional interest needs regular sampling even on a busy global slate.
 * A spotlight slot scans one requested domestic league per early-discovery pass,
 * leaving the existing CORE/SECONDARY cursor intact (3 original slots).
 * This does not bypass fixture, odds, confidence, or publication gates.
 */
export const EARLY_SPOTLIGHT_LEAGUES = [
  307, // Saudi Pro League
  301, // UAE Pro League
  330, // Kuwaiti Premier League
  288, // South Africa PSL
  286, // Serbian Super Liga
  333, // Ukrainian Premier League
  235, // Russian Premier League
] as const;

/** Same fixed half-hour periods as the VPS early-discovery cron. */
export function earlySpotlightLeague(now: Date): number {
  return EARLY_SPOTLIGHT_LEAGUES[Math.floor(now.getTime() / (30 * 60_000)) % EARLY_SPOTLIGHT_LEAGUES.length];
}

export type EarlyFixtureMode = "off" | "shadow" | "on";

/** Off by default until the new schema has been deployed and the lane verified. */
export function earlyFixtureMode(value: string | undefined = process.env.EARLY_FIXTURE_MODE): EarlyFixtureMode {
  return value === "on" || value === "shadow" ? value : "off";
}

export function discoveryHorizonDays(leagueApiId: number): number {
  const tier = generationTierOf(leagueApiId);
  return tier === "CORE" ? EARLY_FIXTURE_POLICY.CORE_DAYS
    : tier === "SECONDARY" ? EARLY_FIXTURE_POLICY.SECONDARY_DAYS
    : tier === "FALLBACK" ? EARLY_FIXTURE_POLICY.FALLBACK_DAYS
    : tier === "DEEP_FALLBACK" ? EARLY_FIXTURE_POLICY.DEEP_FALLBACK_DAYS
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
