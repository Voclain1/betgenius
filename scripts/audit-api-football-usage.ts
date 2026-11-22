/**
 * READ-ONLY seven-day API-Football usage audit.
 *
 *   npx tsx --env-file=.env scripts/audit-api-football-usage.ts --from=2026-11-15 --to=2026-11-21 --out=docs/audit [--status]
 *
 * Sources, strongest first, and what each can prove:
 *
 *   1. Provider /status (only with --status): today's `requests.current` and
 *      `limit_day` from the account itself. One /status request, which
 *      API-Football does not bill against the quota. It has NO history: past
 *      days can only be read from the provider dashboard.
 *   2. ApiUsage budget rows (day = "YYYY-MM-DD"): every request this app
 *      dispatched, per UTC day and endpoint path, incremented BEFORE dispatch
 *      (so failures and 429s are included). "(reconciled)" rows are upward
 *      corrections to match the account. UTC days, not WAT: a WAT day spans
 *      23:00 UTC of the previous day to 23:00 UTC, so WAT totals cannot be
 *      derived exactly from these rows.
 *   3. ApiUsage telemetry rows (day = "#hYYYY-MM-DDTHH", added 22 Nov 2026):
 *      per UTC hour × endpoint × job × outcome; and "#d" rows counting repeat
 *      dispatches of the same URL within 10 minutes. Exact WAT hours and days.
 *      Present only from deployment of that change onward.
 *   4. JobRun.detail: per-run apiCallsSpent / discovery / odds attempts that
 *      some jobs report — partial attribution for history before (3).
 *
 * Guarantees: no database write, no billed provider request, no secrets or
 * account e-mail in the output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { DAILY_LIMIT, RESERVE, PAID_PRIORITY_RESERVE, TELEMETRY_DAY_PREFIX, REPEAT_DAY_PREFIX, parseTelemetryRow } from "../src/lib/football/usage";

const HOUR = 3_600_000;
const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const FROM = arg("from", "2026-11-15");
const TO = arg("to", "2026-11-21");
const OUT = arg("out", "");
const start = new Date(`${FROM}T00:00:00+01:00`);
const end = new Date(new Date(`${TO}T00:00:00+01:00`).getTime() + 24 * HOUR);
const watDay = (d: Date) => new Date(d.getTime() + HOUR).toISOString().slice(0, 10);
const watHour = (d: Date) => new Date(d.getTime() + HOUR).getUTCHours();
const bump = (o: Record<string, number>, k: string, by = 1) => { o[k] = (o[k] ?? 0) + by; };
const FAILED = new Set(["http_error", "api_error", "timeout", "network_error"]);

async function main() {
  const utcFrom = new Date(start.getTime() - 24 * HOUR).toISOString().slice(0, 10);
  const utcTo = end.toISOString().slice(0, 10);

  // (2) Budget rows by UTC day.
  const budget = await prisma.apiUsage.findMany({ where: { day: { gte: utcFrom, lte: utcTo } }, select: { day: true, path: true, count: true } });
  const budgetByUtcDay: Record<string, { total: number; reconciled: number; byPath: Record<string, number> }> = {};
  for (const r of budget) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day)) continue;
    const d = (budgetByUtcDay[r.day] ??= { total: 0, reconciled: 0, byPath: {} });
    d.total += r.count;
    if (r.path === "(reconciled)") d.reconciled += r.count;
    bump(d.byPath, r.path, r.count);
  }

  // (3) Telemetry rows, converted to WAT.
  const telemetryRaw = await prisma.apiUsage.findMany({
    where: { day: { gte: TELEMETRY_DAY_PREFIX + new Date(start).toISOString().slice(0, 13), lt: TELEMETRY_DAY_PREFIX + end.toISOString().slice(0, 13) } },
    select: { day: true, path: true, count: true },
  });
  const repeatRaw = await prisma.apiUsage.findMany({
    where: { day: { gte: REPEAT_DAY_PREFIX + start.toISOString().slice(0, 13), lt: REPEAT_DAY_PREFIX + end.toISOString().slice(0, 13) } },
    select: { day: true, path: true, count: true },
  });
  const daily: Record<string, { dispatched: number; successful: number; empty: number; failed: number; rateLimited: number; quotaRefused: number; repeats: number }> = {};
  const byEndpointDay: Record<string, Record<string, number>> = {};
  const byJobDay: Record<string, Record<string, number>> = {};
  const hourly: Record<string, Record<number, number>> = {};
  const failuresByHour: Record<number, number> = {};
  const repeatsByEndpointJob: Record<string, number> = {};
  for (const raw of telemetryRaw) {
    const t = parseTelemetryRow(raw);
    if (!t) continue;
    const at = new Date(`${t.hourUtc}:00:00Z`);
    const day = watDay(at);
    if (at < start || at >= end) continue;
    const d = (daily[day] ??= { dispatched: 0, successful: 0, empty: 0, failed: 0, rateLimited: 0, quotaRefused: 0, repeats: 0 });
    if (t.outcome === "quota_refused") { d.quotaRefused += t.count; continue; }
    d.dispatched += t.count;
    if (t.outcome === "ok") d.successful += t.count;
    if (t.outcome === "empty") d.empty += t.count;
    if (t.outcome === "rate_limited") d.rateLimited += t.count;
    if (FAILED.has(t.outcome)) { d.failed += t.count; bump(failuresByHour as Record<string, number>, String(watHour(at)), t.count); }
    bump((byEndpointDay[t.path] ??= {}), day, t.count);
    bump((byJobDay[t.job] ??= {}), day, t.count);
    bump(((hourly[day] ??= {}) as Record<string, number>), String(watHour(at)), t.count);
  }
  for (const raw of repeatRaw) {
    const parts = raw.path.split("|");
    const at = new Date(`${raw.day.slice(REPEAT_DAY_PREFIX.length)}:00:00Z`);
    if (at < start || at >= end) continue;
    (daily[watDay(at)] ??= { dispatched: 0, successful: 0, empty: 0, failed: 0, rateLimited: 0, quotaRefused: 0, repeats: 0 }).repeats += raw.count;
    bump(repeatsByEndpointJob, `${parts[0]} ${parts[1]}`, raw.count);
  }

  // (4) Partial historical attribution from JobRun.
  const runs = await prisma.jobRun.findMany({ where: { ranAt: { gte: start, lt: end } }, select: { job: true, ranAt: true, summary: true, detail: true } });
  const jobRunAttribution: Record<string, { runs: number; reportedProviderCalls: number; quotaStandDowns: number }> = {};
  for (const r of runs) {
    const j = (jobRunAttribution[r.job] ??= { runs: 0, reportedProviderCalls: 0, quotaStandDowns: 0 });
    j.runs++;
    const d = (r.detail ?? {}) as Record<string, any>;
    for (const v of [d.apiCallsSpent, d.discoveryCalls, d.attempted, d.scanned, d.vipPremium?.oddsCalls, d.worker?.apiCallsSpent])
      if (typeof v === "number") j.reportedProviderCalls += v;
    if (/budget|quota/i.test(`${r.summary ?? ""} ${d.reason ?? ""} ${d.skipped ?? ""}`)) j.quotaStandDowns++;
  }

  // (1) Optional live account probe (today only).
  let account: { plan: string; active: boolean; current: number; limitDay: number } | null = null;
  if (process.argv.includes("--status")) {
    const { getAccountStatus } = await import("../src/lib/football/api-football");
    const s = await getAccountStatus();
    if (s) account = { plan: s.subscription.plan, active: s.subscription.active, current: s.requests.current, limitDay: s.requests.limit_day };
  }

  const totals = Object.values(daily).map(d => d.dispatched).sort((a, b) => a - b);
  const report = {
    generatedAt: new Date().toISOString(),
    window: { fromWat: FROM, toWat: TO },
    configuredLimits: { dailyLimit: DAILY_LIMIT, reserve: RESERVE, paidPriorityReserve: PAID_PRIORITY_RESERVE, quotaResetsAt: "00:00 UTC (01:00 WAT)" },
    account,
    budgetRowsByUtcDay: budgetByUtcDay,
    telemetry: {
      available: telemetryRaw.length > 0,
      dailyWat: daily,
      summary: totals.length ? { total: totals.reduce((a, b) => a + b, 0), averagePerDay: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length), median: totals[Math.floor(totals.length / 2)], peak: totals[totals.length - 1] } : null,
      byEndpointDay, byJobDay, hourlyWat: hourly, failuresByWatHour: failuresByHour, repeatsWithin10mByEndpointJob: repeatsByEndpointJob,
    },
    jobRunAttribution,
  };
  const json = JSON.stringify(report, null, 2);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `api_football_usage_${FROM}_${TO}.json`), json);
    const days = Object.keys(budgetByUtcDay).sort();
    const csv = ["utc_day,app_counted_requests,reconciled_adjustment,daily_limit,pct_of_limit",
      ...days.map(d => [d, budgetByUtcDay[d].total, budgetByUtcDay[d].reconciled, DAILY_LIMIT, ((budgetByUtcDay[d].total / DAILY_LIMIT) * 100).toFixed(1)].join(","))].join("\n");
    writeFileSync(join(OUT, `api_football_usage_${FROM}_${TO}_by_utc_day.csv`), csv + "\n");
    const watDays = Object.keys(daily).sort();
    const csv2 = ["wat_day,dispatched,successful,empty,failed,rate_limited,quota_refused,repeats_within_10m",
      ...watDays.map(d => { const x = daily[d]; return [d, x.dispatched, x.successful, x.empty, x.failed, x.rateLimited, x.quotaRefused, x.repeats].join(","); })].join("\n");
    writeFileSync(join(OUT, `api_football_usage_${FROM}_${TO}_by_wat_day.csv`), csv2 + "\n");
    console.log(`wrote ${OUT}/api_football_usage_${FROM}_${TO}*.{json,csv}`);
  } else console.log(json);
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
