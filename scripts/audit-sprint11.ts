/**
 * VIP/Premium Sprint 11: production validation audit. READ-ONLY.
 *
 *   1. Job health since deploy and over 7 days: every known scheduled job's
 *      runs, failures and last run; open generation failures; duplicate
 *      safeguards (one paid pick per fixture, one ledger fixture per id).
 *   2. Double Chance fix: for covered paid-scope fixtures, the targeting signal
 *      with and without the fix (legacy behaviour reproduced exactly), and
 *      what the dedicated pass did with the newly targetable fixtures before
 *      and after the deploy: targeted, attempted, drafted, promoted, published.
 *   3. Spare-quota shadow: the pass's recorded spareQuota block per run since
 *      the Sprint 09 deploy (mode, slots per Lagos day, eligible, would-be
 *      targets), and whether those fixtures reached VIP another way.
 *   4. Paid subscriber value: free, confidence-matched free, ordinary VIP,
 *      dedicated VIP, PREMIUM, newer vs older. Strike with Wilson intervals,
 *      calibration, market gap and books, and two ROIs kept apart:
 *        observed  at the price recorded when the pick was confirmed
 *                  (verifiedEntryPrice; dedicated picks only),
 *        estimated at the last pre-kickoff cached median (closing reference).
 *   5. Dry days: every past Lagos kickoff day with no VIP or PREMIUM
 *      publication, with its first failing stage (classifyDryDay).
 *   6. Spend: api-football calls per UTC day; model jobs, tokens and estimated
 *      cost per Lagos day and pass.
 *
 * No provider calls, no api-football calls, no writes.
 *
 * Run: REQUIRE_READ_ONLY=1 npx tsx scripts/audit-sprint11.ts [days=30]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { matchKey } from "../src/lib/slug";
import type { FixtureOdds } from "../src/lib/odds";
import { pickPrice } from "../src/lib/paidSelection";
import { verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
import { isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { DEDICATED_PAID_PROVENANCES, VIP_CONFIDENCE_FLOOR } from "../src/lib/geniusCuration";
import { scopeGroup } from "../src/lib/paidOpportunity";
import { VIP_PREMIUM_INTENT } from "../src/lib/vipPremiumOverlay";
import { KNOWN_JOBS, JOB_GENERATE_VIP_PREMIUM } from "../src/lib/jobRuns";
import { spendByPass } from "../src/lib/generation/stats";
import {
  ADDRESSABLE_WITHOUT_LOWERING_BARS, DC_FIX_DEPLOYED_AT, MIN_DECIDED_FOR_READING, SPARE_QUOTA_DEPLOYED_AT, TARGET_BAR,
  classifyDryDay, compareDcSignals, summariseSpareQuotaRuns, wilsonPct, type DcComparison, type DryDayReason,
} from "../src/lib/sprint11Audit";

const H = 3_600_000, DAY = 24 * H;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));
const ci = (k: number, n: number) => { const w = wilsonPct(k, n); return w ? `${w[0]}–${w[1]}%` : "—"; };
const hdr = (s: string) => console.log(`\n== ${s} ==`);
const intentOf = (prompt: string | null | undefined) => { try { return JSON.parse(prompt ?? "null")?.intent ?? null; } catch { return null; } };

async function main() {
  if (process.env.REQUIRE_READ_ONLY !== "1") throw new Error("refusing: REQUIRE_READ_ONLY=1 is required");
  const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  const days = Math.min(60, Math.max(7, Number(process.argv[2]) || 30));
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  console.log(`session verified read-only; now ${now.toISOString()}; window ${days} days (kickoffs from ${from.toISOString().slice(0, 10)})`);
  console.log(`deploys: Sprint 08-09 live ${SPARE_QUOTA_DEPLOYED_AT.toISOString()}, Sprint 10 (DC fix) live ${DC_FIX_DEPLOYED_AT.toISOString()}; ` +
    `observed since DC fix: ${((now.getTime() - DC_FIX_DEPLOYED_AT.getTime()) / H).toFixed(1)}h`);

  // ── 1. Job health ─────────────────────────────────────────────────────────
  hdr("1. Scheduled job health (JobRun)");
  const runs = await prisma.jobRun.findMany({ where: { ranAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { job: true, ranAt: true, ok: true, summary: true, ms: true } });
  console.log("   job                          7d runs  7d fail  since-deploy runs/fail  last run (UTC)           last ok?  last summary");
  for (const job of [...new Set([...KNOWN_JOBS, ...runs.map((r) => r.job)])]) {
    const rs = runs.filter((r) => r.job === job).sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
    const since = rs.filter((r) => r.ranAt >= SPARE_QUOTA_DEPLOYED_AT);
    const last = rs[rs.length - 1];
    console.log(`   ${job.padEnd(28)} ${String(rs.length).padStart(7)}  ${String(rs.filter((r) => !r.ok).length).padStart(7)}  ${`${since.length}/${since.filter((r) => !r.ok).length}`.padStart(22)}  ${(last?.ranAt.toISOString() ?? "never in 7d").padEnd(24)} ${String(last?.ok ?? "—").padStart(7)}  ${(last?.summary ?? "").slice(0, 90)}`);
  }
  const fails = await prisma.generationFailure.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { source: true, errorName: true, createdAt: true, resolvedAt: true, dismissedAt: true } });
  const fb = new Map<string, { n: number; open: number; sinceDeploy: number }>();
  for (const f of fails) {
    const k = `${f.source} · ${f.errorName}`;
    const x = fb.get(k) ?? { n: 0, open: 0, sinceDeploy: 0 };
    x.n++; if (!f.resolvedAt && !f.dismissedAt) x.open++; if (f.createdAt >= SPARE_QUOTA_DEPLOYED_AT) x.sinceDeploy++;
    fb.set(k, x);
  }
  console.log(`\n   generation failures, 7 days: ${fails.length} (open ${fails.filter((f) => !f.resolvedAt && !f.dismissedAt).length}, since deploy ${fails.filter((f) => f.createdAt >= SPARE_QUOTA_DEPLOYED_AT).length})`);
  for (const [k, x] of [...fb.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`     ${k.padEnd(48)} ${x.n} (open ${x.open}, since deploy ${x.sinceDeploy})`);

  // Duplicate safeguards.
  const paid = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", kickoff: { gte: from }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { id: true, kickoff: true, homeTeamApiId: true, awayTeamApiId: true, fixtureApiId: true, categories: { select: { category: true } } },
  });
  for (const tier of ["VIP", "PREMIUM"]) {
    const seen = new Map<string, number>();
    for (const p of paid.filter((x) => x.categories.some((c) => c.category === tier))) {
      const k = matchKey(p) ?? p.id;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dup = [...seen.values()].filter((n) => n > 1).length;
    console.log(`   duplicate safeguard: ${tier} fixtures with more than one published pick: ${dup} of ${seen.size}`);
  }
  const both = paid.filter((p) => p.categories.some((c) => c.category === "VIP") && p.categories.some((c) => c.category === "PREMIUM")).length;
  console.log(`   rows tagged VIP and PREMIUM at once: ${both}`);
  const ledgerDup = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM (SELECT "fixtureApiId" FROM "GenerationAttempt" WHERE "fixtureApiId" IS NOT NULL AND kickoff >= $1 AND status = 'SUCCEEDED' GROUP BY "fixtureApiId" HAVING count(*) > 1) d`, from);
  console.log(`   ledger: fixture ids with more than one SUCCEEDED row (rescheduled or duplicated): ${Number(ledgerDup[0]?.n ?? 0)}`);

  // ── Shared fixture model for sections 2, 4, 5 ────────────────────────────
  const ledger = await prisma.generationAttempt.findMany({
    where: { kickoff: { gte: from, lte: new Date(now.getTime() + 2 * DAY) } },
    select: { matchKey: true, fixtureApiId: true, leagueApiId: true, leagueName: true, kickoff: true, status: true, homeTeam: true, awayTeam: true },
  });
  const preds = await prisma.prediction.findMany({
    where: { kickoff: { gte: from, lte: new Date(now.getTime() + 2 * DAY) }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: {
      id: true, status: true, kickoff: true, leagueApiId: true, homeTeamApiId: true, awayTeamApiId: true, fixtureApiId: true, homeTeam: true, awayTeam: true,
      marketType: true, selection: true, confidence: true, provenance: true, outcome: true, createdAt: true, publishedAt: true, marketConfirmation: true,
      categories: { select: { category: true } }, aiJob: { select: { prompt: true } },
    },
    take: 80_000,
  });
  const keys = [...new Set([...ledger.map((l) => l.matchKey), ...preds.map((p) => matchKey(p)).filter((k): k is string => !!k)])];
  const quotes = new Map<string, { odds: FixtureOdds | null; fetchedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const q of await prisma.fixtureOddsCache.findMany({ where: { matchKey: { in: keys.slice(i, i + 500) } }, select: { matchKey: true, oddsJson: true, fetchedAt: true } })) {
      quotes.set(q.matchKey, { odds: (q.oddsJson as unknown as FixtureOdds | null) ?? null, fetchedAt: q.fetchedAt });
    }
  }
  type Fx = {
    key: string; kickoff: Date; day: string; league: number | null; group: ReturnType<typeof scopeGroup>; name: string; covered: boolean;
    dc: ReturnType<typeof compareDcSignals> | null; preKickoffQuote: boolean;
    attempted: boolean; firstAttemptAt: Date | null; drafts: number; draftsAt75: number; promoted: boolean; published: boolean; vip: boolean; premium: boolean;
  };
  const fx = new Map<string, Fx>();
  const getFx = (key: string, kickoff: Date, league: number | null, name: string) => {
    let x = fx.get(key);
    if (!x) {
      const q = quotes.get(key);
      const usable = !!q?.fetchedAt && (kickoff > now || q.fetchedAt < kickoff);
      x = { key, kickoff, day: lagosDateKey(kickoff), league, group: scopeGroup(league), name, covered: false, dc: usable ? compareDcSignals(q!.odds) : null, preKickoffQuote: usable,
        attempted: false, firstAttemptAt: null, drafts: 0, draftsAt75: 0, promoted: false, published: false, vip: false, premium: false };
      fx.set(key, x);
    }
    return x;
  };
  for (const l of ledger) { const x = getFx(l.matchKey, l.kickoff, l.leagueApiId, `${l.homeTeam} v ${l.awayTeam}`); if (l.status === "SUCCEEDED") x.covered = true; }
  for (const p of preds) {
    const k = matchKey(p); if (!k || !p.kickoff) continue;
    const x = getFx(k, p.kickoff, p.leagueApiId, `${p.homeTeam} v ${p.awayTeam}`);
    const cats = p.categories.map((c) => c.category);
    const dedicated = (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "");
    if (intentOf(p.aiJob?.prompt) === VIP_PREMIUM_INTENT) {
      x.attempted = true; x.drafts++; if (p.confidence >= VIP_CONFIDENCE_FLOOR) x.draftsAt75++;
      if (!x.firstAttemptAt || p.createdAt < x.firstAttemptAt) x.firstAttemptAt = p.createdAt;
      if (dedicated) { x.promoted = true; if (p.status === "PUBLISHED") x.published = true; }
    }
    if (p.status === "PUBLISHED") { if (cats.includes("VIP")) x.vip = true; if (cats.includes("PREMIUM")) x.premium = true; }
  }
  const all = [...fx.values()];
  const coveredScoped = all.filter((x) => x.covered && x.group !== "OUTSIDE");

  // ── 2. Double Chance ──────────────────────────────────────────────────────
  hdr("2. Double Chance label fix (Draw/Away vs Away/Draw)");
  console.log("   Signal on the fixture's cached quote (past fixtures: last PRE-KICKOFF quote only; upcoming: current quote). The quote the pass saw at decision time is not stored, so this is a closing-reference reconstruction.");
  const kinds: DcComparison[] = ["UNCHANGED", "NEWLY_TARGETABLE", "AWAY_DC_STRONGER_ABOVE_BAR", "AWAY_DC_STRONGER_BELOW_BAR", "BOTH_NONE"];
  for (const g of ["PAID_CORE", "PAID_WIDENED"] as const) {
    const xs = coveredScoped.filter((x) => x.group === g && x.dc);
    console.log(`   ${g}: covered with a usable quote ${xs.length}; ` + kinds.map((k) => `${k} ${xs.filter((x) => x.dc!.kind === k).length}`).join(", "));
  }
  const nonAwayChanged = coveredScoped.filter((x) => x.dc && x.dc.kind !== "UNCHANGED" && x.dc.kind !== "BOTH_NONE" && !(x.dc.fixed?.market === "Double Chance" && /away/i.test(x.dc.fixed.value)));
  console.log(`   regression guard: fixtures whose signal changed to anything other than away Double Chance: ${nonAwayChanged.length} (must be 0)`);
  const homeDc = coveredScoped.filter((x) => x.dc?.legacy?.market === "Double Chance" && x.dc.legacy.value === "Home/Draw");
  console.log(`   home Double Chance headline under the old code: ${homeDc.length}; still home Double Chance with the same probability under the fix: ${homeDc.filter((x) => x.dc!.fixed?.value === "Home/Draw" && x.dc!.fixed.probability === x.dc!.legacy!.probability).length}`);
  const newly = coveredScoped.filter((x) => x.dc?.kind === "NEWLY_TARGETABLE");
  const before = newly.filter((x) => x.kickoff < DC_FIX_DEPLOYED_AT), after = newly.filter((x) => x.kickoff >= DC_FIX_DEPLOYED_AT);
  const funnel = (xs: Fx[], label: string) => console.log(`   ${label.padEnd(44)} newly targetable ${String(xs.length).padStart(4)} | attempted ${xs.filter((x) => x.attempted).length} | drafts at 75+ on ${xs.filter((x) => x.draftsAt75 > 0).length} | promoted ${xs.filter((x) => x.promoted).length} | published dedicated ${xs.filter((x) => x.published).length} | in VIP/PREMIUM any route ${xs.filter((x) => x.vip || x.premium).length}`);
  funnel(before, "historical baseline (kickoff before fix)");
  funnel(after, "kickoff after fix (incl. upcoming)");
  const attemptedAfterFix = newly.filter((x) => x.firstAttemptAt && x.firstAttemptAt >= DC_FIX_DEPLOYED_AT);
  console.log(`   newly targetable fixtures first attempted after the deploy: ${attemptedAfterFix.length} (each = 1 model request); incremental = published dedicated with no ordinary VIP/PREMIUM on the fixture is reported in section 4 once settled`);
  for (const x of attemptedAfterFix.slice(0, 15)) console.log(`     ${x.day} ${x.group} ${x.name} signal ${f1(x.dc!.fixed?.probability)} drafts ${x.drafts} at75 ${x.draftsAt75} promoted ${x.promoted} published ${x.published}`);

  // What the pass recorded itself: targets by market, before vs after.
  const vipRuns = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: from } }, select: { ranAt: true, ok: true, summary: true, detail: true }, orderBy: { ranAt: "asc" } });
  const tgt = (rs: typeof vipRuns) => {
    const m: Record<string, number> = {}; let n = 0;
    for (const r of rs) for (const t of ((r.detail as any)?.vipPremium?.targets ?? []) as Array<{ market: string; selection: string }>) { n++; const k = `${t.market} ${t.selection}`; m[k] = (m[k] ?? 0) + 1; }
    return { n, m };
  };
  const tb = tgt(vipRuns.filter((r) => r.ranAt < DC_FIX_DEPLOYED_AT)), ta = tgt(vipRuns.filter((r) => r.ranAt >= DC_FIX_DEPLOYED_AT));
  console.log(`   recorded targets (JobRun), before fix: ${tb.n} ${JSON.stringify(tb.m)}`);
  console.log(`   recorded targets (JobRun), after fix:  ${ta.n} ${JSON.stringify(ta.m)}`);

  // ── 3. Spare quota ────────────────────────────────────────────────────────
  hdr("3. Spare kickoff-day quota (PAID_SPARE_QUOTA_WIDENING)");
  const sinceSpare = vipRuns.filter((r) => r.ranAt >= SPARE_QUOTA_DEPLOYED_AT);
  const s = summariseSpareQuotaRuns(sinceSpare.map((r) => ({ ranAt: r.ranAt, spare: (r.detail as any)?.vipPremium?.spareQuota })));
  const preBlocks = vipRuns.filter((r) => r.ranAt < SPARE_QUOTA_DEPLOYED_AT && (r.detail as any)?.vipPremium?.spareQuota).length;
  const observedH = sinceSpare.length ? (now.getTime() - SPARE_QUOTA_DEPLOYED_AT.getTime()) / H : 0;
  console.log(`   observed ${observedH.toFixed(1)}h since deploy; pass runs ${s.runs}; runs recording the block ${s.withBlock}; modes ${JSON.stringify(s.modes)} (pre-deploy runs with a block: ${preBlocks})`);
  console.log(`   mode "on" seen: ${s.modes.on ? "YES — production is live, not shadow" : "no"}; standDowns/skips since deploy: ${sinceSpare.filter((r) => (r.detail as any)?.skipped || (r.detail as any)?.ok === false).length}`);
  console.log(`   spare slots by Lagos day (max seen): ${JSON.stringify(s.slotsByDay)}; eligible (summed over runs) ${s.eligibleRunSum}; qualified from cache (summed over runs) ${s.qualifiedRunSum}`);
  console.log(`   distinct would-be targets: ${s.wouldTarget.length}`);
  for (const w of s.wouldTarget) {
    const x = all.find((f) => f.name.replace(" v ", " vs ") === w.fixture && Math.abs(f.kickoff.getTime() - Date.parse(w.kickoff)) < H);
    console.log(`     ${w.kickoff} ${w.fixture} league ${w.leagueApiId} market ${w.maxMarket}% runs ${w.runs} | reached VIP/PREMIUM another way: ${x ? (x.vip || x.premium ? "yes" : x.kickoff > now ? "pending (upcoming)" : "no") : "fixture not matched"}`);
  }
  console.log(`   overhead: shadow reads cached quotes only (no provider or api-football call); oddsCalls since deploy ${sinceSpare.reduce((a, r) => a + ((r.detail as any)?.vipPremium?.oddsCalls ?? 0), 0)} (all for live targets)`);
  console.log(`   Sprint 09 historical estimate (~3.8 extra VIP/month) is NOT a prospective result; compare only once >= 30 days are observed.`);

  // ── 4. Value ──────────────────────────────────────────────────────────────
  hdr("4. Paid subscriber value (published singles, settled; each fixture once per tier)");
  const settled = preds.filter((p) => p.status === "PUBLISHED" && p.kickoff && p.kickoff < new Date(now.getTime() - 3 * H));
  type V = { conf: number; outcome: string; est: number | null; fair: number | null; books: number | null; entry: number | null; mkt: number | null };
  const val = (p: (typeof settled)[number]): V => {
    const k = matchKey(p); const q = k ? quotes.get(k) : undefined;
    const pre = !!q?.fetchedAt && q.fetchedAt < p.kickoff!;
    const price = pre ? pickPrice(q!.odds, p.marketType, p.selection) : null;
    const mc = p.marketConfirmation as any;
    return { conf: p.confidence, outcome: p.outcome, est: price?.median ?? null, fair: price?.fair ?? null, books: price?.bookmakers ?? null,
      entry: verifiedEntryPrice(mc, p.kickoff!), mkt: typeof mc?.marketProbability === "number" ? mc.marketProbability : null };
  };
  const once = (rows: typeof settled) => { const m = new Map<string, (typeof settled)[number]>(); for (const r of rows) { const k = matchKey(r) ?? r.id; if (!m.has(k) || r.confidence > m.get(k)!.confidence) m.set(k, r); } return [...m.values()]; };
  const isDed = (p: (typeof settled)[number]) => (DEDICATED_PAID_PROVENANCES as readonly string[]).includes(p.provenance ?? "");
  const cat = (p: (typeof settled)[number], c: string) => p.categories.some((x) => x.category === c);
  const freeRows = settled.filter((p) => !isPaidOnlyProvenance(p.provenance) && !cat(p, "VIP") && !cat(p, "PREMIUM"));
  const tiers: Array<[string, typeof settled]> = [
    ["Free (all free singles)", once(freeRows)],
    ["Free, confidence >= 75", once(freeRows.filter((p) => p.confidence >= VIP_CONFIDENCE_FLOOR))],
    ["VIP ordinary (curated)", once(settled.filter((p) => cat(p, "VIP") && !isDed(p)))],
    ["VIP dedicated", once(settled.filter((p) => cat(p, "VIP") && isDed(p)))],
    ["PREMIUM (all)", once(settled.filter((p) => cat(p, "PREMIUM")))],
  ];
  const split = new Date(now.getTime() - 14 * DAY);
  console.log(`   ROI: flat 1 unit. "obs" = at the price recorded when the pick was confirmed (dedicated only). "est" = last pre-kickoff cached median (closing reference, NOT a subscriber entry price).`);
  console.log(`   Reading requires >= ${MIN_DECIDED_FOR_READING} decided; smaller samples are marked (anecdotal).`);
  console.log("   tier                         period   n   dec  strike  95% CI   conf  calib  mkt  gap  books | obs n  obs ROI | est n  est ROI");
  for (const [name, rows] of tiers) {
    for (const [period, rs] of [["all", rows], ["older", rows.filter((r) => r.kickoff! < split)], ["last14d", rows.filter((r) => r.kickoff! >= split)]] as const) {
      const v = rs.map(val);
      const dec = v.filter((x) => x.outcome === "WON" || x.outcome === "LOST");
      const won = dec.filter((x) => x.outcome === "WON").length;
      const strike = dec.length ? (100 * won) / dec.length : null;
      const conf = dec.length ? dec.reduce((a, x) => a + x.conf, 0) / dec.length : null;
      const withFair = dec.filter((x) => x.fair != null);
      const mkt = withFair.length ? withFair.reduce((a, x) => a + x.fair!, 0) / withFair.length : null;
      const gap = withFair.length ? withFair.reduce((a, x) => a + (x.conf - x.fair!), 0) / withFair.length : null;
      const books = dec.filter((x) => x.books != null);
      const roi = (xs: V[], price: (x: V) => number | null) => { const p = xs.filter((x) => price(x) != null); return { n: p.length, roi: p.length ? (100 * p.reduce((a, x) => a + (x.outcome === "WON" ? price(x)! - 1 : -1), 0)) / p.length : null }; };
      const obs = roi(dec, (x) => x.entry), est = roi(dec, (x) => x.est);
      const flag = dec.length < MIN_DECIDED_FOR_READING ? " (anecdotal)" : "";
      console.log(`   ${name.padEnd(28)} ${period.padEnd(7)} ${String(rs.length).padStart(4)} ${String(dec.length).padStart(4)}  ${f1(strike).padStart(5)}%  ${ci(won, dec.length).padStart(8)}  ${f1(conf).padStart(4)}  ${strike != null && conf != null ? f1(conf - strike).padStart(5) : "    —"}  ${f1(mkt).padStart(4)} ${f1(gap).padStart(4)}  ${books.length ? f1(books.reduce((a, x) => a + x.books!, 0) / books.length).padStart(4) : "   —"} | ${String(obs.n).padStart(5)}  ${(obs.roi == null ? "—" : `${obs.roi.toFixed(1)}%`).padStart(7)} | ${String(est.n).padStart(5)}  ${(est.roi == null ? "—" : `${est.roi.toFixed(1)}%`).padStart(7)}${flag}`);
    }
  }
  console.log("   calib = mean stated confidence minus realised strike (positive = overconfident). gap = confidence minus de-vigged closing market.");
  // Publishing reliability of dedicated promotions.
  const promotedRows = preds.filter((p) => isDed(p) && p.kickoff && p.kickoff < now);
  console.log(`   dedicated promotions with kickoff in window: ${promotedRows.length}; published ${promotedRows.filter((p) => p.status === "PUBLISHED").length}; published after kickoff ${promotedRows.filter((p) => p.publishedAt && p.publishedAt >= p.kickoff!).length}`);

  // ── 5. Dry days ───────────────────────────────────────────────────────────
  hdr("5. Dry days: Lagos kickoff days with no VIP or PREMIUM publication (first failing stage)");
  const vipFails = await prisma.generationFailure.findMany({ where: { source: "VIP/Premium", kickoff: { gte: from } }, select: { kickoff: true } });
  const pastDays = [...new Set(all.filter((x) => x.kickoff < now && x.kickoff >= from).map((x) => x.day))].sort();
  const lastFull = lagosDateKey(new Date(now.getTime() - DAY));
  const reasons: Record<string, number> = {};
  let zero = 0, thin = 0;
  for (const day of pastDays.filter((d) => d <= lastFull && d > lagosDateKey(from))) {
    const xs = all.filter((x) => x.day === day);
    const paidFx = xs.filter((x) => x.vip || x.premium).length;
    if (paidFx <= 2) thin++;
    if (paidFx > 0) continue;
    zero++;
    const dayStart = Date.parse(`${day}T00:00:00+01:00`), dayEnd = dayStart + DAY;
    const widenedRunTimes = vipRuns.filter((r) => (r.detail as any)?.vipPremium?.widened).map((r) => r.ranAt.getTime());
    const covered = xs.filter((x) => x.covered);
    const scoped = covered.filter((x) => x.group !== "OUTSIDE");
    const priced = scoped.filter((x) => x.dc?.fixed);
    const targetable = priced.filter((x) => (x.dc!.fixed!.probability >= TARGET_BAR) &&
      (x.group === "PAID_CORE" || widenedRunTimes.some((t) => t >= x.kickoff.getTime() - 48 * H && t <= x.kickoff.getTime() - 12 * H)));
    const standDowns = vipRuns.filter((r) => r.ranAt.getTime() >= dayStart - 48 * H && r.ranAt.getTime() <= dayEnd - 12 * H && ((r.detail as any)?.skipped || /budget|quota/i.test(String((r.detail as any)?.reason ?? "")))).length;
    const reason: DryDayReason = classifyDryDay({
      covered: covered.length, inPaidScope: scoped.length, pricedInScope: priced.length, targetable: targetable.length,
      attempted: scoped.filter((x) => x.attempted).length, drafts: scoped.reduce((a, x) => a + x.drafts, 0), draftsAt75: scoped.reduce((a, x) => a + x.draftsAt75, 0),
      promoted: scoped.filter((x) => x.promoted).length, published: scoped.filter((x) => x.published).length,
      generationFailures: vipFails.filter((f) => f.kickoff && lagosDateKey(f.kickoff) === day).length, standDowns,
    });
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    console.log(`   ${day}: covered ${covered.length}, paid scope ${scoped.length}, priced ${priced.length}, targetable ${targetable.length}, attempted ${scoped.filter((x) => x.attempted).length}, drafts>=75 ${scoped.reduce((a, x) => a + x.draftsAt75, 0)}, stand-downs ${standDowns} -> ${reason}${ADDRESSABLE_WITHOUT_LOWERING_BARS.has(reason) ? " (addressable without lowering bars)" : ""}`);
  }
  console.log(`   past full days ${pastDays.filter((d) => d <= lastFull && d > lagosDateKey(from)).length}; zero-paid days ${zero}; days with <= 2 paid fixtures ${thin}; reasons ${JSON.stringify(reasons)}`);

  // ── 6. Spend ──────────────────────────────────────────────────────────────
  hdr("6. Spend");
  const usage = await prisma.apiUsage.findMany({ where: { day: { gte: new Date(now.getTime() - 8 * DAY).toISOString().slice(0, 10) } }, select: { day: true, count: true } });
  const byDay = new Map<string, number>();
  for (const u of usage) byDay.set(u.day, (byDay.get(u.day) ?? 0) + u.count);
  console.log(`   api-football calls per UTC day: ${[...byDay.entries()].sort().map(([d, n]) => `${d} ${n}`).join(", ")}`);
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 8 * DAY) } }, select: { prompt: true, model: true, status: true, promptTokens: true, outputTokens: true, createdAt: true } });
  const spend = spendByPass(jobs);
  const perDay = new Map<string, { jobs: number; cost: number; vip: number; vipCost: number }>();
  for (const r of spend) {
    const x = perDay.get(r.day) ?? { jobs: 0, cost: 0, vip: 0, vipCost: 0 };
    x.jobs += r.jobs; x.cost += r.costUsd; if (r.pass === "VIP/Premium") { x.vip += r.jobs; x.vipCost += r.costUsd; }
    perDay.set(r.day, x);
  }
  for (const [d, x] of [...perDay.entries()].sort()) console.log(`   ${d}: model jobs ${x.jobs}, est. $${x.cost.toFixed(3)}; of which VIP/Premium pass ${x.vip} jobs, $${x.vipCost.toFixed(3)}`);
  const models: Record<string, number> = {};
  for (const j of jobs.filter((j) => j.createdAt >= SPARE_QUOTA_DEPLOYED_AT)) models[j.model] = (models[j.model] ?? 0) + 1;
  console.log(`   models used since deploy: ${JSON.stringify(models)}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
