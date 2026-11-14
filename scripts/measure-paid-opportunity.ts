/**
 * VIP/Premium Sprint 09: where the football calendar is lost on the way to the
 * paid feeds. Unique fixtures throughout; job observations are only ever used
 * for what a run DECIDED at the time (its recorded scope), never as counts.
 *
 *   A. Calendar by generation tier and paid scope group.
 *   B. Confidence of ordinary published singles by provider and scope group.
 *   C. Dedicated pass conversion: attempts -> drafts -> promotions, by scope
 *      group, target-market band and draft market.
 *   D. Scope decisions as recorded: for every covered widened-scope fixture,
 *      how many dedicated runs had it in their 12-48h window, and how many of
 *      those runs were widened. A kickoff day with fewer than PAID_THIN_CORE_MIN
 *      covered core fixtures whose widened-scope fixtures were never in scope is
 *      reported as WINDOW_SCOPE_MISS.
 *   E. Kickoff-day quota: days the quota was spent, and lopsided covered core
 *      fixtures left unattempted on those days.
 *   F. Dry days (<= 2 VIP fixtures): the day reconstructed.
 *
 * "Lopsided" uses the fixture's last PRE-KICKOFF quote (closing reference),
 * labelled as such: it says the market finally priced the fixture there, not
 * that the pass could have read it 12-24h out.
 *
 * READ-ONLY. Run: npx tsx --env-file=.env scripts/measure-paid-opportunity.ts [days=30]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { lopsidednessSignal } from "../src/lib/marketConfirmed";
import { generationTierOf } from "../src/lib/leagues";
import { providerOf } from "../src/lib/calibration";
import { JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import {
  PAID_CORE_LEAGUE_IDS, PAID_WIDENED_LEAGUE_IDS, PAID_THIN_CORE_MIN, VIP_PREMIUM_INTENT, readVipPremiumAttempt, attemptKickoffDay,
} from "../src/lib/vipPremiumOverlay";
import { VIP_PREMIUM_DAILY_QUOTA } from "../src/lib/vipPremiumPipeline";
import { DEDICATED_PAID_PROVENANCES, VIP_ROUTE_PROVENANCE } from "../src/lib/geniusCuration";
import { GENERATE_FROM_HOURS, GENERATE_UNTIL_HOURS } from "../src/lib/generation/window";
import { kickoffDayScope, scopeGroup, type ScopeGroup } from "../src/lib/paidOpportunity";

const H = 3_600_000;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "—");

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(60, Math.max(7, Number(process.argv[2]) || 30));
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  console.log(`window: kickoffs ${from.toISOString().slice(0, 10)} .. ${now.toISOString().slice(0, 16)} (settled past only)`);

  const ledger = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: from, lt: now } },
    select: { matchKey: true, fixtureApiId: true, leagueApiId: true, leagueName: true, kickoff: true, status: true, createdAt: true },
  });
  const preds = await prisma.prediction.findMany({
    where: { kickoff: { gte: from, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, status: true, kickoff: true, leagueApiId: true, leagueName: true, homeTeamApiId: true, awayTeamApiId: true, fixtureApiId: true,
      marketType: true, confidence: true, provenance: true, createdAt: true, aiJobId: true, outcome: true,
      categories: { select: { category: true } }, aiJob: { select: { prompt: true, model: true } },
    },
    take: 60_000,
  });
  const keys = [...new Set([...ledger.map((l) => l.matchKey), ...preds.map((p) => matchKey(p)).filter((k): k is string => !!k)])];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }

  type Fx = {
    key: string; fixtureApiId: number | null; league: number | null; leagueName: string; kickoff: Date; day: string; group: ScopeGroup; tier: string;
    discovered: boolean; succeeded: boolean; ledgerCreated: Date | null; firstOrdinaryAt: Date | null;
    ordinaryPublished: number; maxOrdinaryConf: number | null; route75: boolean;
    closingHeadline: number | null; priced5: boolean;
    attempted: boolean; drafts: number; draftMaxConf: number | null; promoted: boolean;
    vip: boolean; vipDedicated: boolean; premium: boolean;
  };
  const fx = new Map<string, Fx>();
  const get = (key: string, kickoff: Date, league: number | null, name: string | null, fixtureApiId: number | null) => {
    let x = fx.get(key);
    if (!x) {
      const q = quotes.get(key);
      const pre = !!q?.fetchedAt && q.fetchedAt < kickoff;
      const sig = pre ? lopsidednessSignal(q!.oddsJson) : null;
      x = {
        key, fixtureApiId, league, leagueName: name ?? String(league), kickoff, day: lagosDateKey(kickoff), group: scopeGroup(league), tier: generationTierOf(league) ?? "UNCATALOGUED",
        discovered: false, succeeded: false, ledgerCreated: null, firstOrdinaryAt: null, ordinaryPublished: 0, maxOrdinaryConf: null, route75: false,
        closingHeadline: sig?.probability ?? null, priced5: !!sig,
        attempted: false, drafts: 0, draftMaxConf: null, promoted: false, vip: false, vipDedicated: false, premium: false,
      };
      fx.set(key, x);
    }
    if (fixtureApiId != null) x.fixtureApiId ??= fixtureApiId;
    if (name && x.leagueName === String(league)) x.leagueName = name;
    return x;
  };
  for (const l of ledger) {
    const x = get(l.matchKey, l.kickoff, l.leagueApiId, l.leagueName, l.fixtureApiId);
    x.discovered = true; x.ledgerCreated = l.createdAt; if (l.status === "SUCCEEDED") x.succeeded = true;
  }
  const byProvider = new Map<string, { n: number; at75: number }>();
  const draftMarkets: Record<string, { drafts: number; below75: number; promoted: number }> = {};
  const dedicatedJobIds = new Set<string>();
  for (const p of preds) {
    const key = matchKey(p);
    if (!key || !p.kickoff) continue;
    const x = get(key, p.kickoff, p.leagueApiId, p.leagueName, p.fixtureApiId);
    const intent = (() => { try { return JSON.parse(p.aiJob?.prompt ?? "null")?.intent ?? null; } catch { return null; } })();
    const cats = p.categories.map((c) => c.category);
    const dedicated = (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "");
    if (intent === VIP_PREMIUM_INTENT) {
      x.attempted = true; x.drafts++; x.draftMaxConf = Math.max(x.draftMaxConf ?? 0, p.confidence);
      if (p.aiJobId) dedicatedJobIds.add(p.aiJobId);
      const m = (draftMarkets[p.marketType] ??= { drafts: 0, below75: 0, promoted: 0 });
      m.drafts++; if (p.confidence < 75) m.below75++; if (dedicated) m.promoted++;
      if (dedicated) x.promoted = true;
    } else if (!dedicated && p.provenance !== "GOALS_GENERATED") {
      if (!x.firstOrdinaryAt || p.createdAt < x.firstOrdinaryAt) x.firstOrdinaryAt = p.createdAt;
      if (p.status === "PUBLISHED" && !cats.includes("SAME_GAME_DOUBLE")) {
        x.ordinaryPublished++;
        x.maxOrdinaryConf = Math.max(x.maxOrdinaryConf ?? 0, p.confidence);
        if (p.provenance === VIP_ROUTE_PROVENANCE && p.confidence >= 75) x.route75 = true;
        const prov = `${providerOf(p.aiJob?.model) ?? "unknown"}|${x.group}`;
        const e = byProvider.get(prov) ?? { n: 0, at75: 0 };
        e.n++; if (p.confidence >= 75) e.at75++;
        byProvider.set(prov, e);
      }
    }
    if (p.status === "PUBLISHED" && !cats.includes("SAME_GAME_DOUBLE")) {
      if (cats.includes("VIP")) { x.vip = true; if (dedicated) x.vipDedicated = true; }
      if (cats.includes("PREMIUM")) x.premium = true;
    }
  }
  const all = [...fx.values()];

  // ── A ────────────────────────────────────────────────────────────────────
  console.log("\n== A. Calendar by generation tier / paid scope group (unique fixtures, kicked off in window) ==");
  console.log("  group        tier            disc  succ  ordPub  best>=75  route75  priced5  lopsided>=75(closing)  attempted  promoted  VIP  PREMIUM");
  const groups = new Map<string, Fx[]>();
  for (const x of all) groups.set(`${x.group}|${x.tier}`, [...(groups.get(`${x.group}|${x.tier}`) ?? []), x]);
  for (const [k, xs] of [...groups.entries()].sort()) {
    const [g, t] = k.split("|");
    const c = (f: (x: Fx) => boolean) => String(xs.filter(f).length).padStart(5);
    console.log(`  ${g.padEnd(12)} ${t.padEnd(14)} ${c((x) => x.discovered)} ${c((x) => x.succeeded)} ${c((x) => x.ordinaryPublished > 0).padStart(7)} ${c((x) => (x.maxOrdinaryConf ?? 0) >= 75).padStart(9)} ${c((x) => x.route75).padStart(8)} ${c((x) => x.priced5).padStart(8)} ${c((x) => (x.closingHeadline ?? 0) >= 75).padStart(21)} ${c((x) => x.attempted).padStart(10)} ${c((x) => x.promoted).padStart(9)} ${c((x) => x.vip).padStart(4)} ${c((x) => x.premium).padStart(8)}`);
  }

  // ── B ────────────────────────────────────────────────────────────────────
  console.log("\n== B. Ordinary published singles at confidence >= 75, by provider and scope group ==");
  for (const [k, e] of [...byProvider.entries()].sort()) console.log(`  ${k.padEnd(28)} singles ${String(e.n).padStart(5)}  >=75 ${String(e.at75).padStart(4)} (${pct(e.at75, e.n)})`);

  // ── C ────────────────────────────────────────────────────────────────────
  console.log("\n== C. Dedicated pass conversion (unique fixtures attempted, kicked off in window) ==");
  const att = all.filter((x) => x.attempted);
  for (const g of ["PAID_CORE", "PAID_WIDENED", "OUTSIDE"] as const) {
    const xs = att.filter((x) => x.group === g);
    console.log(`  ${g.padEnd(12)} attempted ${String(xs.length).padStart(4)} any draft >=75 ${String(xs.filter((x) => (x.draftMaxConf ?? 0) >= 75).length).padStart(4)} promoted ${String(xs.filter((x) => x.promoted).length).padStart(4)} (${pct(xs.filter((x) => x.promoted).length, xs.length)})`);
  }
  const band = (p: number | null) => (p == null ? "unpriced" : p < 75 ? "<75" : p < 80 ? "75-79" : p < 87 ? "80-86" : p < 92 ? "87-91" : ">=92");
  const bands = new Map<string, Fx[]>();
  for (const x of att) bands.set(band(x.closingHeadline), [...(bands.get(band(x.closingHeadline)) ?? []), x]);
  for (const [b, xs] of [...bands.entries()].sort()) console.log(`  closing headline ${b.padEnd(9)} attempted ${String(xs.length).padStart(4)} draft>=75 ${String(xs.filter((x) => (x.draftMaxConf ?? 0) >= 75).length).padStart(4)} promoted ${String(xs.filter((x) => x.promoted).length).padStart(4)} (${pct(xs.filter((x) => x.promoted).length, xs.length)})`);
  console.log(`  draft market types: ${Object.entries(draftMarkets).map(([m, e]) => `${m} drafts ${e.drafts} <75 ${e.below75} promoted ${e.promoted}`).join(" | ")}`);

  // ── D. Scope decisions as recorded ──────────────────────────────────────
  console.log("\n== D. Dedicated scope as each run recorded it (widened flag), for covered widened-scope fixtures ==");
  const runs = await prisma.jobRun.findMany({
    where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: new Date(from.getTime() - 2 * 86_400_000), lt: now } },
    select: { ranAt: true, detail: true },
    orderBy: { ranAt: "asc" },
  });
  const scoped = runs.map((r) => ({ at: r.ranAt, widened: (r.detail as any)?.vipPremium?.widened as boolean | undefined, core: (r.detail as any)?.vipPremium?.coreFixtures as number | undefined }))
    .filter((r) => typeof r.widened === "boolean");
  console.log(`  dedicated runs ${runs.length}; with a recorded scope decision ${scoped.length} (stand-downs record none)`);
  const coreByDay = new Map<string, number>();
  for (const x of all) if (x.succeeded && x.group === "PAID_CORE") coreByDay.set(x.day, (coreByDay.get(x.day) ?? 0) + 1);
  const dayScope = new Map<string, ReturnType<typeof kickoffDayScope>>();
  const widenedFx = all.filter((x) => x.succeeded && x.group === "PAID_WIDENED");
  for (const x of widenedFx) {
    const inWindow = scoped.filter((r) => x.kickoff.getTime() >= r.at.getTime() + GENERATE_FROM_HOURS * H && x.kickoff.getTime() <= r.at.getTime() + GENERATE_UNTIL_HOURS * H);
    const s = dayScope.get(x.day) ?? kickoffDayScope();
    s.fixtures++;
    if (inWindow.length === 0) s.noRunInWindow++;
    else if (inWindow.some((r) => r.widened)) s.everInScope++;
    else s.neverInScope++;
    if (x.attempted) s.attempted++;
    if (!inWindow.some((r) => r.widened) && inWindow.length > 0 && (x.closingHeadline ?? 0) >= 75) s.neverInScopeLopsided++;
    dayScope.set(x.day, s);
  }
  console.log("  day        core  widenedFx  everInScope  neverInScope (lopsided>=75 closing)  noRunInWindow  attempted  VIP  verdict");
  let missDays = 0, missFx = 0, missLopsided = 0;
  for (const day of [...new Set([...coreByDay.keys(), ...dayScope.keys()])].sort()) {
    const s = dayScope.get(day) ?? kickoffDayScope();
    const core = coreByDay.get(day) ?? 0;
    const vip = all.filter((x) => x.day === day && x.vip).length;
    const thin = core < PAID_THIN_CORE_MIN;
    const verdict = thin && s.neverInScope > 0 ? "WINDOW_SCOPE_MISS" : thin ? "thin, widened in time" : "healthy (core only, by design)";
    if (verdict === "WINDOW_SCOPE_MISS") { missDays++; missFx += s.neverInScope; missLopsided += s.neverInScopeLopsided; }
    console.log(`  ${day} ${String(core).padStart(5)} ${String(s.fixtures).padStart(10)} ${String(s.everInScope).padStart(12)} ${String(s.neverInScope).padStart(13)} (${String(s.neverInScopeLopsided).padStart(2)}) ${String(s.noRunInWindow).padStart(30)} ${String(s.attempted).padStart(10)} ${String(vip).padStart(4)}  ${verdict}`);
  }
  console.log(`  WINDOW_SCOPE_MISS: ${missDays} thin kickoff days; ${missFx} covered widened-scope fixtures never in the pass's scope, ${missLopsided} of them lopsided >= 75 at the closing quote`);

  // ── E. Kickoff-day quota ────────────────────────────────────────────────
  console.log("\n== E. Kickoff-day quota (attempts are counted per kickoff day; quota " + VIP_PREMIUM_DAILY_QUOTA + ") ==");
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(from.getTime() - 3 * 86_400_000) }, prompt: { contains: `"intent":"${VIP_PREMIUM_INTENT}"` } }, select: { prompt: true, createdAt: true } });
  const perDay = new Map<string, number>();
  for (const j of jobs) { const a = readVipPremiumAttempt(j.prompt, j.createdAt); if (a) perDay.set(attemptKickoffDay(a), (perDay.get(attemptKickoffDay(a)) ?? 0) + 1); }
  let quotaDays = 0, quotaLeft = 0;
  for (const day of [...perDay.keys()].sort()) {
    if (day < lagosDateKey(from) || day > lagosDateKey(now)) continue;
    const used = perDay.get(day)!;
    const left = all.filter((x) => x.day === day && x.succeeded && x.group === "PAID_CORE" && !x.attempted && !x.vip && (x.closingHeadline ?? 0) >= 75 && (x.closingHeadline ?? 0) < 100);
    const spent = used >= VIP_PREMIUM_DAILY_QUOTA;
    if (spent) { quotaDays++; quotaLeft += left.length; }
    console.log(`  ${day} attempts ${String(used).padStart(2)} ${spent ? "QUOTA SPENT" : "           "} core covered, lopsided>=75 (closing), unattempted, not VIP: ${left.length}`);
  }
  console.log(`  quota spent on ${quotaDays} days; lopsided core fixtures left unattempted on those days: ${quotaLeft}`);

  // ── F. Dry days ─────────────────────────────────────────────────────────
  console.log("\n== F. Dry days (<= 2 VIP fixtures), reconstructed from pre-kickoff records ==");
  console.log("  day        VIP PREM | covered core/widened/other | ordinary published | best>=75 (route) | core lopsided>=75 closing | attempts (core/widened) drafts>=75 promoted | first-order explanation");
  for (const day of [...new Set(all.map((x) => x.day))].sort()) {
    const xs = all.filter((x) => x.day === day);
    const vip = xs.filter((x) => x.vip).length;
    if (vip > 2) continue;
    const prem = xs.filter((x) => x.premium).length;
    const cov = (g: ScopeGroup) => xs.filter((x) => x.succeeded && x.group === g).length;
    const att = xs.filter((x) => x.attempted);
    const s = dayScope.get(day);
    const core = cov("PAID_CORE");
    const lops = xs.filter((x) => x.succeeded && x.group === "PAID_CORE" && (x.closingHeadline ?? 0) >= 75).length;
    const why = core === 0 && (s?.neverInScope ?? 0) > 0 ? "no core; widened fixtures never in scope (WINDOW_SCOPE_MISS)"
      : core === 0 && cov("PAID_WIDENED") === 0 ? "no paid-scope fixtures at all (low opportunity)"
      : att.length > 0 && !att.some((x) => (x.draftMaxConf ?? 0) >= 75) ? "attempted; every draft below the 75 model floor"
      : att.length === 0 && lops === 0 ? "no lopsided paid-scope fixture to target (low opportunity)"
      : (perDay.get(day) ?? 0) >= VIP_PREMIUM_DAILY_QUOTA ? "quota spent" : "mixed; see columns";
    console.log(`  ${day} ${String(vip).padStart(3)} ${String(prem).padStart(4)} | ${core}/${cov("PAID_WIDENED")}/${cov("OUTSIDE")} | ${xs.filter((x) => x.ordinaryPublished).length} | ${xs.filter((x) => (x.maxOrdinaryConf ?? 0) >= 75).length} (${xs.filter((x) => x.route75).length}) | ${lops} | ${att.filter((x) => x.group === "PAID_CORE").length}/${att.filter((x) => x.group === "PAID_WIDENED").length} ${att.filter((x) => (x.draftMaxConf ?? 0) >= 75).length} ${att.filter((x) => x.promoted).length} | ${why}`);
  }

  // ── G. Lead time into the pass's window ─────────────────────────────────
  console.log("\n== G. Covered paid-scope fixtures whose first ordinary row arrived inside 12h of kickoff (never in the pass's window) ==");
  const late = all.filter((x) => x.group !== "OUTSIDE" && x.firstOrdinaryAt && x.kickoff.getTime() - x.firstOrdinaryAt.getTime() < GENERATE_FROM_HOURS * H);
  console.log(`  ${late.length} of ${all.filter((x) => x.group !== "OUTSIDE" && x.firstOrdinaryAt).length}: ${late.slice(0, 10).map((x) => `${x.day} ${x.leagueName}`).join("; ")}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
