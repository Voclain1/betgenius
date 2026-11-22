/**
 * Seeds DISPOSABLE, fictional data for previewing /admin/updates (issue #232).
 * Refuses anything but an explicitly marked local disposable Postgres.
 *
 *   BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npx tsx scripts/seed-prediction-updates-preview.ts [--clean]
 *
 * Admin login for the preview: preview-admin@example.invalid / preview-only-password
 */
import assert from "node:assert/strict";

const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.BETGENIUS_DISPOSABLE_PG !== "yes"
    || !/^(postgresql|postgres):\/\/[^/]+@(?:127\.0\.0\.1|localhost):5432\//.test(dbUrl)) {
  throw new Error("Refusing to write outside an explicitly marked disposable local Postgres");
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const bcrypt = (await import("bcryptjs")).default;
  const { buildStoredContext } = await import("../src/lib/ai/context");
  type MatchDigest = import("../src/lib/ai/digest").MatchDigest;
  const EMAIL = "preview-admin@example.invalid";
  const LEAGUE = "Preview League (disposable)";

  const old = await prisma.prediction.findMany({ where: { leagueName: LEAGUE, author: { email: EMAIL } }, select: { id: true, aiJobId: true } });
  await prisma.prediction.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  await prisma.aIJob.deleteMany({ where: { id: { in: old.map((o) => o.aiJobId).filter((x): x is string => !!x) } } });
  if (process.argv.includes("--clean")) { await prisma.aIJob.deleteMany({ where: { model: "preview", user: { email: EMAIL } } }); await prisma.user.deleteMany({ where: { email: EMAIL } }); console.log("cleaned"); return prisma.$disconnect(); }

  const admin = await prisma.user.upsert({ where: { email: EMAIL }, update: { role: "ADMIN" },
    create: { email: EMAIL, name: "Preview Admin", role: "ADMIN", passwordHash: await bcrypt.hash("preview-only-password", 10), emailVerified: new Date() } });
  const now = Date.now(), H = 3_600_000, D = 24 * H;
  const iso = (d: number) => new Date(now + d * D).toISOString();
  const team = (name: string, apiId: number, res: Array<[number, string, string, number, number]>, form: string, rank: number, played: number, out: string[] = []) => ({
    apiId, name, rank, points: played * 2, overall: { played, win: Math.round(played * 0.55), draw: 2, loss: played - Math.round(played * 0.55) - 2, goalsFor: played * 2, goalsAgainst: played },
    home: null, away: null, goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null, form, streak: null, biggest: null, formations: [], cards: null, penalties: null,
    last5: res.map(([d, opp, r, gf, ga]) => ({ date: iso(d), opponent: opp, opponentApiId: 1, venue: "home", result: r, goalsFor: gf, goalsAgainst: ga, competition: "League" })),
    availability: out.map((player) => ({ player, kind: "injury", reason: "Knock" })), availabilityAsOf: null, keyPlayers: [], coach: { name: name + " coach" },
  });
  const dg = (h: ReturnType<typeof team>, a: ReturnType<typeof team>) => buildStoredContext({
    fixture: { home: h.name, away: a.name, league: "Preview League", kickoff: iso(1), competitionType: "LEAGUE", round: null },
    teams: { home: h, away: a }, h2h: null, standings: null, coverage: { stats: true, form: true, availability: true, h2h: false, standings: false },
  } as unknown as MatchDigest);

  type Seed = { home: string; away: string; kickoffDays: number; cat: string; prov: string; status?: string; reass?: string; signals?: Array<[string, string, string]>;
    reasoning: string; changed?: boolean; draft?: { reasoning: string; confidence?: number }; decided?: [string, string]; noJob?: boolean; confidence?: number; odds?: number; market?: string; pick?: string };
  const seeds: Seed[] = [
    { home: "Northbridge", away: "Eastvale", kickoffDays: 0.4, cat: "VIP", prov: "VIP_GENERATED", changed: true,
      signals: [["new-result-home", "MODERATE", "Northbridge played since this pick was written"]],
      reasoning: "Northbridge are unbeaten in their last two league matches and sit 3rd in the table. Eastvale have scored in each of their last two away games.",
      draft: { reasoning: "Northbridge lost at Harlow on Saturday, ending a two-match winning run, but they still sit 4th and have scored in every home league match this season. Eastvale have scored in each of their last two away games, so both sides finding the net remains the strongest reading of the evidence." } },
    { home: "Kingsport", away: "Marlow Athletic", kickoffDays: 1.2, cat: "PREMIUM", prov: "PREMIUM_GENERATED", changed: true,
      signals: [["new-result-away", "MODERATE", "Marlow Athletic played since this pick was written"], ["new-unavailable-home-9", "MODERATE", "New absence"]],
      reasoning: "Kingsport have their first-choice midfield available. Marlow Athletic are winless in their last two." },
    { home: "Westerly", away: "Rowan Park", kickoffDays: 0.8, cat: "FEATURED", prov: "STANDARD_CURATED", changed: true,
      signals: [["confirmed-lineup-key-player-absence", "CRITICAL", "Official lineup: Westerly's top scorer is not starting"]],
      reasoning: "Westerly's top scorer has six goals in his last five starts and should decide this one." },
    { home: "Ashgrove", away: "Calder Town", kickoffDays: 2.5, cat: "FEATURED", prov: "STANDARD_CURATED", status: "PENDING_REVIEW", changed: true,
      signals: [["new-result-home", "MODERATE", "Ashgrove played"]], reasoning: "Ashgrove are in strong form with two straight wins." },
    { home: "Fenwick", away: "Oldham Vale", kickoffDays: 1.6, cat: "FEATURED", prov: "STANDARD_CURATED", reass: "UNKNOWN",
      reasoning: "Fenwick have won four of six at home.", },
    { home: "Southmere", away: "Highcliff", kickoffDays: -0.05, cat: "VIP", prov: "VIP_GENERATED", changed: true,
      signals: [["new-result-home", "MODERATE", "x"]], reasoning: "Southmere have kept three clean sheets in a row." },
    { home: "Brackley", away: "Dunmore", kickoffDays: 1.1, cat: "FEATURED", prov: "STANDARD_CURATED", reass: "CURRENT", decided: ["CONFIRMED", "Reviewed new evidence (A new match result is available); original analysis retained."],
      reasoning: "Brackley have won three straight at home." },
    { home: "Lowther", away: "Penrose", kickoffDays: 2.1, cat: "VIP", prov: "VIP_GENERATED", reass: "CURRENT", decided: ["ADMIN_REWRITE_APPLIED", "Explanation updated after new evidence: A new match result is available. Selection, confidence and odds unchanged."],
      reasoning: "Lowther come in on a three-match winning run." },
  ];
  let n = 0;
  for (const s of seeds) {
    n++;
    const k = new Date(now + s.kickoffDays * D);
    const before = dg(team(s.home, 500 + n, [[-12, "Harlow", "W", 2, 0], [-5, "Tamworth", "W", 3, 1]], "WW", 3, 12), team(s.away, 600 + n, [[-11, "Bexley", "W", 2, 1], [-4, "Corby", "W", 1, 0]], "WW", 8, 12, ["J. Okafor"]));
    const after = s.changed ? dg(team(s.home, 500 + n, [[-5, "Tamworth", "W", 3, 1], [-1, "Harlow", "L", 0, 2]], "WL", 4, 13, ["D. Mensah"]), team(s.away, 600 + n, [[-11, "Bexley", "W", 2, 1], [-4, "Corby", "W", 1, 0]], "WW", 8, 12)) : before;
    const job = s.noJob ? null : await prisma.aIJob.create({ data: { userId: admin.id, model: "preview", prompt: "{}", rawOutput: "{}", contextComplete: true, context: before as object, createdAt: new Date(now - 30 * H) } });
    const status = s.status ?? "PUBLISHED";
    const p = await prisma.prediction.create({ data: {
      authorId: admin.id, category: s.cat, status, homeTeam: s.home, awayTeam: s.away, homeTeamApiId: 500 + n, awayTeamApiId: 600 + n, kickoff: k,
      leagueApiId: 39, leagueName: LEAGUE, marketType: "BTTS", selection: { value: "YES" }, manualSettlementOnly: false,
      market: s.market ?? "Both Teams Score", pick: s.pick ?? "Yes", odds: s.odds ?? 1.82, confidence: s.confidence ?? 74, reasoning: s.reasoning,
      matchPreview: s.home + " host " + s.away + ".", contextComplete: true, aiJobId: job?.id ?? null, provenance: s.prov,
      publishedAt: status === "PUBLISHED" ? new Date(now - 20 * H) : null, createdAt: new Date(now - 30 * H),
      categories: { create: [{ category: s.cat, manual: false }] } } });
    await prisma.predictionReassessment.create({ data: { predictionId: p.id, status: s.reass ?? "REVIEW_REQUIRED", publicHold: false,
      checkedAt: new Date(now - 12 * 60_000), lastEvidence: after as object, lastEvidenceAt: new Date(now - 12 * 60_000), lastChangeHash: "preview-" + n,
      summary: s.reass === "UNKNOWN" ? "Fixture status could not be confirmed from the latest snapshot; no change recorded." : "New evidence" } });
    if ((s.reass ?? "REVIEW_REQUIRED") === "REVIEW_REQUIRED")
      await prisma.predictionRevision.create({ data: { predictionId: p.id, kind: "REVIEW_REQUIRED", publiclyVisible: false, reason: "monitoring", beforeJson: {},
        evidenceJson: (s.signals ?? []).map(([code, severity, message]) => ({ code, severity, source: "fixture", message })), recordedAt: new Date(now - 12 * 60_000) } });
    if (s.draft) await prisma.predictionRevision.create({ data: { predictionId: p.id, kind: "ADMIN_REWRITE_DRAFT", publiclyVisible: false, reason: "preview draft", beforeJson: {},
      afterJson: { marketType: "BTTS", selection: { value: "YES" }, confidence: s.draft.confidence ?? 74, reasoning: s.draft.reasoning, matchPreview: s.home + " host " + s.away + " after a first defeat in three.", sameSelection: true, evidenceHash: "preview-" + n } } });
    if (s.decided) await prisma.predictionRevision.create({ data: { predictionId: p.id, kind: s.decided[0], publiclyVisible: false, reason: s.decided[1], beforeJson: {}, recordedAt: new Date(now - n * H) } });
  }
  assert.ok(n === seeds.length);
  console.log(`seeded ${n} fictional preview cases; login ${EMAIL} / preview-only-password`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
