/**
 * Adaptive competition coverage, proved scenario by scenario.
 *
 * WHAT THIS PROTECTS. The scope decision is invisible when it is wrong in the
 * expensive direction: a discovery cycle that scans every fallback league every
 * 15 minutes still returns 200 and still fills the site, and nobody notices
 * until the api-football quota runs out mid-afternoon on a busy Saturday. And
 * when it is wrong in the other direction, the site shows 4 picks on an
 * international-break day while generation reports itself healthy (21 Sept
 * 2026). So each scenario below pins both the scope AND its provider cost.
 *
 * Two layers:
 *   - the pure policy (src/lib/generation/coverage.ts), called directly;
 *   - the real discovery cycle and queue selection (src/lib/generation/queue.ts)
 *     against a stubbed database and a stubbed api-football module, so every
 *     provider call is counted. No network, no database, no quota.
 *
 * Run: npx tsx scripts/check-adaptive-coverage.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let passed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failures++;
  if (!ok) console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  else console.log(`  PASS  ${label}`);
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

type Ledger = { id: string; matchKey: string; fixtureApiId: number | null; leagueApiId: number | null; status: string; kickoff: Date; nextAttemptAt: Date | null; attempts: number; leagueName: string | null; homeTeam: string; awayTeam: string; round: string | null };
type Pred = { fixtureApiId: number | null; homeTeamApiId: number; awayTeamApiId: number; kickoff: Date; leagueApiId: number | null; status: string };

const db = {
  ledger: [] as Ledger[],
  predictions: [] as Pred[],
  odds: [] as Array<{ matchKey: string; bookmakerCount: number | null; fetchedAt: Date | null }>,
  leaseFree: true,
  cursorHolder: "20",
  quotaRemaining: 5_000,
  lastQueuedWhere: null as any,
};
const calls = { byLeague: 0, byDate: 0, dates: [] as string[], resolveSeason: 0 };
let byDatePayload: Record<string, any[] | null> = {};

const inRange = (k: Date, r: any) => (!r?.gt || k > r.gt) && (!r?.lte || k <= r.lte);

const prismaStub = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (values[0] === "generation-discovery-cursor") return Promise.resolve([{ holder: db.cursorHolder }]);
    if (values[0] === "generation-fallback-sweep") return Promise.resolve(db.leaseFree ? [{ holder: values[1] }] : []);
    throw new Error(`unexpected raw query: ${sql.slice(0, 80)}`);
  },
  appLock: { updateMany: () => Promise.resolve({ count: 1 }) },
  generationAttempt: {
    findMany: (args: any) => {
      const w = args.where ?? {};
      // selector ledger lookup: OR by matchKey / fixtureApiId.
      if (w.OR && w.OR[0]?.matchKey?.in) {
        const keys = new Set(w.OR[0].matchKey.in);
        const ids = new Set(w.OR[1]?.fixtureApiId?.in ?? []);
        return Promise.resolve(db.ledger.filter((l) => keys.has(l.matchKey) || (l.fixtureApiId != null && ids.has(l.fixtureApiId))));
      }
      // coverage count.
      if (w.status?.not === "ABANDONED") {
        return Promise.resolve(db.ledger.filter((l) => l.status !== "ABANDONED" && l.leagueApiId != null && inRange(l.kickoff, w.kickoff)));
      }
      // selectQueuedCandidates.
      db.lastQueuedWhere = w;
      return Promise.resolve(
        db.ledger.filter((l) => {
          if (l.kickoff <= w.kickoff.gt) return false;
          if (w.matchKey?.in && !w.matchKey.in.includes(l.matchKey)) return false;
          if (w.leagueApiId?.in && !w.leagueApiId.in.includes(l.leagueApiId)) return false;
          if (w.leagueApiId?.notIn && (l.leagueApiId == null || w.leagueApiId.notIn.includes(l.leagueApiId))) return false;
          return l.status === "PENDING" || (l.status === "FAILED" && l.nextAttemptAt != null && l.nextAttemptAt <= w.kickoff.gt);
        }),
      );
    },
    createMany: (args: any) => {
      let count = 0;
      for (const d of args.data) {
        if (db.ledger.some((l) => l.matchKey === d.matchKey)) continue;
        db.ledger.push({ id: `a${db.ledger.length}`, attempts: 0, nextAttemptAt: d.nextAttemptAt ?? null, ...d });
        count++;
      }
      return Promise.resolve({ count });
    },
    updateMany: () => Promise.resolve({ count: 0 }),
  },
  prediction: {
    findMany: (args: any) => {
      const w = args.where ?? {};
      if (w.status?.not === "ARCHIVED") return Promise.resolve(db.predictions.filter((p) => p.status !== "ARCHIVED" && inRange(p.kickoff, w.kickoff)));
      return Promise.resolve(db.predictions);
    },
  },
  fixtureOddsCache: { findMany: () => Promise.resolve(db.odds) },
};

stub("../src/lib/prisma", { prisma: prismaStub });
stub("../src/lib/football/usage", {
  getUsageSnapshot: () => Promise.resolve({ remaining: db.quotaRemaining }),
  hasBudget: () => Promise.resolve(true),
  recordCall: () => Promise.resolve(),
});
stub("../src/lib/football/api-football", {
  resolveSeason: () => { calls.resolveSeason++; return Promise.resolve(2026); },
  getFixturesByLeague: () => { calls.byLeague++; return Promise.resolve([]); },
  getFixturesByDate: (date: string) => { calls.byDate++; calls.dates.push(date); return Promise.resolve(byDatePayload[date] ?? []); },
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-21T09:00:00Z");
const H = 3_600_000;
let nextId = 1000;

function fixture(leagueApiId: number, opts: { hoursOut?: number; home?: string; away?: string; status?: string; round?: string } = {}) {
  const id = nextId++;
  return {
    fixture: { id, date: new Date(NOW.getTime() + (opts.hoursOut ?? 24) * H).toISOString(), status: { short: opts.status ?? "NS" } },
    league: { id: leagueApiId, name: `League ${leagueApiId}`, round: opts.round ?? "Regular Season - 5" },
    teams: { home: { id: id * 10 + 1, name: opts.home ?? `Home ${id}` }, away: { id: id * 10 + 2, name: opts.away ?? `Away ${id}` } },
  } as any;
}

function ledgerRow(leagueApiId: number, status = "SUCCEEDED", hoursOut = 24): Ledger {
  const id = nextId++;
  const kickoff = new Date(NOW.getTime() + hoursOut * H);
  return {
    id: `l${id}`, matchKey: `${id * 10 + 1}-${id * 10 + 2}-${kickoff.toISOString().slice(0, 10)}`, fixtureApiId: id, leagueApiId,
    status, kickoff, nextAttemptAt: null, attempts: 0, leagueName: null, homeTeam: "H", awayTeam: "A", round: null,
  };
}

function resetWorld() {
  db.ledger = [];
  db.predictions = [];
  db.odds = [];
  db.leaseFree = true;
  db.quotaRemaining = 5_000;
  byDatePayload = {};
  calls.byLeague = 0;
  calls.byDate = 0;
  calls.dates = [];
}

async function main() {
  const leagues = await import("../src/lib/leagues");
  const coverage = await import("../src/lib/generation/coverage");
  const queue = await import("../src/lib/generation/queue");
  const { isReservable } = await import("../src/lib/generation/paidTierGrace");
  const { VIP_PROXY_LEAGUE_IDS, resolveGenerationRisk } = await import("../src/lib/ai/generationRisk");
  const curation = await import("../src/lib/geniusCuration");
  const mc = await import("../src/lib/marketConfirmed");
  const vip = await import("../src/lib/vipPremiumPipeline");
  const { GENERATION_TIERS, LEAGUE_PRIORITY_ORDER, leaguePriorityRank, generationTierOf } = leagues;
  const { COVERAGE_POLICY, decideCoverage, excludedLeagueIds, fallbackQualityGate, planFallback, fillFromTiers, sweepDates, tallySlate, emptyTierCounts } = coverage;

  const CORE = GENERATION_TIERS.CORE as readonly number[];
  const SECONDARY = GENERATION_TIERS.SECONDARY as readonly number[];
  const FALLBACK = GENERATION_TIERS.FALLBACK as readonly number[];
  const DEEP = GENERATION_TIERS.DEEP_FALLBACK as readonly number[];
  const counts = (core: number, secondary: number, fallback = 0, deep = 0) => ({ CORE: core, SECONDARY: secondary, FALLBACK: fallback, DEEP_FALLBACK: deep });

  // A realistic sweep payload: plenty of fallback AND deep fixtures, so any
  // over-selection or tier leak would show.
  const payload = (nFallback: number, nDeep: number) => [
    ...Array.from({ length: nFallback }, (_, i) => fixture(FALLBACK[i % FALLBACK.length], { hoursOut: 20 + (i % 20) })),
    ...Array.from({ length: nDeep }, (_, i) => fixture(DEEP[i % DEEP.length], { hoursOut: 20 + (i % 20) })),
  ];
  const take = (selected: any[][]) => async (rows: any[], need: number) => {
    const picked = rows.slice(0, need);
    selected.push(picked);
    return picked.length;
  };

  console.log("tiers and priority:");
  check("every catalogued league has exactly one generation tier", (() => { try { leagues.assertGenerationTierInvariant(); return true; } catch { return false; } })());
  eq("priority order is CORE, then SECONDARY, then FALLBACK, then DEEP_FALLBACK", LEAGUE_PRIORITY_ORDER, [...CORE, ...SECONDARY, ...FALLBACK, ...DEEP]);
  const maxRank = (ids: readonly number[]) => Math.max(...ids.map((id) => leaguePriorityRank(id)));
  const minRank = (ids: readonly number[]) => Math.min(...ids.map((id) => leaguePriorityRank(id)));
  check("every CORE league outranks every SECONDARY league", maxRank(CORE) < minRank(SECONDARY));
  check("every SECONDARY league outranks every FALLBACK league", maxRank(SECONDARY) < minRank(FALLBACK));
  check("every FALLBACK league outranks every DEEP_FALLBACK league", maxRank(FALLBACK) < minRank(DEEP));
  // The paid-tier set is the first 12 priority entries. It must be exactly the
  // twelve it was before tiers existed, in order, or reservation changes.
  eq("paid-tier (VIP proxy) leagues are unchanged", [...VIP_PROXY_LEAGUE_IDS], [39, 40, 45, 48, 140, 143, 135, 137, 78, 81, 61, 66]);
  check("no fallback league is a display-catalogue removal: every tier league is catalogued", LEAGUE_PRIORITY_ORDER.every((id) => leagues.LEAGUE_CATALOGUE.some((l) => l.id === id)));
  check("base discovery scope is CORE+SECONDARY only", JSON.stringify(queue.BASE_DISCOVERY_LEAGUE_IDS) === JSON.stringify([...CORE, ...SECONDARY]));

  console.log("\nthresholds are named constants:");
  eq("healthy threshold", COVERAGE_POLICY.HEALTHY_MIN, 25);
  eq("deep threshold", COVERAGE_POLICY.THIN_MIN, 12);
  check("targets sit inside the requested bands", COVERAGE_POLICY.FALLBACK_TARGET >= 25 && COVERAGE_POLICY.FALLBACK_TARGET <= 30 && COVERAGE_POLICY.DEEP_TARGET >= 20 && COVERAGE_POLICY.DEEP_TARGET <= 30);

  console.log("\nscenario: 50 CORE/SECONDARY fixtures -> no fallback:");
  const d50 = decideCoverage(counts(35, 15));
  eq("mode CORE (core alone is healthy)", d50.mode, "CORE");
  check("not widened, needs nothing", !d50.widened && d50.need === 0 && d50.target === null);
  eq("only CORE+SECONDARY allowed", d50.allowedTiers, ["CORE", "SECONDARY"]);
  check("every fallback and deep league is excluded from generation", JSON.stringify(excludedLeagueIds(d50)) === JSON.stringify([...FALLBACK, ...DEEP]));
  const plan50 = planFallback(payload(40, 40), d50);
  check("a healthy decision plans zero fallback fixtures even with a full payload", plan50.eligible.FALLBACK.length === 0 && plan50.eligible.DEEP_FALLBACK.length === 0);
  check("narrow reason says so in words", /healthy/.test(d50.reason) && /not scanned or generated/.test(d50.reason), d50.reason);

  console.log("\nscenario: exactly 25 -> no fallback:");
  const d25 = decideCoverage(counts(10, 15));
  eq("mode SECONDARY", d25.mode, "SECONDARY");
  check("not widened at the threshold", !d25.widened && d25.need === 0);
  const d24 = decideCoverage(counts(10, 14));
  check("24 (one below) does widen", d24.widened && d24.mode === "FALLBACK");

  console.log("\nscenario: 18 -> FALLBACK, only enough to fill the target:");
  const d18 = decideCoverage(counts(8, 10));
  eq("mode FALLBACK", d18.mode, "FALLBACK");
  eq("need = target - higher tier", d18.need, COVERAGE_POLICY.FALLBACK_TARGET - 18);
  check("DEEP_FALLBACK is not allowed at 18", !d18.allowedTiers.includes("DEEP_FALLBACK"));
  const plan18 = planFallback(payload(40, 40), d18);
  check("deep fixtures are ignored at 18, not even considered", plan18.eligible.DEEP_FALLBACK.length === 0 && plan18.considered === 40, `considered ${plan18.considered}`);
  const picked18: any[][] = [];
  const fill18 = await fillFromTiers(plan18, d18, take(picked18));
  eq("selects exactly the need, no more", fill18.selected, d18.need);
  check("all selected fixtures are FALLBACK", picked18.flat().every((r) => generationTierOf(r.league.id) === "FALLBACK"));
  const d18b = decideCoverage(counts(8, 10, 6));
  eq("fallback already selected counts toward the target", d18b.need, COVERAGE_POLICY.FALLBACK_TARGET - 18 - 6);
  eq("target already met -> need 0", decideCoverage(counts(8, 10, 12)).need, 0);

  console.log("\nscenario: 4 -> deeper fallback allowed:");
  const d4 = decideCoverage(counts(1, 3));
  eq("mode DEEP_FALLBACK", d4.mode, "DEEP_FALLBACK");
  eq("need = deep target - 4", d4.need, COVERAGE_POLICY.DEEP_TARGET - 4);
  const plan4 = planFallback(payload(5, 40), d4);
  const picked4: any[][] = [];
  const fill4 = await fillFromTiers(plan4, d4, take(picked4));
  eq("FALLBACK is exhausted first (5), DEEP supplies the rest", fill4.byTier, { FALLBACK: 5, DEEP_FALLBACK: d4.need - 5 });
  check("never beyond the slate cap", 4 + fill4.selected <= COVERAGE_POLICY.SLATE_CAP);
  const scarce = await fillFromTiers(planFallback(payload(2, 3), d4), d4, take([]));
  eq("a thin payload is not padded: selects only what exists", scarce.selected, 5);

  console.log("\nscenario: core slate returns next day -> fallback automatically disabled:");
  const tomorrow = decideCoverage(counts(30, 12, 9, 4));
  check("healthy again with fallback rows still in the ledger", !tomorrow.widened && tomorrow.need === 0);
  const excluded = excludedLeagueIds(tomorrow);
  check("yesterday's fallback and deep rows are excluded from ordinary generation", [...FALLBACK, ...DEEP].every((id) => excluded.includes(id)));
  check("no CORE/SECONDARY league is ever excluded", [...CORE, ...SECONDARY].every((id) => !excluded.includes(id)));

  console.log("\nquality gate: weak fallback fixtures cannot bypass it:");
  const fb = FALLBACK.find((id) => generationTierOf(id) === "FALLBACK" && id === 46)!; // EFL Trophy
  eq("a sound fallback fixture passes", fallbackQualityGate(fixture(79)), { ok: true, tier: "FALLBACK" });
  eq("an academy U21 side is refused", fallbackQualityGate(fixture(fb, { away: "Manchester City U21" })), { ok: false, reason: "non_senior_side" });
  eq("a B team is refused", fallbackQualityGate(fixture(141, { home: "Real Sociedad B" })), { ok: false, reason: "non_senior_side" });
  eq("a Jong side is refused", fallbackQualityGate(fixture(89, { home: "Jong Ajax" })), { ok: false, reason: "non_senior_side" });
  eq("a women's side is refused", fallbackQualityGate(fixture(128, { home: "Boca Juniors W" })), { ok: false, reason: "non_senior_side" });
  const badIds = fixture(79); badIds.teams.away.id = badIds.teams.home.id;
  eq("identical team ids are refused", fallbackQualityGate(badIds), { ok: false, reason: "invalid_ids" });
  const noId = fixture(79); noId.fixture.id = 0;
  eq("a missing fixture id is refused", fallbackQualityGate(noId), { ok: false, reason: "invalid_ids" });
  eq("a postponed fixture is refused", fallbackQualityGate(fixture(79, { status: "PST" })), { ok: false, reason: "not_scheduled" });
  eq("an unpriced configured cup is refused", fallbackQualityGate(fixture(359)), { ok: false, reason: "unpriced_cup" });
  eq("bookmakers already answered 'none' -> refused", fallbackQualityGate(fixture(79), { odds: { bookmakerCount: 0, fetchedAt: NOW } }), { ok: false, reason: "no_bookmakers" });
  eq("no odds row yet is not held against it", fallbackQualityGate(fixture(79), { odds: null }).ok, true);
  eq("an uncatalogued league is refused", fallbackQualityGate(fixture(1128)), { ok: false, reason: "unrecognised_competition" });
  eq("the gate is for fallback tiers only (a CORE row is not its business)", fallbackQualityGate(fixture(39)).ok, false);
  const weak = [fixture(46, { away: "Chelsea U21" }), fixture(46, { home: "Arsenal U21" }), fixture(79, { status: "TBD" })];
  const weakPlan = planFallback(weak, d18);
  check("a payload of only weak fixtures yields nothing to generate", weakPlan.eligible.FALLBACK.length === 0);
  eq("and the refusals are counted by reason", weakPlan.rejected, { non_senior_side: 2, not_scheduled: 1 });

  console.log("\nfallback does not alter prediction thresholds or rules:");
  eq("confidence floors unchanged", [curation.GENIUS_CONFIDENCE_FLOOR, curation.VIP_CONFIDENCE_FLOOR, curation.PREMIUM_CONFIDENCE_FLOOR], [70, 75, 80]);
  eq("market-confirmation floors unchanged", [mc.MC_MIN_MODEL_CONFIDENCE, mc.MC_MIN_MARKET_PROBABILITY, mc.MC_MIN_BOOKMAKERS, vip.VIP_MARKET_FLOOR, vip.PREMIUM_MARKET_FLOOR], [75, 75, 5, 75, 80]);
  eq("paid-tier quota unchanged", vip.VIP_PREMIUM_DAILY_QUOTA, 6);
  // A fallback fixture gets the same generation route as any non-top-12
  // league: no special prompt tier, no special calibration.
  const routeOf = (id: number) => JSON.stringify(resolveGenerationRisk(["FEATURED"], id));
  check("FALLBACK fixtures get the same generation route as SECONDARY ones", routeOf(79) === routeOf(88) && routeOf(389) === routeOf(88));
  const coverageSrc = readFileSync(join(__dirname, "..", "src/lib/generation/coverage.ts"), "utf8");
  check("the coverage policy imports nothing from the AI, curation or paid-tier modules", !/from "@\/lib\/(ai\/|geniusCuration|marketConfirmed|vipPremiumPipeline|doublesTargeting|bankerPipeline)/.test(coverageSrc));

  console.log("\ndeterministic ordering within tiers:");
  const mixed = payload(20, 20);
  const shuffled = [...mixed].sort((a, b) => (a.fixture.id * 7919) % 101 - (b.fixture.id * 7919) % 101);
  const ids = (p: ReturnType<typeof planFallback>) => [...p.eligible.FALLBACK, ...p.eligible.DEEP_FALLBACK].map((r) => r.fixture.id);
  eq("the same payload in any order produces the same plan", ids(planFallback(shuffled, d4)), ids(planFallback(mixed, d4)));
  const fbOrder = planFallback(mixed, d4).eligible.FALLBACK;
  check("within FALLBACK, league priority then kickoff", fbOrder.every((r, i) => i === 0 || leaguePriorityRank(fbOrder[i - 1].league.id) < leaguePriorityRank(r.league.id) || (leaguePriorityRank(fbOrder[i - 1].league.id) === leaguePriorityRank(r.league.id) && fbOrder[i - 1].fixture.date <= r.fixture.date)));

  console.log("\nslate counting:");
  const tally = tallySlate([
    { fixtureApiId: 1, matchKey: "a", leagueApiId: 39 },
    { fixtureApiId: 1, matchKey: "a", leagueApiId: 39 }, // same fixture via predictions
    { fixtureApiId: null, matchKey: "b", leagueApiId: 94 },
    { fixtureApiId: 2, matchKey: "c", leagueApiId: 79 },
    { fixtureApiId: 3, matchKey: "d", leagueApiId: 1128 }, // untiered
  ]);
  eq("fixtures count once per tier; untiered leagues ignored", tally, counts(1, 1, 1, 0));

  console.log("\nprovider-call budget:");
  let maxDates = 0;
  for (let h = 0; h < 24; h++) maxDates = Math.max(maxDates, sweepDates(new Date(Date.UTC(2026, 8, 21, h, 30))).length);
  check(`a sweep never needs more than ${COVERAGE_POLICY.SWEEP_MAX_DATES} by-date calls at any hour`, maxDates <= COVERAGE_POLICY.SWEEP_MAX_DATES, `max ${maxDates}`);
  const worstPerDay = (24 * 60 / COVERAGE_POLICY.SWEEP_INTERVAL_MINUTES) * COVERAGE_POLICY.SWEEP_MAX_DATES;
  check(`worst-case sweep cost is bounded at ${worstPerDay} calls/day (lease interval x dates)`, worstPerDay <= 72);
  const perLeagueEquivalent = (FALLBACK.length + DEEP.length) * 96;
  check(`...versus ${perLeagueEquivalent}/day if fallback leagues were scanned per league every 15 minutes`, worstPerDay * 10 < perLeagueEquivalent);

  // ---- The real discovery cycle against stubs ------------------------------

  console.log("\ndiscovery cycle: busy weekend (80 higher-tier fixtures):");
  resetWorld();
  for (let i = 0; i < 80; i++) db.ledger.push(ledgerRow(i % 2 ? CORE[i % CORE.length] : SECONDARY[i % SECONDARY.length]));
  byDatePayload = Object.fromEntries(sweepDates(NOW).map((d) => [d, payload(30, 30)]));
  const busy = await queue.discoverGenerationCandidates({ now: NOW, batchSize: 3 });
  check("healthy mode", !busy.coverage.widened && ["CORE", "SECONDARY"].includes(busy.coverage.mode), busy.coverage.mode);
  eq("zero by-date calls on the busy path", calls.byDate, 0);
  eq("cursor spends exactly its batch (3 per-league calls), as before", calls.byLeague, 3);
  eq("cursor scanned only base-scope leagues", busy.coverage.leaguesScannedByTier.cursor.FALLBACK + busy.coverage.leaguesScannedByTier.cursor.DEEP_FALLBACK, 0);
  eq("no fallback queued", busy.coverage.fallbackSelected, 0);
  check("summary reads as healthy", /healthy/.test(busy.summary) && /no fallback work/.test(busy.summary), busy.summary);
  check("narrow reason recorded, no widened reason", !!busy.coverage.narrowReason && busy.coverage.widenedReason === null);

  console.log("\ndiscovery cycle: thin day (18 higher-tier fixtures):");
  resetWorld();
  for (let i = 0; i < 18; i++) db.ledger.push(ledgerRow(SECONDARY[i % SECONDARY.length]));
  const dates = sweepDates(NOW);
  byDatePayload = Object.fromEntries(dates.map((d, i) => [d, i === 1 ? payload(30, 30) : []]));
  const thin = await queue.discoverGenerationCandidates({ now: NOW, batchSize: 3 });
  eq("mode FALLBACK", thin.coverage.mode, "FALLBACK");
  check(`sweep calls = one per date (${dates.length}), never more`, calls.byDate === dates.length && calls.byDate <= 3, `${calls.byDate}`);
  eq("queued exactly the need", thin.coverage.fallbackSelected, COVERAGE_POLICY.FALLBACK_TARGET - 18);
  check("nothing from DEEP_FALLBACK at 18", !thin.coverage.fallbackSelectedByTier.DEEP_FALLBACK);
  eq("provider calls reported = cursor + sweep", thin.coverage.providerCalls, { cursor: 3, sweep: dates.length, total: 3 + dates.length });
  check("widened reason recorded", !!thin.coverage.widenedReason && thin.coverage.narrowReason === null);
  const queuedFallback = db.ledger.filter((l) => generationTierOf(l.leagueApiId) === "FALLBACK");
  eq("the ledger now holds that many FALLBACK rows", queuedFallback.length, COVERAGE_POLICY.FALLBACK_TARGET - 18);

  console.log("\nnext cycle 15 minutes later: bounded and idempotent:");
  calls.byDate = 0;
  db.leaseFree = false; // the hourly lease is still held
  const again = await queue.discoverGenerationCandidates({ now: new Date(NOW.getTime() + 15 * 60_000), batchSize: 3 });
  eq("no by-date calls while the lease is held", calls.byDate, 0);
  check("the target is now met by what was queued", again.coverage.need === 0, `need ${again.coverage.need}`);
  check("the skip reason is recorded", !!again.coverage.sweep.skippedReason, String(again.coverage.sweep.skippedReason));
  db.leaseFree = true;
  const before = db.ledger.length;
  await queue.discoverGenerationCandidates({ now: new Date(NOW.getTime() + 20 * 60_000), batchSize: 3 });
  eq("even with the lease free, a met target adds nothing (no duplicate rows)", db.ledger.length, before);

  console.log("\nquota headroom stands the sweep down:");
  resetWorld();
  for (let i = 0; i < 4; i++) db.ledger.push(ledgerRow(CORE[i]));
  db.quotaRemaining = COVERAGE_POLICY.SWEEP_MIN_QUOTA_REMAINING - 1;
  const lowQuota = await queue.discoverGenerationCandidates({ now: NOW, batchSize: 3 });
  eq("no by-date calls when the day's budget is low", calls.byDate, 0);
  check("reported as a quota stand-down", /quota/.test(lowQuota.coverage.sweep.skippedReason ?? ""), String(lowQuota.coverage.sweep.skippedReason));

  console.log("\nalready-generated fixtures stay excluded:");
  resetWorld();
  for (let i = 0; i < 4; i++) db.ledger.push(ledgerRow(CORE[i]));
  const done = fixture(79);
  const doneToo = fixture(141);
  db.predictions.push({ fixtureApiId: done.fixture.id, homeTeamApiId: 1, awayTeamApiId: 2, kickoff: new Date(done.fixture.date), leagueApiId: 79, status: "PUBLISHED" });
  db.ledger.push({ ...ledgerRow(141, "ABANDONED"), fixtureApiId: doneToo.fixture.id });
  byDatePayload = { [sweepDates(NOW)[1]]: [done, doneToo, fixture(62)] };
  await queue.discoverGenerationCandidates({ now: NOW, batchSize: 3 });
  check("a fixture with predictions is not re-queued", !db.ledger.some((l) => l.fixtureApiId === done.fixture.id));
  check("an abandoned fixture is not revived", db.ledger.filter((l) => l.fixtureApiId === doneToo.fixture.id).length === 1 && db.ledger.find((l) => l.fixtureApiId === doneToo.fixture.id)!.status === "ABANDONED");
  check("the genuinely new fallback fixture is queued", db.ledger.some((l) => l.leagueApiId === 62));

  console.log("\nworker selection honours the scope:");
  resetWorld();
  const pendingCore = ledgerRow(39, "PENDING");
  const pendingFallback = ledgerRow(79, "PENDING");
  db.ledger.push(pendingCore, pendingFallback);
  const healthyExcluded = excludedLeagueIds(decideCoverage(counts(40, 10)));
  const selected = await queue.selectQueuedCandidates({ now: NOW, limit: 10, excludeLeagueApiIds: healthyExcluded });
  check("a healthy slate: the queued fallback row is not selected", selected.every((c) => c.leagueApiId !== 79) && selected.some((c) => c.leagueApiId === 39));
  const thinExcluded = excludedLeagueIds(decideCoverage(counts(5, 10)));
  const selectedThin = await queue.selectQueuedCandidates({ now: NOW, limit: 10, excludeLeagueApiIds: thinExcluded });
  check("a thin slate: the same fallback row is selectable again", selectedThin.some((c) => c.leagueApiId === 79));
  check("CORE outranks FALLBACK in the queue", selectedThin[0]?.leagueApiId === 39);
  const explicit = await queue.selectQueuedCandidates({ now: NOW, limit: 10, matchKeys: [pendingFallback.matchKey] });
  check("targeted runs (explicit matchKeys) are unaffected by scope", explicit.length === 1);
  const fallbackCandidateKeys = Object.keys(selectedThin.find((c) => c.leagueApiId === 79) ?? {}).sort();
  const coreCandidateKeys = Object.keys(selectedThin.find((c) => c.leagueApiId === 39) ?? {}).sort();
  eq("a fallback candidate carries no extra rule flags (same shape as CORE)", fallbackCandidateKeys, coreCandidateKeys);

  console.log("\npaid-tier reservation is unchanged:");
  const inWindow = new Date(NOW.getTime() + 24 * H);
  check("no FALLBACK or DEEP league is ever reservable", [...FALLBACK, ...DEEP].every((id) => !isReservable({ leagueApiId: id, kickoff: inWindow, isNewToLedger: true }, NOW)));
  check("every paid-tier league still is", VIP_PROXY_LEAGUE_IDS.every((id) => isReservable({ leagueApiId: id, kickoff: inWindow, isNewToLedger: true }, NOW)));
  check("SECONDARY leagues are still not reservable (as before)", SECONDARY.every((id) => !isReservable({ leagueApiId: id, kickoff: inWindow, isNewToLedger: true }, NOW)));

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures) process.exit(1);
  console.log("All adaptive coverage checks passed.");
  void emptyTierCounts;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
