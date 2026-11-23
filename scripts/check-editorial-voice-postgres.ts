/**
 * Disposable-Postgres integration test: editorial standards on the PRIVATE
 * REWRITE paths, run end to end with a stubbed model provider.
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/check-editorial-voice-postgres.ts
 *
 * Paths exercised (real code, real schema):
 *   - pending-review rewrite with a reviewer note (src/lib/ai/rewrite.ts)
 *   - Prediction Updates evidence rewrite (/api/admin/reassessment/rewrite, GENERATE)
 * For each: the prompt actually sent (the note steers privately, the evidence
 * framing is present), a leaky draft is refused with nothing saved, a clean
 * draft is saved, and no published prediction is modified.
 *
 * The only provider is a stubbed Groq endpoint; no network call leaves the process.
 */
import assert from "node:assert/strict";
import Module from "node:module";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}
// One provider, stubbed: the chain skips unconfigured providers.
process.env.ANTHROPIC_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.GROQ_API_KEY = "dummy-test-key-not-real";
process.env.API_FOOTBALL_KEY = "";
process.env.PAID_ROUTE_PRIMARY_PROVIDER = "";

const session: { current: null | { user: { id: string; role: string } } } = { current: null };
const loader = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const realLoad = loader._load;
loader._load = function (req, parent, isMain) {
  const mod = realLoad.call(this, req, parent, isMain) as Record<string, unknown>;
  if (req === "next-auth") return { ...mod, getServerSession: async () => session.current };
  return mod;
};

// Model stub: returns `nextOutput`, records every prompt it is sent.
let nextOutput: unknown = null;
const prompts: Array<{ system: string; user: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.groq.com/")) throw new Error("unexpected network call in test: " + url);
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
  prompts.push({ system: body.messages.find((m) => m.role === "system")?.content ?? "", user: body.messages.find((m) => m.role === "user")?.content ?? "" });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(nextOutput) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }),
    { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main() {
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("../src/lib/prisma");
  const { buildStoredContext } = await import("../src/lib/ai/context");
  const { rewritePrediction, RewriteError } = await import("../src/lib/ai/rewrite");
  const rewriteRoute = await import("../src/app/api/admin/reassessment/rewrite/route");
  type MatchDigest = import("../src/lib/ai/digest").MatchDigest;

  const now = Date.now(), H = 3_600_000, D = 24 * H;
  const iso = (d: number) => new Date(now + d * D).toISOString();
  const made = { users: [] as string[], jobs: [] as string[], preds: [] as string[] };
  const norm = (t: string) => t.replace(/\s+/g, " ");

  const team = (apiId: number, name: string) => ({
    apiId, name, rank: 4, points: 22, overall: { played: 12, win: 7, draw: 2, loss: 3, goalsFor: 21, goalsAgainst: 12 },
    home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null, form: "WWLWD",
    streak: null, biggest: null, formations: [], cards: null, penalties: null,
    last5: [{ date: iso(-6), opponent: "Gamma", opponentApiId: 1, venue: "home", result: "W", goalsFor: 2, goalsAgainst: 1 },
      { date: iso(-2), opponent: "Delta", opponentApiId: 2, venue: "away", result: "L", goalsFor: 0, goalsAgainst: 2 }],
    availability: [], availabilityAsOf: null, keyPlayers: [],
  });
  const kickoff = new Date(now + 2 * D);
  const digest = {
    fixture: { home: "Alpha", away: "Beta", league: "Premier League", kickoff: kickoff.toISOString(), competitionType: "LEAGUE", round: "Regular Season - 14" },
    teams: { home: team(81001, "Alpha"), away: team(81002, "Beta") }, h2h: null, standings: null,
    coverage: { stats: true, form: true, availability: false, h2h: false, standings: false },
  } as unknown as MatchDigest;
  const context = buildStoredContext(digest) as object;

  const cleanPreview = "Alpha return home after Saturday's 2-0 defeat at Delta, but their own ground has been a fortress, with seven wins from their last nine league games there.\n\nBeta travel well and have scored in each of their last five away matches, so Alpha's defence should be tested.";
  const cleanReasoning = "Both sides have scored freely in recent weeks: Alpha at home and Beta on the road. Both teams to score fits that pattern, with the main risk an Alpha clean sheet.";
  const output = (preview: string, reasoning: string, keyFactors: string[] = ["Alpha unbeaten at home since August", "Beta score away from home"]) => ({
    matchPreview: preview, keyFactors,
    predictions: [{ marketType: "BTTS", selection: { value: "YES" }, overUnderLine: 2.5, overUnderDirection: "OVER", confidence: 74, reasoning }],
  });

  try {
    const admin = await prisma.user.create({ data: { email: `editorial-${now}@example.invalid`, role: "ADMIN" } });
    made.users.push(admin.id);
    session.current = { user: { id: admin.id, role: "ADMIN" } };
    const seed = async (status: string, tag: string) => {
      const job = await prisma.aIJob.create({ data: { userId: admin.id, model: "test", prompt: "{}", rawOutput: "{}", contextComplete: true, context } });
      made.jobs.push(job.id);
      const p = await prisma.prediction.create({ data: {
        authorId: admin.id, category: "FEATURED", status, homeTeam: "Alpha", awayTeam: "Beta", homeTeamApiId: 81001, awayTeamApiId: 81002,
        kickoff, leagueApiId: 39, leagueName: "Premier League", fixtureApiId: 880000 + made.preds.length, marketType: "BTTS", selection: { value: "YES" },
        manualSettlementOnly: false, market: "Both Teams Score", pick: "Yes", odds: 1.8, confidence: 74,
        reasoning: tag + " original reasoning that stays untouched.", matchPreview: tag + " original preview.",
        contextComplete: true, aiJobId: job.id, provenance: "STANDARD_CURATED",
        publishedAt: status === "PUBLISHED" ? new Date(now - H) : null,
        categories: { create: [{ category: "FEATURED", manual: false }] },
      } });
      made.preds.push(p.id);
      return p.id;
    };
    // An unrelated published pick that must never change.
    const bystander = await seed("PUBLISHED", "Bystander");
    const publishedBefore = await prisma.prediction.findMany({ where: { status: "PUBLISHED" }, orderBy: { id: "asc" } });

    // ===================================================================== pending-review rewrite with a reviewer note
    const pending = await seed("PENDING_REVIEW", "Pending");
    const note = "Too confident given Beta's away record; lean on Alpha's defensive record instead.";
    const before = await prisma.prediction.findUniqueOrThrow({ where: { id: pending } });

    nextOutput = output("As the reviewer noted, Alpha have been strong at home.\n\nBeta score away from home.", cleanReasoning);
    prompts.length = 0;
    await assert.rejects(() => rewritePrediction({ predictionId: pending, reviewerNote: note, requestedById: admin.id }),
      (e: unknown) => e instanceof RewriteError && e.status === 422 && /reviewer/i.test(e.message), "a narrated reviewer note is refused");
    assert.equal(prompts.length, 1, "exactly one model request");
    const sent = norm(prompts[0].user);
    assert.ok(sent.includes("PRIVATE EDITORIAL DIRECTION") && sent.includes(`"${note}"`), "the note reaches the model as private direction");
    assert.ok(/Act on it silently/.test(sent) && !/directly and visibly/.test(sent), "...to steer, not to be narrated");
    assert.ok(norm(prompts[0].system).includes("EDITORIAL STANDARDS"), "rewrites use the shared editorial standards");
    const afterReject = await prisma.prediction.findUniqueOrThrow({ where: { id: pending } });
    assert.deepEqual(afterReject, before, "refused rewrite: the draft, its history and its job are untouched");

    nextOutput = output(cleanPreview, "Based on the supplied data, both teams to score is the call.");
    await assert.rejects(() => rewritePrediction({ predictionId: pending, reviewerNote: note, requestedById: admin.id }),
      (e: unknown) => e instanceof RewriteError && e.status === 422, "evidence-report language in the reasoning is refused");
    nextOutput = output(cleanPreview, cleanReasoning, ["Data feed shows Alpha strong at home"]);
    await assert.rejects(() => rewritePrediction({ predictionId: pending, reviewerNote: note, requestedById: admin.id }),
      (e: unknown) => e instanceof RewriteError && e.status === 422, "key factors are gated too");
    assert.deepEqual(await prisma.prediction.findUniqueOrThrow({ where: { id: pending } }), before, "still untouched");

    nextOutput = output(cleanPreview, cleanReasoning);
    const ok = await rewritePrediction({ predictionId: pending, reviewerNote: note, requestedById: admin.id });
    assert.equal(ok.prediction.matchPreview, cleanPreview, "a clean rewrite is saved");
    assert.equal(ok.prediction.status, "PENDING_REVIEW", "and stays pending review");
    made.jobs.push(ok.job.id);

    // ===================================================================== Prediction Updates evidence rewrite
    const published = await seed("PUBLISHED", "Published");
    await prisma.predictionReassessment.create({ data: { predictionId: published, status: "REVIEW_REQUIRED", publicHold: false, lastEvidence: context,
      lastEvidenceAt: new Date(), lastChangeHash: "hash-ed", summary: "New result" } });
    await prisma.predictionRevision.create({ data: { predictionId: published, kind: "REVIEW_REQUIRED", publiclyVisible: false, reason: "monitoring", beforeJson: {},
      evidenceJson: [{ code: "new-result-home-x", severity: "MODERATE", source: "form", message: "new result" }] } });
    const auditNote = "Explanation updated after new evidence: A new match result is available. Selection, confidence and odds unchanged.";
    const call = async () => {
      const res = await rewriteRoute.POST(new NextRequest("http://localhost:3000/api/admin/reassessment/rewrite", { method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ predictionId: published, action: "GENERATE", note: auditNote }) }));
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    const pubBefore = await prisma.prediction.findUniqueOrThrow({ where: { id: published } });

    nextOutput = output(cleanPreview, "Selection, confidence and odds unchanged: both teams to score still fits.");
    prompts.length = 0;
    const leaky = await call();
    assert.deepEqual(leaky, { status: 409, body: { error: "REWRITE_PROSE_REJECTED" } }, "echoing the audit note is refused");
    const evSent = norm(prompts[0].user);
    assert.ok(evSent.includes("CURRENT-EVIDENCE REWRITE"), "evidence rewrite framing sent");
    assert.ok(evSent.includes("PRIVATE EDITORIAL DIRECTION") && evSent.includes(auditNote), "the admin's note is private direction");
    assert.ok(!/ORIGINAL published pick/.test(evSent), "no internal instruction smuggled into the note");
    assert.equal(await prisma.predictionRevision.count({ where: { predictionId: published, kind: "ADMIN_REWRITE_DRAFT" } }), 0, "nothing saved");

    nextOutput = output("This rewrite reflects new evidence: Alpha lost at Delta.\n\nBeta score away.", cleanReasoning);
    assert.equal((await call()).body.error, "REWRITE_PROSE_REJECTED", "narrating the update is refused");

    nextOutput = output(cleanPreview, cleanReasoning);
    const good = await call();
    assert.equal(good.status, 200, JSON.stringify(good.body));
    const draft = await prisma.predictionRevision.findFirstOrThrow({ where: { predictionId: published, kind: "ADMIN_REWRITE_DRAFT" } });
    assert.equal((draft.afterJson as { matchPreview: string }).matchPreview, cleanPreview, "clean draft saved privately");
    assert.equal(draft.publiclyVisible, false);
    assert.deepEqual(await prisma.prediction.findUniqueOrThrow({ where: { id: published } }), pubBefore, "a draft never changes the published pick");

    // ===================================================================== nothing published changed automatically
    const publishedAfter = await prisma.prediction.findMany({ where: { status: "PUBLISHED", id: { not: published } }, orderBy: { id: "asc" } });
    assert.deepEqual(publishedAfter, publishedBefore.filter((p) => p.id !== published), "every other published prediction is byte-for-byte unchanged");
    assert.ok(publishedAfter.some((p) => p.id === bystander));

    console.log("PASS: private rewrites — note steers privately (never narrated), evidence-rewrite framing, leaky drafts refused with nothing saved (preview, reasoning, key factors), clean drafts saved, published predictions untouched");
  } finally {
    globalThis.fetch = realFetch;
    await prisma.predictionRevision.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionReassessment.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: made.preds } } });
    await prisma.prediction.deleteMany({ where: { id: { in: made.preds } } });
    await prisma.aIJob.deleteMany({ where: { OR: [{ id: { in: made.jobs } }, { userId: { in: made.users } }] } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
