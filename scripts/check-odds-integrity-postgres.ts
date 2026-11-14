const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { loadOperations } from "../src/lib/operationsData";
import { selectQueuedCandidates } from "../src/lib/generation/queue";
import { matchKey } from "../src/lib/slug";
async function main() {
  if (
    process.env.BETGENIUS_DISPOSABLE_PG !== "yes" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:5432/betgenius_paid_ci")
  )
    throw new Error("Disposable database required");
  const prefix = `integrity-${Date.now()}`;
  const author = await prisma.user.create({
    data: { email: `${prefix}@example.invalid` },
  });
  const now = new Date(),
    kickoff = new Date(+now + 86400000),
    leagueApiId = 1910000000 + Math.floor(Math.random() * 100000);
  const keys: string[] = [];
  let serial = 0;
  async function create(extra: Record<string, unknown> = {}) {
    serial++;
    return prisma.prediction.create({
      data: {
        authorId: author.id,
        category: "FEATURED",
        categories: { create: [{ category: "FEATURED" }] },
        market: "Match Winner",
        pick: "Home",
        marketType: "MATCH_WINNER",
        selection: { value: "HOME" },
        confidence: 80,
        reasoning: "Synthetic integrity fixture",
        status: "PUBLISHED",
        publishedAt: now,
        kickoff,
        homeTeam: "Synthetic Home",
        awayTeam: "Synthetic Away",
        homeTeamApiId: leagueApiId + serial,
        awayTeamApiId: leagueApiId + 100,
        leagueApiId,
        fixtureApiId: leagueApiId + 200 + serial,
        ...extra,
      } as any,
    });
  }
  try {
    const expected = new Map<string, string | null>();
    for (const tier of ["VIP", "PREMIUM"]) {
      for (const legacy of [false, true]) {
        const p = await create({
          category: tier,
          categories: { create: [{ category: tier }] },
          provenance: `${tier}_GENERATED`,
          publishedAt: legacy ? new Date("2026-11-12T12:00:00Z") : now,
        });
        expected.set(
          p.id,
          legacy ? "PAID_PRICE_EVIDENCE_UNAVAILABLE" : "MISSING_PAID_EVIDENCE",
        );
      }
      const p = await create({
        category: tier,
        categories: { create: [{ category: tier }] },
        provenance: `${tier}_GENERATED`,
        marketConfirmation: {
          publicationQuoteEvidence: {
            evidenceKind: "PUBLICATION_INDICATIVE",
            entryPrice: 1.91,
            entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE",
            entryQuoteSelection: { market: "Match Winner", value: "Home" },
            entryBookmakers: 1,
            entryQuoteSources: [{ bookmaker: "Synthetic source", odd: 1.91 }],
            quoteFetchedAt: new Date(+now - 60000).toISOString(),
            confirmedAt: now.toISOString(),
          },
        },
      });
      expected.set(p.id, null);
    }
    const oddsRows = [];
    for (const [marketType, lastError, minutes, code] of [
      ["MATCH_WINNER", null, 180, "ODDS_REFRESH_DUE"],
      [
        "MATCH_WINNER",
        "No bookmaker prices quoted for this fixture yet",
        0,
        "ODDS_COVERAGE_UNAVAILABLE",
      ],
      ["MATCH_WINNER", "provider timeout", 0, "ODDS_PROVIDER_UNAVAILABLE"],
      ["TEAM_TOTAL", null, 0, "ODDS_MARKET_UNSUPPORTED"],
      ["MATCH_WINNER", null, 0, "ODDS_PROVIDER_TIMESTAMP_AGING"],
    ] as const) {
      const p = await create({ marketType });
      const key = matchKey(p)!;
      keys.push(key);
      oddsRows.push({ p, code });
      await prisma.fixtureOddsCache.create({
        data: {
          matchKey: key,
          fetchedAt: new Date(+now - minutes * 60000),
          lastError,
          oddsJson: {
            update: new Date(+now - 36000000).toISOString(),
            markets: [{ market: "Match Winner" }],
          },
        },
      });
    }
    const alreadyGenerated = oddsRows[0].p;
    const key = matchKey(alreadyGenerated)!;
    const attempt = await prisma.generationAttempt.create({
      data: {
        matchKey: key,
        homeTeam: "Synthetic Home",
        awayTeam: "Synthetic Away",
        kickoff,
        fixtureApiId: alreadyGenerated.fixtureApiId,
        leagueApiId,
        leagueName: "Synthetic",
        predictionIds: [],
        status: "FAILED",
        nextAttemptAt: now,
      },
    });
    const beforePredictions = await prisma.prediction.count({
      where: { authorId: author.id },
    });
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(
        await selectQueuedCandidates({ limit: 1, now, matchKeys: [key] }),
        [],
      );
      const saved = await prisma.generationAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      assert.equal(saved.status, "SUCCEEDED");
      assert.deepEqual(saved.predictionIds, [alreadyGenerated.id]);
    }
    await prisma.generationAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", nextAttemptAt: now, predictionIds: [] },
    });
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 3 }, () =>
          selectQueuedCandidates({ limit: 1, now, matchKeys: [key] }),
        ),
      ),
      [[], [], []],
    );
    assert.deepEqual(
      (
        await prisma.generationAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
      ).predictionIds,
      [alreadyGenerated.id],
    );
    assert.deepEqual(
      await selectQueuedCandidates({ limit: 1, now, matchKeys: [] }),
      [],
    );
    assert.equal(
      await prisma.prediction.count({ where: { authorId: author.id } }),
      beforePredictions,
    );
    // A legacy NULL array is distinct from PostgreSQL's empty array; Prisma reads both as [].
    await prisma.$executeRaw`UPDATE "GenerationAttempt" SET "predictionIds"=NULL WHERE id=${attempt.id}`;
    const absentKey = `${leagueApiId + 1000}-${leagueApiId + 1001}-${kickoff.toISOString().slice(0, 10)}`;
    await prisma.generationAttempt.create({
      data: {
        matchKey: absentKey,
        homeTeam: "No Output",
        awayTeam: "No Output",
        kickoff,
        predictionIds: [],
        status: "SUCCEEDED",
      },
    });
    const before = await prisma.prediction.findMany({
      where: { authorId: author.id },
      orderBy: { id: "asc" },
    });
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const mode = await tx.$queryRaw<
          Array<{ transaction_read_only: string }>
        >`SHOW transaction_read_only`;
        assert.equal(mode[0]?.transaction_read_only, "on");
        await tx.prediction.updateMany({
          where: { authorId: author.id },
          data: { reasoning: "This write must be rejected" },
        });
      }),
      /read-only transaction/,
    );
    const result = await loadOperations({ days: 7, competition: leagueApiId });
    for (const [id, code] of expected) {
      const issues = result.findings.filter(
        (f) =>
          f.predictionId === id &&
          ["MISSING_PAID_EVIDENCE", "PAID_PRICE_EVIDENCE_UNAVAILABLE"].includes(
            f.code,
          ),
      );
      assert.deepEqual(
        issues.map((f) => f.code),
        code ? [code] : [],
      );
      if (code)
        assert.equal(
          issues[0].severity,
          code === "MISSING_PAID_EVIDENCE" ? "CRITICAL" : "INFO",
        );
    }
    for (const { p, code } of oddsRows)
      assert.ok(
        result.findings.some((f) => f.predictionId === p.id && f.code === code),
        code,
      );
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === "GENERATION_OUTPUT_LINKS_MISSING" && f.severity === "INFO",
      ),
    );
    assert.ok(
      result.findings.some(
        (f) =>
          f.code === "SUCCESS_WITHOUT_PREDICTION_IDS" &&
          f.severity === "WARNING",
      ),
    );
    assert.deepEqual(
      await prisma.prediction.findMany({
        where: { authorId: author.id },
        orderBy: { id: "asc" },
      }),
      before,
    );
    assert.deepEqual(
      (
        await prisma.generationAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
      ).predictionIds,
      [],
    );
    console.log(
      "Odds integrity PostgreSQL: VIP/PREMIUM legacy/current/valid evidence, cache taxonomy, real generation retries/NULL links, no publication mutation PASS",
    );
  } finally {
    await prisma.generationAttempt.deleteMany({
      where: {
        OR: [{ matchKey: { in: keys } }, { homeTeam: "No Output", kickoff }],
      },
    });
    await prisma.fixtureOddsCache.deleteMany({
      where: { matchKey: { in: keys } },
    });
    await prisma.prediction.deleteMany({ where: { authorId: author.id } });
    await prisma.user.delete({ where: { id: author.id } });
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
