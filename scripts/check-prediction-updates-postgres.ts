/**
 * Disposable-Postgres integration test for the admin Prediction Updates
 * workspace (issue #232). Calls the real route handlers (with a stubbed
 * admin session) against a real schema, under the provider-call hard stop.
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/check-prediction-updates-postgres.ts
 *
 * Never run against a live database: it writes and then deletes its own rows.
 */
import assert from "node:assert/strict";
import Module from "node:module";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}
process.env.API_FOOTBALL_KEY = "";
process.env.PREDICTION_REASSESSMENT_MODE = "shadow";

// Stub the session lookup only; everything else (routes, guards, Prisma) is real.
const session: { current: null | { user: { id: string; role: string } } } = { current: null };
const loader = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const realLoad = loader._load;
loader._load = function (req, parent, isMain) {
  const mod = realLoad.call(this, req, parent, isMain) as Record<string, unknown>;
  if (req === "next-auth") return { ...mod, getServerSession: async () => session.current };
  return mod;
};

async function main() {
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("../src/lib/prisma");
  const { buildStoredContext } = await import("../src/lib/ai/context");
  const { withNoFootballApiCalls } = await import("../src/lib/football/api-football");
  const { listCasePage, listReviewedPage, updatesCounts, compareKeys, priorityKey } = await import("../src/lib/predictionUpdates");
  const { runPublishedReassessment, REASSESSMENT_CORE_MIN_REMAINING } = await import("../src/lib/reassessment/worker");
  const { DAILY_LIMIT, RESERVE } = await import("../src/lib/football/usage");
  const updatesRoute = await import("../src/app/api/admin/prediction-updates/route");
  const rewriteRoute = await import("../src/app/api/admin/reassessment/rewrite/route");
  const resolveRoute = await import("../src/app/api/admin/reassessment/resolve/route");
  type MatchDigest = import("../src/lib/ai/digest").MatchDigest;

  const now = new Date();
  const H = 3_600_000, D = 24 * H;
  const at = (days: number) => new Date(now.getTime() + days * D);
  const made = { users: [] as string[], jobs: [] as string[], preds: [] as string[] };
  const usageDay = now.toISOString().slice(0, 10);
  const usagePath = "/__prediction-updates-test";
  const cleanup = async () => {
    await prisma.apiUsage.deleteMany({ where: { day: usageDay, path: usagePath } });
    await prisma.predictionRevision.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionReassessment.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.prediction.deleteMany({ where: { id: { in: made.preds } } });
    await prisma.aIJob.deleteMany({ where: { id: { in: made.jobs } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  };
  const base = "http://localhost:3000";
  const req = (path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { host: "localhost:3000", "content-type": "application/json" };
    if (init.origin !== null) headers.origin = init.origin ?? base;
    return new NextRequest(base + path, { method: init.method ?? "GET", headers, body: init.body ? JSON.stringify(init.body) : undefined });
  };
  const call = async (handler: (r: InstanceType<typeof NextRequest>) => Promise<Response>, r: InstanceType<typeof NextRequest>) => {
    const res = await withNoFootballApiCalls(() => handler(r));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  try {
    const admin = await prisma.user.create({ data: { email: `prediction-updates-${Date.now()}@example.invalid`, role: "ADMIN" } });
    const member = await prisma.user.create({ data: { email: `prediction-updates-member-${Date.now()}@example.invalid`, role: "USER" } });
    made.users.push(admin.id, member.id);

    const team = (apiId: number, name: string, dates: string[], form: string) => ({
      apiId, name, rank: 4, points: 20,
      overall: { played: 12, win: 7, draw: 3, loss: 2, goalsFor: 20, goalsAgainst: 10 },
      home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null,
      form, streak: null, biggest: null, formations: [], cards: null, penalties: null,
      last5: dates.map((d, i) => ({ date: d, opponent: "Opp " + i, opponentApiId: 88000 + i, venue: "home", result: "W", goalsFor: 2, goalsAgainst: 1 })),
      availability: [], availabilityAsOf: null, keyPlayers: [],
    });
    const iso = (days: number) => new Date(now.getTime() + days * D).toISOString();
    const digest = (h: ReturnType<typeof team>, a: ReturnType<typeof team>, kickoff: Date) => ({
      fixture: { home: h.name, away: a.name, league: "League", kickoff: kickoff.toISOString(), competitionType: "LEAGUE", round: null },
      teams: { home: h, away: a }, h2h: null, standings: null,
      coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
    }) as unknown as MatchDigest;
    const original = (k: Date) => buildStoredContext(digest(team(77001, "Alpha", [iso(-10), iso(-6)], "WW"), team(77002, "Beta", [iso(-9), iso(-5)], "WW"), k));
    const latest = (k: Date) => buildStoredContext(digest(team(77001, "Alpha", [iso(-6), iso(-1)], "WL"), team(77002, "Beta", [iso(-9), iso(-5)], "WW"), k));

    async function seed(o: { tag: string; status?: string; kickoff: Date; categories: string[]; provenance?: string; withJob?: boolean;
      reassessment?: string | null; signals?: Array<{ code: string; severity: string }>; generatedDaysAgo?: number; confidence?: number }) {
      let aiJobId: string | null = null;
      const createdAt = new Date(now.getTime() - (o.generatedDaysAgo ?? 0.1) * D);
      if (o.withJob !== false) {
        const job = await prisma.aIJob.create({ data: { userId: admin.id, model: "test", prompt: "{}", rawOutput: "{}", contextComplete: true,
          context: original(o.kickoff) as object, createdAt } });
        made.jobs.push(job.id); aiJobId = job.id;
      }
      const status = o.status ?? "PUBLISHED";
      const p = await prisma.prediction.create({ data: {
        authorId: admin.id, category: o.categories[0], status, homeTeam: "Alpha " + o.tag, awayTeam: "Beta", homeTeamApiId: 77001, awayTeamApiId: 77002,
        kickoff: o.kickoff, leagueApiId: 39, leagueName: "Premier League", fixtureApiId: 990000 + made.preds.length,
        marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false, market: "Both Teams Score", pick: "Yes", odds: 1.85,
        confidence: o.confidence ?? 74, reasoning: "Alpha are in excellent form with two straight wins. " + o.tag + " original reasoning.",
        matchPreview: o.tag + " preview", contextComplete: true, aiJobId, provenance: o.provenance ?? "STANDARD_CURATED", createdAt,
        publishedAt: status === "PUBLISHED" ? new Date(now.getTime() - H) : null,
        categories: { create: o.categories.map((c) => ({ category: c, manual: false })) },
      } });
      made.preds.push(p.id);
      if (o.reassessment !== null) {
        await prisma.predictionReassessment.create({ data: { predictionId: p.id, status: o.reassessment ?? "REVIEW_REQUIRED", publicHold: false,
          checkedAt: new Date(now.getTime() - 10 * 60_000), lastEvidence: latest(o.kickoff) as object, lastEvidenceAt: new Date(now.getTime() - 10 * 60_000),
          lastChangeHash: "hash-" + o.tag, summary: "New evidence for " + o.tag } });
        if ((o.reassessment ?? "REVIEW_REQUIRED") === "REVIEW_REQUIRED")
          await prisma.predictionRevision.create({ data: { predictionId: p.id, kind: "REVIEW_REQUIRED", publiclyVisible: false, reason: "monitoring",
            beforeJson: {}, evidenceJson: (o.signals ?? [{ code: "new-result-home", severity: "MODERATE" }]).map((s) => ({ ...s, source: "fixture", message: s.code })) } });
      }
      return p.id;
    }
    const draft = async (id: string, tag: string, o: { confidence?: number; sameSelection?: boolean } = {}) => (await prisma.predictionRevision.create({ data: {
      predictionId: id, kind: "ADMIN_REWRITE_DRAFT", publiclyVisible: false, reason: "test draft", beforeJson: {},
      afterJson: { marketType: "BTTS", selection: { value: "YES" }, confidence: o.confidence ?? 74, reasoning: "Updated explanation for " + tag + " that reflects the new result.",
        matchPreview: "Updated preview " + tag, sameSelection: o.sameSelection ?? true, evidenceHash: "hash-" + tag },
      recordedAt: new Date(Date.now() + 1_000) } })).id;

    const countsBefore = await updatesCounts();
    const ids = {
      vip: await seed({ tag: "Vip", kickoff: at(1), categories: ["VIP"], provenance: "VIP_GENERATED" }),
      // Future kickoff, generated long ago: still in the queue (no generation-date cut-off).
      oldGen: await seed({ tag: "OldGen", kickoff: at(6), categories: ["PREMIUM"], provenance: "PREMIUM_GENERATED", generatedDaysAgo: 45 }),
      free: await seed({ tag: "Free", kickoff: at(2), categories: ["FEATURED"] }),
      critical: await seed({ tag: "Critical", kickoff: at(1.5), categories: ["FEATURED"], signals: [{ code: "confirmed-lineup-key-player-absence", severity: "CRITICAL" }] }),
      manual: await seed({ tag: "Manual", kickoff: at(1), categories: ["FEATURED"], withJob: false }),
      weak: await seed({ tag: "Weak", kickoff: at(3), categories: ["FEATURED"] }),
      started: await seed({ tag: "Started", kickoff: at(-0.1), categories: ["VIP"], provenance: "VIP_GENERATED" }),
      pending: await seed({ tag: "Pending", status: "PENDING_REVIEW", kickoff: at(2), categories: ["FEATURED"] }),
      unknown: await seed({ tag: "Unknown", kickoff: at(2), categories: ["FEATURED"], reassessment: "UNKNOWN" }),
      quiet: await seed({ tag: "Quiet", kickoff: at(2), categories: ["FEATURED"], reassessment: "CURRENT" }),
    };
    const usageBefore = await prisma.apiUsage.findMany({ orderBy: { id: "asc" } });

    // ---------------------------------------------------------------- admin-only + CSRF
    session.current = null;
    assert.equal((await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=new"))).status, 403, "anonymous: forbidden");
    session.current = { user: { id: member.id, role: "USER" } };
    assert.equal((await call(updatesRoute.GET, req("/api/admin/prediction-updates?counts=1"))).status, 403, "member: forbidden");
    assert.equal((await call(rewriteRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.free, action: "APPLY", note: "member attempt here" } }))).status, 403);
    session.current = { user: { id: admin.id, role: "ADMIN" } };
    assert.equal((await call(updatesRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.pending }, origin: "https://evil.example" }))).status, 403, "cross-site POST refused");
    assert.equal((await call(rewriteRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.free, action: "APPLY", note: "cross-site attempt", revisionId: "x" }, origin: "https://evil.example" }))).status, 403);

    // ---------------------------------------------------------------- cards
    const page = await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=new&pageSize=100"));
    assert.equal(page.status, 200);
    type C = { id: string; adminStatus: string; reasons: string[]; paid: boolean; diff: { changed: boolean } | null; possiblyStale: string[]; actions: Record<string, boolean>; decision: { required: boolean } };
    // Only this test's rows: the database may hold other cases.
    const cards = (page.body.cards as C[]).filter((c) => made.preds.includes(c.id));
    const card = (id: string) => cards.find((c) => c.id === id)!;
    assert.ok(!cards.some((c) => c.id === ids.unknown || c.id === ids.quiet), "only open new-evidence cases on the first tab");
    assert.deepEqual(cards.slice(0, 2).map((c) => c.id), [ids.vip, ids.oldGen], "paid upcoming first, soonest first, regardless of generation date");
    assert.equal(cards.at(-1)!.id, ids.started, "started matches last");
    assert.equal(card(ids.started).adminStatus, "Match started (read-only)");
    assert.ok(Object.values(card(ids.started).actions).every((v) => !v), "started: no action at all");
    assert.equal(card(ids.vip).adminStatus, "New evidence");
    assert.deepEqual(card(ids.vip).reasons, ["A new match result is available"]);
    assert.equal(card(ids.vip).diff?.changed, true, "what changed is computed from saved snapshots");
    assert.ok(card(ids.vip).possiblyStale.some((s) => /excellent form/.test(s)), "the form claim is shown as possibly out of date");
    assert.equal(card(ids.critical).adminStatus, "Awaiting your decision");
    assert.equal(card(ids.critical).actions.reviewUpdate, false, "critical evidence: no explanation-only update");
    assert.equal(card(ids.critical).actions.replace, true, "free pick: qualified replacement offered");
    assert.equal(card(ids.vip).actions.replace, false, "paid pick: no replacement here");
    assert.equal(card(ids.manual).actions.reviewUpdate, false, "admin-authored: never re-worded");
    assert.equal(card(ids.pending).actions.editDraft, true, "pending review: revise via the existing editorial route");
    assert.equal(card(ids.pending).actions.approve, false);
    const needs = await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=needs"));
    const needsMine = (needs.body.cards as C[]).filter((c) => made.preds.includes(c.id));
    assert.deepEqual(needsMine.map((c) => c.id), [ids.unknown], "needs-more-evidence tab");
    assert.equal(needsMine[0].adminStatus, "Needs more evidence");
    const paidOnly = await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=new&tier=paid"));
    assert.deepEqual((paidOnly.body.cards as C[]).filter((c) => made.preds.includes(c.id)).map((c) => c.id), [ids.vip, ids.oldGen, ids.started], "tier filter");
    assert.ok((paidOnly.body.cards as C[]).every((c) => c.paid), "tier filter excludes free picks");
    const counts = (await call(updatesRoute.GET, req("/api/admin/prediction-updates?counts=1"))).body as Record<string, number>;
    const delta = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v - (countsBefore as Record<string, number>)[k]]));
    assert.deepEqual(delta, { newEvidence: 8, needingApproval: 7, awaitingDecision: 1, needsMoreEvidence: 1 }, "exact counts");

    // ---------------------------------------------------------------- on-demand comparison: cache-only
    const cmp = await call(updatesRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.pending } }));
    assert.equal(cmp.status, 200, "comparison works with no provider (cache-only, sparse data tolerated)");
    assert.match(String(cmp.body.source), /no provider calls/);

    // ---------------------------------------------------------------- server guards
    const snap = (id: string) => prisma.prediction.findUniqueOrThrow({ where: { id }, include: { categories: { orderBy: { category: "asc" } } } });
    const apply = (predictionId: string, revisionId: string) => call(rewriteRoute.POST, req("/x", { method: "POST",
      body: { predictionId, action: "APPLY", note: "Explanation updated after a new result.", revisionId } }));
    const manualDraft = await draft(ids.manual, "Manual");
    assert.deepEqual((await apply(ids.manual, manualDraft)).body, { error: "ADMIN_AUTHORED_PICK" }, "admin-authored picks are never rewritten");
    const criticalDraft = await draft(ids.critical, "Critical");
    assert.deepEqual((await apply(ids.critical, criticalDraft)).body, { error: "DECISION_REQUIRED" }, "critical evidence cannot be masked by prose");
    const weakDraft = await draft(ids.weak, "Weak", { confidence: 60 });
    assert.deepEqual((await apply(ids.weak, weakDraft)).body, { error: "DECISION_REQUIRED" }, "a draft supporting much lower confidence is a decision");
    const startedDraft = await draft(ids.started, "Started");
    assert.deepEqual((await apply(ids.started, startedDraft)).body, { error: "KICKOFF_PASSED" });
    const gen = await call(rewriteRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.manual, action: "GENERATE", note: "Prepare a draft please." } }));
    assert.deepEqual(gen.body, { error: "ADMIN_AUTHORED_PICK" }, "no model request for an admin-authored pick");
    const genCrit = await call(rewriteRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.critical, action: "GENERATE", note: "Prepare a draft please." } }));
    assert.deepEqual(genCrit.body, { error: "DECISION_REQUIRED" }, "no model request when a decision is required");
    const withdrawStarted = await call(resolveRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.started, action: "WITHDRAW", note: "Too late to withdraw this." } }));
    assert.deepEqual(withdrawStarted.body, { error: "KICKOFF_PASSED" }, "never withdrawn after kickoff");
    for (const id of [ids.manual, ids.critical, ids.weak, ids.started]) {
      const p = await snap(id);
      assert.ok(p.reasoning.endsWith("original reasoning.") && p.status === "PUBLISHED", "refused actions leave the pick untouched");
    }

    // ---------------------------------------------------------------- approve & apply: prose only, private audit
    const vipBefore = await snap(ids.vip);
    const vipDraft = await draft(ids.vip, "Vip");
    // A newer card read shows the draft as ready.
    const ready = ((await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=new&tier=paid"))).body.cards as C[]).find((c) => c.id === ids.vip)!;
    assert.equal(ready.adminStatus, "Draft ready");
    assert.equal(ready.actions.approve, true);
    const ok = await apply(ids.vip, vipDraft);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const vipAfter = await snap(ids.vip);
    assert.equal(vipAfter.reasoning, "Updated explanation for Vip that reflects the new result.");
    assert.equal(vipAfter.matchPreview, "Updated preview Vip");
    for (const k of ["status", "market", "pick", "marketType", "confidence", "odds", "kickoff", "publishedAt", "provenance", "createdAt", "authorId", "aiJobId"] as const)
      assert.deepEqual(vipAfter[k], vipBefore[k], "immutable field preserved: " + k);
    assert.deepEqual(vipAfter.selection, vipBefore.selection);
    assert.deepEqual(vipAfter.categories.map((c) => c.category), vipBefore.categories.map((c) => c.category), "categories preserved");
    const applied = await prisma.predictionRevision.findFirstOrThrow({ where: { predictionId: ids.vip, kind: "ADMIN_REWRITE_APPLIED" } });
    assert.equal(applied.publiclyVisible, false, "audit record is private");
    assert.equal((applied.beforeJson as { reasoning: string }).reasoning, vipBefore.reasoning, "audit keeps the original wording");
    assert.equal((applied.afterJson as { reasoning: string }).reasoning, vipAfter.reasoning, "audit keeps the new wording");
    assert.deepEqual((await apply(ids.vip, vipDraft)).body, { error: "NO_ACTIVE_ADMIN_REVIEW" }, "double-apply refused (concurrency guard)");
    assert.equal((await prisma.predictionReassessment.findUniqueOrThrow({ where: { predictionId: ids.vip } })).publicHold, false, "never a public hold");

    // ---------------------------------------------------------------- keep original
    const keep = await call(resolveRoute.POST, req("/x", { method: "POST", body: { predictionId: ids.free, action: "KEEP", note: "Reviewed new evidence; original analysis retained." } }));
    assert.equal(keep.status, 200, JSON.stringify(keep.body));
    assert.equal((await snap(ids.free)).reasoning.endsWith("original reasoning."), true);
    const reviewed = await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=reviewed"));
    const kinds = (reviewed.body.items as Array<{ predictionId: string; kind: string }>).filter((i) => i.predictionId === ids.vip || i.predictionId === ids.free).map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["ADMIN_REWRITE_APPLIED", "CONFIRMED"], "reviewed tab shows both decisions");
    const after = await call(updatesRoute.GET, req("/api/admin/prediction-updates?tab=new&pageSize=100&tier=all"));
    assert.ok(!(after.body.cards as C[]).some((c) => c.id === ids.vip || c.id === ids.free), "decided cases leave the queue");

    // ---------------------------------------------------------------- >500 open cases: paging reaches everything, in order
    const fill: string[] = [];
    for (let i = 0; i < 540; i++) fill.push(`upd-fill-${String(i).padStart(4, "0")}`);
    await prisma.prediction.createMany({ data: fill.map((id, i) => ({ id, authorId: admin.id, category: "FEATURED", status: "PUBLISHED",
      homeTeam: "Fill", awayTeam: "Fill", kickoff: at(1 + (i % 50) / 10), marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false,
      market: "Both Teams Score", pick: "Yes", confidence: 70, reasoning: "Filler.", contextComplete: true, publishedAt: at(-1),
      provenance: i % 7 === 0 ? "VIP_GENERATED" : "STANDARD_CURATED" })) });
    made.preds.push(...fill);
    await prisma.predictionCategoryLink.createMany({ data: fill.map((predictionId, i) => ({ predictionId, category: i % 7 === 0 ? "VIP" : "FEATURED", manual: false })) });
    await prisma.predictionReassessment.createMany({ data: fill.map((predictionId) => ({ predictionId, status: "REVIEW_REQUIRED" })) });
    // The last paid case to be created must still be reachable.
    const lateVip = await seed({ tag: "LateVip", kickoff: at(9), categories: ["VIP"], provenance: "VIP_GENERATED", generatedDaysAgo: 60 });
    const seen: Array<{ id: string; status: string; kickoff: string | null; paid: boolean }> = [];
    let cursor: string | null = null, pages = 0, total = 0;
    for (;;) {
      const r = await withNoFootballApiCalls(() => listCasePage("new", {}, { cursor, pageSize: 37 }));
      total = r.total; pages++;
      seen.push(...r.cards.map((c) => ({ id: c.id, status: c.status, kickoff: c.kickoff, paid: c.paid })));
      assert.ok(pages < 100);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    assert.equal(new Set(seen.map((s) => s.id)).size, seen.length, "no case repeated across pages");
    assert.equal(seen.length, total, "every case reached by paging");
    assert.ok(total > 540);
    assert.ok(seen.some((s) => s.id === lateVip), "a paid case beyond the first 500 is reachable");
    const keyed = await prisma.prediction.findMany({ where: { id: { in: seen.map((s) => s.id) } }, select: { id: true, status: true, kickoff: true, provenance: true, categories: { select: { category: true } } } });
    const byId = new Map(keyed.map((k) => [k.id, k]));
    const nowCheck = new Date();
    for (let i = 1; i < seen.length; i++)
      assert.ok(compareKeys(priorityKey(byId.get(seen[i - 1].id)!, nowCheck), priorityKey(byId.get(seen[i].id)!, nowCheck)) < 0, "priority order holds across pages");
    const firstFree = seen.findIndex((s) => !s.paid && s.status === "PUBLISHED" && s.kickoff && new Date(s.kickoff) > nowCheck);
    assert.ok(seen.slice(0, firstFree).every((s) => s.paid || s.status !== "PUBLISHED"), "every upcoming paid case comes before any free one");
    const rv = await withNoFootballApiCalls(() => listReviewedPage({ pageSize: 1 }));
    assert.ok(rv.nextCursor, "reviewed tab pages too");

    // ---------------------------------------------------------------- quota: monitoring stands down before reaching protected lanes
    const used = (await prisma.apiUsage.aggregate({ where: { day: usageDay }, _sum: { count: true } }))._sum.count ?? 0;
    const fillTo = DAILY_LIMIT - RESERVE - (REASSESSMENT_CORE_MIN_REMAINING - 1) - used;
    if (fillTo > 0) await prisma.apiUsage.create({ data: { day: usageDay, path: usagePath, count: fillTo } });
    const report = await withNoFootballApiCalls(() => runPublishedReassessment({ now: new Date() }));
    assert.match(report.stoodDown ?? "", /quota headroom too low/, "below 1,000 remaining the worker makes no provider call at all");
    assert.equal(report.checked, 0);
    await prisma.apiUsage.deleteMany({ where: { day: usageDay, path: usagePath } });

    // ---------------------------------------------------------------- privacy and provider calls
    const revs = await prisma.predictionRevision.findMany({ where: { predictionId: { in: made.preds } } });
    assert.ok(revs.every((r) => r.publiclyVisible === false), "every revision is private");
    assert.deepEqual(await prisma.apiUsage.findMany({ orderBy: { id: "asc" } }), usageBefore, "no API-Football request was counted");

    console.log("PASS: admin-only + CSRF, prioritised cards beyond 500, what-changed diff and stale statements, draft → approve (prose only, private before/after audit), keep, decision-required and admin-authored guards, no action after kickoff, quota stand-down, no provider calls");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
