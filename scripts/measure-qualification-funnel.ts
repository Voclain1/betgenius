/**
 * VIP/Premium Sprint 08: the paid qualification funnel in UNIQUE FIXTURES,
 * per Lagos kickoff day and per competition, separating ordinary curation
 * from the dedicated pass, plus the evaluation lane's shadow record and the
 * api-football budget.
 *
 * Why another script: scripts/measure-vip-premium.ts reports the dedicated
 * pass's JobRun funnel, which counts a fixture once per run that sees it
 * (42,751 "covered" over 14 days is fixture-runs, not fixtures). This one
 * counts each fixture once.
 *
 *   A. Repository defaults of every flag that governs qualification or
 *      coverage (production values come from the workflow's read-only probe).
 *   B. Per day: discovered, generated, priced, best-pick confidence band,
 *      VIP / PREMIUM published (ordinary vs dedicated), first loss.
 *   C. Per competition: fixtures that reached generation but never VIP.
 *   D. Dedicated pass: unique fixtures attempted, drafts, MODEL_BELOW_FLOOR,
 *      promoted; budget stand-downs by UTC hour.
 *   E. Ordinary curation: marketDisagreeExcluded / widenedAdmitted recorded.
 *   F. Evaluation lane (COVERAGE_ROLLOUT): every recorded lane run.
 *   G. api-football calls per UTC day and the lane's quota threshold.
 *
 * Loss attribution uses the fixture's LAST pre-kickoff quote, so it says what
 * the market finally thought, not necessarily what curation read at the time.
 *
 * READ-ONLY. Run: npx tsx --env-file=.env scripts/measure-qualification-funnel.ts [days=14]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { pickPrice } from "../src/lib/paidSelection";
import { PAID_ANY_LEAGUE_IDS, PAID_CORE_LEAGUE_IDS, PAID_THIN_CORE_MIN, VIP_PREMIUM_INTENT, readVipPremiumAttempt } from "../src/lib/vipPremiumOverlay";
import { DEDICATED_PAID_PROVENANCES, VIP_ROUTE_PROVENANCE } from "../src/lib/geniusCuration";
import { JOB_GENERATION_DISCOVERY, JOB_GENERATE_VIP_PREMIUM, JOB_SETTLE } from "../src/lib/jobRuns";
import { coverageRollout, laneCompetitionIds } from "../src/lib/generation/competitionEligibility";
import { paidQualityPolicyMode } from "../src/lib/paidQualityPolicy";
import { paidSelectionMode } from "../src/lib/paidSelectionMode";
import { EVALUATION_LANE } from "../src/lib/generation/evaluationLane";
import { DAILY_LIMIT, RESERVE, PAID_PRIORITY_RESERVE } from "../src/lib/football/usage";
import { blockedByConfidenceAlone, firstLoss, type FunnelFixture, type FunnelLoss } from "../src/lib/qualificationResearch";

const LOSSES: FunnelLoss[] = ["PAID", "NO_PUBLISHED_SINGLE", "OUT_OF_PAID_SCOPE", "CONFIDENCE", "NOT_VIP_ROUTE_ON_HEALTHY_DAY", "NO_USABLE_PRICE", "MARKET_OUTSIDE_BAND", "MODEL_MARKET_DISAGREE", "OTHER"];

function sumKeys(node: unknown, keys: string[], acc: Record<string, number>, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (keys.includes(k) && typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
    else sumKeys(v, keys, acc, depth + 1);
  }
}

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.min(60, Math.max(3, Number(process.argv[2]) || 14));
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);

  console.log("\n== A. Flags: value this process resolves (the workflow sets none of them, so these are REPOSITORY DEFAULTS) ==");
  console.log(`  COVERAGE_ROLLOUT -> ${coverageRollout()} | PAID_QUALITY_POLICY -> ${paidQualityPolicyMode()} | PAID_SELECTION_MODE -> ${paidSelectionMode()} | PAID_ROUTE_PRIMARY_PROVIDER -> ${process.env.PAID_ROUTE_PRIMARY_PROVIDER || "(unset: default chain)"}`);
  console.log(`  api-football DAILY_LIMIT ${DAILY_LIMIT}, RESERVE ${RESERVE}, PAID_PRIORITY_RESERVE ${PAID_PRIORITY_RESERVE}; lane needs ${EVALUATION_LANE.MIN_QUOTA_REMAINING} remaining, i.e. used <= ${DAILY_LIMIT - RESERVE - EVALUATION_LANE.MIN_QUOTA_REMAINING}`);

  // ── B/C. Fixture funnel ──────────────────────────────────────────────────
  const ledger = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: from, lt: now } },
    select: { matchKey: true, leagueApiId: true, kickoff: true, status: true },
  });
  const preds = await prisma.prediction.findMany({
    where: { kickoff: { gte: from, lt: now }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, status: true, kickoff: true, leagueApiId: true, leagueName: true, homeTeamApiId: true, awayTeamApiId: true,
      marketType: true, selection: true, confidence: true, provenance: true, publishedAt: true,
      categories: { select: { category: true } }, aiJob: { select: { prompt: true } },
    },
    take: 50_000,
  });
  const keys = [...new Set([...ledger.map((l) => l.matchKey), ...preds.map((p) => matchKey(p)).filter((k): k is string => !!k)])];
  const quotes = new Map<string, { oddsJson: FixtureOdds | null; fetchedAt: Date | null; bookmakerCount: number | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true, bookmakerCount: true } })) {
      quotes.set(q.matchKey, { oddsJson: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt, bookmakerCount: q.bookmakerCount });
    }
  }

  type Fx = { key: string; day: string; league: number | null; leagueName: string; discovered: boolean; succeeded: boolean; generated: boolean; priced: boolean; maxConf: number | null; vip: { ordinary: boolean; dedicated: boolean }; premium: boolean; vipRows: number; dedicatedAttempted: boolean; f: FunnelFixture };
  const fx = new Map<string, Fx>();
  const get = (key: string, kickoff: Date, league: number | null, leagueName?: string | null) => {
    let x = fx.get(key);
    if (!x) {
      const q = quotes.get(key);
      x = {
        key, day: lagosDateKey(kickoff), league, leagueName: leagueName ?? String(league), discovered: false, succeeded: false, generated: false,
        priced: !!q?.fetchedAt && q.fetchedAt < kickoff && (q.bookmakerCount ?? 0) >= 5,
        maxConf: null, vip: { ordinary: false, dedicated: false }, premium: false, vipRows: 0, dedicatedAttempted: false,
        f: { fixtureKey: key, inPaidScope: PAID_ANY_LEAGUE_IDS.includes(league ?? -1), picks: [], carriedVip: false, widenedDay: false },
      };
      fx.set(key, x);
    }
    if (leagueName && x.leagueName === String(league)) x.leagueName = leagueName;
    return x;
  };
  for (const l of ledger) { const x = get(l.matchKey, l.kickoff, l.leagueApiId); x.discovered = true; if (l.status === "SUCCEEDED") x.succeeded = true; }
  for (const p of preds) {
    const key = matchKey(p);
    if (!key || !p.kickoff) continue;
    const x = get(key, p.kickoff, p.leagueApiId, p.leagueName);
    x.generated = true;
    const intent = (() => { try { return JSON.parse(p.aiJob?.prompt ?? "null")?.intent ?? null; } catch { return null; } })();
    if (intent === VIP_PREMIUM_INTENT) x.dedicatedAttempted = true;
    if (p.status !== "PUBLISHED") continue;
    const cats = p.categories.map((c) => c.category);
    if (cats.includes("SAME_GAME_DOUBLE")) continue;
    const dedicated = (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "");
    if (cats.includes("VIP")) { x.vipRows++; if (dedicated) x.vip.dedicated = true; else x.vip.ordinary = true; x.f.carriedVip = true; }
    if (cats.includes("PREMIUM")) x.premium = true;
    x.maxConf = Math.max(x.maxConf ?? 0, p.confidence);
    const q = quotes.get(key);
    const price = q?.fetchedAt && q.fetchedAt < p.kickoff ? pickPrice(q.oddsJson, p.marketType, p.selection) : null;
    const exec = price && !price.derived ? price : null;
    (x.f.picks as FunnelFixture["picks"][number][]).push({ confidence: p.confidence, vipRoute: p.provenance === VIP_ROUTE_PROVENANCE, marketProbability: exec?.fair ?? null, bookmakers: exec?.bookmakers ?? null, odds: exec?.median ?? null });
  }
  // Thin-day widening is decided per Lagos day from distinct core fixtures with published rows.
  const coreByDay = new Map<string, Set<string>>();
  for (const x of fx.values()) if (x.f.picks.length && PAID_CORE_LEAGUE_IDS.includes(x.league ?? -1)) coreByDay.set(x.day, new Set([...(coreByDay.get(x.day) ?? []), x.key]));
  for (const x of fx.values()) x.f.widenedDay = (coreByDay.get(x.day)?.size ?? 0) < PAID_THIN_CORE_MIN;

  const byDay = new Map<string, Fx[]>();
  for (const x of fx.values()) byDay.set(x.day, [...(byDay.get(x.day) ?? []), x]);
  console.log(`\n== B. Funnel per Lagos kickoff day, UNIQUE fixtures (kickoffs ${from.toISOString().slice(0, 10)} .. now) ==`);
  console.log("  day        disc  succ  gen  priced5+  best>=80 75-79 70-74 <70 | VIP ord ded tot (rows) PREM | wide | blockedByConfAlone | first loss");
  const totals: Record<string, number> = {};
  const add = (k: string, n = 1) => { totals[k] = (totals[k] ?? 0) + n; };
  for (const day of [...byDay.keys()].sort()) {
    const xs = byDay.get(day)!;
    const c = (f: (x: Fx) => boolean) => xs.filter(f).length;
    const loss: Record<string, number> = {};
    for (const x of xs) { const l = firstLoss(x.f); loss[l] = (loss[l] ?? 0) + 1; add(`loss:${l}`); }
    const row = {
      disc: c((x) => x.discovered), succ: c((x) => x.succeeded), gen: c((x) => x.generated), priced: c((x) => x.priced),
      b80: c((x) => (x.maxConf ?? -1) >= 80), b75: c((x) => (x.maxConf ?? -1) >= 75 && x.maxConf! < 80), b70: c((x) => (x.maxConf ?? -1) >= 70 && x.maxConf! < 75), blow: c((x) => x.maxConf != null && x.maxConf < 70),
      vord: c((x) => x.vip.ordinary && !x.vip.dedicated), vded: c((x) => x.vip.dedicated), vtot: c((x) => x.f.carriedVip), vrows: xs.reduce((s, x) => s + x.vipRows, 0), prem: c((x) => x.premium),
      conf: c((x) => blockedByConfidenceAlone(x.f)),
    };
    for (const [k, v] of Object.entries(row)) add(k, v);
    const wide = (coreByDay.get(day)?.size ?? 0) < PAID_THIN_CORE_MIN;
    console.log(`  ${day} ${String(row.disc).padStart(5)} ${String(row.succ).padStart(5)} ${String(row.gen).padStart(4)} ${String(row.priced).padStart(9)}  ${String(row.b80).padStart(8)} ${String(row.b75).padStart(5)} ${String(row.b70).padStart(5)} ${String(row.blow).padStart(3)} | ${String(row.vord).padStart(7)} ${String(row.vded).padStart(3)} ${String(row.vtot).padStart(3)} (${row.vrows}) ${String(row.prem).padStart(4)} | ${wide ? "yes " : "no  "} | ${String(row.conf).padStart(3)} | ${LOSSES.filter((l) => loss[l]).map((l) => `${l} ${loss[l]}`).join(", ")}`);
  }
  console.log(`  TOTAL ${JSON.stringify(totals)}`);
  const vipDays = [...byDay.values()].filter((xs) => xs.some((x) => x.f.carriedVip)).length;
  const premDays = [...byDay.values()].filter((xs) => xs.some((x) => x.premium)).length;
  console.log(`  days with fixtures ${byDay.size}; with >=1 VIP ${vipDays}; with >=1 PREMIUM ${premDays}; duplicate VIP rows on one fixture ${[...fx.values()].filter((x) => x.vipRows > 1).length}`);

  console.log("\n== C. Paid-scope competitions: fixtures generated but never VIP, by first loss (window) ==");
  const byLeague = new Map<string, Fx[]>();
  for (const x of fx.values()) if (x.generated && x.f.inPaidScope) byLeague.set(`${x.leagueName} (${x.league})`, [...(byLeague.get(`${x.leagueName} (${x.league})`) ?? []), x]);
  for (const [lg, xs] of [...byLeague.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const loss: Record<string, number> = {};
    for (const x of xs) { const l = firstLoss(x.f); loss[l] = (loss[l] ?? 0) + 1; }
    console.log(`  ${lg.padEnd(44)} generated ${String(xs.length).padStart(3)} VIP ${String(loss.PAID ?? 0).padStart(3)} | ${LOSSES.filter((l) => l !== "PAID" && loss[l]).map((l) => `${l} ${loss[l]}`).join(", ") || "—"}`);
  }
  const outScope = [...fx.values()].filter((x) => x.generated && !x.f.inPaidScope);
  const outBest = outScope.filter((x) => (x.maxConf ?? 0) >= 75 && x.priced).length;
  console.log(`  outside paid scope: ${outScope.length} generated fixtures, ${outBest} with a published pick >= 75 and a 5+ book quote (structurally excluded from VIP/PREMIUM)`);

  // ── D. Dedicated pass ────────────────────────────────────────────────────
  console.log("\n== D. Dedicated pass (unique fixtures, by Lagos kickoff day) ==");
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(from.getTime() - 3 * 86_400_000) } }, select: { id: true, prompt: true, createdAt: true } });
  const dedJobs = jobs.map((j) => ({ j, a: readVipPremiumAttempt(j.prompt, j.createdAt) })).filter((x) => x.a);
  const dedJobIds = new Set(dedJobs.map((x) => x.j.id));
  const drafts = dedJobIds.size ? await prisma.prediction.findMany({
    where: { aiJobId: { in: [...dedJobIds] } },
    select: { aiJobId: true, kickoff: true, confidence: true, status: true, provenance: true, homeTeamApiId: true, awayTeamApiId: true },
  }) : [];
  const dd = new Map<string, { fixtures: Set<string>; drafts: number; below75: number; fixturesAllBelow75: Set<string>; promoted: Set<string> }>();
  const byFixtureDraft = new Map<string, number[]>();
  for (const d of drafts) {
    if (!d.kickoff) continue;
    const key = matchKey(d) ?? d.aiJobId ?? "";
    const day = lagosDateKey(d.kickoff);
    const e = dd.get(day) ?? { fixtures: new Set(), drafts: 0, below75: 0, fixturesAllBelow75: new Set(), promoted: new Set() };
    e.fixtures.add(key); e.drafts++; if (d.confidence < 75) e.below75++;
    if ((DEDICATED_PAID_PROVENANCES as readonly string[]).includes(d.provenance ?? "")) e.promoted.add(key);
    byFixtureDraft.set(key, [...(byFixtureDraft.get(key) ?? []), d.confidence]);
    dd.set(day, e);
  }
  for (const [key, confs] of byFixtureDraft) if (confs.every((c) => c < 75)) for (const e of dd.values()) if (e.fixtures.has(key)) e.fixturesAllBelow75.add(key);
  for (const day of [...dd.keys()].sort()) {
    if (day < lagosDateKey(from)) continue;
    const e = dd.get(day)!;
    console.log(`  ${day} fixtures attempted ${String(e.fixtures.size).padStart(2)} drafts ${String(e.drafts).padStart(3)} drafts<75 ${String(e.below75).padStart(3)} fixtures with every draft <75 ${String(e.fixturesAllBelow75.size).padStart(2)} promoted ${e.promoted.size}`);
  }
  const allConfs = drafts.filter((d) => d.kickoff && d.kickoff >= from).map((d) => d.confidence);
  const hist: Record<string, number> = {};
  for (const c of allConfs) { const b = c < 65 ? "<65" : c < 70 ? "65-69" : c < 73 ? "70-72" : c < 75 ? "73-74" : c < 80 ? "75-79" : "80+"; hist[b] = (hist[b] ?? 0) + 1; }
  console.log(`  dedicated draft confidence histogram: ${JSON.stringify(hist)}`);

  const dedRuns = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: from } }, select: { ranAt: true, detail: true, summary: true } });
  const standByHour: Record<string, number> = {};
  let stoodDown = 0;
  for (const r of dedRuns) {
    const reason = String((r.detail as any)?.reason ?? (r.detail as any)?.response?.reason ?? r.summary ?? "");
    if (/budget nearly exhausted/.test(reason)) { stoodDown++; const h = String(r.ranAt.getUTCHours()).padStart(2, "0"); standByHour[h] = (standByHour[h] ?? 0) + 1; }
  }
  console.log(`  dedicated runs ${dedRuns.length}; budget stand-downs ${stoodDown}; by UTC hour ${JSON.stringify(standByHour)}`);

  // ── E. Ordinary curation counters ───────────────────────────────────────
  const settleRuns = await prisma.jobRun.findMany({ where: { job: JOB_SETTLE, ranAt: { gte: from } }, select: { detail: true } });
  const cur: Record<string, number> = {};
  for (const r of settleRuns) sumKeys(r.detail, ["marketDisagreeExcluded", "widenedAdmitted"], cur);
  console.log(`\n== E. Ordinary curation (${settleRuns.length} settle runs): ${JSON.stringify(cur)} (summed over runs; the same fixture can be counted on several runs) ==`);

  // ── F. Evaluation lane ──────────────────────────────────────────────────
  console.log("\n== F. Evaluation lane (discovery JobRun detail.coverage.lane) ==");
  const disc = await prisma.jobRun.findMany({ where: { job: JOB_GENERATION_DISCOVERY, ranAt: { gte: from } }, select: { ranAt: true, detail: true }, orderBy: { ranAt: "asc" } });
  const laneIds = new Set(laneCompetitionIds());
  const status: Record<string, number> = {};
  const shortlisted = new Map<number, Set<number>>();
  let ran = 0, pricedFromCache = 0, calls = 0, queued = 0, first: Date | null = null, last: Date | null = null;
  let withLane = 0;
  for (const r of disc) {
    const c = (r.detail as any)?.coverage;
    if (!c) continue;
    if (c.lane === undefined) { status[c.widened ? "no lane field (widened day: lane not attempted)" : "no lane field (code without the lane, or not reached)"] = (status[c.widened ? "no lane field (widened day: lane not attempted)" : "no lane field (code without the lane, or not reached)"] ?? 0) + 1; continue; }
    withLane++;
    const l = c.lane;
    first ??= r.ranAt; last = r.ranAt;
    const k = `${l.rollout}:${l.ran ? "ran" : `skipped (${String(l.skippedReason ?? "").replace(/\d+/g, "N")})`}`;
    status[k] = (status[k] ?? 0) + 1;
    calls += l.providerCalls ?? 0;
    queued += l.queued ?? 0;
    if (l.ran) { ran++; pricedFromCache += l.pricedFromCache ?? 0; for (const s of l.shortlist ?? []) shortlisted.set(s.leagueApiId, new Set([...(shortlisted.get(s.leagueApiId) ?? []), s.fixtureApiId])); }
  }
  console.log(`  discovery runs ${disc.length}; with a lane record ${withLane} (first ${first?.toISOString().slice(0, 16) ?? "—"}, last ${last?.toISOString().slice(0, 16) ?? "—"})`);
  console.log(`  lane outcomes: ${JSON.stringify(status)}`);
  console.log(`  lane runs that ran ${ran}; provider calls ${calls}; queued ${queued}; shortlisted rows already priced 5+ from cache ${pricedFromCache}`);
  const uniqueShort = [...shortlisted.values()].reduce((s, v) => s + v.size, 0);
  console.log(`  unique fixtures shortlisted ${uniqueShort} across ${shortlisted.size} of ${laneIds.size} lane competitions: ${[...shortlisted.entries()].map(([id, s]) => `${id}:${s.size}`).join(", ") || "—"}`);

  // ── G. api-football budget ──────────────────────────────────────────────
  console.log("\n== G. api-football calls per UTC day ==");
  const usage = await prisma.apiUsage.findMany({ where: { day: { gte: from.toISOString().slice(0, 10) } }, select: { day: true, path: true, count: true, updatedAt: true } });
  const perDay = new Map<string, { total: number; paths: Record<string, number> }>();
  for (const u of usage) { const e = perDay.get(u.day) ?? { total: 0, paths: {} }; e.total += u.count; e.paths[u.path] = (e.paths[u.path] ?? 0) + u.count; perDay.set(u.day, e); }
  for (const day of [...perDay.keys()].sort()) {
    const e = perDay.get(day)!;
    const top = Object.entries(e.paths).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p} ${n}`).join(", ");
    console.log(`  ${day} total ${String(e.total).padStart(5)} ${e.total >= DAILY_LIMIT - RESERVE - PAID_PRIORITY_RESERVE ? "AT CEILING" : "          "} | ${top}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
