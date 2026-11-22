/**
 * Disposable-Postgres integration test for the Early Engine remediation.
 * Exercises the REAL runEarlyFreePublication and runEarlyFreeGeneration
 * against a real schema. No API-Football call is possible (early generation
 * runs under withNoFootballApiCalls and no key is set) and no model is called
 * (the generation case defers before the worker).
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/check-early-remediation-postgres.ts
 *
 * Never run against a live database: it writes and then deletes its own rows.
 */
import assert from "node:assert/strict";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}
process.env.EARLY_FIXTURE_MODE = "on";
process.env.EARLY_FREE_PUBLICATION_MODE = "on";
process.env.API_FOOTBALL_KEY = "";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { buildStoredContext } = await import("../src/lib/ai/context");
  const { EARLY_FREE_GENERATION_INTENT } = await import("../src/lib/ai/generationRisk");
  const { runEarlyFreePublication } = await import("../src/lib/generation/earlyPublication");
  const { runEarlyFreeGeneration } = await import("../src/lib/generation/earlyGeneration");
  const { knownRecentKickoffs } = await import("../src/lib/ai/generationContext");
  const { matchKey } = await import("../src/lib/slug");
  type MatchDigest = import("../src/lib/ai/digest").MatchDigest;

  const H = 3_600_000;
  const now = new Date();
  const at = (h: number) => new Date(now.getTime() + h * H);
  const ids = { clean: 991_000_001, superseded: 991_000_002, selective: 991_000_003, published: 991_000_004, midweek: 991_000_005 };
  const created: { predictions: string[]; jobs: string[]; users: string[] } = { predictions: [], jobs: [], users: [] };

  const cleanup = async () => {
    const fx = Object.values(ids);
    await prisma.predictionRevision.deleteMany({ where: { predictionId: { in: created.predictions } } });
    await prisma.predictionReassessment.deleteMany({ where: { predictionId: { in: created.predictions } } });
    await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: created.predictions } } });
    await prisma.prediction.deleteMany({ where: { id: { in: created.predictions } } });
    await prisma.aIJob.deleteMany({ where: { id: { in: created.jobs } } });
    await prisma.generationAttempt.deleteMany({ where: { fixtureApiId: { in: fx } } });
    await prisma.fixtureOddsCache.deleteMany({ where: { matchKey: { startsWith: "99" } } });
    await prisma.upcomingFixture.deleteMany({ where: { fixtureApiId: { in: fx } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  };

  try {
    const admin = await prisma.user.create({ data: { email: `early-remediation-${Date.now()}@example.invalid`, role: "ADMIN" } });
    created.users.push(admin.id);

    const last5 = (days: number[]) => days.map((d, i) => ({ date: at(-24 * d).toISOString(), opponent: "Opp " + i, venue: i % 2 ? "away" : "home", result: "W", goalsFor: 2, goalsAgainst: 1 }));
    const team = (apiId: number, name: string) => ({
      apiId, name, rank: null, points: null, overall: { played: 12, win: 7, draw: 3, loss: 2, goalsFor: 20, goalsAgainst: 10 },
      home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null, form: "WWDWW",
      streak: null, biggest: null, formations: [], cards: null, penalties: null, last5: last5([4, 8, 11, 15]),
      availability: [], availabilityAsOf: null, keyPlayers: [],
    });

    async function earlyDraft(fixtureApiId: number, home: number, away: number, kickoff: Date) {
      await prisma.upcomingFixture.create({ data: {
        fixtureApiId, leagueApiId: 39, leagueName: "Premier League", homeTeamApiId: home, awayTeamApiId: away,
        homeTeam: "Home " + home, awayTeam: "Away " + away, kickoff, status: "NS", lastSeenAt: now, earlyQueuedAt: now,
      } });
      const digest = {
        fixture: { home: "Home " + home, away: "Away " + away, league: "Premier League", kickoff: kickoff.toISOString(), competitionType: "LEAGUE", round: null },
        teams: { home: team(home, "Home " + home), away: team(away, "Away " + away) }, h2h: null, standings: null,
        coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
      } as unknown as MatchDigest;
      const job = await prisma.aIJob.create({ data: {
        userId: admin.id, model: "test", rawOutput: "{}", contextComplete: true,
        prompt: JSON.stringify({ intent: EARLY_FREE_GENERATION_INTENT, fixtureApiId, categories: ["FEATURED"] }),
        context: buildStoredContext(digest) as object,
      } });
      created.jobs.push(job.id);
      const p = await prisma.prediction.create({ data: {
        authorId: admin.id, category: "FEATURED", status: "PENDING_REVIEW", fixtureApiId, leagueApiId: 39, leagueName: "Premier League",
        homeTeam: "Home " + home, awayTeam: "Away " + away, homeTeamApiId: home, awayTeamApiId: away, kickoff,
        marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false, market: "Both Teams Score", pick: "Yes",
        confidence: 74, reasoning: "Integration test", contextComplete: true, aiJobId: job.id,
        categories: { create: [{ category: "FEATURED", manual: false }] },
      } });
      created.predictions.push(p.id);
      const key = matchKey({ homeTeamApiId: home, awayTeamApiId: away, kickoff })!;
      await prisma.fixtureOddsCache.create({ data: {
        matchKey: key, fixtureApiId, bookmakerCount: 6, fetchedAt: new Date(now.getTime() - 20 * 60_000),
        oddsJson: { bookmakerCount: 6, update: new Date(now.getTime() - 60 * 60_000).toISOString(), markets: [
          { market: "Both Teams Score", selections: [
            { value: "Yes", best: 1.9, median: 1.85, bookmakers: 6, bestBookmaker: "Book A" },
            { value: "No", best: 2.0, median: 1.95, bookmakers: 6, bestBookmaker: "Book B" },
          ] },
        ] },
      } });
      return p.id;
    }

    // Keys starting "99…" so cleanup can find them; team ids chosen accordingly.
    const cleanId = await earlyDraft(ids.clean, 99101, 99102, at(110));
    const supersededId = await earlyDraft(ids.superseded, 99103, 99104, at(112));
    // Team 99104 played two days ago — after its latest saved match (4 days ago).
    await prisma.upcomingFixture.create({ data: {
      fixtureApiId: ids.midweek, leagueApiId: 39, leagueName: "Premier League", homeTeamApiId: 99199, awayTeamApiId: 99104,
      homeTeam: "Other", awayTeam: "Away 99104", kickoff: at(-48), status: "NS", lastSeenAt: at(-72),
    } });
    // An already-published row that must not change.
    const pub = await prisma.prediction.create({ data: {
      authorId: admin.id, category: "FEATURED", status: "PUBLISHED", fixtureApiId: ids.published, homeTeam: "P", awayTeam: "Q",
      homeTeamApiId: 99105, awayTeamApiId: 99106, kickoff: at(100), marketType: "BTTS", selection: { value: "YES" },
      manualSettlementOnly: false, market: "Both Teams Score", pick: "Yes", confidence: 81, reasoning: "Published before",
      publishedAt: at(-5), categories: { create: [{ category: "FEATURED", manual: false }] },
    } });
    created.predictions.push(pub.id);
    const pubBefore = await prisma.prediction.findUniqueOrThrow({ where: { id: pub.id } });

    const known = await knownRecentKickoffs([99103, 99104], at(-24 * 30), now);
    assert.deepEqual(known.map(k => k.teamApiId), [99104], "known kickoffs: only the queried team that actually played");

    const report = await runEarlyFreePublication({ now, actorId: admin.id });
    const after = await prisma.prediction.findMany({ where: { id: { in: [cleanId, supersededId] } }, include: { revisions: true } });
    const clean = after.find(p => p.id === cleanId)!;
    const sup = after.find(p => p.id === supersededId)!;
    assert.equal(clean.status, "PUBLISHED", "control: a fully qualified early pick still auto-publishes (eligibility not tightened beyond supersession)");
    assert.ok(clean.revisions.some(r => r.kind === "EARLY_PUBLICATION_PRICE"), "with its immutable price receipt");
    assert.notEqual(sup.status, "PUBLISHED", "a pick whose evidence misses a match played since is NOT auto-published");
    assert.equal(sup.status, "DRAFT", "5 days out it is held (recoverable), not deleted");
    assert.ok(sup.revisions.some(r => r.kind === "EARLY_HOLD" && r.reason.includes("evidence-superseded")), "hold reason names the cause");
    assert.equal(report.blocked["evidence-superseded"], 1, "reason code counted in the run report (JobRun.detail)");
    assert.ok(report.failures.every(f => f.startsWith("curation:")), "no publication failures: " + report.failures.join("; "));
    const pubAfter = await prisma.prediction.findUniqueOrThrow({ where: { id: pub.id } });
    assert.equal(pubAfter.updatedAt.getTime(), pubBefore.updatedAt.getTime(), "existing published prediction untouched");

    // Head-of-line: a selective-league fixture with no cached table is
    // deferred visibly, attempts not counted, and no model call is made.
    await prisma.upcomingFixture.create({ data: {
      fixtureApiId: ids.selective, leagueApiId: 307, leagueName: "Pro League", homeTeamApiId: 99107, awayTeamApiId: 99108,
      homeTeam: "S1", awayTeam: "S2", kickoff: at(100), status: "NS", lastSeenAt: now, earlyQueuedAt: now,
    } });
    const selKey = matchKey({ homeTeamApiId: 99107, awayTeamApiId: 99108, kickoff: at(100) })!;
    await prisma.generationAttempt.create({ data: {
      matchKey: selKey, fixtureApiId: ids.selective, leagueApiId: 307, leagueName: "Pro League",
      homeTeam: "S1", awayTeam: "S2", kickoff: at(100), status: "PENDING",
    } });
    const otherPending = await prisma.generationAttempt.count({ where: { status: { in: ["PENDING", "FAILED"] }, NOT: { matchKey: selKey } } });
    assert.equal(otherPending, 0, "test precondition: no other queued work (so no model call can happen)");
    const gen = await runEarlyFreeGeneration({ actorId: admin.id, now });
    assert.equal(gen.selected, 0, "nothing sent to the model");
    assert.equal(gen.deferredSelective, 1, "deferral reported");
    const attempt = await prisma.generationAttempt.findUniqueOrThrow({ where: { matchKey: selKey } });
    assert.equal(attempt.status, "FAILED");
    assert.equal(attempt.attempts, 0, "deferral does not consume the 3-attempt abandonment budget");
    assert.ok(attempt.lastError?.startsWith("Early deferred, retry not counted"), "visible reason");
    assert.ok(attempt.nextAttemptAt && Math.abs(attempt.nextAttemptAt.getTime() - (now.getTime() + 6 * H)) < 60_000, "retried in 6h");
    const again = await runEarlyFreeGeneration({ actorId: admin.id, now: new Date(now.getTime() + 30 * 60_000) });
    assert.equal(again.deferredSelective, 0, "not re-selected every run (head-of-line blocking removed)");

    console.log("PASS: supersession gate, unchanged qualified publication, held-not-deleted, published rows untouched, visible uncounted selective deferral");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
