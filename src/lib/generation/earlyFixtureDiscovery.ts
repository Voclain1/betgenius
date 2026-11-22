/**
 * Ahead-of-kickoff fixture capture. A separate, opt-in lane: it does not widen
 * the ordinary 48h discovery/sweep or the VIP/Premium qualification window.
 *
 * "shadow" writes a bounded future-fixture cache only.
 * "on" seeds all eligible quality-filtered free candidates over rotating
 * runs, with no daily or per-league quota. It NEVER publishes picks.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leaguesInTiers } from "@/lib/leagues";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot } from "@/lib/football/usage";
import { candidatesFromFixtures } from "@/lib/generation/selector";
import { EARLY_BOOST, EARLY_FIXTURE_POLICY, discoveryHorizonDays, earlyBoostGranted, earlyDateRange, earlyFixtureMode, earlySpotlightLeague, type EarlyFixtureMode } from "@/lib/generation/earlyFixturePolicy";

const CURSOR_KEY = "early-fixture-discovery-cursor";
const EARLY_LEAGUES = leaguesInTiers(["CORE", "SECONDARY"]);
const EARLY_EXPANDED_LEAGUES = leaguesInTiers(["FALLBACK", "DEEP_FALLBACK"]);
const EXPANDED_CURSOR_KEY = "early-fixture-expanded-discovery-cursor";
const DAY = 86_400_000;

export type EarlyDiscoveryReport = {
  ok: boolean;
  mode: EarlyFixtureMode;
  scanned: number;
  /** Per-league proof of real current upcoming fixture and queued-candidate coverage. */
  byLeague: Record<number, { fixtures: number; queued: number }>;
  fixturesSeen: number;
  cached: number;
  candidatesQueued: number;
  quotaRemaining: number | null;
  /** Whether this pass used the surplus allowance freed by the live-score floor (EARLY_BOOST). */
  boost?: { granted: boolean; baseSlots: number; slots: number };
  failures: Array<{ leagueApiId: number; reason: string }>;
  elapsedMs: number;
  summary: string;
};

/** Keep CORE+SECONDARY as the primary scan, use one existing scan slot
 * per pass for lower tiers. Same 4 provider calls maximum as before. */
async function nextLeagues(batch: number, now: Date, expanded = false): Promise<number[]> {
  const pool = expanded ? EARLY_EXPANDED_LEAGUES : EARLY_LEAGUES;
  const cursor = expanded ? EXPANDED_CURSOR_KEY : CURSOR_KEY;
  const size = pool.length;
  if (!size) return [];
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${cursor}, ${String(batch)}, ${now}, ${new Date("2999-01-01T00:00:00Z")})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = (((("AppLock"."holder")::integer + ${batch}) % ${size}))::text,
          "acquiredAt" = ${now}
    RETURNING "holder"
  `;
  const end = Number(rows[0]?.holder ?? batch) % size;
  const start = (end - batch + size) % size;
  return Array.from({ length: batch }, (_, offset) => pool[(start + offset) % size]);
}

function validFixture(row: FixtureRow, now: Date, horizonDays: number): boolean {
  const k = new Date(row.fixture?.date);
  return Number.isInteger(row.fixture?.id) && row.fixture.id > 0
    && Number.isInteger(row.league?.id) && row.league.id > 0
    && Number.isInteger(row.teams?.home?.id) && row.teams.home.id > 0
    && Number.isInteger(row.teams?.away?.id) && row.teams.away.id > 0
    && row.teams.home.id !== row.teams.away.id
    && Boolean(row.league?.name?.trim() && row.teams.home.name?.trim() && row.teams.away.name?.trim())
    && Number.isFinite(k.getTime()) && k.getTime() > now.getTime()
    && k.getTime() <= now.getTime() + horizonDays * DAY;
}

/** Provider id is stable across kickoff changes; never key the fixture cache by matchKey. */
async function persistFixture(row: FixtureRow, now: Date): Promise<void> {
  const fixtureApiId = row.fixture.id;
  const fields = {
    leagueApiId: row.league.id,
    leagueName: row.league.name,
    homeTeamApiId: row.teams.home.id,
    awayTeamApiId: row.teams.away.id,
    homeTeam: row.teams.home.name,
    awayTeam: row.teams.away.name,
    kickoff: new Date(row.fixture.date),
    status: row.fixture.status?.short ?? "UNKNOWN",
    round: row.league.round ?? null,
    lastSeenAt: now,
  };
  await prisma.upcomingFixture.upsert({
    where: { fixtureApiId },
    create: { fixtureApiId, ...fields },
    update: fields,
  });
}

/**
 * Provider errors keep the previous cache untouched; fresh observations update
 * stable fixture identities. No external scheduler changes are made here.
 */
export async function runEarlyFixtureDiscovery(opts: { batchSize?: number; now?: Date } = {}): Promise<EarlyDiscoveryReport> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const mode = earlyFixtureMode();
  const base = { ok: true, mode, scanned: 0, byLeague: {} as EarlyDiscoveryReport["byLeague"], fixturesSeen: 0, cached: 0, candidatesQueued: 0,
    quotaRemaining: null as number | null, boost: undefined as EarlyDiscoveryReport["boost"], failures: [] as EarlyDiscoveryReport["failures"], elapsedMs: 0, summary: "" };
  if (mode === "off") return { ...base, summary: "EARLY_FIXTURE_MODE=off; no calls or writes", elapsedMs: Date.now() - startedAt };

  const quota = await getUsageSnapshot();
  base.quotaRemaining = quota.remaining;
  if (quota.remaining < EARLY_FIXTURE_POLICY.MIN_API_QUOTA_REMAINING) {
    return { ...base, summary: "Early fixture capture stood down to protect API quota (" + quota.remaining + " left, needs " + EARLY_FIXTURE_POLICY.MIN_API_QUOTA_REMAINING + ")", elapsedMs: Date.now() - startedAt };
  }

  // A per-request time budget and quota headroom are operational safeguards,
  // never a lifetime/day/league limit on how much the engine can cover.
  const baseBatch = Math.min(4, Math.max(1, Math.trunc(opts.batchSize ?? 4)));
  // Surplus allowance (EARLY_BOOST): extra CORE/SECONDARY cursor slots only
  // while the day has at least 2,000 requests left. Below that, the original
  // 4-slot pass is unchanged.
  const boosted = baseBatch >= 4 && earlyBoostGranted(quota.remaining);
  const batch = baseBatch + (boosted ? EARLY_BOOST.DISCOVERY_EXTRA_SLOTS : 0);
  base.boost = { granted: boosted, baseSlots: baseBatch, slots: batch };
  // Base pass: one regional spotlight, two priority leagues and one rotating
  // fallback league (4 calls). A boosted pass adds priority-league slots only.
  const focusedLeague = earlySpotlightLeague(now);
  const expansionSlots = batch >= 4 && EARLY_EXPANDED_LEAGUES.length ? 1 : 0;
  const ordinarySlots = batch - 1 - expansionSlots;
  const regular = ordinarySlots > 0 ? await nextLeagues(ordinarySlots, now) : [];
  const expanded = expansionSlots ? await nextLeagues(expansionSlots, now, true) : [];
  const leagues = [...new Set([focusedLeague, ...regular, ...expanded])];

  for (const leagueApiId of leagues) {
    if (Date.now() - startedAt > EARLY_FIXTURE_POLICY.MAX_RUN_MS) break;
    const days = discoveryHorizonDays(leagueApiId);
    if (!days) continue;
    base.byLeague[leagueApiId] = { fixtures: 0, queued: 0 };
    try {
      // Reallocated fallback slots must NOT add an extra /leagues season lookup.
      // Reuse season metadata captured by existing enrichment; if absent,
      // retain the cursor and skip this league until its cache is ready.
      const expandedTier = EARLY_EXPANDED_LEAGUES.includes(leagueApiId);
      const cachedSeason = expandedTier ? await prisma.leagueEnrichmentCache.findUnique({
        where: { leagueApiId }, select: { season: true },
      }) : null;
      const season = expandedTier ? cachedSeason?.season : await resolveSeason(leagueApiId, now);
      if (!season) continue;
      const dates = earlyDateRange(now, days);
      base.scanned++;
      const response = await getFixturesByLeague(leagueApiId, season, dates.from, dates.to);
      if (response === null) {
        base.failures.push({ leagueApiId, reason: "provider returned no usable response" });
        continue;
      }
      const rows = response.filter((r) => validFixture(r, now, days));
      base.fixturesSeen += rows.length;
      base.byLeague[leagueApiId].fixtures = rows.length;
      // Avoid firing hundreds of concurrent Neon queries for a busy cup slate.
      for (let i = 0; i < rows.length; i += 8) {
        const chunk = rows.slice(i, i + 8);
        await Promise.all(chunk.map((row) => persistFixture(row, now)));
        base.cached += chunk.length;
      }

      if (mode !== "on" || !rows.length) continue;
      const selected = await candidatesFromFixtures(rows, {
        now,
        limit: rows.length,
        fromHours: EARLY_FIXTURE_POLICY.EARLY_GENERATION_FROM_HOURS,
        untilHours: Math.min(EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS, days * 24),
        cacheOnly: true, // Only existing standings; never refresh league data for early qualification.
      });
      if (!selected.candidates.length) continue;
      // Tag ONLY newly inserted attempts as early. createMany(skipDuplicates)
      // followed by marking every candidate can falsely authorize manual or
      // preexisting ordinary rows for early publication.
      for (const c of selected.candidates) {
        // Resume next cron run when the execution budget is consumed. Unqueued
        // fixtures are rediscovered; no permanent quota drops them.
        if (Date.now() - startedAt > EARLY_FIXTURE_POLICY.MAX_RUN_MS) break;
        try {
          await prisma.$transaction(async tx => {
            await tx.generationAttempt.create({
              data: {
                matchKey: c.matchKey, fixtureApiId: c.fixtureApiId,
                leagueApiId: c.leagueApiId, leagueName: c.leagueName,
                homeTeam: c.homeTeam, awayTeam: c.awayTeam,
                kickoff: c.kickoff, round: c.round, status: "PENDING",
              },
            });
            const marked = await tx.upcomingFixture.updateMany({
              where: { fixtureApiId: c.fixtureApiId, earlyQueuedAt: null },
              data: { earlyQueuedAt: now },
            });
            if (marked.count !== 1) throw new Error("EARLY_FIXTURE_ALREADY_QUEUED");
          });
          base.candidatesQueued++;
          base.byLeague[leagueApiId].queued++;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
          if (error instanceof Error && error.message === "EARLY_FIXTURE_ALREADY_QUEUED") continue;
          throw error;
        }
      }
    } catch (error) {
      base.failures.push({ leagueApiId, reason: error instanceof Error ? error.message.slice(0, 180) : String(error) });
    }
  }

  base.elapsedMs = Date.now() - startedAt;
  base.ok = base.failures.length === 0;
  base.summary = "Early fixture " + mode + (base.boost?.granted ? " (surplus allowance " + base.boost.slots + " slots)" : "") + ": scanned " + base.scanned + " leagues, cached "
    + base.cached + " fixtures, queued " + base.candidatesQueued + ", failures " + base.failures.length;
  return base;
}
