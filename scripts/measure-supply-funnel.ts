/**
 * VIP/Premium supply reliability: the paid candidate funnel in UNIQUE FIXTURES
 * per Lagos kickoff day, and the first loss of every paid-scope fixture.
 * READ-ONLY: no provider calls, no api-football calls, no writes.
 *
 * Stages: fixtures -> coverage -> odds availability -> model evaluation ->
 * qualification -> allocation -> publication, separately for the two routes
 * into the paid feeds:
 *
 *   dedicated pass  (JobRun generate-vip-premium; VIP_PREMIUM-intent drafts;
 *                    promotions = MARKET_CONFIRMED provenance)
 *   ordinary curation (JobRun paid-selection-shadow: every ordinary candidate
 *                    at the tier floor with its #175 rule verdict, per run)
 *
 * Point-in-time facts come only from records written at the time (JobRun,
 * AIJob, Prediction, GenerationAttempt). The odds cache holds one row per
 * fixture, overwritten on refresh, so "odds at close" is the last PRE-KICKOFF
 * quote and is labelled as a closing reference.
 *
 * Run: REQUIRE_READ_ONLY=1 npx tsx scripts/measure-supply-funnel.ts [days=14]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { lopsidednessSignal } from "../src/lib/marketConfirmed";
import { DEDICATED_PAID_PROVENANCES, VIP_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { scopeGroup } from "../src/lib/paidOpportunity";
import { VIP_PREMIUM_INTENT, VIP_PREMIUM_ODDS_WARM_LIMIT } from "../src/lib/vipPremiumOverlay";
import { VIP_PREMIUM_DAILY_QUOTA } from "../src/lib/vipPremiumPipeline";
import { JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import { supplyFirstLoss, type SupplyLoss } from "../src/lib/supplyFunnel";

const H = 3_600_000, DAY = 24 * H;
const intentOf = (prompt: string | null | undefined) => { try { return JSON.parse(prompt ?? "null")?.intent ?? null; } catch { return null; } };

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  const days = Math.min(30, Math.max(3, Number(process.argv[2]) || 14));
  const now = new Date();
  const lastFull = lagosDateKey(new Date(now.getTime() - DAY));
  const firstDay = lagosDateKey(new Date(now.getTime() - days * DAY));
  const from = new Date(Date.parse(`${firstDay}T00:00:00+01:00`) - 2 * DAY);
  const to = new Date(Date.parse(`${lastFull}T00:00:00+01:00`) + DAY);
  console.log(`session verified read-only; now ${now.toISOString()}; Lagos kickoff days ${firstDay} .. ${lastFull} (${days} full days)`);

  const [ledger, preds, vipRuns, shadowRuns] = await Promise.all([
    prisma.generationAttempt.findMany({ where: { kickoff: { gte: from, lt: to } }, select: { matchKey: true, fixtureApiId: true, leagueApiId: true, kickoff: true, status: true, createdAt: true, homeTeam: true, awayTeam: true } }),
    prisma.prediction.findMany({
      where: { kickoff: { gte: from, lt: to }, marketType: { not: "SAME_GAME_DOUBLE" } },
      select: { id: true, status: true, kickoff: true, leagueApiId: true, homeTeamApiId: true, awayTeamApiId: true, fixtureApiId: true, confidence: true, provenance: true, createdAt: true, publishedAt: true, categories: { select: { category: true } }, aiJob: { select: { prompt: true } } },
      take: 80_000,
    }),
    prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: new Date(from.getTime() - 2 * DAY), lt: to } }, select: { ranAt: true, ok: true, detail: true }, orderBy: { ranAt: "asc" } }),
    prisma.jobRun.findMany({ where: { job: "paid-selection-shadow", ranAt: { gte: new Date(from.getTime() - 3 * DAY), lt: to } }, select: { ranAt: true, detail: true }, orderBy: { ranAt: "asc" } }),
  ]);
  const keys = [...new Set(ledger.map((l) => l.matchKey))];
  const quotes = new Map<string, { odds: FixtureOdds | null; fetchedAt: Date | null; lastAttemptAt: Date | null; lastError: string | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true, lastAttemptAt: true, lastError: true } })) {
      quotes.set(q.matchKey, { odds: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt, lastAttemptAt: q.lastAttemptAt, lastError: q.lastError });
    }
  }

  // ── Per fixture ──────────────────────────────────────────────────────────
  type Fx = {
    key: string; fixtureApiId: number | null; kickoff: Date; day: string; group: ReturnType<typeof scopeGroup>; name: string;
    covered: boolean; coveredAt: Date | null; closing: number | null; priced5: boolean; quoteAt: Date | null; lastError: string | null;
    attempted: boolean; draftMax: number | null; promoted: boolean; dedicatedPublished: boolean;
    ordinaryAt75: boolean; ordinaryRule: string | null; ordinaryEligible: boolean;
    vip: boolean; premium: boolean; vipVia: "dedicated" | "ordinary" | null;
    inScopeRun: boolean; widenedRun: boolean;
  };
  const fx = new Map<string, Fx>();
  const byId = new Map<number, string>();
  for (const l of ledger) {
    let x = fx.get(l.matchKey);
    if (!x) {
      const q = quotes.get(l.matchKey);
      const pre = !!q?.fetchedAt && q.fetchedAt < l.kickoff;
      const sig = pre ? lopsidednessSignal(q!.odds) : null;
      x = { key: l.matchKey, fixtureApiId: l.fixtureApiId, kickoff: l.kickoff, day: lagosDateKey(l.kickoff), group: scopeGroup(l.leagueApiId), name: `${l.homeTeam} v ${l.awayTeam}`,
        covered: false, coveredAt: null, closing: sig?.probability ?? null, priced5: !!sig, quoteAt: q?.fetchedAt ?? null, lastError: q?.lastError ?? null,
        attempted: false, draftMax: null, promoted: false, dedicatedPublished: false, ordinaryAt75: false, ordinaryRule: null, ordinaryEligible: false,
        vip: false, premium: false, vipVia: null, inScopeRun: false, widenedRun: false };
      fx.set(l.matchKey, x);
    }
    if (l.status === "SUCCEEDED") x.covered = true;
    if (l.fixtureApiId != null) byId.set(l.fixtureApiId, l.matchKey);
  }
  for (const p of preds) {
    const k = matchKey(p); if (!k || !p.kickoff) continue;
    const x = fx.get(k) ?? (p.fixtureApiId != null ? fx.get(byId.get(p.fixtureApiId) ?? "") : undefined);
    if (!x) continue;
    const cats = p.categories.map((c) => c.category);
    const dedicated = (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "");
    const ordinary = !dedicated && !isPaidOnlyProvenance(p.provenance) && intentOf(p.aiJob?.prompt) !== VIP_PREMIUM_INTENT;
    if (ordinary && (!x.coveredAt || p.createdAt < x.coveredAt)) x.coveredAt = p.createdAt;
    if (intentOf(p.aiJob?.prompt) === VIP_PREMIUM_INTENT) {
      x.attempted = true; x.draftMax = Math.max(x.draftMax ?? 0, p.confidence);
      if (dedicated) { x.promoted = true; if (p.status === "PUBLISHED") x.dedicatedPublished = true; }
    }
    if (ordinary && p.status === "PUBLISHED" && p.confidence >= VIP_CONFIDENCE_FLOOR) x.ordinaryAt75 = true;
    if (p.status === "PUBLISHED" && cats.includes("VIP")) { x.vip = true; x.vipVia = dedicated ? "dedicated" : (x.vipVia ?? "ordinary"); }
    if (p.status === "PUBLISHED" && cats.includes("PREMIUM")) x.premium = true;
  }

  // Dedicated pass scope per run: whether a run in the fixture's 12-48h window was widened.
  const runs = vipRuns.map((r) => ({ t: r.ranAt.getTime(), widened: !!(r.detail as any)?.vipPremium?.widened, oddsCalls: (r.detail as any)?.vipPremium?.oddsCalls ?? 0, skippedQuota: !!(r.detail as any)?.skipped }));
  for (const x of fx.values()) {
    const w = runs.filter((r) => r.t >= x.kickoff.getTime() - 48 * H && r.t <= x.kickoff.getTime() - 12 * H);
    x.inScopeRun = x.group === "PAID_CORE" || w.some((r) => r.widened);
    x.widenedRun = w.some((r) => r.widened);
  }

  // Ordinary curation verdicts: the last assessment of each candidate before kickoff.
  const ordinaryVerdict = new Map<string, { tag: string; eligible: boolean; tier: string }>();
  for (const r of shadowRuns) {
    const d = r.detail as any;
    for (const c of (d?.candidates ?? []) as Array<{ fixtureKey?: string; rule?: { eligible: boolean; tag: string } }>) {
      if (!c.fixtureKey || !c.rule) continue;
      const k = `${d.category}|${c.fixtureKey}`;
      ordinaryVerdict.set(k, { tag: c.rule.tag, eligible: c.rule.eligible, tier: d.category });
    }
  }
  const fixtureKeyOf = (x: Fx) => x.key; // paidFixtureKey: matchKey first (geniusCuration.ts)
  let verdictKeyFormat = "unknown";
  const sampleKey = [...ordinaryVerdict.keys()][0];
  if (sampleKey) verdictKeyFormat = sampleKey.split("|")[1]?.split(":")[0] ?? "unknown";
  for (const x of fx.values()) {
    const v = ordinaryVerdict.get(`VIP|${fixtureKeyOf(x)}`) ?? ordinaryVerdict.get(`VIP|${x.key}`);
    if (v) { x.ordinaryRule = v.tag; x.ordinaryEligible = v.eligible; }
  }

  // ── Per day funnel ───────────────────────────────────────────────────────
  const dayList: string[] = [];
  for (let t = Date.parse(`${firstDay}T12:00:00Z`); lagosDateKey(new Date(t)) <= lastFull; t += DAY) dayList.push(lagosDateKey(new Date(t)));
  const attemptsByDay = new Map<string, number>();
  for (const x of fx.values()) if (x.attempted) attemptsByDay.set(x.day, (attemptsByDay.get(x.day) ?? 0) + 1);

  console.log("\n== A. Funnel per Lagos kickoff day (unique fixtures; paid scope = core, or widened when the pass widened in the fixture's window) ==");
  console.log("day         fixt  cov | scope core/wid | priced5  lops75 | ded.att  draft75  promoted  pub | ord>=75  ord.ruleOK | VIP fx (ded/ord)  PREM | attempts/quota");
  const totals: Record<string, number> = {};
  const add = (k: string, n: number) => (totals[k] = (totals[k] ?? 0) + n);
  const lossTotals: Partial<Record<SupplyLoss, number>> = {};
  const lossRows: Array<{ x: Fx; loss: SupplyLoss }> = [];
  for (const day of dayList) {
    const xs = [...fx.values()].filter((x) => x.day === day);
    const cov = xs.filter((x) => x.covered);
    const scoped = cov.filter((x) => x.group !== "OUTSIDE" && x.inScopeRun);
    const core = scoped.filter((x) => x.group === "PAID_CORE").length, wid = scoped.length - core;
    const priced5 = scoped.filter((x) => x.priced5).length;
    const lops = scoped.filter((x) => (x.closing ?? 0) >= 75).length;
    const att = scoped.filter((x) => x.attempted).length;
    const d75 = scoped.filter((x) => (x.draftMax ?? 0) >= 75).length;
    const prom = scoped.filter((x) => x.promoted).length;
    const pub = scoped.filter((x) => x.dedicatedPublished).length;
    const ord75 = cov.filter((x) => x.ordinaryAt75 && x.group !== "OUTSIDE").length;
    const ordOk = cov.filter((x) => x.ordinaryAt75 && x.ordinaryEligible).length;
    const vip = xs.filter((x) => x.vip), vded = vip.filter((x) => x.vipVia === "dedicated").length;
    const prem = xs.filter((x) => x.premium).length;
    const used = attemptsByDay.get(day) ?? 0;
    console.log(`${day}  ${String(xs.length).padStart(4)} ${String(cov.length).padStart(4)} | ${String(core).padStart(5)}/${String(wid).padEnd(4)}     | ${String(priced5).padStart(6)} ${String(lops).padStart(7)} | ${String(att).padStart(7)} ${String(d75).padStart(8)} ${String(prom).padStart(9)} ${String(pub).padStart(4)} | ${String(ord75).padStart(7)} ${String(ordOk).padStart(11)} | ${String(vip.length).padStart(6)} (${vded}/${vip.length - vded})${" ".repeat(Math.max(1, 6 - String(vded).length - String(vip.length - vded).length))}${String(prem).padStart(4)} | ${used}/${VIP_PREMIUM_DAILY_QUOTA}${vip.length <= 2 ? "  <= 2 VIP" : ""}`);
    for (const [k, n] of Object.entries({ fixtures: xs.length, covered: cov.length, scoped: scoped.length, priced5, lops, att, d75, prom, pub, ord75, ordOk, vip: vip.length, vded, prem, thin: vip.length <= 2 ? 1 : 0, zero: vip.length === 0 ? 1 : 0 })) add(k, n);
    for (const x of cov.filter((f) => f.group !== "OUTSIDE")) {
      const loss = supplyFirstLoss({
        vip: x.vip, group: x.group, inScope: x.inScopeRun, priced5: x.priced5, closing: x.closing, attempted: x.attempted, draftMax: x.draftMax,
        promoted: x.promoted, published: x.dedicatedPublished, dayQuotaSpent: used >= VIP_PREMIUM_DAILY_QUOTA,
        coveredLate: !!x.coveredAt && x.kickoff.getTime() - x.coveredAt.getTime() < 12 * H,
        ordinaryAt75: x.ordinaryAt75, ordinaryRule: x.ordinaryRule,
      });
      lossTotals[loss] = (lossTotals[loss] ?? 0) + 1;
      lossRows.push({ x, loss });
    }
  }
  console.log(`TOTAL: ${JSON.stringify(totals)}`);

  console.log("\n== B. First loss per covered paid-scope fixture (pipeline order; supplyFirstLoss) ==");
  for (const [k, n] of Object.entries(lossTotals).sort((a, b) => b[1]! - a[1]!)) console.log(`   ${k.padEnd(34)} ${n}`);

  console.log("\n== C. Recoverable-candidate detail: every fixture whose first loss is not an intentional rule or genuine scarcity ==");
  const suspect: SupplyLoss[] = ["NO_ODDS_IN_SCOPE", "NOT_ATTEMPTED_LOPSIDED", "QUOTA_SPENT", "PROMOTED_NOT_PUBLISHED", "COVERED_TOO_LATE"];
  for (const { x, loss } of lossRows.filter((r) => suspect.includes(r.loss))) {
    const band = runs.filter((r) => r.t >= x.kickoff.getTime() - 24 * H && r.t <= x.kickoff.getTime() - 12 * H);
    console.log(`   ${x.day} ${loss.padEnd(24)} ${x.group.padEnd(12)} ${x.name.slice(0, 40).padEnd(40)} ko ${x.kickoff.toISOString().slice(5, 16)} closing ${x.closing?.toFixed(1) ?? "—"} quote ${x.quoteAt ? `${((x.kickoff.getTime() - x.quoteAt.getTime()) / H).toFixed(1)}h pre-ko` : "none"} err ${x.lastError ? x.lastError.slice(0, 40) : "—"} | covered ${x.coveredAt ? `${((x.kickoff.getTime() - x.coveredAt.getTime()) / H).toFixed(1)}h pre-ko` : "—"} | warm-band runs ${band.length}, at warm limit ${band.filter((r) => r.oddsCalls >= VIP_PREMIUM_ODDS_WARM_LIMIT).length}, quota stand-downs ${band.filter((r) => r.skippedQuota).length} | day attempts ${attemptsByDay.get(x.day) ?? 0}`);
  }

  console.log("\n== D. Ordinary curation verdicts (last assessment before kickoff, VIP tier) ==");
  console.log(`   shadow-log runs ${shadowRuns.length} (first ${shadowRuns[0]?.ranAt.toISOString() ?? "—"}); verdict fixture-key format "${verdictKeyFormat}"`);
  const tags: Record<string, number> = {};
  for (const x of fx.values()) if (x.ordinaryAt75 && x.ordinaryRule && dayList.includes(x.day)) tags[x.ordinaryRule] = (tags[x.ordinaryRule] ?? 0) + 1;
  console.log(`   ordinary >= 75 fixtures with a recorded verdict: ${JSON.stringify(tags)}; without a verdict: ${[...fx.values()].filter((x) => x.ordinaryAt75 && !x.ordinaryRule && dayList.includes(x.day) && x.group !== "OUTSIDE").length}`);

  console.log("\n== E. Allocation and API ==");
  const runsInWindow = runs.filter((r) => r.t >= Date.parse(`${firstDay}T00:00:00+01:00`) - 2 * DAY);
  console.log(`   dedicated pass runs ${runsInWindow.length}; quota stand-downs ${runsInWindow.filter((r) => r.skippedQuota).length}; odds calls ${runsInWindow.reduce((a, r) => a + r.oddsCalls, 0)}; runs at warm limit (${VIP_PREMIUM_ODDS_WARM_LIMIT}) ${runsInWindow.filter((r) => r.oddsCalls >= VIP_PREMIUM_ODDS_WARM_LIMIT).length}`);
  console.log(`   kickoff days with the attempt quota (${VIP_PREMIUM_DAILY_QUOTA}) spent: ${dayList.filter((d) => (attemptsByDay.get(d) ?? 0) >= VIP_PREMIUM_DAILY_QUOTA).join(", ") || "none"}`);
  const usage = await prisma.apiUsage.findMany({ where: { day: { gte: firstDay } }, select: { day: true, path: true, count: true } });
  const perDay = new Map<string, { all: number; odds: number }>();
  for (const u of usage) { const x = perDay.get(u.day) ?? { all: 0, odds: 0 }; x.all += u.count; if (u.path.startsWith("/odds")) x.odds += u.count; perDay.set(u.day, x); }
  console.log(`   api-football per UTC day (all / odds): ${[...perDay.entries()].sort().map(([d, x]) => `${d} ${x.all}/${x.odds}`).join(", ")}`);
  console.log("\n   PREMIUM vs VIP: PREMIUM requires model >= 80 AND market >= 80 on the same gate; every PREMIUM fixture is also VIP (strict subset).");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
