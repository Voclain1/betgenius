/**
 * How VIP and PREMIUM are doing, in one read-only report.
 *
 *   1. The dedicated pass's funnel over its recent runs (JobRun detail):
 *      covered -> in scope -> freshly priced -> qualified -> promoted ->
 *      published, with why fixtures and drafts fell out, and how often it
 *      widened past the core.
 *   2. Its attempts per Lagos day against VIP_PREMIUM_DAILY_QUOTA.
 *   3. What each paid feed carried per Lagos kickoff day: dedicated paid-only
 *      picks vs ordinary picks (the fallback), and their results.
 *   4. Every dedicated pick in the window, with market and model figures.
 *   5. The settled record per tier since the paid-tier cutover.
 *
 * READ-ONLY. No provider calls, no writes. Safe against production.
 *
 * Run: npx tsx --env-file=.env scripts/measure-vip-premium.ts [days=4]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import { PAID_ONLY_PROVENANCES } from "../src/lib/paidOnly";
import { PAID_TIER_CUTOVER } from "../src/lib/geniusCuration";
import { VIP_PREMIUM_DAILY_QUOTA } from "../src/lib/vipPremiumPipeline";

const H = 3_600_000;
const pad = (v: unknown, w = 5) => String(v).padStart(w);
type Tally = Record<string, number>;
const add = (t: Tally, k: string, n = 1) => { t[k] = (t[k] ?? 0) + n; };
const show = (t: Tally) => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "—";

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const days = Math.max(1, Number(process.argv[2]) || 4);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * H);

  // ── 1. Funnel ────────────────────────────────────────────────────────────
  const runs = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: since } }, orderBy: { ranAt: "asc" }, select: { ranAt: true, ok: true, summary: true, detail: true } });
  const funnel: Tally = {};
  const skipped: Tally = {};
  const rejected: Tally = {};
  const held: Tally = {};
  const reasons: Tally = {};
  let widened = 0, withPayload = 0;
  for (const r of runs) {
    const d = (r.detail as any) ?? {};
    const v = d.vipPremium ?? d;
    if (!r.ok) add(reasons, "THREW");
    else if (d.reason) add(reasons, String(d.reason).slice(0, 60));
    if (!v || typeof v.considered !== "number") continue;
    withPayload++;
    if (v.widened) widened++;
    add(funnel, "1 covered (considered)", v.considered ?? 0);
    add(funnel, "2 eligible (in scope)", v.inScope ?? 0);
    add(funnel, "3 freshly priced", v.freshlyPriced ?? 0);
    add(funnel, "4 qualified", v.qualified ?? 0);
    add(funnel, "5 generated (targets)", Array.isArray(v.targets) ? v.targets.length : 0);
    add(funnel, "6 promoted VIP", Array.isArray(v.promotedVip) ? v.promotedVip.length : 0);
    add(funnel, "6 promoted PREMIUM", Array.isArray(v.promotedPremium) ? v.promotedPremium.length : 0);
    add(funnel, "7 published", typeof v.published === "number" ? v.published : 0);
    add(funnel, "odds calls", v.oddsCalls ?? 0);
    add(funnel, "repeats refused", v.repeatsExistingPick ?? 0);
    for (const [k, n] of Object.entries(v.skipped ?? {})) add(skipped, k, Number(n) || 0);
    for (const [k, n] of Object.entries(v.rejectedReasons ?? {})) add(rejected, k, Number(n) || 0);
    for (const h of v.publishHeld ?? []) for (const b of h.blocks ?? []) add(held, b);
  }
  console.log(`\n1. Dedicated pass, last ${days} days: ${runs.length} runs (${runs.filter((r) => r.ok).length} ok), ${withPayload} with a funnel, widened on ${widened}.`);
  console.log("   Funnel totals (fixture-run counts; a fixture is counted on every run that sees it):");
  for (const [k, v] of Object.entries(funnel).sort()) console.log(`     ${k.padEnd(26)} ${pad(v, 6)}`);
  console.log(`   Why covered fixtures were not targeted: ${show(skipped)}`);
  console.log(`   Gate rejections of generated drafts:     ${show(rejected)}`);
  console.log(`   Promoted but held from publishing:       ${show(held)}`);
  console.log(`   Runs that stood down:                    ${show(reasons)}`);
  console.log("   Last 6 run summaries:");
  for (const r of runs.slice(-6)) console.log(`     ${r.ranAt.toISOString().slice(0, 16)}  ${r.ok ? "" : "FAILED "}${r.summary ?? ""}`.slice(0, 260));

  // ── 2. Attempts per day ──────────────────────────────────────────────────
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: since }, prompt: { contains: '"intent":"VIP_PREMIUM"' } }, select: { createdAt: true, prompt: true, predictions: { select: { status: true, provenance: true } } } });
  const perDay = new Map<string, { attempts: number; drafts: number; promoted: number; leagues: Tally }>();
  for (const j of jobs) {
    const day = lagosDateKey(j.createdAt);
    const e = perDay.get(day) ?? { attempts: 0, drafts: 0, promoted: 0, leagues: {} };
    e.attempts++;
    e.drafts += j.predictions.length;
    e.promoted += j.predictions.filter((p) => (PAID_ONLY_PROVENANCES as readonly string[]).includes(p.provenance ?? "")).length;
    try { add(e.leagues, JSON.parse(j.prompt).league ?? "?"); } catch { /* unparseable */ }
    perDay.set(day, e);
  }
  console.log(`\n2. Dedicated attempts per Lagos day (quota ${VIP_PREMIUM_DAILY_QUOTA}):`);
  for (const [day, e] of [...perDay.entries()].sort()) console.log(`   ${day}  attempts ${pad(e.attempts, 2)}  drafts ${pad(e.drafts, 3)}  promoted ${pad(e.promoted, 2)}  — ${show(e.leagues)}`);
  if (!perDay.size) console.log("   none");

  // ── 3. Feed contents per kickoff day ─────────────────────────────────────
  const paid = await prisma.prediction.findMany({
    where: { kickoff: { gte: since, lte: new Date(now.getTime() + 48 * H) }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } },
    select: { id: true, status: true, outcome: true, provenance: true, kickoff: true, confidence: true, marketType: true, homeTeam: true, awayTeam: true, leagueName: true, market: true, pick: true, marketConfirmation: true, categories: { select: { category: true } } },
  });
  type Day = { VIP: Tally; PREMIUM: Tally };
  const feed = new Map<string, Day>();
  for (const p of paid) {
    if (p.status !== "PUBLISHED" || !p.kickoff) continue;
    const day = lagosDateKey(p.kickoff);
    const e = feed.get(day) ?? { VIP: {}, PREMIUM: {} };
    const kind = (PAID_ONLY_PROVENANCES as readonly string[]).includes(p.provenance ?? "") ? "dedicated" : "ordinary";
    for (const c of p.categories.map((x) => x.category)) {
      if (c !== "VIP" && c !== "PREMIUM") continue;
      add(e[c], kind);
      add(e[c], `${kind}:${p.outcome}`);
    }
    feed.set(day, e);
  }
  console.log(`\n3. Published paid feeds per Lagos kickoff day (dedicated = paid-only pick; ordinary = fallback overlap):`);
  for (const [day, e] of [...feed.entries()].sort()) {
    console.log(`   ${day}  VIP: ${show(e.VIP)}`);
    console.log(`   ${" ".repeat(10)}  PREMIUM: ${show(e.PREMIUM)}`);
  }
  if (!feed.size) console.log("   nothing published in VIP or PREMIUM in this window");

  // ── 4. Every dedicated pick ──────────────────────────────────────────────
  const dedicated = await prisma.prediction.findMany({
    where: { kickoff: { gte: since }, provenance: { in: [...PAID_ONLY_PROVENANCES] } },
    orderBy: { kickoff: "asc" },
    select: { status: true, outcome: true, provenance: true, kickoff: true, confidence: true, homeTeam: true, awayTeam: true, leagueName: true, market: true, pick: true, marketConfirmation: true },
  });
  console.log(`\n4. Dedicated paid picks with kickoff in the window: ${dedicated.length}`);
  for (const p of dedicated) {
    const mc = (p.marketConfirmation as any) ?? {};
    console.log(`   ${p.kickoff ? lagosDateKey(p.kickoff) : "?"}  ${p.provenance === "PREMIUM_GENERATED" ? "PREMIUM" : "VIP    "}  ${p.status.padEnd(14)} ${p.outcome.padEnd(7)} ${p.homeTeam} v ${p.awayTeam} (${p.leagueName}) — ${p.market}: ${p.pick} · model ${p.confidence}% · market ${mc.marketProbability != null ? Number(mc.marketProbability).toFixed(1) + "%" : "?"}`);
  }

  // ── 5. Record since the cutover ──────────────────────────────────────────
  const settled = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: PAID_TIER_CUTOVER }, outcome: { not: "PENDING" }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } },
    select: { outcome: true, provenance: true, categories: { select: { category: true } } },
  });
  const rec: Record<string, Tally> = {};
  for (const s of settled) {
    const kind = (PAID_ONLY_PROVENANCES as readonly string[]).includes(s.provenance ?? "") ? "dedicated" : "ordinary";
    for (const c of s.categories.map((x) => x.category)) if (c === "VIP" || c === "PREMIUM") add((rec[`${c} ${kind}`] ??= {}), s.outcome);
  }
  console.log(`\n5. Settled record since the paid-tier cutover (${PAID_TIER_CUTOVER.toISOString().slice(0, 10)}):`);
  for (const [k, t] of Object.entries(rec).sort()) {
    const w = t.WON ?? 0, l = t.LOST ?? 0;
    console.log(`   ${k.padEnd(18)} ${show(t)}${w + l ? `  → strike ${((100 * w) / (w + l)).toFixed(0)}%` : ""}`);
  }
  if (!settled.length) console.log("   nothing settled yet");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
