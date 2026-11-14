/**
 * VIP/Premium Sprint 09: spare kickoff-day quota for widened-scope fixtures
 * (PAID_SPARE_QUOTA_WIDENING). Pure rules plus source wiring; no database,
 * no network, no quota.
 *
 *   1. Mode: default shadow, explicit on/off only.
 *   2. Slots: one reserved per attemptable core fixture; nothing below 0.
 *   3. Planning: off and shadow leave candidates and every counter exactly as
 *      before; on admits only widened-scope fixtures on days with spare slots,
 *      and only ones passing every other rule.
 *   4. Qualification: spare targets never exceed a day's slots; the bar is
 *      unchanged; warming prices in-scope candidates first.
 *   5. The audit's bound and the live rule agree.
 *   6. Wiring: shadow makes no odds call; floors, gate and publish scope unchanged.
 *
 * Run: npx tsx scripts/check-paid-spare-quota.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAID_CORE_LEAGUE_IDS, PAID_WIDENED_LEAGUE_IDS, PAID_ANY_LEAGUE_IDS, planVipPremiumCandidates, qualifyVipPremiumTargets, spareQuotaSlotsByDay,
  spareQuotaWideningMode, vipPremiumOddsToWarm, VIP_MARKET_FLOOR, PREMIUM_MARKET_FLOOR, PAID_MAX_MARKET_PROBABILITY,
  type OverlayQuote,
} from "../src/lib/vipPremiumOverlay";
import { MC_MAX_GAP_PP, MC_MIN_BOOKMAKERS, MC_MIN_MODEL_CONFIDENCE } from "../src/lib/marketConfirmed";
import { PREMIUM_CONFIDENCE_FLOOR, VIP_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { lagosDateKey } from "../src/lib/lagosDate";
import { firstPaidLoss, scopeGroup, spareQuotaSlots } from "../src/lib/paidOpportunity";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : ` — got ${JSON.stringify(got)?.slice(0, 300)}`}`);
};

const H = 3_600_000;
const NOW = new Date("2026-11-05T08:00:00.000Z");
const CORE = PAID_CORE_LEAGUE_IDS[0];
const WIDE = PAID_WIDENED_LEAGUE_IDS[0];
const OUTSIDE = 99_999;

function fx(n: number, league: number, kickoffIn: number, opts: { status?: string; provenance?: string | null; context?: boolean } = {}) {
  const kickoff = new Date(NOW.getTime() + kickoffIn * H);
  const home = 1000 + n, away = 2000 + n;
  const key = `${home}-${away}-${kickoff.toISOString().slice(0, 10)}`;
  return {
    key, kickoff, fixtureApiId: 9000 + n,
    ledger: { matchKey: key, fixtureApiId: 9000 + n, leagueApiId: league, leagueName: `L${league}`, homeTeam: `H${n}`, awayTeam: `A${n}`, kickoff, round: null, status: opts.status ?? "SUCCEEDED" },
    row: { id: `o${n}`, fixtureApiId: 9000 + n, homeTeamApiId: home, awayTeamApiId: away, kickoff, status: "PUBLISHED", provenance: opts.provenance === undefined ? "STANDARD_CURATED" : opts.provenance, contextComplete: opts.context ?? true },
  };
}
function oddsFor(home: number, bookmakers = 6) {
  const shares: Record<string, number> = { Home: home / 100, Draw: (1 - home / 100) * 0.55, Away: (1 - home / 100) * 0.45 };
  const price = (s: number) => Number((1 / (s * 1.05)).toFixed(3));
  return { bookmakerCount: bookmakers, update: NOW.toISOString(), markets: [{ market: "Match Winner", selections: ["Home", "Draw", "Away"].map((value) => ({ value, best: price(shares[value]), median: price(shares[value]), bookmakers })) }] };
}
const fresh = (home: number): OverlayQuote => ({ oddsJson: oddsFor(home) as any, fetchedAt: new Date(NOW.getTime() - 10 * 60_000), lastAttemptAt: null });

// ── 1. Mode ──────────────────────────────────────────────────────────────
check("1 default is shadow", spareQuotaWideningMode({}) === "shadow");
check("1 explicit on / off, case and space tolerant", spareQuotaWideningMode({ PAID_SPARE_QUOTA_WIDENING: " ON " }) === "on" && spareQuotaWideningMode({ PAID_SPARE_QUOTA_WIDENING: "off" }) === "off");
check("1 anything else is shadow, never on", ["yes", "true", "1", "enabled", ""].every((v) => spareQuotaWideningMode({ PAID_SPARE_QUOTA_WIDENING: v }) === "shadow"));

// ── 2. Slots ─────────────────────────────────────────────────────────────
{
  const day = lagosDateKey(new Date(NOW.getTime() + 30 * H));
  const core = [fx(1, CORE, 30), fx(2, CORE, 31), fx(3, CORE, 32), fx(4, CORE, 33)];
  const slots = (o: Partial<Parameters<typeof spareQuotaSlotsByDay>[0]> = {}) => spareQuotaSlotsByDay({
    days: [day], coreLedger: core.map((c) => c.ledger), attempted: new Set(), used: new Map(), quota: 8, now: NOW, ...o,
  }).get(day) ?? 0;
  check("2 8 quota - 4 attemptable core = 4", slots() === 4);
  check("2 attempts already used are subtracted", slots({ used: new Map([[day, 3]]) }) === 1);
  check("2 an attempted core fixture is not reserved twice", slots({ used: new Map([[day, 1]]), attempted: new Set([core[0].fixtureApiId]) }) === 4);
  check("2 a core fixture inside 12h of kickoff is no longer reserved", spareQuotaSlotsByDay({ days: [lagosDateKey(new Date(NOW.getTime() + 6 * H))], coreLedger: [fx(5, CORE, 6).ledger], attempted: new Set(), used: new Map(), quota: 8, now: NOW }).get(lagosDateKey(new Date(NOW.getTime() + 6 * H))) === 8);
  check("2 PENDING core rows are reserved too (they may still be covered)", slots({ coreLedger: [...core.map((c) => c.ledger), fx(6, CORE, 34, { status: "PENDING" }).ledger] }) === 3);
  check("2 ABANDONED core rows are not reserved", slots({ coreLedger: [...core.map((c) => c.ledger), fx(7, CORE, 34, { status: "ABANDONED" }).ledger] }) === 4);
  check("2 non-core rows never reserve", slots({ coreLedger: [...core.map((c) => c.ledger), fx(8, WIDE, 34).ledger] }) === 4);
  const busy = Array.from({ length: 8 }, (_, i) => fx(20 + i, CORE, 30 + i * 0.1));
  check("2 a day with 8 attemptable core fixtures has no spare slot (omitted)", !spareQuotaSlotsByDay({ days: [day], coreLedger: busy.map((c) => c.ledger), attempted: new Set(), used: new Map(), quota: 8, now: NOW }).has(day));
  check("2 never negative", !spareQuotaSlotsByDay({ days: [day], coreLedger: busy.map((c) => c.ledger), attempted: new Set(), used: new Map([[day, 8]]), quota: 8, now: NOW }).has(day));
}

// ── 3. Planning ──────────────────────────────────────────────────────────
{
  // A healthy window: 4 core fixtures, so paidScopeFor does not widen.
  const core = [fx(1, CORE, 20), fx(2, CORE, 21), fx(3, CORE, 22), fx(4, CORE, 23)];
  const wide = fx(10, WIDE, 22);
  const outside = fx(11, OUTSIDE, 22);
  const wideNoSlot = fx(12, WIDE, 40);
  const all = [...core, wide, outside, wideNoSlot];
  const slots = new Map([[lagosDateKey(wide.kickoff), 2]]);
  const run = (spare?: any, extra: any = {}) => planVipPremiumCandidates({ ledger: all.map((f) => f.ledger), rows: all.map((f) => f.row), attempts: extra.attempts ?? [], now: NOW, ...(spare ? { spareQuota: spare } : {}) });
  const before = run();
  check("3 precondition: the window is healthy (not widened)", before.widened === false, before);
  check("3 precondition: today the widened fixture is OUT_OF_SCOPE", !before.candidates.some((c) => c.matchKey === wide.key) && (before.skipped.OUT_OF_SCOPE ?? 0) === 3);
  const off = run({ mode: "off", slots });
  check("3 off: candidates and counters identical to before", JSON.stringify(off.candidates) === JSON.stringify(before.candidates) && JSON.stringify(off.skipped) === JSON.stringify(before.skipped) && off.spareQuota === undefined);
  const shadow = run({ mode: "shadow", slots });
  check("3 shadow: live candidates identical to before", JSON.stringify(shadow.candidates) === JSON.stringify(before.candidates));
  check("3 shadow: every counter identical to before", JSON.stringify(shadow.skipped) === JSON.stringify(before.skipped), shadow.skipped);
  check("3 shadow: records the widened fixture as spare-eligible", shadow.spareQuota?.mode === "shadow" && shadow.spareQuota.eligible.map((c) => c.matchKey).join() === wide.key);
  const on = run({ mode: "on", slots });
  const admitted = on.candidates.find((c) => c.matchKey === wide.key);
  check("3 on: the widened fixture becomes a candidate, flagged viaSpareQuota", !!admitted && admitted.viaSpareQuota === true);
  check("3 on: core candidates are unchanged", JSON.stringify(on.candidates.filter((c) => !c.viaSpareQuota)) === JSON.stringify(before.candidates));
  check("3 on: a non-paid-scope competition is never admitted", !on.candidates.some((c) => c.matchKey === outside.key) && !on.spareQuota!.eligible.some((c) => c.matchKey === outside.key));
  check("3 on: a widened fixture on a day without spare slots is not admitted", !on.candidates.some((c) => c.matchKey === wideNoSlot.key));
  const attempted = run({ mode: "on", slots }, { attempts: [{ fixtureApiId: wide.fixtureApiId, createdAt: NOW, kickoff: wide.kickoff }] });
  check("3 on: an already-attempted widened fixture is not admitted", !attempted.candidates.some((c) => c.matchKey === wide.key));
  const dedicated = { ...wide.row, id: "d1", provenance: "VIP_GENERATED" };
  const withDedicated = planVipPremiumCandidates({ ledger: all.map((f) => f.ledger), rows: [...all.map((f) => f.row), dedicated], attempts: [], now: NOW, spareQuota: { mode: "on", slots } });
  check("3 on: a fixture already carrying a dedicated pick is not admitted", !withDedicated.candidates.some((c) => c.matchKey === wide.key));
  const noContext = fx(13, WIDE, 22, { context: false });
  const nc = planVipPremiumCandidates({ ledger: [...all, noContext].map((f) => f.ledger), rows: [...all, noContext].map((f) => f.row), attempts: [], now: NOW, spareQuota: { mode: "on", slots } });
  check("3 on: no match context, not admitted", !nc.candidates.some((c) => c.matchKey === noContext.key));
  const thin = [fx(1, CORE, 20), wide];
  const thinPlan = planVipPremiumCandidates({ ledger: thin.map((f) => f.ledger), rows: thin.map((f) => f.row), attempts: [], now: NOW, spareQuota: { mode: "on", slots } });
  check("3 on a thin window the existing widening admits it, not the spare rule", thinPlan.widened && thinPlan.candidates.some((c) => c.matchKey === wide.key && !c.viaSpareQuota));
}

// ── 4. Qualification and warming ─────────────────────────────────────────
{
  const day = lagosDateKey(new Date(NOW.getTime() + 22 * H));
  const w1 = fx(30, WIDE, 22), w2 = fx(31, WIDE, 22.5), w3 = fx(32, WIDE, 23), c1 = fx(33, CORE, 21);
  const cand = (f: ReturnType<typeof fx>, spare: boolean) => ({ matchKey: f.key, fixtureApiId: f.fixtureApiId, leagueApiId: f.ledger.leagueApiId, leagueName: null, homeTeam: "H", awayTeam: "A", homeTeamApiId: 1, awayTeamApiId: 2, kickoff: f.kickoff, round: null, ...(spare ? { viaSpareQuota: true as const } : {}) });
  const cands = [cand(c1, false), cand(w1, true), cand(w2, true), cand(w3, true)];
  const quotes = new Map(cands.map((c) => [c.matchKey, fresh(80)]));
  const q = qualifyVipPremiumTargets(cands, quotes, NOW, 10, { used: new Map(), quota: 8 }, new Map([[day, 2]]));
  check("4 spare targets per day are capped by the day's slots", q.targets.filter((t) => t.viaSpareQuota).length === 2 && q.targets.some((t) => t.matchKey === c1.key), q.targets.map((t) => t.matchKey));
  const none = qualifyVipPremiumTargets(cands, quotes, NOW, 10, { used: new Map(), quota: 8 });
  check("4 without slots no spare target qualifies", none.targets.every((t) => !t.viaSpareQuota));
  const below = qualifyVipPremiumTargets([cand(w1, true)], new Map([[w1.key, fresh(60)]]), NOW, 10, { used: new Map(), quota: 8 }, new Map([[day, 2]]));
  check("4 the market bar is unchanged for spare targets", below.targets.length === 0 && (below.skipped.MARKET_BELOW_BAR ?? 0) === 1);
  const stale = qualifyVipPremiumTargets([cand(w1, true)], new Map([[w1.key, { ...fresh(80), fetchedAt: new Date(NOW.getTime() - 3 * H) }]]), NOW, 10, { used: new Map(), quota: 8 }, new Map([[day, 2]]));
  check("4 a stale quote still disqualifies a spare target", stale.targets.length === 0 && (stale.skipped.NO_FRESH_QUOTE ?? 0) === 1);
  const spent = qualifyVipPremiumTargets([cand(w1, true)], quotes, NOW, 10, { used: new Map([[day, 8]]), quota: 8 }, new Map([[day, 2]]));
  check("4 the kickoff-day quota still binds", spent.targets.length === 0);
  const warm = vipPremiumOddsToWarm([cand(w1, true), cand(c1, false)], new Map(), NOW, 1);
  check("4 warming prices in-scope candidates before spare ones", warm.length === 1 && warm[0].matchKey === c1.key);
}

// ── 5. Audit bound and live rule agree ───────────────────────────────────
{
  // 6 Nov 2026 as measured: 6 core covered, 2 attempts, 4 core never attempted, 5 widened lopsided out of scope.
  check("5 audit bound for 6 Nov: 2 slots", spareQuotaSlots({ quota: 8, attemptsUsed: 2, coreUnattempted: 4, widenedLopsidedOutOfScope: 5 }) === 2);
  const day = lagosDateKey(new Date(NOW.getTime() + 30 * H));
  const core = Array.from({ length: 4 }, (_, i) => fx(40 + i, CORE, 30 + i));
  const live = spareQuotaSlotsByDay({ days: [day], coreLedger: core.map((c) => c.ledger), attempted: new Set(), used: new Map([[day, 2]]), quota: 8, now: NOW }).get(day);
  check("5 live rule gives the same 2 slots for the same day", live === 2, live);
}

// ── 6. Wiring and invariants ─────────────────────────────────────────────
{
  const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  const pipe = src("src/lib/vipPremiumPipeline.ts");
  const shadowBranch = pipe.slice(pipe.indexOf("let spareQuota: TargetSelection"), pipe.indexOf("return {", pipe.indexOf("let spareQuota: TargetSelection")));
  check("6 the shadow record reads cached quotes only (no refreshOddsCache)", shadowBranch.length > 0 && !/refreshOddsCache/.test(shadowBranch) && /readQuotes/.test(shadowBranch));
  check("6 warming still receives only plan.candidates (shadow-eligible fixtures are never priced)", /vipPremiumOddsToWarm\(plan\.candidates,/.test(pipe));
  check("6 the verification path (anyLeague) turns the rule off", /options\.anyLeague \? "off" : spareQuotaWideningMode\(\)/.test(pipe));
  check("6 floors unchanged", VIP_CONFIDENCE_FLOOR === 75 && PREMIUM_CONFIDENCE_FLOOR === 80 && MC_MIN_MODEL_CONFIDENCE === 75);
  check("6 gate unchanged", VIP_MARKET_FLOOR === 75 && PREMIUM_MARKET_FLOOR === 80 && MC_MAX_GAP_PP === 10 && MC_MIN_BOOKMAKERS === 5 && Math.abs(PAID_MAX_MARKET_PROBABILITY - 100 / 1.15) < 1e-9);
  check("6 every admitted competition can already be auto-published (PAID_ANY scope)", PAID_WIDENED_LEAGUE_IDS.every((id) => PAID_ANY_LEAGUE_IDS.includes(id)));
  check("6 no env or workflow file turns the rule on", !/PAID_SPARE_QUOTA_WIDENING\s*[:=]\s*"?on/i.test(src(".github/workflows/deploy-vps.yml") + (() => { try { return src(".env.example"); } catch { return ""; } })()));
  check("6 the daily spend cap is untouched", /export const VIP_PREMIUM_DAILY_SPEND_CAP = 12;/.test(pipe) && /export const VIP_PREMIUM_DAILY_QUOTA = 8;/.test(pipe));
  const overlaySrc = src("src/lib/vipPremiumOverlay.ts");
  check("6 auto-publish scope check unchanged (PAID_ANY)", /if \(!PAID_ANY_LEAGUE_IDS\.includes\(row\.leagueApiId \?\? -1\)\) blocks\.push\("OUT_OF_SCOPE"\);/.test(overlaySrc));
}

// ── 7. Audit classification ──────────────────────────────────────────────
{
  const base = { vip: false, group: "PAID_CORE" as const, everInScope: null, attempted: false, draftMaxConf: null, promoted: false, closingHeadline: 80 };
  check("7 VIP first", firstPaidLoss({ ...base, vip: true, group: "OUTSIDE" }) === "VIP");
  check("7 outside paid scope", firstPaidLoss({ ...base, group: "OUTSIDE" }) === "OUTSIDE_PAID_SCOPE");
  check("7 attempted, every draft < 75", firstPaidLoss({ ...base, attempted: true, draftMaxConf: 72 }) === "MODEL_BELOW_FLOOR");
  check("7 attempted, a draft >= 75 failed the gate", firstPaidLoss({ ...base, attempted: true, draftMaxConf: 78 }) === "GATE_REJECTED");
  check("7 widened, never in scope", firstPaidLoss({ ...base, group: "PAID_WIDENED", everInScope: false }) === "WIDENED_SCOPE_HEALTHY_DAY");
  check("7 not lopsided at close", firstPaidLoss({ ...base, closingHeadline: 70 }) === "MARKET_BELOW_BAR");
  check("7 lopsided, in scope, never attempted", firstPaidLoss(base) === "NOT_ATTEMPTED_IN_SCOPE");
  check("7 scope groups", scopeGroup(CORE) === "PAID_CORE" && scopeGroup(WIDE) === "PAID_WIDENED" && scopeGroup(OUTSIDE) === "OUTSIDE" && scopeGroup(null) === "OUTSIDE");
}

// ── 8. Reservation edge cases (Phase 0 of Sprint 10) ─────────────────────
{
  const at = (iso: string) => new Date(iso);
  const now = at("2026-11-05T08:00:00Z");
  const row = (id: number | null, kickoff: string, status = "SUCCEEDED") => ({ fixtureApiId: id, leagueApiId: CORE, kickoff: at(kickoff), status });
  const slots = (rows: ReturnType<typeof row>[], days: string[], used = new Map<string, number>(), attempted = new Set<number>()) =>
    spareQuotaSlotsByDay({ days, coreLedger: rows, attempted, used, quota: 8, now });
  check("8 a repeated ledger row for one fixture is reserved once", slots([row(1, "2026-11-06T15:00:00Z"), row(1, "2026-11-06T15:00:00Z")], ["2026-11-06"]).get("2026-11-06") === 7);
  check("8 a rescheduled fixture reserves only its latest kickoff day", (() => { const m = slots([row(2, "2026-11-06T15:00:00Z"), row(2, "2026-11-07T15:00:00Z")], ["2026-11-06", "2026-11-07"]); return m.get("2026-11-06") === 8 && m.get("2026-11-07") === 7; })());
  check("8 rows without a provider id are each reserved (conservative)", slots([row(null, "2026-11-06T15:00:00Z"), row(null, "2026-11-06T16:00:00Z")], ["2026-11-06"]).get("2026-11-06") === 6);
  check("8 a 23:30 UTC kickoff counts on the next Lagos day", (() => { const m = slots([row(3, "2026-11-06T23:30:00Z")], ["2026-11-06", "2026-11-07"]); return m.get("2026-11-06") === 8 && m.get("2026-11-07") === 7; })());
  check("8 exactly 12h before kickoff is still attemptable, so reserved", slots([row(4, "2026-11-05T20:00:00Z")], ["2026-11-05"]).get("2026-11-05") === 7);
  check("8 one minute inside 12h is no longer reserved", slots([row(5, "2026-11-05T19:59:00Z")], ["2026-11-05"]).get("2026-11-05") === 8);
  check("8 PENDING and FAILED rows are reserved, ABANDONED are not", slots([row(6, "2026-11-06T15:00:00Z", "PENDING"), row(7, "2026-11-06T16:00:00Z", "FAILED"), row(8, "2026-11-06T17:00:00Z", "ABANDONED")], ["2026-11-06"]).get("2026-11-06") === 6);
  check("8 an attempt on a reserved fixture is counted once (in used, not reserved)", slots([row(9, "2026-11-06T15:00:00Z")], ["2026-11-06"], new Map([["2026-11-06", 1]]), new Set([9])).get("2026-11-06") === 7);
  check("8 limitation pinned: a core fixture not yet in the ledger is not reserved", slots([], ["2026-11-06"]).get("2026-11-06") === 8);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exitCode = 1;
