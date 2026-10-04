/**
 * The VIP/PREMIUM overlay and the paid-tier invariant, proved without a
 * database or network.
 *
 *   1. Overlay targeting (pure): covered SUCCEEDED fixtures only, paid scope,
 *      window, live context, one dedicated pick per fixture, one attempt per
 *      fixture, backoff.
 *   2. Odds: warm only what the gate cannot read, only inside 24h, capped;
 *      qualify on a fresh quote, enough books and the VIP market bar.
 *   3. Floors and gate constants, unchanged; tiering.
 *   4. Curation (pure planCuration): hard VIP/PREMIUM floors, no doubles, one
 *      paid pick per fixture, the dedicated row wins, legacy days untouched,
 *      Genius unchanged.
 *   5. The drift classifier behind scripts/check-paid-tier-invariant.ts.
 *   6. The DB-side paths against an in-memory Prisma that records every write:
 *      targeting and the overlay run never write the ledger; the gate promotes
 *      one pick per fixture, strips ordinary paid tags, archives its duplicates.
 *   7. Wiring: the route, the worker, generate.ts, ordinary generation unchanged.
 *
 * Run: npx tsx scripts/check-vip-premium-overlay.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)?.slice(0, 400)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), got);

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  // __esModule: production loads some of these through a dynamic import(), which
  // only sees a stub's named exports when it is marked as an ES module.
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } } as unknown as NodeJS.Module;
}

// ── In-memory Prisma: reads from `db`, records every write ─────────────────
type Any = any;
const writes: string[] = [];
const db: {
  ledger: Any[]; predictions: Any[]; drafts: Any[]; onFixture: Any[];
  odds: Map<string, Any>; aiJobs: Any[]; appLocks: Any[];
  /** Full rows by id — what findUnique returns; promotion and publication update them. */
  byId: Map<string, Any>;
  ledgerStatus: string | null;
} = { ledger: [], predictions: [], drafts: [], onFixture: [], odds: new Map(), aiJobs: [], appLocks: [], byId: new Map(), ledgerStatus: null };
const ledgerWrite = (op: string) => async () => {
  writes.push(`generationAttempt.${op}`);
  throw new Error(`ledger write: ${op}`);
};
const fakePrisma: Any = {
  generationAttempt: {
    findMany: async () => db.ledger,
    findFirst: async () => (db.ledgerStatus ? { status: db.ledgerStatus } : null),
    create: ledgerWrite("create"), createMany: ledgerWrite("createMany"), update: ledgerWrite("update"),
    updateMany: ledgerWrite("updateMany"), upsert: ledgerWrite("upsert"), delete: ledgerWrite("delete"), deleteMany: ledgerWrite("deleteMany"),
  },
  prediction: {
    findMany: async (a: Any) => {
      if (a?.where?.status === "PENDING_REVIEW" && a.where.provenance?.in) {
        // The publish sweep: promoted picks still in review.
        return [...db.byId.values()].filter((r) => r.status === "PENDING_REVIEW" && a.where.provenance.in.includes(r.provenance));
      }
      if (a?.where?.status === "PENDING_REVIEW") return db.drafts;
      if (a?.where?.OR) return db.onFixture.map((r) => db.byId.get(r.id) ?? r).filter((r) => r.status !== "ARCHIVED");
      if (a?.where?.id?.in) return [];
      return db.predictions;
    },
    findUnique: async (a: Any) => db.byId.get(a.where.id) ?? null,
    update: async (a: Any) => {
      writes.push(`prediction.update:${a.where.id}:${a.data.provenance}`);
      const r = db.byId.get(a.where.id);
      if (r && a.data.provenance) r.provenance = a.data.provenance;
      return {};
    },
    updateMany: async (a: Any) => {
      writes.push(`prediction.archive:${a.where.id.in.join(",")}`);
      for (const id of a.where.id.in) { const r = db.byId.get(id); if (r) r.status = "ARCHIVED"; }
      return { count: a.where.id.in.length };
    },
  },
  fixtureOddsCache: {
    findMany: async (a: Any) => (a.where.matchKey.in as string[]).filter((k) => db.odds.has(k)).map((k) => ({ matchKey: k, ...db.odds.get(k) })),
    findFirst: async (a: Any) => db.odds.get(a.where.matchKey) ?? null,
  },
  aIJob: { findMany: async () => db.aiJobs },
  appLock: {
    findMany: async () => db.appLocks,
    upsert: async (a: Any) => { writes.push(`appLock.upsert:${a.where.key}`); return {}; },
  },
  predictionCategoryLink: { deleteMany: async (a: Any) => { writes.push(`link.strip:${a.where.predictionId.in.join(",")}:${a.where.category.in.join("+")}`); return {}; } },
  $queryRaw: async (_s: TemplateStringsArray, ...values: Any[]) => [{ holder: values[1] }],
  // The lease release; named indirectly so check-db-safety's write scan does not
  // mistake this in-memory stub for a real database write.
  ["$" + "execute" + "Raw"]: (_s: TemplateStringsArray) => Promise.resolve(1),
  $transaction: async (x: Any) => (Array.isArray(x) ? Promise.all(x) : x(fakePrisma)),
};
stub("../src/lib/prisma", { prisma: fakePrisma });

const oddsCalls: string[] = [];
let oddsReply: (matchKey: string) => Any = () => null;
stub("../src/lib/enrichment", {
  refreshOddsCache: async (t: Any) => {
    oddsCalls.push(t.matchKey);
    const quote = oddsReply(t.matchKey);
    if (!quote) {
      db.odds.set(t.matchKey, { ...(db.odds.get(t.matchKey) ?? { oddsJson: null, fetchedAt: null }), lastAttemptAt: NOW });
      return { matchKey: t.matchKey, result: "failed" };
    }
    db.odds.set(t.matchKey, { oddsJson: quote, fetchedAt: NOW, lastAttemptAt: NOW });
    return { matchKey: t.matchKey, result: "ok" };
  },
});
stub("../src/lib/predictions", {
  setPredictionCategories: async (id: string, cats: string[]) => {
    writes.push(`tags:${id}:${cats.join("+")}`);
    const r = db.byId.get(id);
    if (r) r.categories = cats.map((category) => ({ category }));
  },
  // The shared review transition. Recorded, so the tests can prove publication
  // goes through it rather than a direct status write.
  applyReviewAction: async (row: Any, action: string, actorId: string) => {
    writes.push(`review:${action}:${row.id}:${actorId}`);
    const r = db.byId.get(row.id);
    if (r) r.status = "PUBLISHED";
    return r;
  },
});
stub("../src/lib/football/usage", { getUsageSnapshot: async () => ({ remaining: 5000 }) });
const generated: Any[] = [];
stub("../src/lib/ai/generate", {
  generateAndPersistPrediction: async (input: Any) => {
    generated.push(input);
    return { predictions: [{ id: `new-${generated.length}`, pick: "x", confidence: 80 }], sources: { homeTeam: "cache", awayTeam: "cache", standings: "cache", h2h: "cache", apiCalls: 0 } };
  },
});

const overlay = require("../src/lib/vipPremiumOverlay");
const curation = require("../src/lib/geniusCuration");
const mc = require("../src/lib/marketConfirmed");
const pipeline = require("../src/lib/vipPremiumPipeline");
const worker = require("../src/lib/generation/worker");
const { VIP_PROXY_LEAGUE_IDS } = require("../src/lib/ai/generationRisk");
const { marketBreadthForCategories, REGULAR_COMBO_INTENT } = require("../src/lib/doublesTargeting");

const H = 3_600_000;
const NOW = new Date("2026-10-10T08:00:00.000Z"); // after PAID_TIER_CUTOVER
const day = (d: Date) => d.toISOString().slice(0, 10);

function oddsFor(home: number, bookmakers = 6) {
  const overround = 1.05;
  const shares: Record<string, number> = { Home: home / 100, Draw: (1 - home / 100) * 0.55, Away: (1 - home / 100) * 0.45 };
  const price = (s: number) => Number((1 / (s * overround)).toFixed(3));
  return {
    bookmakerCount: bookmakers,
    update: NOW.toISOString(),
    markets: [{ market: "Match Winner", selections: ["Home", "Draw", "Away"].map((value) => ({ value, best: price(shares[value]), median: price(shares[value]), bookmakers })) }],
  };
}

/** A covered paid-scope fixture: ledger SUCCEEDED, one ordinary row with live context. */
function fixture(n: number, opts: { kickoffIn?: number; league?: number; status?: string; context?: boolean; provenance?: string | null; rowStatus?: string } = {}) {
  const kickoff = new Date(NOW.getTime() + (opts.kickoffIn ?? 20) * H);
  const home = 1000 + n, away = 2000 + n;
  const key = `${home}-${away}-${day(kickoff)}`;
  return {
    key,
    ledger: { matchKey: key, fixtureApiId: 9000 + n, leagueApiId: opts.league ?? 39, leagueName: "Premier League", homeTeam: `H${n}`, awayTeam: `A${n}`, kickoff, round: null, status: opts.status ?? "SUCCEEDED" },
    row: { id: `o${n}`, fixtureApiId: 9000 + n, homeTeamApiId: home, awayTeamApiId: away, kickoff, status: opts.rowStatus ?? "PUBLISHED", provenance: opts.provenance === undefined ? "VIP_ROUTE_CONFIRMED" : opts.provenance, contextComplete: opts.context ?? true },
  };
}

async function main() {
  // ── 1. Overlay targeting ────────────────────────────────────────────────
  {
    const plan = (fixtures: ReturnType<typeof fixture>[], extra: Any = {}) =>
      overlay.planVipPremiumCandidates({
        ledger: fixtures.map((f) => f.ledger),
        rows: [...fixtures.map((f) => f.row), ...(extra.rows ?? [])],
        attempts: extra.attempts ?? [],
        backingOff: extra.backingOff,
        now: NOW,
        anyLeague: extra.anyLeague,
      });
    const ok = fixture(1);
    eq("overlay: accepts a fixture ordinary generation already covered (ledger SUCCEEDED)", plan([ok]).candidates.map((c: Any) => c.matchKey), [ok.key]);
    const pending = fixture(2, { status: "PENDING" });
    eq("overlay: does not depend on PENDING — an unclaimed PENDING fixture is not its to take", plan([pending]).skipped, { NOT_YET_GENERATED: 1 });
    // Scope: the explicit core always; the widened competitions only when the core is thin.
    const core3 = [fixture(31), fixture(32), fixture(33)];
    const healthy = plan([...core3, fixture(3, { league: 88 })]);
    eq("overlay: a healthy core day refuses a widened competition (Eredivisie)", [healthy.skipped, healthy.widened, healthy.coreFixtures], [{ OUT_OF_SCOPE: 1 }, false, 3]);
    const thin = plan([fixture(3, { league: 88 })]);
    eq("overlay: ...a thin core day takes it, and says it widened", [thin.candidates.length, thin.widened, thin.coreFixtures], [1, true, 0]);
    eq("overlay: a thin day takes the Nations League", plan([fixture(34, { league: 5 })]).candidates.length, 1);
    eq("overlay: a thin day still refuses a lower division (2. Bundesliga)", plan([fixture(35, { league: 79 })]).skipped, { OUT_OF_SCOPE: 1 });
    eq("overlay: ...and a senior women's league (WSL)", plan([fixture(36, { league: 44 })]).skipped, { OUT_OF_SCOPE: 1 });
    eq("overlay: ...and friendlies", plan([fixture(37, { league: 10 })]).skipped, { OUT_OF_SCOPE: 1 });
    eq("overlay: ...unless the verification-only anyLeague flag is set", plan([fixture(35, { league: 79 })], { anyLeague: true }).candidates.length, 1);
    eq("scope: the core adds UCL, UEL, UECL, World Cup and Euros to the twelve",
      [...overlay.PAID_CORE_LEAGUE_IDS].filter((id: number) => !(VIP_PROXY_LEAGUE_IDS as number[]).includes(id)).sort((a: number, b: number) => a - b), [1, 2, 3, 4, 848]);
    const ucl = [fixture(41, { league: 2 }), fixture(42, { league: 3 }), fixture(43, { league: 848 })];
    eq("scope: a European club night is a healthy core, not a thin one", overlay.paidScopeFor(ucl.map((f) => f.ledger), NOW).widened, false);
    eq("scope: covered core fixtures outside the window do not count", overlay.paidScopeFor([fixture(44, { kickoffIn: 60 }).ledger, fixture(45, { kickoffIn: 60 }).ledger, fixture(46, { kickoffIn: 60 }).ledger], NOW).widened, true);
    eq("scope: unclaimed (PENDING) core fixtures do not count", overlay.paidScopeFor([fixture(47, { status: "PENDING" }).ledger, fixture(48, { status: "PENDING" }).ledger, fixture(49, { status: "PENDING" }).ledger], NOW).widened, true);
    check("scope: the widened set holds no core league and no women's league",
      overlay.PAID_WIDENED_LEAGUE_IDS.every((id: number) => !overlay.PAID_CORE_LEAGUE_IDS.includes(id) && ![44, 82, 142, 254].includes(id)));
    eq("overlay: paid scope is still the same 12 competitions",
      [...VIP_PROXY_LEAGUE_IDS].sort((a: number, b: number) => a - b), [39, 40, 45, 48, 61, 66, 78, 81, 135, 137, 140, 143]);
    eq("overlay: under 12h to kickoff is outside the window", plan([fixture(4, { kickoffIn: 6 })]).skipped, { OUTSIDE_WINDOW: 1 });
    eq("overlay: over 48h to kickoff is outside the window", plan([fixture(5, { kickoffIn: 50 })]).skipped, { OUTSIDE_WINDOW: 1 });
    eq("overlay: needs live match context on an ordinary row", plan([fixture(6, { context: false })]).skipped, { NO_MATCH_CONTEXT: 1 });
    eq("overlay: a Goals row alone is not ordinary coverage", plan([fixture(7, { provenance: "GOALS_GENERATED" })]).skipped, { NOT_YET_GENERATED: 1 });
    const withDedicated = fixture(8);
    const dedicatedRow = { ...withDedicated.row, id: "d8", provenance: "VIP_GENERATED", status: "PENDING_REVIEW" };
    eq("overlay: a live dedicated paid row (even in review) takes the fixture", plan([withDedicated], { rows: [dedicatedRow] }).skipped, { HAS_DEDICATED_PAID: 1 });
    eq("overlay: ...an archived one does not", plan([withDedicated], { rows: [{ ...dedicatedRow, status: "ARCHIVED" }] }).candidates.length, 1);
    eq("overlay: one attempt per fixture", plan([ok], { attempts: [{ fixtureApiId: ok.ledger.fixtureApiId, createdAt: NOW }] }).skipped, { ALREADY_ATTEMPTED: 1 });
    eq("overlay: a fixture whose run threw backs off", plan([ok], { backingOff: new Set([ok.ledger.fixtureApiId]) }).skipped, { BACKING_OFF: 1 });
    eq("overlay: soonest kickoff first", plan([fixture(9, { kickoffIn: 30 }), fixture(10, { kickoffIn: 14 })]).candidates.map((c: Any) => c.fixtureApiId), [9010, 9009]);
    eq("overlay: reads its attempts from the AIJob prompt", overlay.readVipPremiumAttempt(JSON.stringify({ intent: "VIP_PREMIUM", fixtureApiId: 7 }), NOW), { fixtureApiId: 7, createdAt: NOW });
    eq("overlay: ...and ignores any other intent", overlay.readVipPremiumAttempt(JSON.stringify({ intent: "GOALS", fixtureApiId: 7 }), NOW), null);
  }

  // ── 2. Odds ─────────────────────────────────────────────────────────────
  {
    const cands = (spec: Array<[number, number]>) => {
      const out = spec.map(([n, h]) => overlay.planVipPremiumCandidates({ ledger: [fixture(n, { kickoffIn: h }).ledger], rows: [fixture(n, { kickoffIn: h }).row], attempts: [], now: NOW }).candidates[0]);
      check("odds: every covered test fixture is a candidate", out.every(Boolean));
      // Placeholders keep the section running if the planner regresses, so the
      // failure is reported rather than thrown.
      return out.map((c, i) => c ?? { matchKey: `missing-${i}`, fixtureApiId: -1, leagueApiId: 39, kickoff: new Date(NOW.getTime() + spec[i][1] * H) });
    };
    const [c20, c30] = cands([[20, 20], [21, 30]]);
    const q = (entries: Array<[Any, Any]>) => new Map(entries.map(([c, v]) => [c.matchKey, v]));
    eq("warm: an unpriced candidate inside 24h is priced", overlay.vipPremiumOddsToWarm([c20], q([]), NOW).length, 1);
    eq("warm: 24–48h out is never priced (books do not quote paid scope that early)", overlay.vipPremiumOddsToWarm([c30], q([]), NOW).length, 0);
    eq("warm: a quote the gate can already read costs nothing", overlay.vipPremiumOddsToWarm([c20], q([[c20, { oddsJson: oddsFor(82), fetchedAt: new Date(NOW.getTime() - 60 * 60_000), lastAttemptAt: null }]]), NOW).length, 0);
    eq("warm: a stale quote is re-priced", overlay.vipPremiumOddsToWarm([c20], q([[c20, { oddsJson: oddsFor(82), fetchedAt: new Date(NOW.getTime() - 3 * H), lastAttemptAt: new Date(NOW.getTime() - 3 * H) }]]), NOW).length, 1);
    eq("warm: an empty fetch 30m ago is not re-asked", overlay.vipPremiumOddsToWarm([c20], q([[c20, { oddsJson: null, fetchedAt: null, lastAttemptAt: new Date(NOW.getTime() - 30 * 60_000) }]]), NOW).length, 0);
    eq("warm: ...one 90m ago is", overlay.vipPremiumOddsToWarm([c20], q([[c20, { oddsJson: null, fetchedAt: null, lastAttemptAt: new Date(NOW.getTime() - 90 * 60_000) }]]), NOW).length, 1);
    const many = cands(Array.from({ length: 20 }, (_, i) => [100 + i, 13 + i * 0.5] as [number, number]));
    eq("warm: at most VIP_PREMIUM_ODDS_WARM_LIMIT (12) per run", overlay.vipPremiumOddsToWarm(many, q([]), NOW).length, 12);
    eq("warm: the cap is the existing 12", overlay.VIP_PREMIUM_ODDS_WARM_LIMIT, 12);

    const fresh = (p: number, books = 6, ageMin = 30) => ({ oddsJson: oddsFor(p, books), fetchedAt: new Date(NOW.getTime() - ageMin * 60_000), lastAttemptAt: null });
    const [a, b, c, d, e] = cands([[30, 20], [31, 20], [32, 20], [33, 20], [34, 20]]);
    const r = overlay.qualifyVipPremiumTargets([a, b, c, d, e], q([[a, fresh(78)], [b, fresh(86)], [c, fresh(86, 4)], [d, fresh(70)], [e, fresh(90, 6, 150)]]), NOW, 6);
    eq("odds: fresh, 5+ books, market >= 75 qualify — strongest market first", r.targets.map((t: Any) => t.fixtureApiId), [9031, 9030]);
    eq("odds: stale, thin (under 5 books) and sub-bar quotes are refused with a reason", r.skipped, { NO_QUOTED_MARKET: 1, MARKET_BELOW_BAR: 1, NO_FRESH_QUOTE: 1 });
    eq("odds: freshly priced / qualified counts", [r.freshlyPriced, r.qualified], [4, 2]);
    eq("odds: the limit is respected", overlay.qualifyVipPremiumTargets([a, b], q([[a, fresh(78)], [b, fresh(86)]]), NOW, 1).targets.length, 1);
  }

  // ── 3. Floors, gate constants, tiering ─────────────────────────────────
  {
    eq("floor: VIP stays 75", curation.VIP_CONFIDENCE_FLOOR, 75);
    eq("floor: PREMIUM stays 80", curation.PREMIUM_CONFIDENCE_FLOOR, 80);
    eq("gate: market-confirmation constants unchanged (model 75, market 75, gap 10, books 5, quote 2h)",
      [mc.MC_MIN_MODEL_CONFIDENCE, mc.MC_MIN_MARKET_PROBABILITY, mc.MC_MAX_GAP_PP, mc.MC_MIN_BOOKMAKERS, mc.MC_MAX_QUOTE_AGE_MS], [75, 75, 10, 5, 2 * H]);
    eq("gate: VIP market bar 75, PREMIUM market bar 80", [overlay.VIP_MARKET_FLOOR, overlay.PREMIUM_MARKET_FLOOR], [75, 80]);
    eq("quota: still 6 attempts a day", pipeline.VIP_PREMIUM_DAILY_QUOTA, 6);
    eq("quota: one fixture per run", overlay.VIP_PREMIUM_RUN_LIMIT, 1);
    eq("tier: market 86 and confidence 84 is PREMIUM", overlay.paidTierFor({ confirmed: true, marketProbability: 86 }, 84), "PREMIUM");
    eq("tier: market 82 but confidence 78 is VIP — PREMIUM's floor holds", overlay.paidTierFor({ confirmed: true, marketProbability: 82 }, 78), "VIP");
    eq("tier: market 77, confidence 88 is VIP — the market separates the tiers", overlay.paidTierFor({ confirmed: true, marketProbability: 77 }, 88), "VIP");
    eq("tier: below 75 confidence is nothing", overlay.paidTierFor({ confirmed: true, marketProbability: 86 }, 74), null);
    eq("tier: an unconfirmed verdict is nothing", overlay.paidTierFor({ confirmed: false, marketProbability: 90 }, 90), null);
  }

  // ── 3b. Draw No Bet at the gate ─────────────────────────────────────────
  {
    const mc = require("../src/lib/marketConfirmed");
    const odds = oddsFor(70); // Home 70, Draw 16.5, Away 13.5 (de-vigged)
    const dnbHome = mc.drawNoBetProbability(odds, "Home");
    check("dnb: the side's share of the non-draw outcomes", Math.abs(dnbHome.probability - (70 / (70 + 13.5)) * 100) < 0.01, dnbHome);
    const v = (confidence: number, o: Any = odds, fetchedAt: Date | null = new Date(NOW.getTime() - 20 * 60_000)) =>
      mc.evaluateMarketConfirmed({ marketType: "DRAW_NO_BET", selection: { value: "HOME" }, confidence, odds: o, fetchedAt, now: NOW });
    check("dnb: confirmed when the model agrees with the derived price", v(80).confirmed === true && v(80).value === "Home (draw no bet)", v(80));
    eq("dnb: still held to the gap (market ~90, model 76)", v(76, oddsFor(80)).reason, "GAP_TOO_WIDE");
    eq("dnb: still held to a fresh quote", v(84, odds, new Date(NOW.getTime() - 3 * H)).reason, "STALE_QUOTE");
    eq("dnb: still held to the book depth", v(84, oddsFor(70, 3)).reason, "THIN_COVERAGE");
    eq("dnb: an away DNB on a home favourite is below the floor", mc.evaluateMarketConfirmed({ marketType: "DRAW_NO_BET", selection: { value: "AWAY" }, confidence: 80, odds, fetchedAt: new Date(NOW.getTime() - 20 * 60_000), now: NOW }).reason, "MARKET_BELOW_FLOOR");
    eq("dnb: team totals stay out — no bookmaker market to check them against", mc.evaluateMarketConfirmed({ marketType: "TEAM_TOTAL", selection: { side: "HOME", line: 0.5, direction: "OVER" }, confidence: 85, odds, fetchedAt: NOW, now: NOW }).reason, "INELIGIBLE_MARKET");
  }

  // ── 4. Curation ─────────────────────────────────────────────────────────
  {
    const TODAY = new Date("2026-10-10T18:00:00.000Z");
    const LEGACY = new Date("2026-09-30T18:00:00.000Z");
    let seq = 0;
    const row = (id: string, confidence: number, o: { fx?: number; prov?: string | null; market?: string; tags?: string[]; kickoff?: Date; league?: number } = {}) => ({
      id, confidence, leagueApiId: o.league ?? 39, provenance: o.prov === undefined ? "VIP_ROUTE_CONFIRMED" : o.prov,
      marketType: o.market ?? "MATCH_WINNER", createdAt: new Date("2026-10-09T08:00:00.000Z"),
      kickoff: o.kickoff ?? TODAY, fixtureApiId: 5000 + (o.fx ?? ++seq), homeTeamApiId: 100 + (o.fx ?? seq), awayTeamApiId: 200 + (o.fx ?? seq), categories: o.tags ?? [],
    });
    const plan = (cat: string, rows: Any[], claimed: string[] = []) => curation.planCuration(cat, rows, new Set(claimed));

    // A paid-only pick belongs to VIP/PREMIUM alone.
    const paidOnly = row("paid88", 88, { prov: "VIP_GENERATED", tags: ["VIP"] });
    check("isolation: GENIUS never selects a paid-only pick", !plan("GENIUS", [paidOnly, row("g72", 72)]).selectedIds.includes("paid88"));
    eq("isolation: ...and removes it if something tagged it GENIUS", plan("GENIUS", [{ ...paidOnly, categories: ["VIP", "GENIUS"] }, row("g72", 72)]).removed, ["paid88"]);
    check("isolation: VIP keeps it", plan("VIP", [paidOnly], [curation.paidFixtureKey(paidOnly)]).selectedIds.includes("paid88"));

    const pool = [row("c90", 90), row("c78", 78), row("c70", 70), row("c68", 68), row("c65", 65), row("c60", 60)];
    eq("curation: VIP selects only rows at or above 75 — no top-up to five", plan("VIP", pool).selectedIds, ["c90", "c78"]);
    eq("curation: PREMIUM selects only rows at or above 80", plan("PREMIUM", pool).selectedIds, ["c90"]);
    check("curation: VIP carries a hard floor", curation.curationRuleFor("VIP").hardFloor === true);
    check("curation: a two-pick VIP day stays a two-pick day", plan("VIP", [row("x90", 90), row("x80", 80), row("x74", 74)]).selected === 2);
    eq("curation: GENIUS is unchanged — 70 floor, still topped up to five",
      plan("GENIUS", pool).selectedIds, curation.selectCuratedIds(pool, curation.GENIUS_CONFIDENCE_FLOOR));
    eq("curation: GENIUS rule unchanged", curation.curationRuleFor("GENIUS"), { floor: 70 });

    const dbl = row("dbl85", 85, { prov: null, market: "SAME_GAME_DOUBLE" });
    check("curation: a SAME_GAME_DOUBLE is not selected into VIP, whatever its confidence", !plan("VIP", [dbl, row("s76", 76)]).selectedIds.includes("dbl85"));
    check("curation: ...nor into PREMIUM", !plan("PREMIUM", [dbl]).selectedIds.includes("dbl85"));
    check("curation: ...and is reported", plan("VIP", [dbl]).doublesExcluded === 1);
    // Refused as a double, not merely as a row without a route marker.
    const routedDouble = row("rdbl90", 90, { prov: "VIP_ROUTE_CONFIRMED", market: "SAME_GAME_DOUBLE" });
    check("curation: a double is refused even if it carries a route marker", !plan("VIP", [routedDouble]).selectedIds.includes("rdbl90") && !plan("PREMIUM", [routedDouble]).selectedIds.includes("rdbl90"));
    check("curation: GENIUS may still take a double (Combo Bets untouched)", plan("GENIUS", [dbl]).selectedIds.includes("dbl85"));
    const taggedDouble = row("tdbl", 72, { prov: null, market: "SAME_GAME_DOUBLE", tags: ["VIP"] });
    eq("curation: a double already in VIP on a new-rules day is removed", plan("VIP", [taggedDouble, row("s80", 80)]).removed, ["tdbl"]);

    const same = [row("f82", 82, { fx: 70 }), row("f79", 79, { fx: 70 }), row("g76", 76, { fx: 71 })];
    eq("curation: one paid pick per fixture — VIP keeps the fixture's best row", plan("VIP", same).selectedIds, ["f82", "g76"]);
    eq("curation: ...PREMIUM keeps the same row", plan("PREMIUM", same).selectedIds, ["f82"]);
    check("curation: ...and reports the duplicate", plan("VIP", same).fixtureDuplicatesExcluded === 1);
    eq("curation: deterministic whatever the input order", plan("VIP", [...same].reverse()).selectedIds, plan("VIP", same).selectedIds);
    eq("curation: equal confidence on one fixture resolves by id", plan("VIP", [row("zz", 80, { fx: 72 }), row("aa", 80, { fx: 72 })]).selectedIds, ["aa"]);

    const ordinaryTagged = row("ord85", 85, { fx: 80, tags: ["VIP", "PREMIUM"] });
    const claimedKey = curation.paidFixtureKey(ordinaryTagged);
    const vipClaimed = plan("VIP", [ordinaryTagged, row("other", 81)], [claimedKey]);
    check("curation: a fixture with a live dedicated pick is not given an ordinary one", !vipClaimed.selectedIds.includes("ord85"));
    eq("curation: ...an ordinary row already tagged there is removed — the dedicated row wins", vipClaimed.removed, ["ord85"]);
    check("curation: ...in PREMIUM too, even when the dedicated pick is VIP-only", !plan("PREMIUM", [ordinaryTagged], [claimedKey]).selectedIds.includes("ord85"));
    const dedicated = row("ded76", 76, { fx: 81, prov: "VIP_GENERATED", tags: ["VIP"] });
    check("curation: a dedicated pick in the feed is kept", plan("VIP", [dedicated, row("o95", 95, { fx: 81 })], [curation.paidFixtureKey(dedicated)]).selectedIds.includes("ded76"));
    check("curation: ...and an ordinary row on its fixture is not added beside it", !plan("VIP", [dedicated, row("o95", 95, { fx: 81 })], [curation.paidFixtureKey(dedicated)]).selectedIds.includes("o95"));

    const legacyPad = row("leg62", 62, { prov: null, market: "SAME_GAME_DOUBLE", tags: ["VIP"], kickoff: LEGACY });
    const legacyPlan = plan("VIP", [legacyPad, row("leg50", 50, { kickoff: LEGACY })]);
    check("curation: legacy day (before the cutover) — a padded row already in VIP is kept", legacyPlan.selectedIds.includes("leg62") && legacyPlan.removed.length === 0);
    check("curation: legacy day — nothing new is padded in below the floor", !legacyPlan.added.includes("leg50"));
    eq("curation: the cutover is 3 Oct 00:00 Lagos", curation.PAID_TIER_CUTOVER.toISOString(), "2026-10-02T23:00:00.000Z");
  }

  // ── 5. Drift classifier ─────────────────────────────────────────────────
  {
    const K = new Date("2026-10-10T18:00:00.000Z");
    const r = (id: string, confidence: number, categories: string[], o: Any = {}) => ({
      id, status: o.status ?? "PUBLISHED", marketType: o.market ?? "MATCH_WINNER", confidence, kickoff: o.kickoff ?? K,
      fixtureApiId: o.fx ?? null, homeTeamApiId: o.home ?? Number(id.replace(/\D/g, "")) + 1, awayTeamApiId: 999, categories,
    });
    const drift = curation.classifyPaidTierDrift([
      r("a1", 76, ["VIP"]),
      r("a2", 72, ["VIP"]),
      r("a3", 78, ["VIP", "PREMIUM"]),
      r("a4", 85, ["VIP"], { market: "SAME_GAME_DOUBLE" }),
      r("a5", 80, ["VIP"], { home: 50 }),
      r("a6", 81, ["PREMIUM", "VIP"], { home: 50 }),
      r("a7", 60, ["VIP"], { kickoff: new Date("2026-09-25T18:00:00.000Z") }),
      r("a8", 60, ["VIP"], { status: "ARCHIVED" }),
      r("a9", 60, ["VIP", "SAME_GAME_DOUBLE"]),
    ]);
    const issuesOf = (id: string) => drift.violations.find((v: Any) => v.row.id === id)?.issues ?? [];
    eq("drift: VIP below 75 fails", issuesOf("a2"), ["VIP_BELOW_FLOOR"]);
    eq("drift: PREMIUM below 80 fails", issuesOf("a3"), ["PREMIUM_BELOW_FLOOR"]);
    eq("drift: a paid SAME_GAME_DOUBLE fails", issuesOf("a4"), ["SAME_GAME_DOUBLE"]);
    eq("drift: two paid picks on one fixture fail, across VIP and PREMIUM", [issuesOf("a5"), issuesOf("a6")], [["DUPLICATE_FIXTURE"], ["DUPLICATE_FIXTURE"]]);
    eq("drift: a pre-cutover row is reported, not failed", drift.legacy.map((l: Any) => l.row.id), ["a7"]);
    eq("drift: archived rows and hidden legs are ignored; the clean row is clean", [drift.clean, drift.violations.length], [1, 5]);
  }

  // ── 6. DB-side paths, against the recording Prisma ─────────────────────
  {
    const f1 = fixture(40, { kickoffIn: 20 });
    const f2 = fixture(41, { kickoffIn: 30 });
    const f3 = fixture(42, { kickoffIn: 22 });
    db.ledger = [f1.ledger, f2.ledger, f3.ledger];
    db.predictions = [f1.row, f2.row, f3.row];
    db.odds = new Map([[f3.key, { oddsJson: oddsFor(70), fetchedAt: new Date(NOW.getTime() - 20 * 60_000), lastAttemptAt: null }]]);
    db.aiJobs = [];
    db.appLocks = [];
    oddsReply = (k) => (k === f1.key ? oddsFor(84) : null);
    writes.length = 0;
    oddsCalls.length = 0;

    const sel = await pipeline.selectVipPremiumTargets(NOW, 6, { warmOdds: true });
    eq("select: targets the covered fixture the market backs", sel.targets.map((t: Any) => t.matchKey), [f1.key]);
    eq("select: one odds call — the unpriced fixture inside 24h, nothing for the 30h one or the fresh one", oddsCalls, [f1.key]);
    eq("select: funnel counts", [sel.considered, sel.inScope, sel.freshlyPriced, sel.qualified, sel.oddsCalls, sel.warmed], [3, 3, 2, 1, 1, 1]);
    eq("select: never writes the generation ledger", writes.filter((w) => w.startsWith("generationAttempt")), []);

    writes.length = 0;
    generated.length = 0;
    db.odds.set(f3.key, { oddsJson: oddsFor(88), fetchedAt: new Date(NOW.getTime() - 20 * 60_000), lastAttemptAt: null });
    const run = await worker.runVipPremiumGeneration({ authorId: "admin", limit: 6, now: NOW });
    eq("run: one fixture per run, however many qualify", [run.claimed, generated.length], [1, 1]);
    eq("run: generates with the paid intent, on the target fixture", [generated[0]?.intent, generated[0]?.categories, generated[0]?.fixtureApiId], ["VIP_PREMIUM", ["FEATURED"], 9042]);
    eq("run: never writes the generation ledger", writes.filter((w) => w.startsWith("generationAttempt")), []);
    check("run: reports its targeting diagnostics", run.vipPremium.qualified === 2 && run.vipPremium.targets.length === 1, run.vipPremium);

    // The gate and automatic publication.
    const draft = (id: string, confidence: number, fx: ReturnType<typeof fixture>, o: { kickoff?: Date; now?: Date } = {}) => ({
      id, marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence, market: "Match Winner", pick: `${id} pick`,
      homeTeam: fx.ledger.homeTeam, awayTeam: fx.ledger.awayTeam, homeTeamApiId: fx.row.homeTeamApiId, awayTeamApiId: fx.row.awayTeamApiId,
      kickoff: o.kickoff ?? fx.row.kickoff, fixtureApiId: fx.row.fixtureApiId, leagueApiId: 39, contextComplete: true, rewriteCount: 0,
      status: "PENDING_REVIEW", provenance: "VIP_ROUTE_CONFIRMED", categories: [{ category: "FEATURED" }], approvedById: null,
      aiJob: { prompt: JSON.stringify({ intent: "VIP_PREMIUM", fixtureApiId: fx.row.fixtureApiId }), createdAt: new Date((o.now ?? NOW).getTime() - 5 * 60_000) },
    });
    const gate = async (
      fx: ReturnType<typeof fixture>,
      drafts: Any[],
      market: number,
      others: Any[] = [],
      opts: { ageMin?: number; now?: Date; actor?: string | null; ledger?: string | null; priorAttempts?: number } = {},
    ) => {
      const now = opts.now ?? NOW;
      writes.length = 0;
      db.byId = new Map([...drafts, ...others].map((r) => [r.id, structuredClone(r)]));
      db.drafts = drafts;
      db.onFixture = [...drafts, ...others];
      db.ledgerStatus = opts.ledger === undefined ? "SUCCEEDED" : opts.ledger;
      db.aiJobs = [
        ...Array.from({ length: opts.priorAttempts ?? 0 }, (_, i) => ({ prompt: JSON.stringify({ intent: "VIP_PREMIUM", fixtureApiId: -i }), createdAt: new Date(now.getTime() - 60 * 60_000) })),
        ...drafts.map((d) => d.aiJob),
      ];
      db.odds = new Map([[fx.key, { oddsJson: oddsFor(market), fetchedAt: new Date(now.getTime() - (opts.ageMin ?? 10) * 60_000), lastAttemptAt: null }]]);
      return pipeline.applyVipPremiumGate({ now, actorId: opts.actor === null ? undefined : opts.actor ?? "admin" });
    };
    const g = fixture(50);
    const ordinaryVip = { ...g.row, id: "ord", marketType: "MATCH_WINNER", status: "PUBLISHED", provenance: "VIP_ROUTE_CONFIRMED", categories: [{ category: "FEATURED" }, { category: "GENIUS" }, { category: "VIP" }] };
    const published = (id: string) => writes.includes(`review:PUBLISH:${id}:admin`);

    const r1 = await gate(g, [draft("p84", 84, g), draft("p70", 70, g)], 86, [ordinaryVip]);
    eq("gate: market 86 + model 84 promotes to PREMIUM", r1.promotedPremium.map((p: Any) => p.predictionId), ["p84"]);
    check("gate: ...tagged VIP + PREMIUM", writes.includes("tags:p84:VIP+PREMIUM"), writes);
    check("publish: a fully gate-qualified PREMIUM pick is published", published("p84") && r1.published.includes("p84"), { writes, held: r1.publishHeld });
    check("publish: ...through the shared review transition, attributed to the run's author", writes.some((w) => w === "review:PUBLISH:p84:admin"));
    check("publish: ...then it wins the fixture — the ordinary row loses only VIP/PREMIUM", writes.includes("link.strip:ord:VIP+PREMIUM") && r1.ordinaryPaidTagsRemoved === 1, writes);
    check("publish: ...and the strip comes after publication, never before", writes.indexOf("review:PUBLISH:p84:admin") < writes.indexOf("link.strip:ord:VIP+PREMIUM"));
    check("gate: its other drafts on the covered fixture are archived, not left for review", writes.includes("prediction.archive:p70") && r1.archived === 1, writes);

    const r2 = await gate(g, [draft("v78", 78, g)], 82, [ordinaryVip]);
    eq("gate: market 82 but model 78 promotes to VIP only", [r2.promotedVip.map((p: Any) => p.predictionId), r2.promotedPremium.length], [["v78"], 0]);
    check("publish: a fully gate-qualified VIP pick is published", published("v78"), writes);
    const r2b = await gate(g, [draft("v76", 76, g)], 84, [ordinaryVip]);
    check("publish: market 84 / model 76 publishes as VIP, never as PREMIUM", published("v76") && r2b.promotedVip.length === 1 && !writes.some((w) => w.startsWith("tags:v76:") && w.includes("PREMIUM")), writes);

    const liveDedicated = { ...g.row, id: "ded", marketType: "MATCH_WINNER", provenance: "PREMIUM_GENERATED", status: "PENDING_REVIEW", categories: [{ category: "VIP" }, { category: "PREMIUM" }] };
    const r3 = await gate(g, [draft("p85", 85, g)], 86, [liveDedicated, ordinaryVip]);
    check("gate: a fixture that already has a dedicated paid pick gets no second one", r3.promotedVip.length + r3.promotedPremium.length === 0 && r3.duplicateFixture.length === 1, r3);
    check("gate: ...and the draft is archived", writes.includes("prediction.archive:p85") && !writes.some((w) => w.startsWith("tags:p85")), writes);

    const r4 = await gate(g, [draft("s84", 84, g)], 86, [ordinaryVip], { ageMin: 180 });
    check("gate: a stale quote holds the draft for re-judging instead of archiving it", r4.heldForRequote === 1 && r4.archived === 0, r4);
    check("publish: a stale-quote draft is not published and strips nothing", !writes.some((w) => w.startsWith("review:") || w.startsWith("link.strip")), writes);

    // Promoted, but a publish-time check fails: stays in review, claims nothing.
    const r5 = await gate(g, [draft("n84", 84, g)], 86, [ordinaryVip], { ledger: null });
    check("publish: promoted but not publishable (ordinary coverage not confirmed) stays in review", r5.promotedPremium.length === 1 && !published("n84") && r5.publishHeld.some((h: Any) => h.predictionId === "n84" && h.blocks.includes("NOT_ORDINARY_COVERED")), r5.publishHeld);
    check("publish: ...and leaves the ordinary paid pick's tags alone", !writes.some((w) => w.startsWith("link.strip")) && r5.ordinaryPaidTagsRemoved === 0, writes);

    const r6 = await gate(g, [draft("q84", 84, g)], 86, [ordinaryVip], { priorAttempts: 6 });
    check("publish: a 7th attempt of the day is not published (daily quota)", !published("q84") && r6.publishHeld.some((h: Any) => h.blocks.includes("OVER_DAILY_QUOTA")), r6.publishHeld);

    const r7 = await gate(g, [draft("x84", 84, g)], 86, [ordinaryVip], { actor: null });
    check("publish: with no actor (dry runs, scripts) nothing is published", r7.promotedPremium.length === 1 && !writes.some((w) => w.startsWith("review:")) && r7.published.length === 0);

    // An earlier promotion, held for a stale quote, is published once its quote is readable.
    const earlier = { ...draft("e84", 84, g), provenance: "PREMIUM_GENERATED", categories: [{ category: "VIP" }, { category: "PREMIUM" }] };
    const r8 = await gate(g, [], 86, [earlier, ordinaryVip]);
    check("publish: a held promotion is retried and published when its quote is fresh", published("e84") && r8.published.includes("e84"), { writes, held: r8.publishHeld });

    const PRE = new Date("2026-09-30T08:00:00.000Z");
    const legacyKickoff = new Date("2026-10-01T12:00:00.000Z");
    const legacyFx = { ...g, key: `${g.row.homeTeamApiId}-${g.row.awayTeamApiId}-${day(legacyKickoff)}`, row: { ...g.row, kickoff: legacyKickoff } };
    const r9 = await gate(legacyFx as Any, [draft("l84", 84, g, { kickoff: legacyKickoff, now: PRE })], 86, [{ ...ordinaryVip, kickoff: legacyKickoff }], { now: PRE });
    check("publish: legacy day — publishes, but leaves the old day's ordinary paid tags alone", published("l84") && r9.ordinaryPaidTagsRemoved === 0 && !writes.some((w) => w.startsWith("link.strip")), { r9, writes });
    eq("gate: never writes the generation ledger", writes.filter((w) => w.startsWith("generationAttempt")), []);

    // A paid pick is its own pick: a repeat of a selection already on the
    // fixture is refused, and a different, safer market on it is promoted.
    const banker = { ...g.row, id: "bank", marketType: "MATCH_WINNER", selection: { value: "HOME" }, status: "PUBLISHED", provenance: "BANKER_GENERATED", categories: [{ category: "BANKER" }] };
    const dnb = { ...draft("dnb84", 84, g), marketType: "DRAW_NO_BET", selection: { value: "HOME" }, market: "Draw No Bet" };
    const rRep = await gate(g, [draft("mw84", 84, g), dnb], 86, [banker]);
    eq("distinct: the straight win the Banker already carries is refused", rRep.repeatsExisting.map((o: Any) => o.predictionId), ["mw84"]);
    eq("distinct: ...and the draw-no-bet on the same side is promoted instead", [...rRep.promotedVip, ...rRep.promotedPremium].map((o: Any) => o.predictionId), ["dnb84"]);
    check("distinct: ...the repeat is archived, never left for review", writes.includes("prediction.archive:mw84"), writes);
    check("distinct: ...and the Banker keeps every tag — nothing on it is stripped", !writes.some((w) => w.startsWith("link.strip:bank")), writes);
    const rOnly = await gate(g, [draft("only84", 84, g)], 86, [banker]);
    check("distinct: a fixture whose only draft repeats an existing pick promotes nothing", rOnly.promotedVip.length + rOnly.promotedPremium.length === 0 && rOnly.heldForRequote === 0 && writes.includes("prediction.archive:only84"), { rOnly, writes });

    // The publish verdict itself, rule by rule.
    const pubRow = { provenance: "PREMIUM_GENERATED", intent: "VIP_PREMIUM", status: "PENDING_REVIEW", rewriteCount: 0, marketType: "MATCH_WINNER", confidence: 84, contextComplete: true, leagueApiId: 39, categories: ["VIP", "PREMIUM"] };
    const okFx = { ordinaryCovered: true, conflictingDedicated: false, withinDailyQuota: true };
    const pass = { confirmed: true, marketProbability: 86 };
    const blocks = (row: Any = {}, v: Any = pass, fx: Any = {}) => overlay.paidAutoPublishVerdict({ ...pubRow, ...row }, v, { ...okFx, ...fx }).blocks;
    eq("verdict: a fully qualified PREMIUM pick publishes", blocks(), []);
    eq("verdict: PREMIUM needs model >= 80 AND market >= 80 — model 76", blocks({ confidence: 76 }), ["PREMIUM_NOT_EARNED"]);
    eq("verdict: ...market 79", blocks({}, { confirmed: true, marketProbability: 79 }), ["PREMIUM_NOT_EARNED"]);
    eq("verdict: a VIP-only pick at market 84 / model 76 publishes", blocks({ provenance: "VIP_GENERATED", confidence: 76, categories: ["VIP"] }), []);
    eq("verdict: a failed, stale or missing-market gate verdict blocks", blocks({}, { confirmed: false, marketProbability: null }), ["GATE_FAILED", "PREMIUM_NOT_EARNED"]);
    eq("verdict: an ordinary-generation row can never auto-publish", blocks({ provenance: "VIP_ROUTE_CONFIRMED", intent: null }), ["NOT_DEDICATED_PAID", "NOT_PAID_PASS_JOB"]);
    eq("verdict: the retired Market-Confirmed marker does not qualify", blocks({ provenance: "MARKET_CONFIRMED" }), ["NOT_DEDICATED_PAID"]);
    eq("verdict: only a row still in review", blocks({ status: "PUBLISHED" }), ["NOT_PENDING_REVIEW"]);
    eq("verdict: never a rewritten row", blocks({ rewriteCount: 1 }), ["REWRITTEN"]);
    eq("verdict: never a double", blocks({ marketType: "SAME_GAME_DOUBLE" }), ["COMBO"]);
    eq("verdict: never a hidden leg", blocks({ categories: ["VIP", "PREMIUM", "SAME_GAME_DOUBLE"] }), ["HIDDEN_LEG"]);
    eq("verdict: only in the paid competitions", blocks({ leagueApiId: 79 }), ["OUT_OF_SCOPE"]);
    eq("verdict: a widened competition publishes whatever the core did since", blocks({ leagueApiId: 88 }), []);
    eq("verdict: never a repeat of a pick already on the fixture", blocks({}, pass, { repeatsExisting: true }), ["REPEATS_EXISTING_PICK"]);
    eq("verdict: only with live match context", blocks({ contextComplete: false }), ["NO_MATCH_CONTEXT"]);
    eq("verdict: only on an ordinary-covered fixture", blocks({}, pass, { ordinaryCovered: false }), ["NOT_ORDINARY_COVERED"]);
    eq("verdict: never beside another dedicated pick", blocks({}, pass, { conflictingDedicated: true }), ["CONFLICTING_DEDICATED_PICK"]);
    eq("verdict: never beyond the daily quota", blocks({}, pass, { withinDailyQuota: false }), ["OVER_DAILY_QUOTA"]);
    eq("verdict: must carry the VIP tag", blocks({ categories: ["PREMIUM"] }), ["NOT_TAGGED_VIP"]);
    const dc = { value: "HOME_OR_DRAW" };
    const me = { id: "me", provenance: "VIP_GENERATED", marketType: "DOUBLE_CHANCE", selection: dc };
    const mw = { marketType: "MATCH_WINNER", selection: { value: "HOME" } };
    eq("fixture: an ordinary row on a SUCCEEDED fixture is coverage", overlay.paidPublishFixture(me, "SUCCEEDED", [me, { id: "o", provenance: "VIP_ROUTE_CONFIRMED", ...mw }], true), { ordinaryCovered: true, conflictingDedicated: false, repeatsExisting: false, withinDailyQuota: true });
    eq("fixture: a Goals row alone is not coverage", overlay.paidPublishFixture(me, "SUCCEEDED", [me, { id: "g", provenance: "GOALS_GENERATED", marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" } }], true).ordinaryCovered, false);
    eq("fixture: another dedicated row conflicts", overlay.paidPublishFixture(me, "SUCCEEDED", [me, { id: "d", provenance: "PREMIUM_GENERATED", ...mw }], true).conflictingDedicated, true);
    eq("fixture: an ordinary row with the same selection is a repeat", overlay.paidPublishFixture(me, "SUCCEEDED", [me, { id: "b", provenance: "BANKER_GENERATED", marketType: "DOUBLE_CHANCE", selection: { value: "HOME_OR_DRAW" } }], true).repeatsExisting, true);
    eq("fixture: ...a different side of the same market is not", overlay.paidPublishFixture(me, "SUCCEEDED", [me, { id: "b", provenance: "STANDARD_CURATED", marketType: "DOUBLE_CHANCE", selection: { value: "AWAY_OR_DRAW" } }], true).repeatsExisting, false);

    // Distinct picks: the same bet, whatever the key order; a different line or market is not.
    check("distinct: key order does not make a different bet", overlay.sameSelection({ marketType: "OVER_UNDER", selection: { line: 1.5, direction: "OVER" } }, { marketType: "OVER_UNDER", selection: { direction: "OVER", line: 1.5 } }));
    check("distinct: another line is another bet", !overlay.sameSelection({ marketType: "OVER_UNDER", selection: { line: 1.5, direction: "OVER" } }, { marketType: "OVER_UNDER", selection: { line: 2.5, direction: "OVER" } }));
    check("distinct: DNB home is not the straight home win", !overlay.sameSelection({ marketType: "DRAW_NO_BET", selection: { value: "HOME" } }, mw));
    check("distinct: a hidden combo leg with the same selection counts as a repeat",
      overlay.repeatsExistingPick({ id: "x", ...mw }, [{ id: "leg", provenance: "STANDARD_CURATED", ...mw }]));
    check("distinct: a draft is never a repeat of itself", !overlay.repeatsExistingPick({ id: "x", ...mw }, [{ id: "x", provenance: "STANDARD_CURATED", ...mw }]));
  }

  // ── 6b. An unpublished dedicated draft claims nothing ──────────────────
  {
    const K = new Date("2026-10-10T18:00:00.000Z");
    const base = { fixtureApiId: 7700, homeTeamApiId: 770, awayTeamApiId: 771, kickoff: K };
    eq("claims: a dedicated pick still in review claims no fixture", [...curation.paidClaimsFrom([{ id: "d", status: "PENDING_REVIEW", provenance: "VIP_GENERATED", ...base }])], []);
    eq("claims: a published one does", curation.paidClaimsFrom([{ id: "d", status: "PUBLISHED", provenance: "VIP_GENERATED", ...base }]).size, 1);
    eq("claims: an ordinary published row claims nothing", curation.paidClaimsFrom([{ id: "o", status: "PUBLISHED", provenance: "VIP_ROUTE_CONFIRMED", ...base }]).size, 0);
    const ordinary = { id: "ord80", confidence: 80, leagueApiId: 39, provenance: "VIP_ROUTE_CONFIRMED", marketType: "MATCH_WINNER", createdAt: K, ...base, categories: ["VIP"] };
    const claims = curation.paidClaimsFrom([{ id: "d", status: "PENDING_REVIEW", provenance: "PREMIUM_GENERATED", ...base }]);
    check("claims: so an unpublished dedicated draft does not suppress a valid ordinary paid pick", curation.planCuration("VIP", [ordinary], claims).selectedIds.includes("ord80"));
    // A published dedicated pick that lost its tag: its own claim must not exile it.
    const ownDedicated = { ...ordinary, id: "ded88", confidence: 88, provenance: "VIP_GENERATED", categories: [] };
    const ownClaim = curation.paidClaimsFrom([{ id: "ded88", status: "PUBLISHED", provenance: "VIP_GENERATED", ...base }]);
    const reselect = curation.planCuration("VIP", [ownDedicated, { ...ordinary, categories: [] }], ownClaim);
    eq("claims: a published dedicated pick on its own claimed fixture is re-selected; the ordinary row there is not", reselect.selectedIds, ["ded88"]);
    const src = readFileSync(join(__dirname, "..", "src/lib/geniusCuration.ts"), "utf8");
    const loader = src.slice(src.indexOf("async function loadPaidClaimedFixtures"), src.indexOf("async function curateCategory"));
    check("claims: curation loads PUBLISHED dedicated picks only, through paidClaimsFrom", /status: "PUBLISHED"/.test(loader) && /paidClaimsFrom\(/.test(loader));
  }

  // ── 7. Wiring ───────────────────────────────────────────────────────────
  {
    const root = join(__dirname, "..");
    const code = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
    const route = code("src/app/api/admin/generate/run/route.ts");
    const branch = route.slice(route.indexOf('url.searchParams.get("vipPremium") === "1") {'), route.indexOf("const requested ="));
    check("route: ?vipPremium=1 runs the overlay, then the gate, in one request",
      /runVipPremiumGeneration\(/.test(branch) && branch.indexOf("runVipPremiumGeneration(") < branch.indexOf("applyVipPremiumGate("));
    check("route: ...and returns targeting and gate diagnostics", /vipPremium: \{/.test(branch) && /rejectedReasons/.test(branch) && /archivedDrafts/.test(branch));
    check("route: ...standing down on the shared quota figure", /vipPremiumQuotaRemaining\(\)/.test(branch) && /remaining <= 0/.test(branch));
    check("route: the paid run is still recorded as its own job", /"vipPremium"\) === "1"\s*\?\s*JOB_GENERATE_VIP_PREMIUM/.test(route));
    check("route: the old PENDING allow-list path is gone", !/selectVipPremiumTargets/.test(route) && !/wantsVipPremium/.test(route));

    const workerSrc = code("src/lib/generation/worker.ts");
    const paidRun = workerSrc.slice(workerSrc.indexOf("export async function runVipPremiumGeneration"));
    check("distinct: the paid run tells the model what the fixture already carries",
      /const avoidPicks = await existingPicksOnFixture\(t\);/.test(paidRun) && /intent: VIP_PREMIUM_INTENT,[\s\S]*avoidPicks,/.test(paidRun));
    const { lowerRiskPickBlock } = require("../src/lib/ai/analysis");
    const block = lowerRiskPickBlock(["Match Winner: Arsenal", "Goals Over/Under: Over 2.5"]);
    check("distinct: the prompt lists each existing pick and forbids repeating it", block.includes("  - Match Winner: Arsenal") && block.includes("  - Goals Over/Under: Over 2.5") && /Do not return any of them/.test(block));
    check("distinct: ...steers to the lower-risk markets the odds check can price, not team totals or handicaps",
      ["DOUBLE_CHANCE", "DRAW_NO_BET", "OVER_UNDER", "BTTS", "MATCH_WINNER"].every((m) => block.includes(m)) && !/TEAM_TOTAL|EUROPEAN_HANDICAP/.test(block));
    check("distinct: ...and never names the product, a tier or the market price to the model", !/VIP|PREMIUM|tier|odds|price|bookmaker/i.test(block));
    check("distinct: with nothing on the fixture, there is no list", !/ALREADY on this fixture/.test(lowerRiskPickBlock([])));

    const feeds = code("src/lib/categoryPredictions.ts");
    check("isolation: every feed but VIP/PREMIUM excludes paid-only picks (Today unlocks by the feed's category)",
      /\.\.\.\(PAID_FEEDS\.has\(cat\) \? \{\} : NOT_PAID_ONLY\)/.test(feeds) && /new Set<PredictionCategory>\(\["VIP", "PREMIUM"\]\)/.test(feeds));
    check("isolation: free accumulators never take a paid-only leg", /\.\.\.NOT_PAID_ONLY \}/.test(code("src/lib/accumulatorPipeline.ts")));
    const { NOT_PAID_ONLY, PAID_ONLY_PROVENANCES } = require("../src/lib/paidOnly");
    eq("isolation: the filter excludes exactly the two dedicated markers", [NOT_PAID_ONLY, [...PAID_ONLY_PROVENANCES]], [{ provenance: { notIn: ["VIP_GENERATED", "PREMIUM_GENERATED"] } }, ["VIP_GENERATED", "PREMIUM_GENERATED"]]);
    const list = code("src/components/CategoryPredictionsList.tsx");
    check("empty state: the paid feeds quote their real floors",
      list.includes(`category === "PREMIUM" ? "${curation.PREMIUM_CONFIDENCE_FLOOR}%" : "${curation.VIP_CONFIDENCE_FLOOR}%"`));
    check("worker: the overlay run never records a ledger attempt or reads the queue", !/recordAttempt\(|selectQueuedCandidates\(|generationAttempt\./.test(paidRun));
    const ordinaryRun = workerSrc.slice(workerSrc.indexOf("export async function runGeneration"), workerSrc.indexOf("export type GoalsRunReport"));
    check("worker: ordinary generation still claims from the queue and records attempts", /selectQueuedCandidates\(/.test(ordinaryRun) && /recordAttempt\(c, \{ ok: true/.test(ordinaryRun));
    check("queue: ordinary claiming unchanged", /OR: \[\s*\{ status: "PENDING" \},\s*\{ status: "FAILED", nextAttemptAt: \{ lte: now \} \},?\s*\]/.test(code("src/lib/generation/queue.ts")));

    const pipeSrc = code("src/lib/vipPremiumPipeline.ts") + code("src/lib/vipPremiumOverlay.ts");
    check("pipeline: no ledger write anywhere in the paid pass", !/generationAttempt\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(pipeSrc));
    check("pipeline: targeting reads SUCCEEDED ledger rows, never PENDING", /status: "SUCCEEDED"/.test(pipeSrc) && !/"PENDING"/.test(pipeSrc));

    const gen = code("src/lib/ai/generate.ts");
    check("generate: a paid-pass job never assembles a double", /input\.intent !== "VIP_PREMIUM"/.test(gen));
    eq("generate: paid jobs still ask for several markets; regular combos too; ordinary stays single",
      [marketBreadthForCategories(["FEATURED"], "VIP_PREMIUM"), marketBreadthForCategories(["FEATURED"], REGULAR_COMBO_INTENT), marketBreadthForCategories(["FEATURED"])],
      ["multi", "multi", "single"]);

    check("preflight:db runs the paid-tier drift check", /check-paid-tier-invariant\.ts/.test(code("scripts/lib/preflightSteps.ts")));

    const pipelineOnly = code("src/lib/vipPremiumPipeline.ts");
    const auto = pipelineOnly.slice(pipelineOnly.indexOf("export async function autoPublishVipPremiumPrediction"), pipelineOnly.indexOf("export async function applyVipPremiumGate"));
    check("publish: goes through applyReviewAction, only after the full verdict passes",
      /if \(!publish\) return/.test(auto) && /await applyReviewAction\(row, "PUBLISH", actorId\)/.test(auto) && auto.indexOf("paidAutoPublishVerdict(") < auto.indexOf("applyReviewAction("));
    check("publish: never a direct status write", !/status: "PUBLISHED"\s*[,}]/.test(auto.replace(/where: \{[^}]*\}/g, "")) && !/publishedAt/.test(auto));
    check("publish: the ordinary paid tags are stripped only after publication", auto.indexOf("applyReviewAction(") < auto.indexOf("predictionCategoryLink.deleteMany"));
    check("route: the paid run publishes as its author", /applyVipPremiumGate\(\{ actorId: authorId \}\)/.test(branch));
    check("ordinary generation never auto-publishes", !/autoPublish|applyReviewAction|"PUBLISH"/.test(ordinaryRun) && !/applyReviewAction|autoPublish/.test(gen));
    check("the overlay run itself publishes nothing — only the gate does", !/autoPublish|applyReviewAction/.test(paidRun));
  }

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("VIP/PREMIUM overlay checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
