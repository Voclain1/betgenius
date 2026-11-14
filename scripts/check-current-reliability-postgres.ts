/** End-to-end current-mode curation -> committed category links -> immutable research records.
 * Real disposable PostgreSQL; no provider network access or production credentials. */
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { curateVipTips, curatePremiumTips } from "../src/lib/geniusCuration";
import {
  loadPaidCurationDecision,
  recordPaidSelectionShadow,
} from "../src/lib/vipPremiumPipeline";
import { matchKey } from "../src/lib/slug";
import { RELIABILITY_JOB, snapshotId } from "../src/lib/reliabilitySnapshot";

async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable local CI database required");
  const env = { ...process.env };
  const prefix = `current-s06-${Date.now()}`;
  const user = await prisma.user.create({
    data: { email: `${prefix}@example.invalid` },
  });
  const now = new Date("2030-01-05T09:00:00.000Z"),
    kickoff = new Date(+now + 6 * 3600000);
  const originalFetch = globalThis.fetch;
  let networkCalls = 0,
    cacheReads = 0;
  globalThis.fetch = (async () => {
    networkCalls++;
    throw new Error("Provider calls forbidden in curation test");
  }) as typeof fetch;
  const originalCacheRead = prisma.fixtureOddsCache.findMany;
  (prisma.fixtureOddsCache as any).findMany = (...args: unknown[]) => {
    cacheReads++;
    return (originalCacheRead as any).apply(prisma.fixtureOddsCache, args);
  };
  process.env.PAID_SELECTION_MODE = "current";
  process.env.RELIABILITY_SHADOW = "on";
  const ids: string[] = [];
  const logIds: string[] = [];
  const quoteKeys: string[] = [];
  try {
    const create = async (
      suffix: string,
      confidence: number,
      team: number,
      provenance = "VIP_ROUTE_CONFIRMED",
      marketType = "MATCH_WINNER",
    ) => {
      const row = await prisma.prediction.create({
        data: {
          id: `${prefix}-${suffix}`,
          category: "FEATURED",
          market: "Match Winner",
          pick: "Home",
          confidence,
          reasoning: "Disposable current-mode integration fixture",
          authorId: user.id,
          homeTeam: `${prefix} Home ${team}`,
          awayTeam: `${prefix} Away ${team + 1}`,
          homeTeamApiId: team,
          awayTeamApiId: team + 1,
          kickoff,
          status: "PUBLISHED",
          publishedAt: now,
          provenance,
          marketType,
          selection:
            marketType === "BTTS" ? { value: "YES" } : { value: "HOME" },
          leagueApiId: 39,
          createdAt: new Date(+now - 3600000),
          categories: { create: [{ category: "FEATURED" }] },
        },
      });
      ids.push(row.id);
      return row;
    };
    const selected = await create("selected", 85, 100001);
    const rejected = await create(
      "route-rejected",
      86,
      100011,
      "STANDARD_CURATED",
    );
    const duplicate = await create(
      "fixture-rejected",
      82,
      100001,
      "VIP_ROUTE_CONFIRMED",
      "BTTS",
    );
    const vipOnly = await create("vip-only", 78, 100021);
    const belowFloor = await create("below-floor", 70, 100031);
    const quoteKey = matchKey(selected)!;
    quoteKeys.push(quoteKey);
    await prisma.fixtureOddsCache.create({
      data: {
        matchKey: quoteKey,
        fetchedAt: new Date(+now - 10 * 60000),
        oddsJson: {
          bookmakerCount: 5,
          update: new Date(+now - 20 * 60000).toISOString(),
          markets: [
            {
              market: "Match Winner",
              selections: [
                ["Home", 1.16],
                ["Draw", 8],
                ["Away", 12],
              ].map(([value, odd]) => ({
                value,
                best: odd,
                median: odd,
                bookmakers: 5,
                bestBookmaker: "Book 0",
                quotes: Array.from({ length: 5 }, (_, i) => ({
                  bookmaker: `Book ${i}`,
                  odd,
                })),
              })),
            },
          ],
        },
      },
    });
    for (const [tier, curate] of [
      ["VIP", curateVipTips],
      ["PREMIUM", curatePremiumTips],
    ] as const) {
      const reset = () =>
        prisma.predictionCategoryLink.deleteMany({
          where: { predictionId: { in: ids }, category: tier },
        });
      const expected =
        tier === "VIP" ? [selected.id, vipOnly.id].sort() : [selected.id];
      await reset();
      process.env.RELIABILITY_DIAGNOSTICS = "off";
      cacheReads = 0;
      const baseline = await curate(now);
      assert.equal(cacheReads, 1, "one existing cache read, observer off");
      assert.deepEqual([...baseline.selectedIds].sort(), expected);
      assert.equal(
        await prisma.jobRun.count({
          where: { id: { in: ids.map((id) => snapshotId(tier, id)) } },
        }),
        0,
      );
      await reset();
      process.env.RELIABILITY_DIAGNOSTICS = "on";
      cacheReads = 0;
      const observed = await curate(now);
      assert.deepEqual(
        observed,
        baseline,
        "observer cannot change any curation plan field",
      );
      assert.equal(
        cacheReads,
        1,
        "reuse baseline assessment, no extra cache/provider read",
      );
      const links = await prisma.predictionCategoryLink.findMany({
        where: { predictionId: { in: ids }, category: tier },
      });
      assert.deepEqual(
        links.map((l) => l.predictionId).sort(),
        expected,
        "exact same committed category links",
      );
      const eligible =
        tier === "VIP"
          ? [selected.id, rejected.id, duplicate.id, vipOnly.id]
          : [selected.id, rejected.id, duplicate.id];
      const keys = eligible.map((id) => snapshotId(tier, id));
      logIds.push(...keys);
      const records = await prisma.jobRun.findMany({
        where: { id: { in: keys }, job: RELIABILITY_JOB },
      });
      assert.equal(
        records.length,
        eligible.length,
        "nonempty full eligible research universe",
      );
      const details = new Map(
        records.map((r) => [(r.detail as any).predictionId, r.detail as any]),
      );
      assert.equal(details.get(selected.id).baselineSelected, true);
      assert.equal(details.get(rejected.id).baselineSelected, false);
      assert.equal(details.get(rejected.id).baselineRule.eligible, false);
      assert.equal(
        details.get(duplicate.id).baselineSelected,
        false,
        "fixture rejection is preserved independently of admission",
      );
      assert.equal(details.get(duplicate.id).baselineRule.eligible, true);
      assert.equal(details.get(selected.id).estimate.status, "UNCALIBRATED");
      assert.equal(details.get(selected.id).rawConfidence, 85);
      assert.equal(details.get(selected.id).price.status, "VALID");
      assert.equal(details.get(selected.id).price.quotes.length, 5);
      assert.equal(
        await prisma.jobRun.count({
          where: { id: snapshotId(tier, belowFloor.id) },
        }),
        0,
      );
      assert.equal(
        await prisma.jobRun.count({
          where: { job: "paid-selection-shadow", ranAt: { gte: now } },
        }),
        0,
        "current mode must not enable legacy shadow logs",
      );
      // Actual curation retries (including concurrent observers) must never revise first decisions.
      await Promise.all([
        curate(new Date(+now + 60000)),
        curate(new Date(+now + 60000)),
      ]);
      const retried = await prisma.jobRun.findMany({
        where: { id: { in: keys } },
        orderBy: { id: "asc" },
      });
      assert.equal(retried.length, keys.length);
      assert.deepEqual(
        retried.map((r) => r.detail),
        [...records]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((r) => r.detail),
      );
      // Later baseline membership/confidence changes cannot rewrite the captured first decisions.
      const rows = await prisma.prediction.findMany({
        where: { id: { in: ids } },
      });
      const decision = await loadPaidCurationDecision(
        rows,
        tier,
        new Date(+now + 120000),
      );
      assert.equal(
        decision.assessments.length,
        0,
        "legacy current-mode channel remains unchanged",
      );
      assert.equal(decision.researchAssessments?.length, eligible.length);
      await recordPaidSelectionShadow({
        category: tier,
        day: "2030-01-05",
        effective: decision.effective,
        assessments: decision.assessments,
        researchAssessments: decision.researchAssessments?.map((a) => ({
          ...a,
          rawConfidence: 99,
        })),
        rows,
        selectedIds: [],
        plan: {},
        now: new Date(+now + 120000),
      });
      assert.deepEqual(
        (
          await prisma.jobRun.findMany({
            where: { id: { in: keys } },
            orderBy: { id: "asc" },
          })
        ).map((r) => r.detail),
        retried.map((r) => r.detail),
      );
      // Observer failure occurs AFTER category changes commit; only callback transactions fail.
      await reset();
      const transaction = prisma.$transaction;
      let failedObserverCalls = 0;
      (prisma as any).$transaction = (arg: unknown, ...rest: unknown[]) => {
        if (typeof arg === "function") {
          failedObserverCalls++;
          throw new Error("deliberate observer outage");
        }
        return (transaction as any).call(prisma, arg, ...rest);
      };
      try {
        assert.deepEqual(await curate(now), baseline);
        assert.equal(failedObserverCalls, 1, "observer really ran and failed");
        assert.deepEqual(
          (
            await prisma.predictionCategoryLink.findMany({
              where: { predictionId: { in: ids }, category: tier },
            })
          )
            .map((l) => l.predictionId)
            .sort(),
          expected,
        );
      } finally {
        (prisma as any).$transaction = transaction;
      }
      // Empty eligible pool: no cache calls, no fabricated records, valid empty plan.
      await prisma.prediction.updateMany({
        where: { id: { in: ids } },
        data: { status: "ARCHIVED" },
      });
      cacheReads = 0;
      const countBefore = await prisma.jobRun.count({
        where: { job: RELIABILITY_JOB },
      });
      const empty = await curate(now);
      assert.deepEqual(empty.selectedIds, []);
      assert.equal(cacheReads, 0);
      assert.equal(
        await prisma.jobRun.count({ where: { job: RELIABILITY_JOB } }),
        countBefore,
      );
      await prisma.prediction.update({
        where: { id: belowFloor.id },
        data: { status: "PUBLISHED" },
      });
      assert.deepEqual(
        (await curate(now)).selectedIds,
        [],
        "rows exist but none meet the tier floor",
      );
      assert.equal(cacheReads, 0);
      assert.equal(
        await prisma.jobRun.count({ where: { job: RELIABILITY_JOB } }),
        countBefore,
      );
      await prisma.prediction.updateMany({
        where: { id: { in: ids } },
        data: { status: "PUBLISHED" },
      });
      await reset();
    }
    assert.equal(networkCalls, 0, "no bookmaker/provider network requests");
    console.log(
      "Current-mode VIP/PREMIUM PostgreSQL curation: baseline parity, selected/rejected universe, empty pools, immutable retries, off switch, observer outage, zero provider calls PASS",
    );
  } finally {
    globalThis.fetch = originalFetch;
    (prisma.fixtureOddsCache as any).findMany = originalCacheRead;
    for (const key of [
      "PAID_SELECTION_MODE",
      "RELIABILITY_DIAGNOSTICS",
      "RELIABILITY_SHADOW",
    ]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await prisma.jobRun.deleteMany({ where: { id: { in: logIds } } });
    await prisma.fixtureOddsCache.deleteMany({
      where: { matchKey: { in: quoteKeys } },
    });
    await prisma.prediction.deleteMany({ where: { authorId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
