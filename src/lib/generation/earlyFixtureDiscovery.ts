/**
 * Ahead-of-kickoff fixture capture. A separate, opt-in lane: it does not widen
 * the ordinary 48h discovery/sweep or the VIP/Premium qualification window.
 *
 * "shadow" writes a bounded future-fixture cache only.
 * "on" additionally seeds a small number of already-quality-filtered free
 * candidates into the existing generation ledger. It NEVER publishes picks.
 */
import { prisma } from "@/lib/prisma";
import { lagosDayBounds } from "@/lib/lagosDate";
import { leaguesInTiers } from "@/lib/leagues";
import { getFixturesByLeague, resolveSeason, type FixtureRow } from "@/lib/football/api-football";
import { getUsageSnapshot } from "@/lib/football/usage";
import { candidatesFromFixtures } from "@/lib/generation/selector";
import { EARLY_FIXTURE_POLICY, discoveryHorizonDays, earlyDateRange, earlyFixtureMode, type EarlyFixtureMode } from "@/lib/generation/earlyFixturePolicy";

const CURSOR_KEY = "early-fixture-discovery-cursor";
const EARLY_LEAGUES = leaguesInTiers(["CORE", "SECONDARY"]);
const DAY = 86_400_000;

export type EarlyDiscoveryReport = {
  ok: boolean;
  mode: EarlyFixtureMode;
  scanned: number;
  fixturesSeen: number;
  cached: number;
  candidatesQueued: number;
  quotaRemaining: number | null;
  failures: Array<{ leagueApiId: number; reason: string }>;
  elapsedMs: number;
  summary: string;
};

/** Rotates a unique batch through CORE+SECONDARY, independently of ordinary discovery. */
async function nextLeagues(batch: number, now: Date): Promise<number[]> {
  const size = EARLY_LEAGUES.length;
  if (!size) return [];
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "AppLock" ("key", "holder", "acquiredAt", "expiresAt")
    VALUES (${CURSOR_KEY}, ${String(batch)}, ${now}, ${new Date("2999-01-01T00:00:00Z")})
    ON CONFLICT ("key") DO UPDATE
      SET "holder" = (((("AppLock"."holder")::integer + ${batch}) % ${size}))::text,
          "acquiredAt" = ${now}
    RETURNING "holder"
  `;
  const end = Number(rows[0]?.holder ?? batch) % size;
  const start = (end - batch + size) % size;
  return Array.from({ length: batch }, (_, offset) => EARLY_LEAGUES[(start + offset) % size]);
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
  const base = { ok: true, mode, scanned: 0, fixturesSeen: 0, cached: 0, candidatesQueued: 0,
    quotaRemaining: null as number | null, failures: [] as EarlyDiscoveryReport["failures"], elapsedMs: 0, summary: "" };
  if (mode === "off") return { ...base, summary: "EARLY_FIXTURE_MODE=off; no calls or writes", elapsedMs: Date.now() - startedAt };

  const quota = await getUsageSnapshot();
  base.quotaRemaining = quota.remaining;
  if (quota.remaining < EARLY_FIXTURE_POLICY.MIN_API_QUOTA_REMAINING) {
    return { ...base, summary: "Early fixture capture stood down to protect API quota", elapsedMs: Date.now() - startedAt };
  }

  const batch = Math.min(4, Math.max(1, Math.trunc(opts.batchSize ?? 3)));
  const leagues = await nextLeagues(batch, now);
  const { start: lagosStart } = lagosDayBounds(0, now);
  let todayQueued = mode === "on"
    ? await prisma.upcomingFixture.count({ where: { earlyQueuedAt: { gte: lagosStart } } })
    : 0;

  for (const leagueApiId of leagues) {
    if (Date.now() - startedAt > EARLY_FIXTURE_POLICY.MAX_RUN_MS) break;
    const days = discoveryHorizonDays(leagueApiId);
    if (!days) continue;
    base.scanned++;
    try {
      const dates = earlyDateRange(now, days);
      const season = await resolveSeason(leagueApiId, now);
      const response = await getFixturesByLeague(leagueApiId, season, dates.from, dates.to);
      if (response === null) {
        base.failures.push({ leagueApiId, reason: "provider returned no usable response" });
        continue;
      }
      const rows = response.filter((r) => validFixture(r, now, days));
      base.fixturesSeen += rows.length;
      // Avoid firing hundreds of concurrent Neon queries for a busy cup slate.
      for (let i = 0; i < rows.length; i += 8) {
        const chunk = rows.slice(i, i + 8);
        await Promise.all(chunk.map((row) => persistFixture(row, now)));
        base.cached += chunk.length;
      }

      if (mode !== "on" || todayQueued >= EARLY_FIXTURE_POLICY.MAX_QUEUE_PER_DAY) continue;
      const available = Math.min(
        EARLY_FIXTURE_POLICY.MAX_QUEUE_PER_LEAGUE,
        EARLY_FIXTURE_POLICY.MAX_QUEUE_PER_DAY - todayQueued,
      );
      const selected = await candidatesFromFixtures(rows, {
        now,
        limit: available,
        fromHours: EARLY_FIXTURE_POLICY.EARLY_GENERATION_FROM_HOURS,
        untilHours: EARLY_FIXTURE_POLICY.EARLY_GENERATION_UNTIL_HOURS,
      });
      if (!selected.candidates.length) continue;
      const created = await prisma.generationAttempt.createMany({
        data: selected.candidates.map((c) => ({
          matchKey: c.matchKey,
          fixtureApiId: c.fixtureApiId,
          leagueApiId: c.leagueApiId,
          leagueName: c.leagueName,
          homeTeam: c.homeTeam,
          awayTeam: c.awayTeam,
          kickoff: c.kickoff,
          round: c.round,
          status: "PENDING",
        })),
        skipDuplicates: true,
      });
      if (created.count) {
        const fixtureIds = selected.candidates.map((c) => c.fixtureApiId);
        await prisma.upcomingFixture.updateMany({
          where: { fixtureApiId: { in: fixtureIds }, earlyQueuedAt: null },
          data: { earlyQueuedAt: now },
        });
        todayQueued += created.count;
        base.candidatesQueued += created.count;
      }
    } catch (error) {
      base.failures.push({ leagueApiId, reason: error instanceof Error ? error.message.slice(0, 180) : String(error) });
    }
  }

  base.elapsedMs = Date.now() - startedAt;
  base.ok = base.failures.length === 0;
  base.summary = "Early fixture " + mode + ": scanned " + base.scanned + " leagues, cached "
    + base.cached + " fixtures, queued " + base.candidatesQueued + ", failures " + base.failures.length;
  return base;
}
