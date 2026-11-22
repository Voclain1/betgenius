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
  // See EARLY_LANE_MIN_QUOTA_REMAINING below.
  MIN_API_QUOTA_REMAINING: 750,
  MAX_RUN_MS: 22_000,
} as const;

/**
 * Quota headroom (getUsageSnapshot().remaining = limit − reserve − used) below
 * which the early lane's provider-facing jobs (discovery, odds warming) stand
 * down. Shared by both.
 *
 * WAS 2,200 (discovery) and 1,800 (odds). Production, 15–21 Nov 2026 (verified
 * ApiUsage/JobRun exports, docs/API_FOOTBALL_7_DAY_USAGE_REPORT.md): every UTC
 * day used 6,421–7,125 requests, so both thresholds were crossed EVERY day and
 * early discovery stood down in 44 of 123 passes (35.8%; 28 of 48 on 21 Nov).
 * The cause is the live-score snapshot (src/lib/liveSnapshot.ts), which by
 * design spends everything above its 1,000 GENERATION_RESERVE — the floor it
 * keeps "for prediction generation and settlement". A threshold above that
 * floor guaranteed the early lane was the first thing shut out each day.
 *
 * The order in which lanes stop as the day's remaining quota falls must be:
 *   live scores (1,000)  →  early lane (750)  →  ordinary generation (500)
 *   →  paid VIP/Premium pass (30; plus the 300-request paid-only reserve).
 * So the early lane sits BELOW the live-score floor: live scores stop filling
 * first, and the early lane keeps running in the band live scores leave
 * untouched. On the verified days it would have stood down only once more
 * than 6,650 requests were used (15, 20 and 21 Nov, late in the UTC day),
 * instead of after 5,200 every day. Its own spend is unchanged and bounded
 * (≤4 /fixtures and ≤4 /odds per half hour; ≤384/day), and it stops 250
 * requests before ordinary generation and 720 before the paid pass.
 */
export const EARLY_LANE_MIN_QUOTA_REMAINING = 750;

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
