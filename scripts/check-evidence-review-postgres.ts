/**
 * Disposable-Postgres integration test for the historical evidence review.
 * Exercises listEvidenceReview / applyEvidenceReviewAction / historicalEvidenceFor
 * against a real schema, under the provider-call hard stop.
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/check-evidence-review-postgres.ts
 *
 * Never run against a live database: it writes and then deletes its own rows.
 */
import assert from "node:assert/strict";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}
process.env.API_FOOTBALL_KEY = "";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { buildStoredContext, parseStoredContext } = await import("../src/lib/ai/context");
  const { withNoFootballApiCalls } = await import("../src/lib/football/api-football");
  const { listEvidenceReview, applyEvidenceReviewAction, historicalEvidenceFor, EvidenceReviewError } = await import("../src/lib/evidenceReview");
  const { FREE_REASSESSMENT_VISIBLE } = await import("../src/lib/reassessment/visibility");
  type MatchDigest = import("../src/lib/ai/digest").MatchDigest;

  const now = new Date();
  const H = 3_600_000, D = 24 * H;
  const at = (days: number) => new Date(now.getTime() + days * D);
  const made = { users: [] as string[], jobs: [] as string[], preds: [] as string[] };
  const cleanup = async () => {
    await prisma.predictionRevision.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionReassessment.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.prediction.deleteMany({ where: { id: { in: made.preds } } });
    await prisma.aIJob.deleteMany({ where: { id: { in: made.jobs } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  };

  try {
    const admin = await prisma.user.create({ data: { email: `evidence-review-${Date.now()}@example.invalid`, role: "ADMIN" } });
    made.users.push(admin.id);
    const team = (apiId: number, name: string, daysAgo: number[], withStats = true) => ({
      apiId, name, rank: null, points: null,
      overall: withStats ? { played: 12, win: 7, draw: 3, loss: 2, goalsFor: 20, goalsAgainst: 10 } : null,
      home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
      form: withStats ? "WWDWL" : null, streak: null, biggest: null, formations: [], cards: null, penalties: null,
      last5: daysAgo.map((d, i) => ({ date: new Date(now.getTime() - d * D).toISOString(), opponent: "Opp " + i, opponentApiId: 88000 + i, venue: "home", result: "W", goalsFor: 2, goalsAgainst: 1 })),
      availability: [], availabilityAsOf: null, keyPlayers: [],
    });
    const digest = (h: ReturnType<typeof team>, a: ReturnType<typeof team>, kickoff: Date) => ({
      fixture: { home: h.name, away: a.name, league: "League", kickoff: kickoff.toISOString(), competitionType: "LEAGUE", round: null },
      teams: { home: h, away: a }, h2h: null, standings: null,
      coverage: { stats: !!h.overall && !!a.overall, form: h.last5.length > 0 || a.last5.length > 0, availability: false, h2h: false, standings: false },
    }) as unknown as MatchDigest;

    async function seed(opts: { tag: string; status: string; kickoff: Date; categories: string[]; provenance?: string;
      context?: unknown; contextComplete: boolean; withJob?: boolean; publishedAt?: Date | null }) {
      let aiJobId: string | null = null;
      if (opts.withJob !== false) {
        const job = await prisma.aIJob.create({ data: { userId: admin.id, model: "test", prompt: "{}", rawOutput: "{}",
          contextComplete: opts.contextComplete, context: opts.context as object ?? undefined, createdAt: new Date(now.getTime() - 2 * H) } });
        made.jobs.push(job.id); aiJobId = job.id;
      }
      const p = await prisma.prediction.create({ data: {
        authorId: admin.id, category: opts.categories[0], status: opts.status, homeTeam: opts.tag + " Home", awayTeam: opts.tag + " Away",
        homeTeamApiId: 77001, awayTeamApiId: 77002, kickoff: opts.kickoff, leagueApiId: 39, leagueName: "Premier League",
        marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false, market: "Both Teams Score", pick: "Yes",
        confidence: 74, reasoning: opts.tag + " original reasoning, kept verbatim.", matchPreview: opts.tag + " preview",
        contextComplete: opts.contextComplete, aiJobId, provenance: opts.provenance ?? "STANDARD_CURATED",
        publishedAt: opts.publishedAt === undefined ? (opts.status === "PUBLISHED" ? new Date(now.getTime() - H) : null) : opts.publishedAt,
        categories: { create: opts.categories.map((c) => ({ category: c, manual: false })) },
      } });
      made.preds.push(p.id);
      return p.id;
    }
    const good = (k: Date) => buildStoredContext(digest(team(77001, "A", [4, 8]), team(77002, "B", [3, 7]), k));
    const ids = {
      // Published VIP pick before kickoff; real evidence but the historical early flag -> freshness uncertain.
      paidUpcoming: await seed({ tag: "PaidUpcoming", status: "PUBLISHED", kickoff: at(2), categories: ["VIP"], provenance: "VIP_GENERATED", context: good(at(2)), contextComplete: false }),
      // Settled published free pick with no sporting evidence -> insufficient; retain only.
      settledInsufficient: await seed({ tag: "Settled", status: "PUBLISHED", kickoff: at(-3), categories: ["FEATURED"], context: buildStoredContext(digest(team(77001, "A", [], false), team(77002, "B", [], false), at(-3))), contextComplete: false }),
      pending: await seed({ tag: "Pending", status: "PENDING_REVIEW", kickoff: at(3), categories: ["FEATURED"], context: good(at(3)), contextComplete: false }),
      draftNoSnapshot: await seed({ tag: "Draft", status: "DRAFT", kickoff: at(5), categories: ["FEATURED"], context: undefined, contextComplete: false }),
      available: await seed({ tag: "Fine", status: "PUBLISHED", kickoff: at(1), categories: ["FEATURED"], context: good(at(1)), contextComplete: true }),
      manual: await seed({ tag: "Manual", status: "PUBLISHED", kickoff: at(1), categories: ["FEATURED"], withJob: false, contextComplete: true }),
    };
    const snapshotAll = () => prisma.prediction.findMany({ where: { id: { in: made.preds } }, include: { categories: { orderBy: { category: "asc" } } }, orderBy: { id: "asc" } });
    const before = await snapshotAll();
    const usageBefore = await prisma.apiUsage.count();

    // ---- list: default view shows flagged generated rows only
    const list = await withNoFootballApiCalls(() => listEvidenceReview({}, now));
    const byId = new Map(list.items.map((i) => [i.id, i]));
    assert.equal(byId.get(ids.paidUpcoming)?.classification, "FRESHNESS_UNCERTAIN", "real evidence + old flag: freshness uncertain (not 'no live data')");
    assert.equal(byId.get(ids.settledInsufficient)?.classification, "EVIDENCE_INSUFFICIENT");
    assert.equal(byId.get(ids.pending)?.classification, "FRESHNESS_UNCERTAIN");
    assert.equal(byId.get(ids.draftNoSnapshot)?.classification, "SNAPSHOT_UNAVAILABLE");
    assert.ok(!byId.has(ids.available), "evidence-available rows are not in the default flagged list");
    assert.ok(!byId.has(ids.manual), "admin-authored rows are never flagged");
    assert.equal(byId.get(ids.paidUpcoming)?.paid, true);
    assert.deepEqual(byId.get(ids.paidUpcoming)?.actions, { retain: true, openPrivateReview: true, rewriteDraft: false, reviewPage: false });
    assert.deepEqual(byId.get(ids.settledInsufficient)?.actions, { retain: true, openPrivateReview: false, rewriteDraft: false, reviewPage: false }, "settled picks: retain only");
    assert.equal(byId.get(ids.pending)?.actions.rewriteDraft, true, "pending review: existing draft rewrite");
    assert.equal(byId.get(ids.paidUpcoming)?.reasoning, "PaidUpcoming original reasoning, kept verbatim.", "original reasoning shown");
    const paidOnly = await listEvidenceReview({ paid: "paid" }, now);
    assert.deepEqual(paidOnly.items.map((i) => i.id), [ids.paidUpcoming], "tier filter");
    const avail = await listEvidenceReview({ classes: ["EVIDENCE_AVAILABLE"] }, now);
    assert.ok(avail.items.some((i) => i.id === ids.available), "class filter reaches evidence-available rows");

    // ---- actions
    await withNoFootballApiCalls(() => applyEvidenceReviewAction({ predictionId: ids.settledInsufficient, action: "RETAIN", note: "Checked form claims against results; retain." }));
    await assert.rejects(() => applyEvidenceReviewAction({ predictionId: ids.settledInsufficient, action: "OPEN_PRIVATE_REVIEW", note: "Should be refused after kickoff." }),
      (e: unknown) => e instanceof EvidenceReviewError && e.code === "KICKOFF_PASSED");
    await assert.rejects(() => applyEvidenceReviewAction({ predictionId: ids.pending, action: "OPEN_PRIVATE_REVIEW", note: "Not published, refuse." }),
      (e: unknown) => e instanceof EvidenceReviewError && e.code === "NOT_PUBLISHED");
    await assert.rejects(() => applyEvidenceReviewAction({ predictionId: ids.manual, action: "RETAIN", note: "Manual rows have no flag." }),
      (e: unknown) => e instanceof EvidenceReviewError && e.code === "NOT_GENERATED");
    await withNoFootballApiCalls(() => applyEvidenceReviewAction({ predictionId: ids.paidUpcoming, action: "OPEN_PRIVATE_REVIEW", note: "Verify freshness before kickoff." }));
    await assert.rejects(() => applyEvidenceReviewAction({ predictionId: ids.paidUpcoming, action: "OPEN_PRIVATE_REVIEW", note: "Second open is refused." }),
      (e: unknown) => e instanceof EvidenceReviewError && e.code === "REVIEW_ALREADY_OPEN");

    const reass = await prisma.predictionReassessment.findUniqueOrThrow({ where: { predictionId: ids.paidUpcoming } });
    assert.equal(reass.status, "REVIEW_REQUIRED");
    assert.equal(reass.publicHold, false, "private: no public hold");
    const seeded = parseStoredContext(reass.lastEvidence);
    assert.ok(seeded && seeded.coverage.stats && seeded.coverage.form, "credible generation snapshot seeded for the existing rewrite workflow");
    assert.ok(/!digest \|\| !digest\.coverage\.stats \|\| !digest\.coverage\.form/.test(require("node:fs").readFileSync("src/app/api/admin/reassessment/rewrite/route.ts", "utf8")),
      "the rewrite route's credibility gate is the one the seed satisfies");
    const revs = await prisma.predictionRevision.findMany({ where: { predictionId: { in: made.preds } } });
    assert.deepEqual(revs.map((r) => r.kind).sort(), ["EVIDENCE_REVIEW_OPENED", "EVIDENCE_REVIEW_RETAINED"]);
    assert.ok(revs.every((r) => r.publiclyVisible === false), "all review records are private");

    // ---- nothing about any prediction changed
    const after = await snapshotAll();
    assert.deepEqual(after, before, "every prediction row (selection, confidence, reasoning, status, published time, categories, updatedAt) is unchanged");
    const publicRows = await prisma.prediction.findMany({ where: { ...FREE_REASSESSMENT_VISIBLE, status: "PUBLISHED", id: { in: made.preds } }, select: { id: true, pick: true } });
    assert.equal(publicRows.length, 4, "every published pick is still in the public feed query, with its original selection");
    assert.ok(publicRows.every((r) => r.pick === "Yes"));
    const updatesFlag = reass.status === "REVIEW_REQUIRED" && reass.publicHold;
    assert.equal(updatesFlag, false, "the public updates page shows no review flag");
    assert.equal(await prisma.apiUsage.count(), usageBefore, "no API-Football request was counted");

    // ---- review state reflected; detail classification consistent
    const reviewed = await listEvidenceReview({ reviewed: "reviewed" }, now);
    assert.deepEqual(reviewed.items.map((i) => i.id).sort(), [ids.paidUpcoming, ids.settledInsufficient].sort());
    const detail = await withNoFootballApiCalls(() => historicalEvidenceFor(ids.paidUpcoming));
    assert.equal(detail?.classification, "FRESHNESS_UNCERTAIN");
    assert.equal(detail?.review?.kind, "EVIDENCE_REVIEW_OPENED");

    // ---- the production diagnostic, run exactly as documented, on these rows
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("npx", ["tsx", "scripts/diagnose-missing-evidence.ts", "--days=1"], { encoding: "utf8", env: process.env });
    const diag = JSON.parse(out.slice(out.indexOf("{")));
    const hc = diag.historicalClassification;
    assert.deepEqual(hc.byClass, { FRESHNESS_UNCERTAIN: 2, EVIDENCE_INSUFFICIENT: 1, SNAPSHOT_UNAVAILABLE: 1, EVIDENCE_AVAILABLE: 1 }, "diagnostic counts by class");
    assert.deepEqual(hc.byClassTier.FRESHNESS_UNCERTAIN, { paid: 1, free: 1 }, "diagnostic splits paid and free");
    assert.deepEqual(hc.editorialVerification.items.map((i: { id: string }) => i.id).sort(), [ids.pending, ids.draftNoSnapshot].sort(),
      "editorial list: flagged, visible or awaiting a decision, and not yet reviewed (the two reviewed rows drop off)");
    assert.ok(!/Home|Away|original reasoning/.test(out), "diagnostic output carries ids and codes only, no team names or reasoning");

    console.log("PASS: four classes on real rows, admin-only actions, private review records, no public hold, every prediction unchanged, no provider calls");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
