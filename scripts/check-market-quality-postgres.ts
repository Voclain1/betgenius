/**
 * Disposable-Postgres integration test for the PR #235 review fixes:
 *
 *   - cross-job duplicate guard: an early auto-publication of a FEATURED single
 *     for a fixture that ALREADY shows a published FEATURED single (from a
 *     different job) is refused and the row stays in review; a fixture without
 *     one publishes normally; the already published row is never touched;
 *   - admin authority: a bulk PUBLISH of such a duplicate still publishes, and
 *     the response carries a DUPLICATE_FIXTURE warning;
 *   - monitoring: selection decisions and hold counts come from every generated
 *     row (pending review, rejected, archived, published), not only PUBLISHED.
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/check-market-quality-postgres.ts
 */
import assert from "node:assert/strict";
import Module from "node:module";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}
process.env.API_FOOTBALL_KEY = "dummy-test-key-not-real";

const session: { current: null | { user: { id: string; role: string } } } = { current: null };
const loader = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const realLoad = loader._load;
loader._load = function (req, parent, isMain) {
  const mod = realLoad.call(this, req, parent, isMain) as Record<string, unknown>;
  if (req === "next-auth") return { ...mod, getServerSession: async () => session.current };
  return mod;
};
globalThis.fetch = (async (input: string | URL | Request) => {
  throw new Error("unexpected network call in test: " + String(input));
}) as typeof fetch;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { publishEarlyFreePredictionAtomically, publishedFeaturedSingleFor } = await import("../src/lib/predictions");
  const { matchKey } = await import("../src/lib/slug");
  const { loadMarketQualityReport } = await import("../src/lib/marketQualityReport");
  const bulk = await import("../src/app/api/admin/predictions/bulk/route");
  const { refreshOddsCache, ODDS_BUDGET_REFUSED } = await import("../src/lib/enrichment");
  const { utcDay, withPaidPriority } = await import("../src/lib/football/usage");
  const { vipPremiumOddsWarmReason } = await import("../src/lib/vipPremiumOverlay");

  let n = 0;
  const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
  const now = Date.now(), H = 3_600_000, D = 24 * H;
  const made = { users: [] as string[], jobs: [] as string[], preds: [] as string[], keys: [] as string[] };
  const admin = await prisma.user.create({ data: { email: `mq-${now}@example.invalid`, role: "ADMIN" } });
  made.users.push(admin.id);
  session.current = { user: { id: admin.id, role: "ADMIN" } };

  const kickoff = new Date(now + 4 * D);
  const seed = async (o: { status: string; fixtureApiId: number; home: number; marketType?: string; selection?: object; category?: string;
    sq?: object; earlyUnsafe?: boolean; createdAt?: Date }) => {
    const job = await prisma.aIJob.create({ data: { userId: admin.id, model: "test", prompt: JSON.stringify(o.earlyUnsafe ? { earlyPriceUnsafe: true } : {}), rawOutput: "{}", contextComplete: true } });
    made.jobs.push(job.id);
    const p = await prisma.prediction.create({ data: {
      authorId: admin.id, category: (o.category ?? "FEATURED") as never, status: o.status as never, homeTeam: "Alpha", awayTeam: "Beta",
      homeTeamApiId: o.home, awayTeamApiId: o.home + 1, kickoff, leagueApiId: 39, leagueName: "Premier League", fixtureApiId: o.fixtureApiId,
      marketType: (o.marketType ?? "BTTS") as never, selection: o.selection ?? { value: "YES" }, manualSettlementOnly: false,
      market: "Both Teams Score", pick: "Yes", odds: 1.8, confidence: 74, reasoning: "Both sides have scored freely in their saved recent results.",
      matchPreview: "Preview.", contextComplete: true, aiJobId: job.id, provenance: "STANDARD_CURATED",
      analysisJson: { v: 1, keyFactors: [], ...(o.sq ? { selectionQuality: o.sq } : {}) },
      publishedAt: o.status === "PUBLISHED" ? new Date(now - H) : null, ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      categories: { create: [{ category: (o.category ?? "FEATURED") as never, manual: false }] },
    } });
    made.preds.push(p.id);
    return p;
  };
  const oddsFor = async (home: number, fixtureApiId: number) => {
    const key = matchKey({ homeTeamApiId: home, awayTeamApiId: home + 1, kickoff })!;
    const s = (value: string, median: number) => ({ value, median, best: median + 0.05, bookmakers: 9, bestBookmaker: "X" });
    await prisma.fixtureOddsCache.upsert({ where: { matchKey: key }, update: {}, create: { matchKey: key, fixtureApiId, fetchedAt: new Date(now - 10 * 60_000),
      oddsJson: { bookmakerCount: 9, update: new Date(now - 20 * 60_000).toISOString(), markets: [{ market: "Both Teams Score", selections: [s("Yes", 1.8), s("No", 2.0)] }] } } as never });
    made.keys.push(key);
  };

  try {
    // ------------------------------------------------ cross-job duplicate: early lane refuses, keeps the row for review
    const published = await seed({ status: "PUBLISHED", fixtureApiId: 990001, home: 91000 });
    const publishedBefore = JSON.stringify(await prisma.prediction.findUnique({ where: { id: published.id } }));
    const early = await seed({ status: "PENDING_REVIEW", fixtureApiId: 990001, home: 91000, marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" } });
    await oddsFor(91000, 990001);
    ok(await publishedFeaturedSingleFor(prisma, early) === published.id, "a published FEATURED single from ANOTHER job is found for the same fixture");
    const lock = await prisma.prediction.findUniqueOrThrow({ where: { id: early.id } });
    await assert.rejects(publishEarlyFreePredictionAtomically(lock as never, admin.id), /EARLY_PUBLICATION_DUPLICATE_FIXTURE/); n++;
    ok((await prisma.prediction.findUniqueOrThrow({ where: { id: early.id } })).status === "PENDING_REVIEW", "the second pick stays in review (not deleted, not published)");
    ok(JSON.stringify(await prisma.prediction.findUnique({ where: { id: published.id } })) === publishedBefore, "the already published row is untouched");

    // Same team ids and kickoff, different fixture id: still the same match.
    const byTeams = await seed({ status: "PENDING_REVIEW", fixtureApiId: 990009, home: 91000 });
    ok(await publishedFeaturedSingleFor(prisma, byTeams) === published.id, "matched by team ids and kickoff when fixture ids differ");

    // Control: a fixture with no published single publishes normally.
    const clean = await seed({ status: "PENDING_REVIEW", fixtureApiId: 990002, home: 92000 });
    await oddsFor(92000, 990002);
    ok(await publishedFeaturedSingleFor(prisma, clean) === null, "no published single on a fresh fixture");
    const cleanRow = await prisma.prediction.findUniqueOrThrow({ where: { id: clean.id } });
    ok(await publishEarlyFreePredictionAtomically(cleanRow as never, admin.id) === true, "control: a fixture without a published single auto-publishes");
    ok((await prisma.prediction.findUniqueOrThrow({ where: { id: clean.id } })).status === "PUBLISHED", "control row is PUBLISHED");

    // A combo leg / non-FEATURED published row does not count as the fixture's public single.
    const otherCat = await seed({ status: "PUBLISHED", fixtureApiId: 990003, home: 93000, category: "VIP" });
    const afterVip = await seed({ status: "PENDING_REVIEW", fixtureApiId: 990003, home: 93000 });
    ok(await publishedFeaturedSingleFor(prisma, afterVip) === null && !!otherCat, "a VIP row does not block the free FEATURED single");

    // ------------------------------------------------ admin authority: bulk publish of the duplicate succeeds with a warning
    const res = await bulk.POST(new Request("http://localhost/api/admin/predictions/bulk", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [early.id], action: "PUBLISH" }) }));
    const body = await res.json() as { updated: number; failed: unknown[]; warnings: Array<{ id: string; warning: string }> };
    const w = body.warnings.find((x) => x.id === early.id);
    ok(body.updated === 1 && body.failed.length === 0 && /DUPLICATE_FIXTURE/.test(w?.warning ?? ""), "admin bulk publish: published, with a DUPLICATE_FIXTURE warning in the response");
    ok((await prisma.prediction.findUniqueOrThrow({ where: { id: early.id } })).status === "PUBLISHED", "the admin decision is applied");
    ok(JSON.stringify(await prisma.prediction.findUnique({ where: { id: published.id } })) === publishedBefore, "still no change to the earlier published row");

    // ------------------------------------------------ odds budget refusal never puts a fixture into the paid fetch backoff
    {
      const key = "budget-test-" + now;
      const stale = new Date(now - 3 * H);
      await prisma.fixtureOddsCache.create({ data: { matchKey: key, fixtureApiId: 990099, fetchedAt: stale, lastAttemptAt: stale, oddsJson: { bookmakerCount: 7, markets: [] } } as never });
      made.keys.push(key);
      const day = utcDay();
      const before = await prisma.apiUsage.findUnique({ where: { day_path: { day, path: "/budget-test" } } });
      await prisma.apiUsage.upsert({ where: { day_path: { day, path: "/budget-test" } }, create: { day, path: "/budget-test", count: 1_000_000 }, update: { count: 1_000_000 } });
      try {
        const general = await refreshOddsCache({ matchKey: key, fixtureApiId: 990099, kickoff: new Date(now + 20 * H), kind: "candidate" } as never);
        const paid = await withPaidPriority(() => refreshOddsCache({ matchKey: key, fixtureApiId: 990099, kickoff: new Date(now + 20 * H), kind: "candidate" } as never));
        const row = await prisma.fixtureOddsCache.findUniqueOrThrow({ where: { matchKey: key } });
        ok(general.result === "failed" && general.detail === ODDS_BUDGET_REFUSED && paid.detail === ODDS_BUDGET_REFUSED, "a budget refusal is reported as such");
        ok(+row.lastAttemptAt! === +stale && row.lastError === null, "a budget refusal leaves the cache row untouched (no attempt stamp, no error)");
        ok(vipPremiumOddsWarmReason({ kickoff: new Date(now + 20 * H) }, { oddsJson: null, fetchedAt: row.fetchedAt, lastAttemptAt: row.lastAttemptAt }, new Date()) === "DUE",
          "so the paid pass still sees the fixture as due for its own (reserved) odds call");
      } finally {
        if (before) await prisma.apiUsage.update({ where: { day_path: { day, path: "/budget-test" } }, data: { count: before.count } });
        else await prisma.apiUsage.delete({ where: { day_path: { day, path: "/budget-test" } } });
      }
    }

    // ------------------------------------------------ monitor: holds from every generated row, not only PUBLISHED
    const hold = (reason: string) => ({ policyVersion: "t", mode: "shadow", decision: "HOLD", holdReason: reason });
    await seed({ status: "PENDING_REVIEW", fixtureApiId: 990010, home: 94000, sq: hold("NO_VERIFIED_PRICE") });
    await seed({ status: "REJECTED", fixtureApiId: 990011, home: 94100, sq: hold("NO_VERIFIED_PRICE") });
    await seed({ status: "ARCHIVED", fixtureApiId: 990012, home: 94200, sq: hold("INSUFFICIENT_EVIDENCE") });
    await seed({ status: "PUBLISHED", fixtureApiId: 990013, home: 94300, sq: { policyVersion: "t", mode: "shadow", decision: "KEEP", holdReason: null } });
    await seed({ status: "PENDING_REVIEW", fixtureApiId: 990014, home: 94400, sq: hold("NO_VERIFIED_PRICE"), createdAt: new Date(now - 20 * D) });
    const report = await loadMarketQualityReport({ days: 7, now: new Date(now) });
    const sel = report.metrics.selection;
    ok(sel.decisions.HOLD === 3 && sel.decisions.KEEP === 1, `decisions counted across statuses (got ${JSON.stringify(sel.decisions)})`);
    ok(sel.holdStatuses.PENDING_REVIEW === 1 && sel.holdStatuses.REJECTED === 1 && sel.holdStatuses.ARCHIVED === 1 && !sel.holdStatuses.PUBLISHED,
      `holds found in non-public statuses (got ${JSON.stringify(sel.holdStatuses)})`);
    ok(sel.holdReasons.NO_VERIFIED_PRICE === 2 && sel.holdReasons.INSUFFICIENT_EVIDENCE === 1, "hold reasons counted");
    ok(sel.holdPct === 75, `hold rate is a generation rate (3 of 4 recorded), got ${sel.holdPct}`);
    ok(sel.generatedRows >= 9 && sel.recordedRows === 4, "rows outside the window are excluded; rows without a record are counted as generated only");
    ok(report.metrics.publishedSingles >= 0, "publication KPIs reported separately");
  } finally {
    await prisma.predictionRevision.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionReassessment.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.prediction.deleteMany({ where: { id: { in: made.preds } } });
    await prisma.aIJob.deleteMany({ where: { id: { in: made.jobs } } });
    await prisma.fixtureOddsCache.deleteMany({ where: { matchKey: { in: made.keys } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  }
  console.log(`PASS: market quality on Postgres — ${n} assertions (cross-job duplicate guard, admin authority, generation-wide hold monitor, odds budget refusal)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
