import { prisma } from "@/lib/prisma";
import { VIP_PROXY_LEAGUE_IDS } from "@/lib/ai/generationRisk";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "@/lib/generation/window";

/**
 * First refusal on paid-tier fixtures, so the VIP/PREMIUM pass cannot be
 * out-raced by ordinary generation.
 *
 * THE RACE, precisely. Both passes draw from the same pool. Ordinary generation
 * discovers fixtures from api-football, writes a ledger row and completes in one
 * run, so a fixture goes from "absent from the ledger" to `SUCCEEDED` without
 * ever being visibly claimable. The paid pass, by contrast, can only target
 * ledger rows that are still `PENDING` (see selectVipPremiumTargets). The state
 * it needs is one ordinary generation never leaves behind.
 *
 * Measured before this existed: ZERO `PENDING` rows in the entire ledger at any
 * horizon, 202 fixtures inside 72h all `SUCCEEDED`, 31 of them in paid-tier
 * leagues — and 4 paid-pass attempts across 14 days, producing 0 VIP and 1
 * PREMIUM against a forecast of 1.65 and 1.00 per DAY. The pass was scheduled,
 * firing, and returning HTTP 200 with `claimed: 0`, which is indistinguishable
 * from a quiet market. docs/GENERATION_SCHEDULING.md describes the same failure
 * and tries to prevent it with cron ORDERING — but ordering lives in
 * cron-job.org, outside this repository, and cannot be enforced here. This can.
 *
 * HOW: a reservation is an ordinary `PENDING` ledger row whose `nextAttemptAt`
 * is in the near future. No new column, no new status, no new state machine —
 * both halves of the behaviour already exist:
 *   - ordinary generation skips a row while `nextAttemptAt > now` (the retry
 *     backoff check in selectCandidates), so it leaves the fixture alone;
 *   - the paid pass filters on `status === "PENDING"` and does NOT look at
 *     `nextAttemptAt`, so the same row is immediately targetable.
 *
 * WHY IT CANNOT STICK. `nextAttemptAt` is a timestamp, not a flag. When it
 * passes, the row becomes an ordinary retry-eligible candidate and ordinary
 * generation claims it on its next run. There is no path that leaves a fixture
 * reserved indefinitely, and `attempts` is left at 0 so a reservation consumes
 * none of the retry budget that MAX_GENERATION_ATTEMPTS bounds.
 */

/**
 * How long ordinary generation stands off a paid-tier fixture.
 *
 * DERIVED FROM THE REAL CADENCES, not chosen for roundness. Ordinary generation
 * runs every 15 minutes (`10,25,40,55` — inferred from 461 live AIJob
 * timestamps, per docs/GENERATION_SCHEDULING.md) and the paid pass is scheduled
 * on the same 15-minute period, offset by five (`5,20,35,50`).
 *
 * A grace shorter than one full paid-pass period could expire between two paid
 * ticks and guarantee nothing. 15 minutes guarantees exactly one tick with zero
 * margin, and a single lost tick — a dropped Neon connection, which was observed
 * three times in one working session — would forfeit the fixture. 20 minutes
 * guarantees one tick and usually gives two, absorbing one failure.
 *
 * COST OF BEING WRONG IS SMALL AND ONE-SIDED. Only paid-tier-league fixtures are
 * reserved (31 of 192 in the last measurement, ~16%), only while the paid pass
 * still has quota today, and only inside its own 12-48h kickoff window — so the
 * delayed content is 12 hours or more from kickoff and a 20-minute wait changes
 * nothing a reader would notice. Everything else is untouched.
 */
export const PAID_TIER_GRACE_MS = 20 * 60 * 1000;

export type GraceCandidate = {
  matchKey: string;
  fixtureApiId: number | null;
  leagueApiId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamApiId: number;
  awayTeamApiId: number;
  kickoff: Date;
  round: string | null;
  /** True when selectCandidates found no ledger row for this fixture at all. */
  isNewToLedger: boolean;
};

export function isPaidTierLeague(leagueApiId: number | null | undefined): boolean {
  return (VIP_PROXY_LEAGUE_IDS as readonly number[]).includes(leagueApiId ?? -1);
}

/**
 * Is this fixture one the paid pass could actually take?
 *
 * The kickoff bound is the paid pass's own window rather than ordinary
 * generation's. selectVipPremiumTargets requires
 * GENERATE_FROM_HOURS..GENERATE_UNTIL_HOURS, so reserving a fixture three hours
 * out would delay ordinary content for a pass that is structurally unable to
 * claim it — a pure loss.
 */
export function isReservable(candidate: { leagueApiId: number; kickoff: Date; isNewToLedger: boolean }, now: Date): boolean {
  if (!candidate.isNewToLedger) return false;
  if (!isPaidTierLeague(candidate.leagueApiId)) return false;
  const ms = candidate.kickoff.getTime() - now.getTime();
  return ms >= GENERATE_FROM_HOURS * 3_600_000 && ms <= GENERATE_UNTIL_HOURS * 3_600_000;
}

/**
 * Reserve eligible paid-tier fixtures and report which keys to withhold from
 * this run's candidates.
 *
 * Returns an empty set — and writes nothing — when the paid pass has no quota
 * left today. A reservation exists to give that pass a chance; once it can no
 * longer act, holding a fixture back would delay ordinary content for nobody.
 *
 * NEVER THROWS. This sits in the path that produces all ordinary content. A
 * failure to reserve should cost the paid pass a fixture, never cost the site
 * its generation run, so errors are logged and treated as "reserved nothing".
 */
export async function reservePaidTierFixtures(
  candidates: GraceCandidate[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const reservable = candidates.filter((c) => isReservable(c, now));
  if (reservable.length === 0) return new Set();

  try {
    // Deferred import: vipPremiumPipeline imports this module's siblings in
    // generation/selector, and a static import here would close that cycle.
    const { vipPremiumGeneratedToday, VIP_PREMIUM_DAILY_QUOTA } = await import("@/lib/vipPremiumPipeline");
    const spent = await vipPremiumGeneratedToday(now);
    if (spent >= VIP_PREMIUM_DAILY_QUOTA) return new Set();

    const nextAttemptAt = new Date(now.getTime() + PAID_TIER_GRACE_MS);
    // skipDuplicates keeps this idempotent: two overlapping runs cannot create
    // two ledger rows for one matchKey, and a row that already exists is one
    // this function did not need to create.
    await prisma.generationAttempt.createMany({
      data: reservable.map((c) => ({
        matchKey: c.matchKey,
        fixtureApiId: c.fixtureApiId,
        leagueApiId: c.leagueApiId,
        leagueName: c.leagueName,
        homeTeam: c.homeTeam,
        awayTeam: c.awayTeam,
        kickoff: c.kickoff,
        round: c.round,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt,
      })),
      skipDuplicates: true,
    });
    return new Set(reservable.map((c) => c.matchKey));
  } catch (error) {
    console.error("[paidTierGrace] reservation failed; ordinary generation proceeds unchanged", {
      code: "PAID_TIER_RESERVE_FAILED",
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}
