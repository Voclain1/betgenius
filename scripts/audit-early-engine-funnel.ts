/**
 * READ-ONLY early-engine funnel audit, by kickoff distance at first capture.
 *
 *   npx tsx --env-file=.env scripts/audit-early-engine-funnel.ts --from=2026-11-15 --to=2026-11-21 --out=docs/audit
 *
 * Dates are Africa/Lagos calendar days, inclusive. Fixtures are attributed to
 * the WAT day they were FIRST CAPTURED (UpcomingFixture.discoveredAt).
 *
 * Guarantees: no API-Football request (nothing here imports the provider
 * client), no model call, no database write (findMany/aggregate only), no team
 * names, user data, prompts or provider error text in the output — only
 * counts, ids-free distributions and reason codes.
 *
 * What it can and cannot reconstruct is listed in
 * docs/EARLY_ENGINE_DEEP_AUDIT.md §"Reconstructing the funnel". In short: the
 * capture → queue → attempt → draft → triage → publication chain is fully on
 * record; the reason a row was blocked at a given triage pass exists only as
 * per-run aggregates in JobRun.detail.blocked (not per prediction), and
 * provenance-based freshness exists only for jobs created after this change.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseStoredContext, parseStoredProvenance } from "../src/lib/ai/context";
import { assessSavedGenerationEvidence } from "../src/lib/ai/evidenceReadiness";
import { isDedicatedEarlyFreeJob } from "../src/lib/generation/earlyPublication";
import { matchKey } from "../src/lib/slug";
import { BANDS, bandOf, attemptErrorClass } from "../src/lib/generation/earlyFunnel";

const HOUR = 3_600_000;
const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const FROM = arg("from", "2026-11-15");
const TO = arg("to", "2026-11-21");
const OUT = arg("out", "");
const start = new Date(`${FROM}T00:00:00+01:00`);
const end = new Date(new Date(`${TO}T00:00:00+01:00`).getTime() + 24 * HOUR);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const mean = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
const chunk = <T,>(xs: T[], n = 2000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const bump = (o: Record<string, number>, k: string, by = 1) => { o[k] = (o[k] ?? 0) + by; };
const lagosMinute = (d: Date) => new Date(d.getTime() + HOUR).getUTCMinutes();

async function main() {
  const fixtures = await prisma.upcomingFixture.findMany({
    where: { discoveredAt: { gte: start, lt: end } },
    select: { fixtureApiId: true, leagueApiId: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true, status: true, discoveredAt: true, earlyQueuedAt: true },
  });
  const ids = fixtures.map(f => f.fixtureApiId);
  const attempts = (await Promise.all(chunk(ids).map(part => prisma.generationAttempt.findMany({
    where: { fixtureApiId: { in: part } },
    select: { fixtureApiId: true, status: true, attempts: true, lastError: true, lastAttemptAt: true, nextAttemptAt: true },
  })))).flat();
  const predictions = (await Promise.all(chunk(ids, 500).map(part => prisma.prediction.findMany({
    where: { fixtureApiId: { in: part } },
    select: {
      id: true, fixtureApiId: true, status: true, confidence: true, contextComplete: true, createdAt: true, publishedAt: true,
      aiJob: { select: { prompt: true, context: true, createdAt: true } },
      revisions: { select: { kind: true, recordedAt: true } },
    },
  })))).flat();
  const keys = fixtures.map(f => matchKey(f)).filter((k): k is string => !!k);
  const odds = (await Promise.all(chunk(keys).map(part => prisma.fixtureOddsCache.findMany({
    where: { matchKey: { in: part } }, select: { matchKey: true, fetchedAt: true, lastAttemptAt: true },
  })))).flat();

  const attemptBy = new Map(attempts.map(a => [a.fixtureApiId!, a]));
  const oddsBy = new Map(odds.map(o => [o.matchKey, o]));
  const predsBy = new Map<number, typeof predictions>();
  for (const p of predictions) predsBy.set(p.fixtureApiId!, [...(predsBy.get(p.fixtureApiId!) ?? []), p]);
  const now = new Date();

  type Band = Record<string, unknown> & { counts: Record<string, number>; attemptStatus: Record<string, number>; attemptErrors: Record<string, number>; evidence: Record<string, number>; provenance: Record<string, number> };
  const out: Record<string, Band> = {};
  const timings: Record<string, { captureToGenerationH: number[]; generationToPublicationH: number[]; captureToPublicationH: number[] }> = {};
  for (const b of BANDS) {
    out[b.id] = { label: b.label, counts: {}, attemptStatus: {}, attemptErrors: {}, evidence: {}, provenance: {} };
    timings[b.id] = { captureToGenerationH: [], generationToPublicationH: [], captureToPublicationH: [] };
  }

  for (const f of fixtures) {
    const band = out[bandOf((f.kickoff.getTime() - f.discoveredAt.getTime()) / HOUR)];
    const t = timings[bandOf((f.kickoff.getTime() - f.discoveredAt.getTime()) / HOUR)];
    const c = band.counts;
    bump(c, "1_discovered");
    if (f.earlyQueuedAt) bump(c, "2_eligible_queued_early");
    const a = attemptBy.get(f.fixtureApiId);
    if (a) {
      bump(band.attemptStatus, a.status);
      bump(band.attemptErrors, attemptErrorClass(a.lastError));
      if (a.lastAttemptAt || a.status === "SUCCEEDED") bump(c, "3_processed");
      if (a.attempts > 1 || /retry not counted/.test(a.lastError ?? "")) bump(c, "12_retried");
      if (a.status === "ABANDONED") bump(c, "13a_abandoned");
      if (attemptErrorClass(a.lastError) === "no-usable-evidence") bump(c, "5_no_usable_evidence_deferred");
    }
    const key = matchKey(f);
    const o = key ? oddsBy.get(key) : undefined;
    if (!o?.fetchedAt) bump(c, "6_odds_never_quoted");

    const preds = predsBy.get(f.fixtureApiId) ?? [];
    const early = preds.filter(p => isDedicatedEarlyFreeJob(p.aiJob?.prompt, f.fixtureApiId));
    if (preds.length) bump(c, "7b_any_lane_prediction");
    if (preds.some(p => p.status === "PUBLISHED")) bump(c, "15b_any_lane_published");
    if (!preds.length && f.kickoff < now && (!a || a.status !== "SUCCEEDED")) bump(c, "13b_lost_no_prediction_any_lane");
    if (!early.length) continue;
    bump(c, "7_early_generated");
    const ev = early.map(p => assessSavedGenerationEvidence(parseStoredContext(p.aiJob?.context), p.contextComplete));
    for (const e of ev) bump(band.evidence, e.status);
    if (ev.some(e => e.status === "ready" || e.status === "needs-freshness-review")) bump(c, "4_sufficient_football_evidence");
    for (const p of early) {
      const prov = parseStoredProvenance(p.aiJob?.context);
      if (!prov) { bump(band.provenance, "not-recorded"); continue; }
      for (const part of ["homeTeam", "awayTeam", "standings", "h2h"] as const) bump(band.provenance, `${part}:${prov[part].status}`);
    }
    if (early.some(p => p.confidence >= 70)) bump(c, "8_confidence_at_or_above_70");
    if (early.some(p => p.confidence >= 65)) bump(c, "8b_confidence_at_or_above_65");
    if (early.some(p => p.contextComplete)) bump(c, "8c_context_complete");
    const auto = early.filter(p => p.revisions.some(r => r.kind === "EARLY_PUBLICATION_PRICE"));
    if (auto.length) bump(c, "9_auto_published");
    if (early.some(p => p.revisions.some(r => r.kind === "EARLY_REVIEW_READY") || p.status === "PENDING_REVIEW")) bump(c, "10_admin_review");
    if (early.some(p => p.revisions.some(r => r.kind === "EARLY_HOLD"))) bump(c, "11_held_at_least_once");
    if (early.some(p => p.status === "DRAFT")) bump(c, "11b_currently_held");
    if (early.some(p => p.status === "PUBLISHED")) bump(c, "15_early_published_any_route");
    const gen = Math.min(...early.map(p => (p.aiJob?.createdAt ?? p.createdAt).getTime()));
    t.captureToGenerationH.push((gen - f.discoveredAt.getTime()) / HOUR);
    const pub = early.map(p => p.publishedAt?.getTime()).filter((x): x is number => x != null);
    if (pub.length) {
      t.generationToPublicationH.push((Math.min(...pub) - gen) / HOUR);
      t.captureToPublicationH.push((Math.min(...pub) - f.discoveredAt.getTime()) / HOUR);
    }
  }
  for (const b of BANDS) {
    const t = timings[b.id];
    out[b.id].timingHours = {
      captureToGeneration: { mean: mean(t.captureToGenerationH), median: median(t.captureToGenerationH), n: t.captureToGenerationH.length },
      generationToPublication: { mean: mean(t.generationToPublicationH), median: median(t.generationToPublicationH), n: t.generationToPublicationH.length },
      captureToPublication: { mean: mean(t.captureToPublicationH), median: median(t.captureToPublicationH), n: t.captureToPublicationH.length },
    };
  }

  // Per-run aggregates the scheduled jobs already stored (JobRun.detail).
  const runs = await prisma.jobRun.findMany({
    where: { ranAt: { gte: start, lt: end }, job: { in: ["early-fixture-discovery", "early-free-odds", "early-free-generation", "early-free-publication", "generate-ordinary", "generate-vip-premium", "generate-goals", "generate-european-clubs", "prediction-reassessment"] } },
    select: { job: true, ranAt: true, ok: true, summary: true, detail: true, ms: true },
  });
  const jobs: Record<string, { runs: number; failed: number; ms: number[]; sums: Record<string, number>; leaseStandDownsByLagosMinute: Record<string, number>; quotaStandDowns: number }> = {};
  const publicationBlocked: Record<string, number> = {};
  for (const r of runs) {
    const j = (jobs[r.job] ??= { runs: 0, failed: 0, ms: [], sums: {}, leaseStandDownsByLagosMinute: {}, quotaStandDowns: 0 });
    j.runs++;
    if (!r.ok) j.failed++;
    if (r.ms != null) j.ms.push(r.ms);
    const d = (r.detail ?? {}) as Record<string, any>;
    const text = `${r.summary ?? ""} ${d.reason ?? ""} ${d.skipped ?? ""}`;
    if (/already in progress/.test(text)) bump(j.leaseStandDownsByLagosMinute, String(lagosMinute(r.ranAt)).padStart(2, "0"));
    if (/budget|quota/i.test(text)) j.quotaStandDowns++;
    for (const k of ["scanned", "fixturesSeen", "cached", "candidatesQueued", "considered", "due", "attempted", "quoted", "unquoted",
      "selected", "generated", "pricedSelected", "unpricedSelected", "deferredSelective", "qualifying", "published", "reviewReady", "held", "restored",
      "claimed", "succeeded", "failed", "abandoned", "predictionsCreated", "apiCallsSpent", "cacheHits", "fetches", "discoveryCalls"]) {
      const v = typeof d[k] === "number" ? d[k] : typeof d.worker?.[k] === "number" && k === "apiCallsSpent" ? d.worker[k] : null;
      if (typeof v === "number") bump(j.sums, k, v);
    }
    if (r.job === "early-free-publication" && d.blocked && typeof d.blocked === "object")
      for (const [k, v] of Object.entries(d.blocked)) if (typeof v === "number") bump(publicationBlocked, k, v);
  }
  const jobSummary = Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, {
    runs: v.runs, failed: v.failed, medianMs: median(v.ms),
    // Lease hold-time tail: what decides whether a run can block the next lease user.
    p95Ms: v.ms.length ? [...v.ms].sort((a, b) => a - b)[Math.min(v.ms.length - 1, Math.floor(v.ms.length * 0.95))] : null,
    maxMs: v.ms.length ? Math.max(...v.ms) : null,
    sums: v.sums, quotaStandDowns: v.quotaStandDowns,
    leaseStandDowns: Object.values(v.leaseStandDownsByLagosMinute).reduce((a, b) => a + b, 0),
    leaseStandDownsByLagosMinute: v.leaseStandDownsByLagosMinute,
  }]));

  const report = {
    generatedAt: now.toISOString(), window: { fromWat: FROM, toWat: TO, startUtc: start.toISOString(), endUtc: end.toISOString() },
    note: "Fixture counts are by first-capture WAT day. Triage blocked reasons are summed per-run occurrences (a row triaged every 30 minutes is counted once per pass), not distinct predictions.",
    bands: out, publicationBlockedOccurrences: publicationBlocked, jobs: jobSummary,
  };
  const json = JSON.stringify(report, null, 2);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `early_funnel_${FROM}_${TO}.json`), json);
    const stages = [...new Set(Object.values(out).flatMap(b => Object.keys(b.counts)))].sort();
    const csv = ["stage," + BANDS.map(b => `${b.id} (${b.label})`).join(","),
      ...stages.map(s => [s, ...BANDS.map(b => out[b.id].counts[s] ?? 0)].join(","))].join("\n");
    writeFileSync(join(OUT, `early_funnel_${FROM}_${TO}.csv`), csv + "\n");
    console.log(`wrote ${OUT}/early_funnel_${FROM}_${TO}.{json,csv}`);
  } else console.log(json);
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
