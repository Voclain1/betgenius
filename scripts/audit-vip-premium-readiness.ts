/** SELECT-only audit: no warming, generation, provider request or configuration write. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { lagosDateKey, lagosTodayBounds } from '../src/lib/lagosDate';
import { planVipPremiumCandidates, qualifyVipPremiumTargets, paidScopeFor, spareQuotaSlotsByDay, spareQuotaWideningMode, readVipPremiumAttempt, attemptsByKickoffDay, attemptKickoffDay, VIP_PREMIUM_BACKOFF_LOCK_PREFIX, vipPremiumOddsDiagnostic } from '../src/lib/vipPremiumOverlay';
import { quotaExperimentConfig, PAID_BASE_DAILY_ATTEMPTS } from '../src/lib/vipQuotaExperiment';
import { paidFixtureReadiness, summarisePaidOdds } from '../src/lib/vipPremiumReadiness';
import { PAID_ONLY_PROVENANCES } from '../src/lib/paidOnly';
import type { FixtureOdds } from '../src/lib/odds';

const H = 3_600_000;
const emit = (kind: string, data: object) => console.log(JSON.stringify({ kind, ...data }));
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const ssh = (command: string) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'vps', command], { encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
let stage = 'configuration';
let db: PrismaClient | undefined;
async function main() {
  const runtime = JSON.parse(ssh('cd /opt/betgenius && docker compose --env-file deploy.env exec -T app node -e ' + shellQuote(readFileSync('scripts/ops/paid-supply-config-probe.mjs', 'utf8'))));
  const tag = ssh("sed -n 's/^APP_TAG=//p' /opt/betgenius/deploy.env").trim();
  assert.match(tag, /^[a-f0-9]{40}$/);
  if (process.env.PAID_SUPPLY_EXPECTED_COMMIT) assert.equal(tag, process.env.PAID_SUPPLY_EXPECTED_COMMIT);
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(runtime)) if (typeof value === 'string' && value !== '(unset)') env[key] = value;
  if (runtime.anthropicKeyPresent) env.ANTHROPIC_API_KEY = 'presence-only';
  const now = new Date(), from = new Date(+now + 12 * H), until = new Date(+now + 48 * H);
  const deploy = new Date(process.env.PAID_SUPPLY_DEPLOYED_AT || '2026-11-15T14:19:29Z');
  assert.ok(Number.isFinite(+deploy) && deploy <= now);
  const num = (key: string) => { const n = Number(env[key]); return env[key] && Number.isFinite(n) && n > 0 ? n : null; };
  const input = num('VIP_QUOTA_INPUT_USD_PER_MILLION'), output = num('VIP_QUOTA_OUTPUT_USD_PER_MILLION');
  emit('runtime_configuration', { at: now, deployedCommit: tag, settings: runtime, experimentDisabled: env.VIP_QUOTA_EXPERIMENT !== 'on', activeExperimentConfigValid: !!quotaExperimentConfig(env, now), reservationUsd: input && output ? Math.ceil(200_000 * input + 16_000 * output) / 1e6 : null });
  assert.notEqual(env.VIP_QUOTA_EXPERIMENT, 'on', 'experiment unexpectedly enabled');
  stage = 'read-only-guard';
  const url = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '');
  url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=20000');
  db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const evidence = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [guard] = await tx.$queryRawUnsafe<{ database: string; read_only: string }[]>("SELECT current_database() AS database,current_setting('transaction_read_only') AS read_only");
    assert.equal(guard.database, 'betgenius'); assert.equal(guard.read_only, 'on');
    stage = 'cached-eligibility';
    const jobs = await tx.aIJob.findMany({ where: { createdAt: { gte: new Date(+now - 4 * 24 * H) }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { id: true, prompt: true, createdAt: true, status: true } });
    const attempts = jobs.flatMap(j => { const a = readVipPremiumAttempt(j.prompt, j.createdAt); return a ? [a] : []; });
    const used = attemptsByKickoffDay(attempts);
    const ledger = await tx.generationAttempt.findMany({ where: { kickoff: { gte: from, lte: new Date(+until + 24 * H) } } });
    const currentLedger = ledger.filter(l => l.status === 'SUCCEEDED' && l.fixtureApiId !== null && l.kickoff && l.kickoff <= until);
    const rows = await tx.prediction.findMany({ where: { status: { not: 'ARCHIVED' }, kickoff: { gte: from, lte: until } }, select: { id: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, status: true, provenance: true, contextComplete: true } });
    const locks = await tx.appLock.findMany({ where: { key: { startsWith: VIP_PREMIUM_BACKOFF_LOCK_PREFIX }, expiresAt: { gt: now } }, select: { key: true } });
    const backoffs = new Set(locks.map(l => Number(l.key.slice(VIP_PREMIUM_BACKOFF_LOCK_PREFIX.length))));
    const slots = spareQuotaSlotsByDay({ days: currentLedger.map(l => lagosDateKey(l.kickoff!)), coreLedger: ledger, attempted: new Set(attempts.flatMap(a => a.fixtureApiId === null ? [] : [a.fixtureApiId])), used, quota: PAID_BASE_DAILY_ATTEMPTS, now });
    const plan = planVipPremiumCandidates({ ledger: currentLedger, rows, attempts, backingOff: backoffs, now, scope: paidScopeFor(currentLedger, now), spareQuota: { mode: spareQuotaWideningMode(env), slots } });
    const quotes = await tx.fixtureOddsCache.findMany({ where: { matchKey: { in: plan.candidates.map(c => c.matchKey) } } });
    const qm = new Map(quotes.map(q => [q.matchKey, { oddsJson: q.oddsJson as unknown as FixtureOdds | null, fetchedAt: q.fetchedAt, lastAttemptAt: q.lastAttemptAt, lastError: q.lastError }]));
    const uncapped = qualifyVipPremiumTargets(plan.candidates, qm, now, plan.candidates.length, undefined, slots);
    const baseline = qualifyVipPremiumTargets(plan.candidates, qm, now, plan.candidates.length, { used, quota: PAID_BASE_DAILY_ATTEMPTS }, slots);
    const reservations = await tx.paidQuotaAttempt.findMany({ select: { fixtureApiId: true, kickoffDay: true, spendDay: true, createdAt: true, reservedMicroUsd: true, modelRequests: true, usageReliable: true } });
    const eligible = uncapped.targets.filter(t => !reservations.some(r => r.fixtureApiId === t.fixtureApiId));
    const orphanReservations = reservations.filter(r => !attempts.some(a => a.fixtureApiId === r.fixtureApiId));
    const fixtureDays = paidFixtureReadiness([...attempts.map(a => ({ day: attemptKickoffDay(a), fixtureApiId: a.fixtureApiId })), ...orphanReservations.map(r => ({ day: r.kickoffDay, fixtureApiId: r.fixtureApiId }))], eligible.map(t => ({ day: lagosDateKey(t.kickoff), fixtureApiId: t.fixtureApiId })));
    stage = 'publication-and-budgets';
    const published = await tx.prediction.findMany({ where: { provenance: { in: [...PAID_ONLY_PROVENANCES] }, publishedAt: { gte: deploy } }, orderBy: { publishedAt: 'asc' }, select: { id: true, status: true, fixtureApiId: true, kickoff: true, publishedAt: true, provenance: true, confidence: true } });
    const recent = await tx.jobRun.findMany({ where: { job: 'generate-vip-premium' }, orderBy: { ranAt: 'desc' }, take: 12, select: { ranAt: true, ok: true, detail: true } });
    // Trace the whole deployment interval, not just the latest quota standdowns.
    // Return counts and reason codes only; never saved prompts or raw errors.
    const cycles = await tx.jobRun.findMany({ where: { job: 'generate-vip-premium', ranAt: { gte: deploy } }, select: { ok: true, detail: true } });
    const lifecycle = { cycles: cycles.length, failedCycles: cycles.filter(c => !c.ok).length, evaluated: 0, promotedVip: 0, promotedPremium: 0, published: 0, heldForRequote: 0, publishHeld: 0, duplicateFixture: 0, rejectedReasons: {} as Record<string, number> };
    for (const cycle of cycles) {
      const v = (cycle.detail as any)?.vipPremium;
      if (!v) continue;
      for (const key of ['evaluated', 'published', 'heldForRequote', 'duplicateFixture'] as const) if (Number.isSafeInteger(v[key]) && v[key] >= 0) lifecycle[key] += v[key];
      for (const key of ['promotedVip', 'promotedPremium', 'publishHeld'] as const) if (Array.isArray(v[key])) lifecycle[key] += v[key].length;
      for (const [reason, count] of Object.entries(v.rejectedReasons ?? {})) if (/^[A-Z_]{1,80}$/.test(reason) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) lifecycle.rejectedReasons[reason] = (lifecycle.rejectedReasons[reason] ?? 0) + count;
    }
    const deploymentJobs = await tx.aIJob.findMany({ where: { createdAt: { gte: deploy }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { prompt: true, createdAt: true, status: true, predictions: { select: { provenance: true, status: true, confidence: true } } } });
    const generation = { scheduled: {} as Record<string, number>, manual: {} as Record<string, number>, predictionRows: 0, dedicatedRows: 0, draftConfidenceBelow75: 0 };
    for (const job of deploymentJobs) {
      if (!readVipPremiumAttempt(job.prompt, job.createdAt)) continue;
      let manual = false; try { manual = JSON.parse(job.prompt).manual === true; } catch { continue; }
      const counts = manual ? generation.manual : generation.scheduled;
      counts[job.status] = (counts[job.status] ?? 0) + 1;
      generation.predictionRows += job.predictions.length;
      generation.dedicatedRows += job.predictions.filter(p => PAID_ONLY_PROVENANCES.includes(p.provenance as any)).length;
      generation.draftConfidenceBelow75 += job.predictions.filter(p => p.confidence < 75).length;
    }
    const bounds = lagosTodayBounds(now), today = attempts.filter(a => a.createdAt >= bounds.start && a.createdAt < bounds.end);
    const extras = reservations.filter(r => r.spendDay === lagosDateKey(now));
    const spend = today.length + extras.filter(r => !today.some(a => a.fixtureApiId === r.fixtureApiId)).length;
    const usage = await tx.apiUsage.findMany({ where: { day: now.toISOString().slice(0, 10) } });
    const calls = usage.reduce((sum, r) => sum + r.count, 0);
    return { at: now, database: guard.database, readOnly: guard.read_only, windowFrom: from, windowUntil: until,
      funnel: { covered: plan.considered, inScope: plan.candidates.length, planSkips: plan.skipped, qualificationSkips: uncapped.skipped, baselineSkips: baseline.skipped, eligible: eligible.map(t => ({ fixtureApiId: t.fixtureApiId, kickoff: t.kickoff, quoteAgeMinutes: t.quoteAgeMs / 60_000, marketSignal: t.marketProbability, bookmakers: t.bookmakers })) },
      fixtureDays, odds: summarisePaidOdds(plan.candidates.map(c => vipPremiumOddsDiagnostic(c, qm.get(c.matchKey), now))),
      publication: { sinceDeployment: deploy, rowsAcrossAllStatuses: published, latePublications: published.filter(p => !p.kickoff || !p.publishedAt || p.publishedAt >= p.kickoff).length, lifecycle, generation },
      budget: { creationDay: lagosDateKey(now), attemptCharges: spend, remainingCreationSlots: Math.max(0, 12 - spend), apiUtcDay: now.toISOString().slice(0, 10), calls, paidApiHeadroom: Math.max(0, Math.min(num('API_FOOTBALL_DAILY_LIMIT') ?? 7500, 7500) - (num('API_FOOTBALL_DAILY_RESERVE') ?? 100) - calls), extraReservedUsd: extras.reduce((sum, r) => sum + r.reservedMicroUsd, 0) / 1e6, unreliableExtraRequests: extras.filter(r => r.modelRequests > 0 && !r.usageReliable).length },
      recentCycles: recent.map(r => { const v = (r.detail as any)?.vipPremium; return { at: r.ranAt, ok: r.ok, considered: v?.considered, inScope: v?.inScope, freshlyPriced: v?.freshlyPriced, qualified: v?.qualified, skipped: v?.skipped, evaluated: v?.evaluated, published: v?.published, rejectedReasons: v?.rejectedReasons, publishHeld: v?.publishHeld, heldForRequote: v?.heldForRequote, publicationOutcome: v?.publicationOutcome }; }),
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 90_000, maxWait: 15_000 });
  emit('readiness_snapshot', evidence);
  emit('audit_complete', { productionWritten: false, providerCalls: 0, quotesWarmed: 0, configurationChanged: false, featureActivated: false });
}
main().catch(() => { console.error(JSON.stringify({ kind: 'audit_failed', stage, valuesWithheld: true })); process.exitCode = 1; }).finally(() => db?.$disconnect());
