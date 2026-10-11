/**
 * The European-club lane, rule by rule.
 *
 * WHAT THIS PROTECTS. The lane exists to give clubs like Qarabağ and The New
 * Saints attention their leagues' tier never gets, and the owner's condition
 * was that it be STRICT and leave the existing setup alone. So the checks pin
 * three things: who counts as a European club (main stage only), that nothing
 * is generated unless the market already backs the club inside the value band,
 * and that what survives generation is Market-Confirmed and at most one pick.
 * The sweep and target selection run against a stubbed database and provider,
 * so every api-football call is counted.
 *
 * Run: npx tsx scripts/check-european-clubs.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let passed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

// ---------------------------------------------------------------------------
// Stubs, installed before anything under src/ is imported.
// ---------------------------------------------------------------------------

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

type LedgerRow = { leagueApiId: number | null; round: string | null; matchKey: string; kickoff: Date; homeTeam: string; awayTeam: string; fixtureApiId: number | null };
const db = {
  ledger: [] as LedgerRow[],
  predictions: [] as Array<{ fixtureApiId: number | null; homeTeamApiId: number | null; awayTeamApiId: number | null; kickoff: Date | null }>,
  aiJobs: [] as Array<{ prompt: string; createdAt: Date }>,
  locks: new Map<string, { holder: string; expiresAt: Date }>(),
  odds: new Map<string, { oddsJson: unknown; fetchedAt: Date | null; bookmakerCount: number | null }>(),
  quotaRemaining: 5_000,
};
const calls = { byDate: 0, odds: 0 };
let byDatePayload: Record<string, any[] | null> = {};
/** What refreshOddsCache "fetches" per matchKey. */
let oddsOnFetch: Record<string, unknown> = {};
let clock = new Date();

const prismaStub = {
  $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const [key, holder, now, expiresAt] = values as [string, string, Date, Date];
    const row = db.locks.get(key);
    if (!row) {
      db.locks.set(key, { holder, expiresAt });
      return Promise.resolve([{ holder }]);
    }
    if (row.expiresAt <= now) {
      row.expiresAt = expiresAt;
      return Promise.resolve([{ holder: row.holder }]);
    }
    return Promise.resolve([]);
  },
  appLock: {
    update: ({ where, data }: any) => {
      const row = db.locks.get(where.key)!;
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    findUnique: ({ where }: any) => Promise.resolve(db.locks.has(where.key) ? { holder: db.locks.get(where.key)!.holder } : null),
    findMany: ({ where }: any) =>
      Promise.resolve([...db.locks.entries()].filter(([k, v]) => k.startsWith(where.key.startsWith) && v.expiresAt > where.expiresAt.gt).map(([key]) => ({ key }))),
    upsert: ({ where, create, update }: any) => {
      const row = db.locks.get(where.key);
      if (row) Object.assign(row, update);
      else db.locks.set(where.key, { holder: create.holder, expiresAt: create.expiresAt });
      return Promise.resolve({});
    },
  },
  aIJob: { findMany: ({ where }: any) => Promise.resolve(db.aiJobs.filter((j) => j.prompt.includes(where.prompt.contains))) },
  generationAttempt: {
    findMany: ({ where }: any) => {
      if (where.leagueApiId?.in) return Promise.resolve(db.ledger.filter((l) => where.leagueApiId.in.includes(l.leagueApiId) && l.kickoff >= where.kickoff.gte && l.round != null));
      const ids = new Set(where.OR[0].fixtureApiId.in);
      const keys = new Set(where.OR[1].matchKey.in);
      return Promise.resolve(db.ledger.filter((l) => (l.fixtureApiId != null && ids.has(l.fixtureApiId)) || keys.has(l.matchKey)));
    },
  },
  prediction: {
    findMany: ({ where }: any) => {
      if (where.id) return Promise.resolve([]);
      const ids = new Set(where.OR[0].fixtureApiId.in);
      const teams = new Set(where.OR[1].homeTeamApiId.in);
      return Promise.resolve(db.predictions.filter((p) => (p.fixtureApiId != null && ids.has(p.fixtureApiId)) || (p.homeTeamApiId != null && teams.has(p.homeTeamApiId))));
    },
    updateMany: () => Promise.resolve({ count: 0 }),
  },
  fixtureOddsCache: {
    findMany: ({ where }: any) => Promise.resolve(where.matchKey.in.filter((k: string) => db.odds.has(k)).map((k: string) => ({ matchKey: k, ...db.odds.get(k)! }))),
    findUnique: ({ where }: any) => Promise.resolve(db.odds.get(where.matchKey) ?? null),
  },
};

stub("../src/lib/prisma", { prisma: prismaStub });
stub("../src/lib/football/usage", {
  getUsageSnapshot: () => Promise.resolve({ remaining: db.quotaRemaining }),
  hasBudget: () => Promise.resolve(true),
  recordCall: () => Promise.resolve(),
});
stub("../src/lib/football/api-football", {
  getFixturesByDate: (date: string) => { calls.byDate++; return Promise.resolve(date in byDatePayload ? byDatePayload[date] : []); },
});
stub("../src/lib/enrichment", {
  refreshOddsCache: (target: { matchKey: string }) => {
    calls.odds++;
    const fetched = oddsOnFetch[target.matchKey];
    if (fetched) db.odds.set(target.matchKey, { oddsJson: fetched, fetchedAt: clock, bookmakerCount: 8 });
    return Promise.resolve({ matchKey: target.matchKey, result: fetched ? "ok" : "failed" });
  },
});

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-11T09:00:00Z");
const H = 3_600_000;
const AZERBAIJAN = 419;
const WALES = 110;
const WELSH_CUP = 112;
const QARABAG = 556;
const TNS = 1366;

let nextId = 5000;
function fixture(leagueApiId: number, homeId: number, awayId: number, opts: { hoursOut?: number; status?: string; home?: string; away?: string } = {}) {
  const id = nextId++;
  return {
    fixture: { id, date: new Date(NOW.getTime() + (opts.hoursOut ?? 30) * H).toISOString(), status: { short: opts.status ?? "NS" } },
    league: { id: leagueApiId, name: `League ${leagueApiId}`, season: 2026, round: "Regular Season - 8" },
    teams: { home: { id: homeId, name: opts.home ?? `Team ${homeId}` }, away: { id: awayId, name: opts.away ?? `Team ${awayId}` } },
    goals: { home: null, away: null },
  } as any;
}

function uefaRow(leagueApiId: number, round: string, home: number, away: number, kickoff = new Date("2026-09-30T19:00:00Z")): LedgerRow {
  return { leagueApiId, round, matchKey: `${home}-${away}-${kickoff.toISOString().slice(0, 10)}`, kickoff, homeTeam: `Team ${home}`, awayTeam: `Team ${away}`, fixtureApiId: nextId++ };
}

/** A FixtureOdds payload from true probabilities, with a 5% margin on every leg. */
function oddsFor(p: { home: number; draw: number; away: number }, books = 8) {
  const price = (x: number) => Number((1 / (x * 1.05)).toFixed(3));
  const sel = (value: string, x: number) => ({ value, best: price(x), median: price(x), bookmakers: books });
  return {
    bookmakerCount: books,
    update: null,
    markets: [
      { market: "Match Winner", selections: [sel("Home", p.home), sel("Draw", p.draw), sel("Away", p.away)] },
      { market: "Double Chance", selections: [sel("Home/Draw", p.home + p.draw), sel("Away/Draw", p.away + p.draw), sel("Home/Away", p.home + p.away)] },
      { market: "Both Teams Score", selections: [sel("Yes", 0.45), sel("No", 0.55)] },
      { market: "Goals Over/Under", selections: [sel("Over 1.5", 0.8), sel("Under 1.5", 0.2)] },
    ],
  } as any;
}

function resetWorld() {
  db.ledger = [];
  db.predictions = [];
  db.aiJobs = [];
  db.locks = new Map();
  db.odds = new Map();
  db.quotaRemaining = 5_000;
  calls.byDate = 0;
  calls.odds = 0;
  byDatePayload = {};
  oddsOnFetch = {};
  clock = NOW;
}

async function main() {
  const lane = await import("../src/lib/europeanClubs");
  const pipeline = await import("../src/lib/europeanClubsPipeline");
  const mc = await import("../src/lib/marketConfirmed");
  const { PAID_MAX_MARKET_PROBABILITY } = await import("../src/lib/vipPremiumOverlay");
  const { marketBreadthForCategories, startCutoffMsForCategories, DOUBLES_START_CUTOFF_MS } = await import("../src/lib/doublesTargeting");
  const { EUROPEAN_LANE_POLICY: P } = lane;
  const noCover = { fixtureIds: new Set<number>(), matchKeys: new Set<string>() };

  console.log("who counts as a European club:");
  for (const r of ["League Stage - 1", "League Stage - 8", "Knockout Round Play-offs", "Round of 16", "Quarter-finals", "Semi-finals", "Final"]) {
    check(`"${r}" is a main-stage round`, lane.isMainStageRound(r));
  }
  for (const r of ["Play-offs", "3rd Qualifying Round", "Preliminary Round", "", null]) {
    check(`${JSON.stringify(r)} is not (qualifying only does not count)`, !lane.isMainStageRound(r));
  }
  eq("season starts 1 July: October 2026 -> 2026", lane.europeanSeasonStart(NOW).toISOString(), "2026-07-01T00:00:00.000Z");
  eq("March 2027 is still the 2026/27 season", lane.europeanSeasonStart(new Date("2027-03-01T00:00:00Z")).toISOString(), "2026-07-01T00:00:00.000Z");
  eq("30 June 2026 is the 2025/26 season", lane.europeanSeasonStart(new Date("2026-06-30T12:00:00Z")).toISOString(), "2025-07-01T00:00:00.000Z");

  const clubs = lane.europeanClubsFromLedger([
    uefaRow(2, "League Stage - 2", QARABAG, 40),
    uefaRow(848, "League Stage - 1", TNS, 41),
    uefaRow(848, "League Stage - 3", 41, TNS),
    uefaRow(2, "3rd Qualifying Round", 900, 901), // knocked out in qualifying
    uefaRow(3, "League Stage - 5", 902, 903, new Date("2026-01-20T20:00:00Z")), // last season
    uefaRow(39, "Regular Season - 8", 904, 905), // not a UEFA competition
  ], NOW);
  eq("main-stage clubs from both sides of the fixture", [...clubs.keys()].sort((a, b) => a - b), [40, 41, QARABAG, TNS].sort((a, b) => a - b));
  eq("a club's competitions are merged, not duplicated", clubs.get(TNS)?.competitions, [848]);
  check("a club that only played qualifying is not a European club", !clubs.has(900) && !clubs.has(901));
  check("last season's league stage does not count this season", !clubs.has(902));

  console.log("\nwhich domestic competitions the lane reaches into:");
  check("Azerbaijan Premyer Liqa (DEEP_FALLBACK league)", lane.isLaneDomesticLeague(AZERBAIJAN));
  check("Welsh Premier League (DEEP_FALLBACK league)", lane.isLaneDomesticLeague(WALES));
  check("not the Welsh Cup: cups are left out", !lane.isLaneDomesticLeague(WELSH_CUP));
  check("not the Premier League: CORE is already covered daily", !lane.isLaneDomesticLeague(39));
  check("not Eredivisie: SECONDARY is already covered daily", !lane.isLaneDomesticLeague(88));
  check("not a women's league", !lane.isLaneDomesticLeague(64));
  check("not an uncatalogued competition", !lane.isLaneDomesticLeague(1128));
  check("not the Champions League itself", !lane.isLaneDomesticLeague(2));

  console.log("\nthe fixture gate:");
  const ctx = { clubs, covered: noCover, now: NOW };
  const ok = lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700), ctx);
  eq("Qarabağ at home in the league, 30h out: through, home side marked", ok, { ok: true, clubSides: ["home"] });
  eq("away club marked away", lane.europeanLaneGate(fixture(WALES, 701, TNS), ctx), { ok: true, clubSides: ["away"] });
  eq("two European clubs meeting: both sides", lane.europeanLaneGate(fixture(WALES, TNS, 41), ctx), { ok: true, clubSides: ["home", "away"] });
  const reason = (r: ReturnType<typeof lane.europeanLaneGate>) => (r.ok ? "ok" : r.reason);
  eq("no European club in it", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, 700, 701), ctx)), "no_european_club");
  eq("a cup tie", reason(lane.europeanLaneGate(fixture(WELSH_CUP, TNS, 701), ctx)), "not_lane_league");
  eq("not scheduled", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700, { status: "PST" }), ctx)), "not_scheduled");
  eq("inside the 12h lead time", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700, { hoursOut: 8 }), ctx)), "inside_lead_time");
  eq("beyond the 48h window", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700, { hoursOut: 60 }), ctx)), "outside_window");
  eq("a reserve side", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700, { away: "Sabah II" }), ctx)), "non_senior_side");
  const covered = fixture(AZERBAIJAN, QARABAG, 700);
  eq("already covered by another path", reason(lane.europeanLaneGate(covered, { ...ctx, covered: { fixtureIds: new Set([covered.fixture.id]), matchKeys: new Set() } })), "already_covered");
  eq("books asked and quoted nothing", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700), { ...ctx, odds: { bookmakerCount: 0, fetchedAt: NOW } })), "no_bookmakers");
  eq("no odds row yet is not held against it at sweep time", reason(lane.europeanLaneGate(fixture(AZERBAIJAN, QARABAG, 700), { ...ctx, odds: null })), "ok");

  const rows = [fixture(WALES, TNS, 701, { hoursOut: 20 }), fixture(AZERBAIJAN, QARABAG, 700, { hoursOut: 40 }), fixture(AZERBAIJAN, 700, 701), fixture(39, 1, 2), fixture(WELSH_CUP, TNS, 702)];
  rows.push(rows[0]);
  const plan = lane.planLaneSweep(rows, ctx);
  eq("sweep plan: one candidate per club fixture, duplicates collapsed", plan.candidates.map((c) => c.homeTeamApiId), [TNS, QARABAG]);
  eq("ordered by league priority (Wales ranks above Azerbaijan in DEEP_FALLBACK), then kickoff", plan.candidates.map((c) => c.leagueApiId), [WALES, AZERBAIJAN]);
  eq("rows outside lane leagues are ignored, not counted as rejected", plan.rejected, { no_european_club: 1 });
  check("candidates are JSON-safe (ISO kickoff) and carry the catalogue name", typeof plan.candidates[1].kickoff === "string" && plan.candidates[1].leagueName === "Premyer Liqa");

  console.log("\nthe stored sweep:");
  const record = { version: 1, token: "t", sweptAt: NOW.toISOString(), dates: [], clubs: 2, considered: 3, rejected: {}, candidates: plan.candidates } as const;
  eq("a stored record reads back", lane.parseLaneSweep(JSON.stringify(record))?.candidates.length, 2);
  for (const bad of [null, "", "{}", "lease-token-123", "{not json", JSON.stringify({ version: 2, candidates: [] })]) {
    eq(`unreadable holder ${JSON.stringify(bad)} is no candidates, not an error`, lane.parseLaneSweep(bad), null);
  }
  eq("lane attempts read back from the AIJob prompt", lane.readLaneAttempt(JSON.stringify({ intent: "EUROPEAN_CLUB", fixtureApiId: 77 }), NOW), { fixtureApiId: 77, createdAt: NOW });
  eq("another pass's AIJob is not a lane attempt", lane.readLaneAttempt(JSON.stringify({ intent: "GOALS", fixtureApiId: 77 }), NOW), null);

  console.log("\nchoosing what to generate:");
  const [c1, c2] = plan.candidates;
  const targets = (over: Partial<Parameters<typeof lane.planLaneTargets>[0]> = {}) =>
    lane.planLaneTargets({ candidates: plan.candidates, attempts: [], backingOff: new Set(), covered: noCover, now: NOW, ...over });
  eq("both candidates eligible, in priority order", targets().ordered.map((c) => c.fixtureApiId), [c1.fixtureApiId, c2.fixtureApiId]);
  eq("one shot per fixture: an attempted fixture is never retried", targets({ attempts: [{ fixtureApiId: c1.fixtureApiId, createdAt: new Date(NOW.getTime() - 26 * H) }] }).ordered.map((c) => c.fixtureApiId), [c2.fixtureApiId]);
  eq("a fixture serving its backoff is skipped", targets({ backingOff: new Set([c1.fixtureApiId]) }).skipped, { backing_off: 1 });
  eq("a fixture another path took since the sweep is skipped", targets({ covered: { fixtureIds: new Set([c2.fixtureApiId]), matchKeys: new Set() } }).skipped, { already_covered: 1 });
  eq("a stored candidate now inside 12h is skipped", targets({ now: new Date(NOW.getTime() + 9 * H) }).skipped, { inside_lead_time: 1 });
  const capped = targets({ attempts: Array.from({ length: P.DAILY_ATTEMPT_CAP }, (_, i) => ({ fixtureApiId: 10 + i, createdAt: NOW })) });
  check(`the daily cap (${P.DAILY_ATTEMPT_CAP}) stands the lane down`, capped.stoodDown?.startsWith("daily cap reached") === true && capped.ordered.length === 0);
  check("yesterday's attempts do not count toward today's cap", targets({ attempts: Array.from({ length: P.DAILY_ATTEMPT_CAP }, (_, i) => ({ fixtureApiId: 10 + i, createdAt: new Date(NOW.getTime() - 30 * H) })) }).stoodDown === null);

  console.log("\nthe market value gate (before any model call):");
  const fresh = new Date(NOW.getTime() - 10 * 60_000);
  const verdict = (o: any, sides: Array<"home" | "away">, at: Date | null = fresh) => lane.laneValueVerdict(o, at, sides, NOW);
  const strongHome = oddsFor({ home: 0.78, draw: 0.14, away: 0.08 });
  const v1 = verdict(strongHome, ["home"]);
  check("club priced ~78% to win at home: worth generating", v1.ok && v1.value.market === "Match Winner" && v1.value.value === "Home" && Math.abs(v1.value.probability - 78) < 0.5, JSON.stringify(v1));
  const dcOnly = verdict(oddsFor({ home: 0.6, draw: 0.22, away: 0.18 }), ["home"]);
  check("win only 60% but home-or-draw ~82%: the double chance qualifies", dcOnly.ok && dcOnly.value.value === "Home/Draw", JSON.stringify(dcOnly));
  const awayClub = verdict(oddsFor({ home: 0.1, draw: 0.12, away: 0.78 }), ["away"]);
  check("away club works the same way", awayClub.ok && awayClub.value.value === "Away");
  const r = (v: ReturnType<typeof verdict>) => (v.ok ? "ok" : v.reason);
  eq("the club is the underdog: not worth a call", r(verdict(oddsFor({ home: 0.2, draw: 0.25, away: 0.55 }), ["home"])), "CLUB_NOT_FAVOURED");
  eq("the OPPONENT being strongly favoured is not value for the club", r(verdict(oddsFor({ home: 0.78, draw: 0.14, away: 0.08 }), ["away"])), "CLUB_NOT_FAVOURED");
  eq("priced ~93% to win: too short, no value", r(verdict(oddsFor({ home: 0.93, draw: 0.05, away: 0.02 }), ["home"])), "TOO_SHORT");
  eq("four books is not a market", r(verdict(oddsFor({ home: 0.78, draw: 0.14, away: 0.08 }, 4), ["home"])), "THIN_MARKET");
  eq("no odds", r(verdict(null, ["home"])), "NO_ODDS");
  eq("a quote older than 2h is not trusted", r(verdict(strongHome, ["home"], new Date(NOW.getTime() - 3 * H))), "STALE_QUOTE");
  eq("nor one 100 minutes old: it would be stale by the time the drafts are judged", r(verdict(strongHome, ["home"], new Date(NOW.getTime() - 100 * 60_000))), "STALE_QUOTE");
  check("selection headroom is under the draft gate's limit", P.SELECTION_QUOTE_MAX_AGE_MS < P.MAX_QUOTE_AGE_MS);
  eq("only NO_ODDS and STALE_QUOTE are worth an odds call", lane.LANE_RETRYABLE_VALUE_REASONS, ["NO_ODDS", "STALE_QUOTE"]);

  console.log("\nthe draft gate (after generation):");
  const draft = (id: string, marketType: string, value: string, confidence: number) => ({ id, marketType, selection: { value } as any, confidence });
  const judged = lane.judgeLaneDrafts([
    draft("win", "MATCH_WINNER", "HOME", 80), // market ~78, gap 2: confirmed
    draft("dc", "DOUBLE_CHANCE", "HOME_OR_DRAW", 85), // market ~92: confirmed but too short
    draft("low", "BTTS", "NO", 60), // model below the floor
    draft("away", "MATCH_WINNER", "AWAY", 76), // market ~8: below the market floor
  ], strongHome, fresh, NOW);
  const byId = Object.fromEntries(judged.map((j) => [j.id, j]));
  eq("only the confirmed in-band draft is kept", judged.filter((j) => j.kept).map((j) => j.id), ["win"]);
  eq("too short to be value", byId.dc.reason, "TOO_SHORT");
  eq("model below 75%", byId.low.reason, "MODEL_BELOW_FLOOR");
  eq("market disagrees", byId.away.reason, "MARKET_BELOW_FLOOR");
  const two = lane.judgeLaneDrafts([draft("a", "MATCH_WINNER", "HOME", 79), draft("b", "MATCH_WINNER", "HOME", 84)], strongHome, fresh, NOW);
  eq("two passing drafts: one kept, the other a runner-up", two.map((j) => [j.id, j.kept, j.reason]), [["a", true, null], ["b", false, "RUNNER_UP"]]);
  eq("nothing passes: nothing kept", lane.judgeLaneDrafts([draft("x", "BTTS", "NO", 60)], strongHome, fresh, NOW).filter((j) => j.kept).length, 0);
  eq("a stale quote keeps nothing", lane.judgeLaneDrafts([draft("w", "MATCH_WINNER", "HOME", 80)], strongHome, new Date(NOW.getTime() - 3 * H), NOW)[0].reason, "STALE_QUOTE");

  console.log("\nno looser than the existing gates:");
  eq("bookmaker floor is the Market-Confirmed one", P.MIN_BOOKMAKERS, mc.MC_MIN_BOOKMAKERS);
  eq("market floor is the Market-Confirmed one", P.MIN_MARKET_PROBABILITY, mc.MC_MIN_MARKET_PROBABILITY);
  eq("value ceiling is the paid tier's (fair odds 1.15)", P.MAX_MARKET_PROBABILITY, PAID_MAX_MARKET_PROBABILITY);
  eq("quote age is the Market-Confirmed one", P.MAX_QUOTE_AGE_MS, mc.MC_MAX_QUOTE_AGE_MS);
  eq("Market-Confirmed itself is unchanged", [mc.MC_MIN_MODEL_CONFIDENCE, mc.MC_MIN_MARKET_PROBABILITY, mc.MC_MAX_GAP_PP, mc.MC_MIN_BOOKMAKERS], [75, 75, 10, 5]);
  check("the lane stands down before the fallback sweep does when quota is tight", P.MIN_QUOTA_REMAINING > 1_000);
  eq("the lane asks for several markets, like the VIP pass", marketBreadthForCategories(["FEATURED"], "EUROPEAN_CLUB"), "multi");
  eq("...and takes the multi-market start cutoff with it", startCutoffMsForCategories(["FEATURED"], 22_000, "EUROPEAN_CLUB"), DOUBLES_START_CUTOFF_MS);
  eq("ordinary FEATURED breadth unchanged", marketBreadthForCategories(["FEATURED"], undefined), "single");
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  check("no same-game double is assembled from lane drafts", /input\.intent !== "EUROPEAN_CLUB"/.test(src("src/lib/ai/generate.ts")));
  const pipelineSrc = src("src/lib/europeanClubsPipeline.ts");
  check("the lane never writes the GenerationAttempt ledger", !/generationAttempt\.(create|createMany|update|updateMany|upsert|delete)/.test(pipelineSrc));
  const worker = src("src/lib/generation/worker.ts");
  const laneRun = worker.slice(worker.indexOf("export async function runEuropeanClubGeneration"), worker.indexOf("export type VipPremiumRunReport"));
  check("the lane run never calls recordAttempt or touches the ledger", laneRun.length > 0 && !/recordAttempt|generationAttempt/.test(laneRun));
  check("the lane run never publishes: kept drafts wait for review", !/applyReviewAction|"PUBLISH"|PUBLISHED/.test(laneRun + pipelineSrc));

  // ---- The sweep and selection against stubs -------------------------------

  console.log("\nsweep: no European clubs known yet:");
  resetWorld();
  const none = await pipeline.sweepEuropeanLaneIfDue(NOW);
  check("stands down without a provider call", !none.ran && calls.byDate === 0 && /no main-stage UEFA club/.test(none.skippedReason ?? ""));
  check("and leaves no lease behind, so it sweeps as soon as clubs appear", !db.locks.has(lane.EUROPEAN_LANE_SWEEP_KEY));

  console.log("\nsweep: due, with Qarabağ and TNS in Europe:");
  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40), uefaRow(848, "League Stage - 2", TNS, 41));
  const qarabagHome = fixture(AZERBAIJAN, QARABAG, 700, { hoursOut: 30 });
  const tnsAway = fixture(WALES, 701, TNS, { hoursOut: 26 });
  const noClub = fixture(AZERBAIJAN, 702, 703, { hoursOut: 30 });
  const premier = fixture(39, 1, 2, { hoursOut: 30 });
  byDatePayload = { "2026-10-11": [], "2026-10-12": [qarabagHome, tnsAway, noClub, premier], "2026-10-13": [] };
  const swept = await pipeline.sweepEuropeanLaneIfDue(NOW);
  check("ran, one by-date call per date in the horizon", swept.ran && calls.byDate === swept.dates.length && swept.dates.length <= 3, `${calls.byDate} calls for ${swept.dates.length} dates`);
  eq("found both club fixtures and nothing else", swept.candidates.map((c) => c.club).sort(), ["Team 1366", "Team 556"]);
  eq("the others are accounted for", swept.rejected, { no_european_club: 1 });
  check("the result is stored with the lease", lane.parseLaneSweep(db.locks.get(lane.EUROPEAN_LANE_SWEEP_KEY)?.holder)?.candidates.length === 2);
  const again = await pipeline.sweepEuropeanLaneIfDue(new Date(NOW.getTime() + 60 * 60_000));
  check(`not again within ${P.SWEEP_INTERVAL_MINUTES} minutes, and no calls spent`, !again.ran && calls.byDate === swept.dates.length);
  db.quotaRemaining = 1_200;
  const tight = await pipeline.sweepEuropeanLaneIfDue(new Date(NOW.getTime() + 4 * H));
  check("stands down below its quota floor", !tight.ran && /quota headroom/.test(tight.skippedReason ?? ""));

  console.log("\nsweep: every provider call fails:");
  db.quotaRemaining = 5_000;
  const later = new Date(NOW.getTime() + 4 * H);
  byDatePayload = Object.fromEntries(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((d) => [d, null]));
  const failed = await pipeline.sweepEuropeanLaneIfDue(later);
  check("reported, and the previous candidate list is kept", failed.ran && /previous candidate list kept/.test(failed.skippedReason ?? "") && lane.parseLaneSweep(db.locks.get(lane.EUROPEAN_LANE_SWEEP_KEY)?.holder)?.candidates.length === 2);
  check(`retries in ${P.SWEEP_RETRY_MINUTES} minutes, not the full interval`, db.locks.get(lane.EUROPEAN_LANE_SWEEP_KEY)!.expiresAt.getTime() === later.getTime() + P.SWEEP_RETRY_MINUTES * 60_000);

  console.log("\nselection: market-first, odds warmed on demand:");
  // Restore the good sweep (taken at NOW) and run an hour later.
  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40), uefaRow(848, "League Stage - 2", TNS, 41));
  byDatePayload = { "2026-10-12": [qarabagHome, tnsAway] };
  await pipeline.sweepEuropeanLaneIfDue(NOW);
  const runAt = new Date(NOW.getTime() + H);
  clock = runAt;
  const qKey = `${QARABAG}-700-${qarabagHome.fixture.date.slice(0, 10)}`;
  const tKey = `701-${TNS}-${tnsAway.fixture.date.slice(0, 10)}`;
  // Wales ranks above Azerbaijan, so TNS is looked at first.
  oddsOnFetch = { [qKey]: oddsFor({ home: 0.62, draw: 0.2, away: 0.18 }), [tKey]: oddsFor({ home: 0.08, draw: 0.12, away: 0.8 }) };
  const sel = await pipeline.selectLaneTarget(runAt);
  check("the first candidate that clears the gate is the target", sel.target?.awayTeamApiId === TNS && sel.target.value.value === "Away", JSON.stringify(sel.evaluated));
  eq("one odds call spent, for the fixture it chose", sel.oddsCalls, 1);

  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40), uefaRow(848, "League Stage - 2", TNS, 41));
  byDatePayload = { "2026-10-12": [qarabagHome, tnsAway] };
  await pipeline.sweepEuropeanLaneIfDue(NOW);
  clock = runAt;
  oddsOnFetch = { [qKey]: oddsFor({ home: 0.62, draw: 0.2, away: 0.18 }), [tKey]: oddsFor({ home: 0.4, draw: 0.3, away: 0.3 }) };
  const second = await pipeline.selectLaneTarget(runAt);
  check("TNS not favoured: skipped for Qarabağ, whose home-or-draw (~82%) qualifies", second.target?.homeTeamApiId === QARABAG && second.target.value.value === "Home/Draw" && second.evaluated[0].reason === "CLUB_NOT_FAVOURED", JSON.stringify(second.evaluated));
  eq(`odds calls stay within ODDS_WARM_PER_RUN (${P.ODDS_WARM_PER_RUN})`, second.oddsCalls, 2);

  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40), uefaRow(848, "League Stage - 2", TNS, 41));
  const third = fixture(AZERBAIJAN, 704, QARABAG, { hoursOut: 40 });
  byDatePayload = { "2026-10-12": [qarabagHome, tnsAway, third] };
  await pipeline.sweepEuropeanLaneIfDue(NOW);
  clock = runAt;
  oddsOnFetch = {};
  const starved = await pipeline.selectLaneTarget(runAt);
  check("no fixture priced: no target, no generation", starved.target === null && starved.stoodDown === "no candidate cleared the market value gate this run");
  eq("and never more than the warm budget in calls, however many candidates", starved.oddsCalls, P.ODDS_WARM_PER_RUN);

  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40));
  byDatePayload = { "2026-10-12": [qarabagHome] };
  await pipeline.sweepEuropeanLaneIfDue(NOW);
  db.predictions.push({ fixtureApiId: qarabagHome.fixture.id, homeTeamApiId: QARABAG, awayTeamApiId: 700, kickoff: new Date(qarabagHome.fixture.date) });
  const taken = await pipeline.selectLaneTarget(runAt);
  check("a fixture ordinary generation took after the sweep is left alone", taken.target === null && taken.skipped.already_covered === 1 && calls.odds === 0);

  resetWorld();
  db.ledger.push(uefaRow(2, "League Stage - 2", QARABAG, 40));
  byDatePayload = { "2026-10-12": [qarabagHome] };
  await pipeline.sweepEuropeanLaneIfDue(NOW);
  db.aiJobs.push({ prompt: JSON.stringify({ intent: "EUROPEAN_CLUB", fixtureApiId: qarabagHome.fixture.id }), createdAt: NOW });
  const once = await pipeline.selectLaneTarget(runAt);
  check("a fixture the lane already attempted is not attempted again", once.target === null && once.skipped.attempted === 1);
  eq("...and the slate exclusion sees it", [...(await pipeline.laneFixtureIds(runAt))], [qarabagHome.fixture.id]);

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures) process.exit(1);
  console.log("All European-club lane checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
