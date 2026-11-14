import { NextRequest } from "next/server";
/** Disposable PostgreSQL only: actual leases, transitions, audits and notification transactions. */
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  executeOperation,
  operationIdentity,
} from "../src/lib/operationExecution";
import { loadOperations } from "../src/lib/operationsData";
import { recoverOperation } from "../src/lib/operationsRecovery";
import {
  applyReviewAction,
  publishPaidPredictionAtomically,
} from "../src/lib/predictions";
import { reconcilePredictions } from "../src/lib/predictionOperations";
function stub(path: string, exports: Record<string, unknown>) {
  const key = require.resolve(path);
  require.cache[key] = {
    id: key,
    filename: key,
    loaded: true,
    exports: { __esModule: true, ...exports },
  } as NodeJS.Module;
}
let oddsResponse: any = null,
  oddsCalls = 0;
let fixtures: any[] | null = [],
  providerCalls = 0,
  dateCalls = 0;
stub("../src/lib/football/api-football", {
  getOdds: async () => {
    oddsCalls++;
    return oddsResponse;
  },
  getFixturesByIds: async () => {
    providerCalls++;
    return fixtures;
  },
  getFixturesByDate: async () => {
    dateCalls++;
    return fixtures;
  },
});
const { settleFinishedPredictions } = require("../src/lib/settleFinished");
let role: string | undefined = "ADMIN",
  actorId = "";
stub("next-auth", {
  getServerSession: async () => ({ user: { role, id: actorId } }),
});
stub("../src/lib/auth", { authOptions: {} });
const { POST } = require("../src/app/api/admin/prediction-ops/route");
const { PATCH } = require("../src/app/api/admin/predictions/[id]/route");
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable PostgreSQL required");
  const prefix = `s07-ci-${Date.now()}`,
    user = await prisma.user.create({
      data: { email: `${prefix}@example.invalid` },
    });
  actorId = user.id;
  const oldMode = process.env.OPS_RECOVERY_MODE;
  const quoteKeys: string[] = [];
  const executionIds: string[] = [],
    predictionIds: string[] = [],
    fixtureIds: string[] = [],
    teamIds: string[] = [];
  const apiId = 1900000000 + Math.floor(Math.random() * 10000000),
    league = await prisma.league.create({
      data: { apiId, name: prefix, country: "Synthetic", season: 2026 },
    });
  const home = await prisma.team.create({
      data: { apiId: apiId + 1, name: `${prefix}-home` },
    }),
    away = await prisma.team.create({
      data: { apiId: apiId + 2, name: `${prefix}-away` },
    });
  teamIds.push(home.id, away.id);
  const now = new Date(),
    future = new Date(+now + 86400000),
    past = new Date(+now - 3 * 3600000);
  const create = async (
    suffix: string,
    kickoff = future,
    fixtureApiId: number | null = null,
    status = "PENDING_REVIEW",
  ) => {
    const p = await prisma.prediction.create({
      data: {
        id: `${prefix}-${suffix}`,
        authorId: user.id,
        category: "FEATURED",
        market: "Match Winner",
        pick: "Home",
        marketType: "MATCH_WINNER",
        selection: { value: "HOME" },
        manualSettlementOnly: false,
        leagueApiId: 39,
        homeTeam: "Synthetic Home",
        awayTeam: "Synthetic Away",
        homeTeamApiId: apiId + 1,
        awayTeamApiId: apiId + 2,
        kickoff,
        fixtureApiId,
        status,
        confidence: 80,
        reasoning: "Synthetic operations integration",
        marketConfirmation: { publicationQuoteEvidence: { frozen: true } },
        categories: { create: { category: "FEATURED" } },
      },
      include: { categories: true },
    });
    predictionIds.push(p.id);
    return p;
  };
  try {
    let calls = 0;
    const key = `${prefix}:concurrent`;
    executionIds.push(operationIdentity(key));
    const input = {
      key,
      resource: key,
      actorId: user.id,
      reason: "Synthetic concurrent retry",
      run: async () => {
        calls++;
        return { ok: true, detail: { count: 1 } };
      },
    };
    await Promise.all(Array.from({ length: 8 }, () => executeOperation(input)));
    assert.equal(calls, 1);
    assert.equal((await executeOperation(input)).status, "SUCCEEDED");
    assert.equal(calls, 1);
    assert.equal(
      await prisma.jobRun.count({
        where: { id: { startsWith: operationIdentity(key) + "_" } },
      }),
      1,
    );
    const retryKey = `${prefix}:retry`,
      retryId = operationIdentity(retryKey);
    executionIds.push(retryId);
    let failedCalls = 0;
    for (let i = 1; i <= 3; i++) {
      const r = await executeOperation({
        key: retryKey,
        resource: retryKey,
        actorId: user.id,
        reason: "Synthetic provider timeout",
        run: async () => {
          failedCalls++;
          throw new Error("provider timeout");
        },
      });
      assert.equal(r.status, i === 3 ? "TERMINAL" : "FAILED");
      if (i < 3) {
        assert.equal(
          (
            await executeOperation({
              key: retryKey,
              resource: retryKey,
              actorId: user.id,
              reason: "Synthetic retry duplicate",
              run: input.run,
            })
          ).status,
          "BACKOFF",
        );
        const receipt = await prisma.jobRun.findUniqueOrThrow({
          where: { id: retryId },
        });
        await prisma.jobRun.update({
          where: { id: retryId },
          data: {
            detail: {
              ...(receipt.detail as any),
              nextAt: new Date(0).toISOString(),
            },
          },
        });
      }
    }
    assert.equal(failedCalls, 3);
    assert.equal(
      (
        await executeOperation({
          key: retryKey,
          resource: retryKey,
          actorId: user.id,
          reason: "Synthetic terminal retry",
          run: input.run,
        })
      ).status,
      "TERMINAL",
    );
    assert.equal(calls, 1);
    const expiredKey = `${prefix}:expired`,
      lockKey = "s07:" + operationIdentity(expiredKey);
    executionIds.push(operationIdentity(expiredKey));
    await prisma.appLock.create({
      data: {
        key: lockKey,
        holder: "dead-owner",
        acquiredAt: new Date(0),
        expiresAt: new Date(0),
      },
    });
    assert.equal(
      (
        await executeOperation({
          ...input,
          key: expiredKey,
          resource: expiredKey,
        })
      ).status,
      "SUCCEEDED",
    );
    const heldKey = `${prefix}:held`;
    await prisma.appLock.create({
      data: {
        key: "s07:" + operationIdentity(heldKey),
        holder: "other",
        expiresAt: future,
      },
    });
    assert.equal(
      (await executeOperation({ ...input, key: heldKey, resource: heldKey }))
        .status,
      "BUSY",
    );
    await prisma.appLock.delete({
      where: { key: "s07:" + operationIdentity(heldKey) },
    });
    const oldQuery = prisma.$queryRaw;
    try {
      (prisma as any).$queryRaw = async () => {
        throw new Error("database unavailable");
      };
      await assert.rejects(
        executeOperation({ ...input, key: `${prefix}:db` }),
        /database unavailable/,
      );
    } finally {
      (prisma as any).$queryRaw = oldQuery;
    }

    const interruptedKey = `${prefix}:interrupted`,
      interruptedId = operationIdentity(interruptedKey);
    executionIds.push(interruptedId);
    const interruptedState = {
      status: "RUNNING",
      attempt: 1,
      actorId: user.id,
      holder: "dead-worker",
      reason: "Synthetic interrupted execution",
    };
    await prisma.jobRun.create({
      data: {
        id: interruptedId,
        job: "operations-execution",
        ok: false,
        detail: interruptedState,
      },
    });
    await prisma.jobRun.create({
      data: {
        id: `${interruptedId}_1`,
        job: "operations-attempt",
        ok: false,
        detail: interruptedState,
      },
    });
    assert.equal(
      (
        await executeOperation({
          ...input,
          key: interruptedKey,
          resource: interruptedKey,
        })
      ).status,
      "SUCCEEDED",
    );
    assert.equal(
      (
        (
          await prisma.jobRun.findUniqueOrThrow({
            where: { id: `${interruptedId}_1` },
          })
        ).detail as any
      ).status,
      "INTERRUPTED",
    );
    const p = await create("publication");
    const outcomes = await Promise.allSettled([
      applyReviewAction(p, "PUBLISH", user.id),
      applyReviewAction(p, "PUBLISH", user.id),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal(
      await prisma.notificationEvent.count({
        where: { predictionId: p.id, type: "NEW_PREDICTION" },
      }),
      1,
    );
    const finalFixture = await prisma.fixture.create({
      data: {
        apiId: apiId + 10,
        leagueId: league.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoff: future,
        status: "FT",
        homeScore: 1,
        awayScore: 0,
      },
    });
    fixtureIds.push(finalFixture.id);
    const finished = await create("finished", future, apiId + 10);
    await assert.rejects(
      applyReviewAction(finished, "PUBLISH", user.id),
      /FIXTURE_NOT_PREMATCH/,
    );
    await assert.rejects(
      publishPaidPredictionAtomically(finished, user.id, {}),
      /FIXTURE_NOT_PREMATCH/,
    );
    assert.equal(
      (
        await prisma.prediction.findUniqueOrThrow({
          where: { id: finished.id },
        })
      ).status,
      "PENDING_REVIEW",
    );
    const late = await create("late", past);
    await assert.rejects(applyReviewAction(late, "PUBLISH", user.id));
    const settling = await create("settle", past, apiId + 11, "PUBLISHED");
    const fixture = (status = "FT", homeScore = 1, awayScore = 0) => ({
      fixture: {
        id: apiId + 11,
        date: past.toISOString(),
        status: { short: status },
      },
      teams: {
        home: { id: apiId + 1, name: "Synthetic Home" },
        away: { id: apiId + 2, name: "Synthetic Away" },
      },
      goals: { home: homeScore, away: awayScore },
      score: {
        fulltime: { home: homeScore, away: awayScore },
        halftime: { home: 0, away: 0 },
      },
    });
    fixtures = [fixture()];
    await Promise.all([
      settleFinishedPredictions(1, [settling.id]),
      settleFinishedPredictions(1, [settling.id]),
    ]);
    const settled = await prisma.prediction.findUniqueOrThrow({
      where: { id: settling.id },
    });
    assert.equal(settled.outcome, "WON");
    assert.deepEqual(
      (settled.marketConfirmation as any).publicationQuoteEvidence,
      { frozen: true },
    );
    assert.equal(
      (settled.marketConfirmation as any).settlementEvidence.source,
      "api-football",
    );
    assert.equal(
      await prisma.notificationEvent.count({
        where: { predictionId: settling.id, type: "RESULT_WON" },
      }),
      1,
    );
    fixtures = [fixture("FT", 0, 1)];
    await settleFinishedPredictions(1, [settling.id]);
    assert.equal(
      (
        await prisma.prediction.findUniqueOrThrow({
          where: { id: settling.id },
        })
      ).outcome,
      "WON",
    );
    const discrepancy = reconcilePredictions(
      [{ ...settled, categories: ["FEATURED"] }],
      new Map([
        [
          apiId + 11,
          {
            status: "FT",
            kickoff: past,
            homeScore: 0,
            awayScore: 1,
            updatedAt: new Date(),
          },
        ],
      ]),
      new Set(),
      new Set(),
      new Date(),
    );
    assert.ok(discrepancy.some((f) => f.code === "RESULT_DISCREPANCY"));
    const pending = await create("pending", past, apiId + 11, "PUBLISHED");
    for (const status of ["PST", "ABD", "SUSP", "CANC", "1H"]) {
      fixtures = [fixture(status)];
      await settleFinishedPredictions(1, [pending.id]);
      assert.equal(
        (
          await prisma.prediction.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).outcome,
        "PENDING",
      );
    }
    fixtures = [{ ...fixture(), score: { fulltime: { home: 1, away: null } } }];
    await settleFinishedPredictions(1, [pending.id]);
    assert.equal(
      (await prisma.prediction.findUniqueOrThrow({ where: { id: pending.id } }))
        .outcome,
      "PENDING",
    );
    await prisma.prediction.update({
      where: { id: pending.id },
      data: { manualSettlementOnly: false },
    });
    const before = await prisma.prediction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    fixtures = null;
    providerCalls = 0;
    dateCalls = 0;
    await settleFinishedPredictions(1, [pending.id]);
    const after = await prisma.prediction.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert.equal(after.settlementAttempts, before.settlementAttempts);
    assert.equal(after.outcome, "PENDING");
    assert.equal(dateCalls, 0);
    assert.equal(providerCalls, 1);

    const rescheduled = await create(
      "rescheduled",
      new Date(+past - 3600000),
      apiId + 11,
      "PUBLISHED",
    );
    fixtures = [fixture()];
    await settleFinishedPredictions(1, [rescheduled.id]);
    const rescheduledResult = await prisma.prediction.findUniqueOrThrow({
      where: { id: rescheduled.id },
    });
    assert.equal(rescheduledResult.outcome, "WON");
    assert.equal(+rescheduledResult.kickoff!, +past);
    const recovery = {
      action: "REFRESH_ODDS" as const,
      predictionId: p.id,
      dryRun: true,
      role: "ADMIN",
      actorId: user.id,
      reason: "Synthetic recovery preview",
    };
    const count = await prisma.jobRun.count();
    await recoverOperation(recovery);
    assert.equal(await prisma.jobRun.count(), count);
    delete process.env.OPS_RECOVERY_MODE;
    assert.equal(
      ((await recoverOperation({ ...recovery, dryRun: false })) as any).status,
      "DISABLED",
    );
    await assert.rejects(
      recoverOperation({ ...recovery, role: "USER" }),
      /FORBIDDEN/,
    );
    const request = (origin = "https://example.invalid") =>
      new NextRequest("https://example.invalid/api/admin/prediction-ops", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REFRESH_ODDS",
          predictionId: p.id,
          dryRun: true,
          reason: "Synthetic preview reason",
        }),
      });
    role = "USER";
    assert.equal((await POST(request())).status, 403);
    role = "ADMIN";
    assert.equal((await POST(request("https://attacker.invalid"))).status, 403);
    assert.equal((await POST(request())).status, 200);

    // Manual corrections require an explicit reason and retain the prior evidence in a durable audit.
    const correctionRequest = (reason?: string) =>
      new Request(
        "https://example.invalid/api/admin/predictions/" + settling.id,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SETTLE",
            patch: {
              outcome: "LOST",
              finalHomeScore: 0,
              finalAwayScore: 1,
              ...(reason ? { correctionReason: reason } : {}),
            },
          }),
        },
      );
    assert.equal(
      (await PATCH(correctionRequest(), { params: { id: settling.id } }))
        .status,
      409,
    );
    assert.equal(
      (
        await PATCH(correctionRequest("Synthetic corrected result review"), {
          params: { id: settling.id },
        })
      ).status,
      200,
    );
    const audit = await prisma.jobRun.findMany({
      where: {
        job: "settlement-correction",
        summary: { contains: settling.id },
      },
    });
    assert.equal(audit.length, 1);
    assert.equal(
      (
        await prisma.prediction.findUniqueOrThrow({
          where: { id: settling.id },
        })
      ).settlementNote,
      "Synthetic corrected result review",
    );
    assert.equal((audit[0].detail as any).before.outcome, "WON");
    assert.deepEqual(
      (audit[0].detail as any).before.evidence.publicationQuoteEvidence,
      { frozen: true },
    );
    assert.equal(
      (
        await PATCH(correctionRequest("Synthetic corrected result review"), {
          params: { id: settling.id },
        })
      ).status,
      200,
    );
    assert.equal(
      await prisma.jobRun.count({
        where: {
          job: "settlement-correction",
          summary: { contains: settling.id },
        },
      }),
      1,
    );
    fixtures = [fixture()];
    process.env.OPS_RECOVERY_MODE = "manual";
    const recoveryInput = {
      action: "RETRY_SETTLEMENT" as const,
      predictionId: pending.id,
      dryRun: true,
      role: "ADMIN",
      actorId: user.id,
      reason: "Synthetic authorized retry",
    };
    const preview = (await recoverOperation(recoveryInput)) as any;
    assert.equal(preview.eligible, true);
    assert.equal(
      (
        (await recoverOperation({
          ...recoveryInput,
          dryRun: false,
          expectedKey: "wrong",
          authorizePublishedChange: true,
        })) as any
      ).status,
      "REQUIRES_VALID_PREVIEW_AND_AUTHORIZATION",
    );
    executionIds.push(operationIdentity(preview.key));
    const executed = (await recoverOperation({
      ...recoveryInput,
      dryRun: false,
      expectedKey: preview.key,
      authorizePublishedChange: true,
    })) as any;
    assert.equal(executed.status, "SUCCEEDED");
    const replay = (await recoverOperation({
      ...recoveryInput,
      dryRun: false,
      expectedKey: preview.key,
      authorizePublishedChange: true,
    })) as any;
    assert.equal(replay.replayed, true);

    const edited = await create("category-edit");
    const editRequest = (confidence: number, categories: string[]) =>
      new Request(
        "https://example.invalid/api/admin/predictions/" + edited.id,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "EDIT",
            patch: { confidence, categories },
          }),
        },
      );
    assert.equal(
      (await PATCH(editRequest(81, ["TODAY"]), { params: { id: edited.id } }))
        .status,
      200,
    );
    assert.deepEqual(
      (
        await prisma.predictionCategoryLink.findMany({
          where: { predictionId: edited.id },
        })
      ).map((c) => c.category),
      ["TODAY"],
    );
    const transaction = prisma.$transaction;
    try {
      (prisma as any).$transaction = (arg: any, ...args: any[]) =>
        typeof arg !== "function"
          ? (transaction as any).call(prisma, arg, ...args)
          : (transaction as any).call(
              prisma,
              async (tx: any) => {
                const update = tx.prediction.update;
                tx.prediction.update = (input: any) => {
                  if (input.data.confidence === 82)
                    throw new Error("Synthetic post-category failure");
                  return update(input);
                };
                return arg(tx);
              },
              ...args,
            );
      await assert.rejects(
        PATCH(editRequest(82, ["FEATURED"]), { params: { id: edited.id } }),
        /post-category failure/,
      );
    } finally {
      (prisma as any).$transaction = transaction;
    }
    assert.equal(
      (await prisma.prediction.findUniqueOrThrow({ where: { id: edited.id } }))
        .confidence,
      81,
    );
    assert.deepEqual(
      (
        await prisma.predictionCategoryLink.findMany({
          where: { predictionId: edited.id },
        })
      ).map((c) => c.category),
      ["TODAY"],
    );

    const oddsTarget = await create(
      "odds-refresh",
      future,
      apiId + 12,
      "PUBLISHED",
    );
    const { matchKey } = require("../src/lib/slug");
    const cacheKey = matchKey(oddsTarget);
    quoteKeys.push(cacheKey);
    oddsResponse = [
      {
        fixture: { id: apiId + 12 },
        update: new Date().toISOString(),
        bookmakers: [
          {
            id: 1,
            name: "Synthetic bookmaker",
            bets: [
              {
                name: "Match Winner",
                values: [
                  { value: "Home", odd: "1.5" },
                  { value: "Draw", odd: "4" },
                  { value: "Away", odd: "6" },
                ],
              },
            ],
          },
        ],
      },
    ];
    const oddsInput = {
      action: "REFRESH_ODDS" as const,
      predictionId: oddsTarget.id,
      dryRun: true,
      role: "ADMIN",
      actorId: user.id,
      reason: "Synthetic stale quote recovery",
    };
    const oddsPreview = (await recoverOperation(oddsInput)) as any;
    assert.equal(oddsPreview.eligible, true);
    executionIds.push(operationIdentity(oddsPreview.key));
    assert.equal(
      (
        (await recoverOperation({
          ...oddsInput,
          dryRun: false,
          expectedKey: oddsPreview.key,
          authorizePublishedChange: true,
        })) as any
      ).status,
      "SUCCEEDED",
    );
    assert.equal(oddsCalls, 1);
    assert.equal(
      (
        (await recoverOperation({
          ...oddsInput,
          dryRun: false,
          expectedKey: oddsPreview.key,
          authorizePublishedChange: true,
        })) as any
      ).replayed,
      true,
    );
    assert.equal(oddsCalls, 1);
    assert.deepEqual(
      (
        await prisma.prediction.findUniqueOrThrow({
          where: { id: oddsTarget.id },
        })
      ).marketConfirmation,
      oddsTarget.marketConfirmation,
    );

    const beforeFencedWrite = await prisma.fixtureOddsCache.findUniqueOrThrow({
      where: { matchKey: cacheKey },
    });
    const { refreshOddsCache } = require("../src/lib/enrichment");
    await assert.rejects(
      refreshOddsCache(
        {
          matchKey: cacheKey,
          fixtureApiId: apiId + 12,
          kickoff: future,
          kind: "published",
        },
        { key: "absent-synthetic-lease", holder: "expired-owner" },
      ),
      /RECOVERY_LEASE_LOST/,
    );
    assert.deepEqual(
      (
        await prisma.fixtureOddsCache.findUniqueOrThrow({
          where: { matchKey: cacheKey },
        })
      ).oddsJson,
      beforeFencedWrite.oddsJson,
    );
    const callsBeforeDiagnostics = providerCalls + dateCalls + oddsCalls,
      diagnosticStarted = Date.now();
    const diagnostics = await loadOperations({ days: 1 });
    assert.ok(diagnostics.universe <= 500);
    assert.equal(providerCalls + dateCalls + oddsCalls, callsBeforeDiagnostics);
    console.log(
      `Synthetic operations diagnostic query: ${Date.now() - diagnosticStarted} ms, zero provider calls.`,
    );
    console.log(
      "Sprint 07 PostgreSQL: lease concurrency/expiry, idempotency, retry/backoff/dead letter, DB outage, publication veto/races, atomic settlement evidence, provider outages, discrepancy detection and authorized dry-run recovery PASS",
    );
  } finally {
    if (oldMode === undefined) delete process.env.OPS_RECOVERY_MODE;
    else process.env.OPS_RECOVERY_MODE = oldMode;
    await prisma.notificationEvent.deleteMany({
      where: { predictionId: { in: predictionIds } },
    });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.fixtureOddsCache.deleteMany({
      where: { matchKey: { in: quoteKeys } },
    });
    await prisma.fixture.deleteMany({ where: { id: { in: fixtureIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.league.delete({ where: { id: league.id } });
    await prisma.jobRun.deleteMany({
      where: { OR: executionIds.map((id) => ({ id: { startsWith: id } })) },
    });
    await prisma.jobRun.deleteMany({
      where: { job: "settlement-correction", summary: { contains: prefix } },
    });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
