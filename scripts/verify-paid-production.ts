/**
 * Production verification and paid-lifecycle audit. READ-ONLY.
 *
 *   1. Deployment: the shadow log is being written, in shadow mode, with the
 *      calibration inactive; curation (settle) and the paid pass still run.
 *   2. Subscribers: counts by tier and resolved status (no personal data).
 *   3. Lifecycle, last 30 days: publication lead time, picks added to a paid
 *      feed after kickoff (from the shadow log), duplicate or contradictory
 *      paid picks per fixture, generation failures, attempt allocation, odds
 *      errors, settlement lag and backlog, and each day's paid-ops status.
 *   4. Public leak probe: anonymous GETs of the public site and APIs, searched
 *      for the reasoning text of today's paid-only (dedicated) picks, which
 *      appear nowhere public if access control holds; and the predictions API
 *      checked for unlocked or field-leaking paid rows.
 *
 * The probe makes plain anonymous GET requests to PUBLIC_ORIGIN (default the
 * production site); it carries no credentials and changes nothing.
 *
 * Run: npx tsx --env-file=.env scripts/verify-paid-production.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey, lagosDayBounds } from "../src/lib/lagosDate";
import { resolveSubscription } from "../src/lib/entitlement";
import { JOB_GENERATE_VIP_PREMIUM, JOB_SETTLE } from "../src/lib/jobRuns";
import { JOB_PAID_SELECTION_SHADOW } from "../src/lib/vipPremiumPipeline";
import { PAID_ONLY_PROVENANCES, isPaidOnlyProvenance } from "../src/lib/paidOnly";
import { PAID_TIER_CUTOVER, paidFixtureKey } from "../src/lib/geniusCuration";
import { loadPaidOpsSnapshot } from "../src/lib/paidOpsData";
import { CALIBRATION_ARTIFACT } from "../src/lib/calibrationArtifact";

const H = 3_600_000;
const DEPLOY_AT = new Date(process.env.DEPLOY_AT ?? "2026-11-13T14:52:04Z");
const ORIGIN = (process.env.PUBLIC_ORIGIN ?? "https://www.betgenius.ng").replace(/\/$/, "");
let fails = 0;
const verdict = (ok: boolean, label: string, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); };
const tally = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const pct = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const hrs = (ms: number | null) => (ms == null ? "—" : `${(ms / H).toFixed(1)}h`);

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  const now = new Date();
  console.log(`\nNow ${now.toISOString()}; deploy marker ${DEPLOY_AT.toISOString()}; public origin ${ORIGIN}`);

  // ── 1. Deployment ───────────────────────────────────────────────────────
  console.log("\n1. Deployment of #176");
  const [shadow, settles, passRuns, promos] = await Promise.all([
    prisma.jobRun.findMany({ where: { job: JOB_PAID_SELECTION_SHADOW }, select: { ranAt: true, summary: true, detail: true }, orderBy: { ranAt: "desc" }, take: 500 }),
    prisma.jobRun.findMany({ where: { job: JOB_SETTLE, ranAt: { gte: DEPLOY_AT } }, select: { ranAt: true, ok: true, summary: true }, orderBy: { ranAt: "asc" } }),
    prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: DEPLOY_AT } }, select: { ranAt: true, ok: true, summary: true }, orderBy: { ranAt: "asc" } }),
    prisma.prediction.findMany({ where: { provenance: { in: [...PAID_ONLY_PROVENANCES] }, updatedAt: { gte: DEPLOY_AT } }, select: { id: true, status: true, marketConfirmation: true } }),
  ]);
  const since = shadow.filter((s) => s.ranAt >= DEPLOY_AT);
  console.log(`  settle runs since deploy: ${settles.length} (${settles.filter((s) => s.ok).length} ok) ${settles.map((s) => s.ranAt.toISOString().slice(11, 16)).join(" ")}`);
  console.log(`  paid-pass runs since deploy: ${passRuns.length} (${passRuns.filter((s) => s.ok).length} ok); last: ${passRuns.at(-1)?.summary?.slice(0, 140) ?? "—"}`);
  console.log(`  shadow runs since deploy: ${since.length}; modes ${JSON.stringify(tally(since, (s) => `${(s.detail as any)?.mode}/${(s.detail as any)?.live}`))}; fallbacks ${JSON.stringify(tally(since, (s) => String((s.detail as any)?.fallback ?? "none")))}`);
  for (const s of since.slice(0, 4)) console.log(`     ${s.ranAt.toISOString().slice(0, 16)} ${s.summary}`);
  verdict(CALIBRATION_ARTIFACT?.active === false, "calibration artifact in the deployed code is inactive", CALIBRATION_ARTIFACT?.version ?? "none");
  verdict(passRuns.length > 0 && passRuns.some((r) => r.ok), "VIP/Premium generation still runs after deploy", `${passRuns.length} runs`);
  if (settles.length === 0) console.log("  NOTE  no settle run since deploy yet — curation (and so the shadow log) runs with settle every 3h");
  else verdict(since.length > 0, "shadow records are written by curation", `${since.length} rows after ${settles.length} settle runs`);
  verdict(since.every((s) => (s.detail as any)?.mode === "shadow" && (s.detail as any)?.live === "current"), "every shadow record is mode shadow with live decisions on the #175 rule");
  verdict(since.every((s) => (s.detail as any)?.calibrationActive === false), "no shadow record used an active calibration");
  const withRecord = promos.filter((p) => (p.marketConfirmation as any)?.calibrationVersion !== undefined);
  console.log(`  dedicated picks promoted since deploy: ${promos.length}; with the frozen value record: ${withRecord.length}`);

  // ── 2. Subscribers ──────────────────────────────────────────────────────
  console.log("\n2. Subscriptions (counts only)");
  const subs = await prisma.subscription.findMany({ select: { tier: true, status: true, currentPeriodEnd: true, currentPeriodStart: true } });
  const resolved = subs.map((s) => ({ raw: `${s.tier}/${s.status}`, r: resolveSubscription(s as any, now) }));
  console.log(`  stored: ${JSON.stringify(tally(resolved, (x) => x.raw))}`);
  console.log(`  resolved now: ${JSON.stringify(tally(resolved, (x) => `${x.r.tier}/${x.r.status}`))}`);
  const activePaid = resolved.filter((x) => x.r.status === "ACTIVE" && x.r.tier !== "FREE").length;
  verdict(activePaid >= 1, "at least one subscriber holds active paid access", `${activePaid} active paid`);
  const lapsedButActiveStored = subs.filter((s) => s.status === "ACTIVE" && s.currentPeriodEnd && s.currentPeriodEnd < now).length;
  console.log(`  stored ACTIVE with an ended period (resolved as lapsed at read time): ${lapsedButActiveStored}`);

  // ── 3. Lifecycle ────────────────────────────────────────────────────────
  console.log("\n3. Paid lifecycle, last 30 days");
  const from = new Date(now.getTime() - 30 * 24 * H);
  const paidRows = await prisma.prediction.findMany({
    where: { kickoff: { gte: from }, status: { in: ["PUBLISHED", "PENDING_REVIEW"] }, categories: { some: { category: { in: ["VIP", "PREMIUM"] } } } },
    select: { id: true, kickoff: true, publishedAt: true, status: true, provenance: true, outcome: true, settledAt: true, marketType: true, selection: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, categories: { select: { category: true } } },
  });
  const ded = paidRows.filter((r) => isPaidOnlyProvenance(r.provenance) && r.publishedAt && r.kickoff);
  const lead = ded.map((r) => r.kickoff!.getTime() - r.publishedAt!.getTime());
  console.log(`  dedicated picks: ${ded.length}; publication lead before kickoff p10 ${hrs(pct(lead, 0.1))} median ${hrs(pct(lead, 0.5))}; under 2h: ${lead.filter((l) => l < 2 * H).length}; after kickoff: ${lead.filter((l) => l <= 0).length}`);
  const stuck = paidRows.filter((r) => r.status === "PENDING_REVIEW" && r.kickoff && r.kickoff < now);
  console.log(`  paid-tagged rows still in review after kickoff: ${stuck.length}`);

  // Added to a paid feed after kickoff, from the shadow log's `selected` flags.
  const firstSelected = new Map<string, { at: Date; category: string }>();
  for (const s of [...shadow].reverse()) for (const c of ((s.detail as any)?.candidates ?? []) as Array<{ id: string; selected?: boolean }>) {
    const k = `${(s.detail as any)?.category}:${c.id}`;
    if (c.selected && !firstSelected.has(k)) firstSelected.set(k, { at: s.ranAt, category: (s.detail as any)?.category });
  }
  const ids = [...new Set([...firstSelected.keys()].map((k) => k.split(":")[1]))];
  const kicks = new Map((ids.length ? await prisma.prediction.findMany({ where: { id: { in: ids } }, select: { id: true, kickoff: true } }) : []).map((r) => [r.id, r.kickoff]));
  const late = [...firstSelected.entries()].filter(([k, v]) => { const ko = kicks.get(k.split(":")[1]); return !!ko && v.at >= ko; });
  const close = [...firstSelected.entries()].filter(([k, v]) => { const ko = kicks.get(k.split(":")[1]); return !!ko && v.at < ko && ko.getTime() - v.at.getTime() < H; });
  console.log(`  shadow-logged first selections: ${firstSelected.size}; first seen in a paid feed AFTER kickoff: ${late.length}; within 1h of kickoff: ${close.length}`);

  const post = paidRows.filter((r) => r.kickoff! >= PAID_TIER_CUTOVER && r.status === "PUBLISHED");
  for (const tier of ["VIP", "PREMIUM"]) {
    const by = new Map<string, typeof post>();
    for (const r of post.filter((x) => x.categories.some((c) => c.category === tier))) (by.get(paidFixtureKey(r)) ?? by.set(paidFixtureKey(r), []).get(paidFixtureKey(r))!).push(r);
    const dup = [...by.values()].filter((v) => v.length > 1);
    console.log(`  ${tier}: fixtures carried twice or more: ${dup.length}${dup.length ? ` (${dup.slice(0, 3).map((v) => v.map((r) => r.marketType).join("+")).join(", ")})` : ""}`);
  }

  const ledger = await prisma.generationAttempt.findMany({ where: { kickoff: { gte: from } }, select: { status: true, lastError: true, kickoff: true } });
  console.log(`  ledger, last 30 days: ${JSON.stringify(tally(ledger, (l) => l.status))}`);
  const errs = tally(ledger.filter((l) => l.status !== "SUCCEEDED" && l.lastError), (l) => String(l.lastError).replace(/\d+/g, "N").slice(0, 80));
  for (const [k, v] of Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${String(v).padStart(4)} × ${k}`);
  const passFails = await prisma.jobRun.findMany({ where: { job: JOB_GENERATE_VIP_PREMIUM, ranAt: { gte: from } }, select: { ok: true, summary: true, detail: true } });
  const resultErrs: string[] = [];
  for (const r of passFails) for (const x of (((r.detail as any)?.results ?? []) as Array<{ ok?: boolean; error?: string }>)) if (x.ok === false) resultErrs.push(String(x.error ?? "").replace(/\d+/g, "N").slice(0, 80));
  console.log(`  paid-pass runs 30d: ${passFails.length}, failed runs ${passFails.filter((r) => !r.ok).length}; per-fixture generation errors ${resultErrs.length}: ${JSON.stringify(tally(resultErrs, (e) => e))}`);
  console.log(`  paid-pass stand-down reasons 30d: ${JSON.stringify(tally(passFails.filter((r) => (r.detail as any)?.reason || (r.detail as any)?.skipped), (r) => String((r.detail as any)?.reason ?? (r.detail as any)?.skipped).slice(0, 60)))}`);

  const odds = await prisma.fixtureOddsCache.findMany({ where: { lastAttemptAt: { gte: new Date(now.getTime() - 3 * 24 * H) }, lastError: { not: null } }, select: { lastError: true } });
  console.log(`  odds fetch errors, last 3 days: ${odds.length} ${JSON.stringify(tally(odds, (o) => String(o.lastError).replace(/\d+/g, "N").slice(0, 60)))}`);

  const settled = paidRows.filter((r) => r.settledAt && r.kickoff && ["WON", "LOST", "VOID"].includes(r.outcome));
  const lag = settled.map((r) => r.settledAt!.getTime() - r.kickoff!.getTime());
  console.log(`  paid settlement lag after kickoff: median ${hrs(pct(lag, 0.5))}, p90 ${hrs(pct(lag, 0.9))}, max ${hrs(pct(lag, 1))}; over 12h: ${lag.filter((l) => l > 12 * H).length}/${lag.length}`);

  const snap = await loadPaidOpsSnapshot(21, now);
  console.log(`  settlement backlog (all published, >6h after kickoff): ${snap.settlementBacklog.pendingOver6h} (${snap.settlementBacklog.manualOnly} awaiting manual), oldest ${snap.settlementBacklog.oldest ?? "—"}`);
  console.log("\n  Paid-ops status by Lagos kickoff day (discovered/covered/failed | scope priced | attempts errors | promoted published | max run gap | VIP PREMIUM)");
  for (const d of snap.days) {
    console.log(`   ${d.day} ${d.status.padEnd(19)} ${String(d.discovered).padStart(3)}/${String(d.covered).padStart(3)}/${String(d.failed).padStart(2)} | ${String(d.paidScopePriced).padStart(2)}/${String(d.paidScope).padStart(2)} | ${String(d.attempts).padStart(2)} ${d.attemptErrors} | ${d.promoted} ${d.published} | ${d.maxRunGapMinutes ?? "—"}m | ${d.vipPicks} ${d.premiumPicks}  ${d.reasons.join("; ")}`);
  }

  // ── 4. Public leak probe ────────────────────────────────────────────────
  console.log("\n4. Public leak probe (anonymous GET)");
  const today = lagosDayBounds(0, now), tomorrow = lagosDayBounds(1, now);
  const secret = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", provenance: { in: [...PAID_ONLY_PROVENANCES] }, kickoff: { gte: today.start, lt: tomorrow.end } },
    select: { id: true, reasoning: true, matchPreview: true, homeTeam: true, matchSlugKey: true, leagueSlugKey: true, homeSlugKey: true, kickoff: true },
  });
  const words = (t: string | null) => (t ?? "").replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const needles = secret.flatMap((s) => {
    const w = words(s.reasoning);
    return w.length >= 8 ? [{ id: s.id, text: w.slice(2, 9).join(" ") }] : [];
  });
  console.log(`  paid-only picks today/tomorrow: ${secret.length}; reasoning fingerprints: ${needles.length}`);
  const paths = new Set<string>(["/", "/predictions", "/predictions/today", "/predictions/vip", "/predictions/premium", "/predictions/vip?date=yesterday", "/track-record", "/free-ticket",
    "/api/predictions", "/api/predictions?category=VIP", "/api/predictions?category=PREMIUM", "/api/predictions?category=TODAY", "/api/top-trends"]);
  for (const s of secret) {
    if (s.matchSlugKey) paths.add(`/predictions/match/${s.matchSlugKey}`);
    if (s.leagueSlugKey) paths.add(`/predictions/league/${s.leagueSlugKey}`);
    if (s.homeSlugKey) paths.add(`/predictions/team/${s.homeSlugKey}`);
    if (s.homeTeam) paths.add(`/api/search?q=${encodeURIComponent(s.homeTeam)}`);
  }
  const yesterday = lagosDateKey(lagosDayBounds(-1, now).start);
  const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/[^A-Za-z\s]/g, " ").replace(/\s+/g, " ");
  let fetched = 0, leaks = 0;
  for (const p of paths) {
    let body = "", status = 0;
    try { const r = await fetch(`${ORIGIN}${p}`, { headers: { "user-agent": "betgenius-paid-verify/1.0" }, redirect: "follow" }); status = r.status; body = await r.text(); } catch (e: any) { console.log(`  WARN  ${p}: ${e?.message ?? e}`); continue; }
    fetched++;
    const flat = decode(body);
    const hit = needles.filter((n) => flat.includes(n.text));
    if (hit.length) { leaks += hit.length; console.log(`  FAIL  ${p} (${status}) contains the reasoning of ${hit.length} paid-only pick(s)`); }
    if (p.startsWith("/api/predictions") && status === 200) {
      try {
        const rows = JSON.parse(body) as Array<Record<string, any>>;
        const forbidden = ["selection", "market", "marketType", "ouLine", "ouDirection", "overUnder", "analysisJson", "marketConfirmation", "previousDrafts"];
        // A VIP/PREMIUM request must return only locked rows to an anonymous
        // reader; anywhere else, no unlocked row may be a paid-only pick.
        const paidFeed = /category=(VIP|PREMIUM)/.test(p);
        const unlocked = rows.filter((r) => r.locked !== true && (paidFeed || isPaidOnlyProvenance(r.provenance)));
        const paidRows = paidFeed ? rows : rows.filter((r) => r.locked === true);
        const leaky = rows.filter((r) => r.locked === true && forbidden.some((k) => k in r));
        verdict(unlocked.length === 0, `${p}: no paid row served unlocked to an anonymous reader`, `${paidRows.length} paid rows, ${unlocked.length} unlocked`);
        verdict(leaky.length === 0, `${p}: locked rows carry no pick fields`, `${leaky.length} leaky`);
      } catch { /* not JSON */ }
    }
  }
  for (const cat of ["VIP", "PREMIUM"]) {
    const r = await fetch(`${ORIGIN}/api/predictions/results?category=${cat}&day=${yesterday}`).catch(() => null);
    verdict(r?.status === 403, `/api/predictions/results ${cat}: members only for an anonymous reader`, `status ${r?.status ?? "error"}`);
  }
  verdict(leaks === 0, "no paid-only reasoning appears on any public page or API", `${fetched} responses searched for ${needles.length} fingerprints`);
  if (needles.length === 0) console.log("  NOTE  no paid-only picks published for today/tomorrow yet, so the fingerprint search had nothing to look for");

  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
