import { snapshotId } from "./reliabilitySnapshot";
import { prisma } from "./prisma";
import { auditPublicationQuoteEvidence } from "./paidEntryEvidence";
import { matchKey } from "./slug";
import {
  freshness,
  freshnessThresholds,
  meaningfulCompletion,
  reconcilePredictions,
  type FixtureState,
} from "./predictionOperations";
import { KNOWN_JOBS } from "./jobRuns";
type OperationsDb = Pick<
  typeof prisma,
  | "prediction"
  | "fixture"
  | "fixtureOddsCache"
  | "fixtureDetailCache"
  | "teamEnrichmentCache"
  | "jobRun"
  | "appLock"
  | "generationAttempt"
  | "notificationDelivery"
>;
export async function loadOperations(
  input: {
    days?: number;
    competition?: number;
    category?: string;
    severity?: string;
  } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      return readOperations(tx, input);
    },
    { timeout: 10000, maxWait: 1000 },
  );
}
async function readOperations(
  db: OperationsDb,
  input: {
    days?: number;
    competition?: number;
    category?: string;
    severity?: string;
  } = {},
) {
  const now = new Date(),
    days = input.days === 7 ? 7 : 1,
    since = new Date(+now - days * 86400000),
    limits = freshnessThresholds();
  const rows = await db.prediction.findMany({
    where: {
      kickoff: {
        gte: since,
        lte: new Date(+now + 3 * 86400000),
      },
      ...(input.competition ? { leagueApiId: input.competition } : {}),
      ...(input.category
        ? { categories: { some: { category: input.category } } }
        : {}),
    },
    take: 501,
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { categories: { select: { category: true } } },
  });
  const bounded = rows.slice(0, 500),
    ids = bounded.map((p) => p.id),
    fixtureIds = [
      ...new Set(
        bounded.flatMap((p) =>
          p.fixtureApiId != null ? [p.fixtureApiId] : [],
        ),
      ),
    ];
  const keys = [
    ...new Set(bounded.map((p) => matchKey(p)).filter((k): k is string => !!k)),
  ];
  const [
    fixtures,
    odds,
    details,
    teams,
    observations,
    executions,
    expiredLeases,
    ledger,
    notifications,
    ...histories
  ] = await Promise.all([
    db.fixture.findMany({
      where: { apiId: { in: fixtureIds } },
      take: 500,
      select: {
        apiId: true,
        status: true,
        kickoff: true,
        homeScore: true,
        awayScore: true,
        updatedAt: true,
      },
    }),
    db.fixtureOddsCache.findMany({
      where: { matchKey: { in: keys } },
      take: 500,
      select: {
        matchKey: true,
        fetchedAt: true,
        lastError: true,
        oddsJson: true,
      },
    }),
    db.fixtureDetailCache.findMany({
      where: { matchKey: { in: keys } },
      take: 500,
      select: { matchKey: true, fetchedAt: true, lastError: true },
    }),
    db.teamEnrichmentCache.findMany({where:{teamApiId:{in:[...new Set(bounded.flatMap(p=>[p.homeTeamApiId,p.awayTeamApiId].filter((id): id is number=>id!=null)))]}},take:1000,select:{teamApiId:true,fetchedAt:true,lastError:true}}),
    db.jobRun.findMany({
      where: {
        job: "prediction-reliability-s06",
        id: {
          in: ids.flatMap((id) => [
            snapshotId("VIP", id),
            snapshotId("PREMIUM", id),
          ]),
        },
      },
      take: 1000,
      orderBy: { ranAt: "desc" },
      select: { detail: true },
    }),
    db.jobRun.findMany({
      where: {
        job: { in: ["operations-execution", "operations-attempt"] },
        ranAt: { gte: since },
      },
      take: 101,
      orderBy: { ranAt: "desc" },
    }),
    db.appLock.findMany({
      where: { expiresAt: { lt: now } },
      take: 50,
      orderBy: { expiresAt: "asc" },
      select: { key: true, expiresAt: true },
    }),
    db.generationAttempt.findMany({
      where: {
        kickoff: { gte: since, lte: new Date(+now + 3 * 86400000) },
        status: { in: ["FAILED", "PENDING", "ABANDONED", "SUCCEEDED"] },
      },
      take: 101,
      orderBy: { kickoff: "asc" },
      select: {
        id: true,
        status: true,
        attempts: true,
        kickoff: true,
        nextAttemptAt: true,
        lastError: true,
        predictionIds: true,
      },
    }),
    db.notificationDelivery.findMany({
      where: { status: "FAILED", createdAt: { gte: since } },
      take: 51,
      select: { id: true },
    }),
    ...KNOWN_JOBS.map((job) =>
      db.jobRun.findMany({
        where: { job, ranAt: { gte: since } },
        take: 101,
        orderBy: { ranAt: "desc" },
        select: { job: true, ranAt: true, ok: true, ms: true, detail: true },
      }),
    ),
  ]);
  const fixtureMap = new Map<number, FixtureState>(
    fixtures.map((f) => [f.apiId, f]),
  );
  const evidence = new Set(
    bounded
      .filter(
        (p) =>
          p.kickoff &&
          auditPublicationQuoteEvidence(p.marketConfirmation, p.kickoff).usable,
      )
      .map((p) => p.id),
  );
  const observed = new Set(
    observations.flatMap((r) => {
      const d = r.detail as any;
      return typeof d?.predictionId === "string" ? [d.predictionId] : [];
    }),
  );
  const normalized = bounded.map((p) => ({
    ...p,
    categories: p.categories.map((c) => c.category),
  }));
  const findings = reconcilePredictions(
    normalized,
    fixtureMap,
    evidence,
    observed,
    now,
    limits.settlement,
  );
  for (const attempt of ledger)
    if (attempt.status === "SUCCEEDED" && !attempt.predictionIds.length)
      findings.push({
        code: "SUCCESS_WITHOUT_PREDICTION_IDS",
        severity: "WARNING",
        detail: `Generation attempt ${attempt.id} claims success with no recorded output ids`,
        repair: "MANUAL_REVIEW",
      });
  for (const attempt of ledger)
    if (
      ["PENDING", "FAILED"].includes(attempt.status) &&
      attempt.kickoff <= now
    )
      findings.push({
        code: "MISSED_GENERATION_WINDOW",
        severity: "WARNING",
        detail: `Attempt ${attempt.id} reached kickoff without completion`,
        repair: "MANUAL_REVIEW",
      });
  const byOdds = new Map(odds.map((q) => [q.matchKey, q])),
    byDetail = new Map(details.map((d) => [d.matchKey, d]));
  const byTeam = new Map(teams.map(t=>[t.teamApiId,t]));
  const fresh = bounded.map((p) => {
    const key = matchKey(p),
      q = key ? byOdds.get(key) : undefined,
      d = key ? byDetail.get(key) : undefined,
      f = p.fixtureApiId ? fixtureMap.get(p.fixtureApiId) : undefined;
    const local = freshness({
      fetchedAt: q?.fetchedAt ?? null,
      now,
      maxMinutes: limits.odds,
      lastError: q?.lastError,
    });
    const providerUpdate = (q?.oddsJson as any)?.update;
    const provider = freshness({
      fetchedAt: providerUpdate ? new Date(providerUpdate) : null,
      now,
      maxMinutes: limits.odds,
    });
    const oddsState =
      local.status === "FRESH" || local.status === "AGING" ? provider : local;
    if (
      p.kickoff &&
      p.kickoff > now &&
      p.status === "PUBLISHED" &&
      oddsState.status !== "FRESH"
    )
      findings.push({
        predictionId: p.id,
        code: "ODDS_" + oddsState.status,
        severity: "WARNING",
        detail: "Provider quote freshness differs from local fetch freshness",
        repair: "REFRESH_ODDS",
      });
    const publicationEvidence = (p.marketConfirmation as any)?.publicationQuoteEvidence ?? p.marketConfirmation as any;
    const quoteTime = publicationEvidence?.quoteFetchedAt;
    const teamFreshness = (id:number|null) => { const t=id!=null?byTeam.get(id):undefined;return freshness({fetchedAt:t?.fetchedAt??null,now,maxMinutes:limits.enrichment,lastError:t?.lastError}); };
    return {
      id: p.id,
      teamEnrichment: {home:teamFreshness(p.homeTeamApiId),away:teamFreshness(p.awayTeamApiId)},
      fixture: freshness({
        fetchedAt: f?.updatedAt ?? null,
        now,
        maxMinutes: limits.fixture,
      }),
      odds: oddsState,
      enrichment: freshness({
        fetchedAt: d?.fetchedAt ?? null,
        now,
        maxMinutes: limits.enrichment,
        lastError: d?.lastError,
      }),
      generation: freshness({
        fetchedAt: p.createdAt,
        now,
        maxMinutes: limits.generation,
      }),
      publication: freshness({
        fetchedAt: typeof quoteTime === "string" ? new Date(quoteTime) : null,
        now: p.publishedAt ?? now,
        maxMinutes: limits.publication,
      }),
      settlement:
        p.outcome === "PENDING"
          ? "PENDING"
          : p.settledAt
            ? "RECORDED"
            : "MISSING_TIME",
    };
  });
  const jobs = KNOWN_JOBS.map((job, i) => {
    const h = histories[i],
      classified = h
        .slice(0, 100)
        .map((r) => meaningfulCompletion(r.detail, r.ok ? 200 : 500));
    return {
      job,
      lastAt: h[0]?.ranAt ?? null,
      lastSuccess: h.find((r) => r.ok)?.ranAt ?? null,
      nextExpected: null,
      schedule: "External schedule unverified unless documented in audit",
      runs: classified.length,
      truncated: h.length > 100,
      transportSuccess: h.slice(0, 100).filter((r) => r.ok).length,
      useful: classified.filter((r) => r.status === "USEFUL_OUTPUT").length,
      failed: classified.filter(
        (r) => r.status === "FAILED" || r.status === "PARTIAL_FAILURE",
      ).length,
      unknown: classified.filter((r) => r.status === "UNKNOWN").length,
    };
  });
  const publishedInWindow = bounded.filter(
    (p) => p.publishedAt && p.publishedAt >= since && p.publishedAt <= now,
  );
  const publishedIds = new Set(publishedInWindow.map((p) => p.id));
  const upcomingIds = new Set(
    bounded
      .filter((p) => p.status === "PUBLISHED" && p.kickoff && p.kickoff > now)
      .map((p) => p.id),
  );
  return {
    now: now.toISOString(),
    days,
    truncated: rows.length > 500,
    universe: bounded.length,
    findings: findings.filter(
      (f) => !input.severity || f.severity === input.severity,
    ),
    freshness: fresh,
    jobs,
    publishing: normalized.reduce<Record<string, number>>((s, p) => {
      s[p.status] = (s[p.status] ?? 0) + 1;
      return s;
    }, {}),
    metrics: {
      apiErrorRate: null,
      recoveryAttempts: executions.filter(
        (r) =>
          r.job === "operations-attempt" &&
          (r.detail as any)?.status !== "RUNNING",
      ).length,
      recoverySuccesses: executions.filter(
        (r) => r.job === "operations-attempt" && r.ok,
      ).length,
      retryAttempts: executions.filter(
        (r) =>
          r.job === "operations-attempt" &&
          (r.detail as any)?.attempt > 1 &&
          (r.detail as any)?.status !== "RUNNING",
      ).length,
      retrySuccesses: executions.filter(
        (r) =>
          r.job === "operations-attempt" &&
          (r.detail as any)?.attempt > 1 &&
          r.ok,
      ).length,

      freshOdds: fresh.filter(
        (f) => upcomingIds.has(f.id) && f.odds.status === "FRESH",
      ).length,
      oddsDenominator: upcomingIds.size,
      latePublications: findings.filter(
        (f) =>
          f.code === "LATE_PUBLICATION" &&
          !!f.predictionId &&
          publishedIds.has(f.predictionId),
      ).length,
      published: publishedInWindow.length,
      settlementLatencyMinutes: bounded
        .filter(
          (p) =>
            p.kickoff &&
            p.settledAt &&
            p.settledAt >= since &&
            p.settledAt <= now,
        )
        .map((p) => (+p.settledAt! - +p.kickoff!) / 60000),
      discrepancies: findings.filter((f) => f.code === "RESULT_DISCREPANCY")
        .length,
    },
    executions: executions.slice(0, 100).map((r) => ({
      id: r.id,
      at: r.ranAt,
      ok: r.ok,
      summary: r.summary,
      detail: r.detail,
    })),
    expiredLeases,
    ledger: ledger.slice(0, 100),
    failedNotifications: notifications.length,
    notificationCountCapped: notifications.length > 50,
  };
}
