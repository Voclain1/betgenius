/**
 * Why were picks generated late? Lead time, split into its causes.
 *
 * A pick reaching review hours (or minutes) before kickoff is one of three
 * different failures, and they need different fixes:
 *
 *   LATE DISCOVERY  the fixture entered the ledger (GenerationAttempt.createdAt)
 *                   only shortly before kickoff, so nothing could generate it
 *                   earlier;
 *   QUEUE WAIT      it was discovered in good time but sat PENDING while runs
 *                   worked on other fixtures (throughput, claim order, lock or
 *                   quota stalls);
 *   LATE REVIEW     it was generated in good time but published late.
 *
 * Per Lagos kickoff day it prints the hours from discovery, generation and
 * publication to kickoff, and classifies every row generated inside
 * GENERATE_FROM_HOURS (12h). Then generation throughput per Lagos hour over the
 * last 48h (gaps there are runs that did nothing), and the queue as it stands.
 *
 * READ-ONLY. No api-football calls, no writes. Safe against production.
 *
 * Run: npx tsx --env-file=.env scripts/measure-generation-leadtime.ts [days=7]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey } from "../src/lib/lagosDate";
import { GENERATE_FROM_HOURS } from "../src/lib/generation/window";
import { DAILY_LIMIT, RESERVE } from "../src/lib/football/usage";

const H = 3_600_000;
const hours = (ms: number) => ms / H;
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1).padStart(6) : "     -");
const pad = (v: unknown, w = 6) => String(v).padStart(w);

async function main() {
  const days = Math.max(1, Number(process.argv[2]) || 7);
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * H);

  const rows = await prisma.prediction.findMany({
    where: { kickoff: { gte: from, lte: new Date(now.getTime() + 48 * H) }, marketType: { not: "SAME_GAME_DOUBLE" } },
    select: { id: true, fixtureApiId: true, kickoff: true, createdAt: true, publishedAt: true, status: true, provenance: true, leagueName: true, homeTeam: true, awayTeam: true },
  });
  const fixtureIds = [...new Set(rows.map((r) => r.fixtureApiId).filter((id): id is number => id != null))];
  const ledger = fixtureIds.length
    ? await prisma.generationAttempt.findMany({ where: { fixtureApiId: { in: fixtureIds } }, select: { fixtureApiId: true, createdAt: true, attempts: true } })
    : [];
  const discoveredAt = new Map(ledger.map((l) => [l.fixtureApiId!, l.createdAt]));

  // One entry per fixture: its FIRST generated row, which is what decided lead time.
  const byFixture = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.kickoff) continue;
    const k = r.fixtureApiId != null ? `f${r.fixtureApiId}` : r.id;
    const prev = byFixture.get(k);
    if (!prev || r.createdAt < prev.createdAt) byFixture.set(k, r);
  }

  type Cause = "LATE_DISCOVERY" | "QUEUE_WAIT" | "UNKNOWN_DISCOVERY";
  const perDay = new Map<string, { gen: number[]; disc: number[]; pub: number[]; late: number; under2: number; pubAfterKo: number; causes: Partial<Record<Cause, number>>; n: number }>();
  const lateSamples: string[] = [];
  for (const r of byFixture.values()) {
    const day = lagosDateKey(r.kickoff!);
    const d = perDay.get(day) ?? { gen: [], disc: [], pub: [], late: 0, under2: 0, pubAfterKo: 0, causes: {}, n: 0 };
    d.n++;
    const ko = r.kickoff!.getTime();
    const genLead = hours(ko - r.createdAt.getTime());
    d.gen.push(genLead);
    const disc = r.fixtureApiId != null ? discoveredAt.get(r.fixtureApiId) : undefined;
    if (disc) d.disc.push(hours(ko - disc.getTime()));
    if (r.publishedAt) {
      d.pub.push(hours(ko - r.publishedAt.getTime()));
      if (r.publishedAt.getTime() > ko) d.pubAfterKo++;
    }
    if (genLead < GENERATE_FROM_HOURS) {
      d.late++;
      if (genLead < 2) d.under2++;
      // Discovered with more than 12h to spare but generated inside 12h: it waited.
      const cause: Cause = !disc ? "UNKNOWN_DISCOVERY" : hours(ko - disc.getTime()) < GENERATE_FROM_HOURS ? "LATE_DISCOVERY" : "QUEUE_WAIT";
      d.causes[cause] = (d.causes[cause] ?? 0) + 1;
      if (lateSamples.length < 25) {
        lateSamples.push(
          `  ${day}  ${r.homeTeam} v ${r.awayTeam} (${r.leagueName ?? "?"}) — discovered ${disc ? hours(ko - disc.getTime()).toFixed(1) + "h" : "?"} before, generated ${genLead.toFixed(1)}h before, ${r.publishedAt ? `published ${hours(ko - r.publishedAt.getTime()).toFixed(1)}h before` : `not published (${r.status})`} → ${cause}`,
        );
      }
    }
    perDay.set(day, d);
  }

  console.log(`\nLead time to kickoff, per Lagos kickoff day (hours; p50 / p10). First generated row per fixture, doubles excluded.\n`);
  console.log("  day          fixtures   discovered       generated        published   gen<12h  gen<2h  pub>KO   causes of gen<12h");
  for (const [day, d] of [...perDay.entries()].sort()) {
    const causes = Object.entries(d.causes).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${day}   ${pad(d.n, 6)}   ${f1(pct(d.disc, 50))} /${f1(pct(d.disc, 10))}  ${f1(pct(d.gen, 50))} /${f1(pct(d.gen, 10))}  ${f1(pct(d.pub, 50))} /${f1(pct(d.pub, 10))}  ${pad(d.late, 7)} ${pad(d.under2, 7)} ${pad(d.pubAfterKo, 7)}   ${causes}`);
  }
  if (lateSamples.length) console.log(`\nGenerated inside ${GENERATE_FROM_HOURS}h of kickoff (first ${lateSamples.length}):\n${lateSamples.join("\n")}`);

  // Throughput: generation jobs per Lagos hour over the last 48h, by intent.
  const since = new Date(now.getTime() - 48 * H);
  const jobs = await prisma.aIJob.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, prompt: true } });
  const perHour = new Map<string, Record<string, number>>();
  for (const j of jobs) {
    let intent = "ORDINARY";
    try {
      const p = JSON.parse(j.prompt);
      intent = p?.intent ?? ((p?.categories ?? []).includes("SAME_GAME_DOUBLE") ? "DOUBLES" : "ORDINARY");
    } catch { /* unparseable: count as ordinary */ }
    const lagos = new Date(j.createdAt.getTime() + H);
    const key = lagos.toISOString().slice(0, 13).replace("T", " ") + ":00";
    const h = perHour.get(key) ?? {};
    h[intent] = (h[intent] ?? 0) + 1;
    perHour.set(key, h);
  }
  console.log(`\nGeneration jobs per Lagos hour, last 48h (${jobs.length} jobs). Hours with none are listed as gaps.`);
  for (let t = Math.floor(since.getTime() / H) * H; t <= now.getTime(); t += H) {
    const key = new Date(t + H).toISOString().slice(0, 13).replace("T", " ") + ":00";
    const h = perHour.get(key);
    console.log(`  ${key}  ${h ? Object.entries(h).map(([k, v]) => `${k} ${v}`).join(", ") : "— none —"}`);
  }

  // The queue right now.
  const queued = await prisma.generationAttempt.findMany({
    where: { kickoff: { gt: now }, status: { in: ["PENDING", "FAILED"] } },
    select: { kickoff: true, status: true, createdAt: true, leagueApiId: true },
  });
  const qDays = new Map<string, { PENDING: number; FAILED: number; oldestWaitH: number; soonestKoH: number }>();
  for (const q of queued) {
    const day = lagosDateKey(q.kickoff);
    const e = qDays.get(day) ?? { PENDING: 0, FAILED: 0, oldestWaitH: 0, soonestKoH: Infinity };
    e[q.status as "PENDING" | "FAILED"]++;
    e.oldestWaitH = Math.max(e.oldestWaitH, hours(now.getTime() - q.createdAt.getTime()));
    e.soonestKoH = Math.min(e.soonestKoH, hours(q.kickoff.getTime() - now.getTime()));
    qDays.set(day, e);
  }
  console.log(`\nQueue now (not yet generated, kickoff ahead): ${queued.length} fixtures`);
  for (const [day, e] of [...qDays.entries()].sort()) {
    console.log(`  ${day}  pending ${pad(e.PENDING, 4)}  failed ${pad(e.FAILED, 4)}  longest wait ${e.oldestWaitH.toFixed(1)}h  soonest kickoff in ${e.soonestKoH.toFixed(1)}h`);
  }

  // api-football budget per UTC day. Ordinary generation stands down when
  // fewer than MIN_QUOTA_HEADROOM (200) calls remain, so a day that ran near
  // its limit generates nothing until the UTC reset — a QUEUE_WAIT cause.
  const usage = await prisma.apiUsage.findMany({ where: { day: { gte: from.toISOString().slice(0, 10) } }, select: { day: true, path: true, count: true } });
  const perUsageDay = new Map<string, { total: number; odds: number }>();
  for (const u of usage) {
    const e = perUsageDay.get(u.day) ?? { total: 0, odds: 0 };
    e.total += u.count;
    if (u.path.includes("odds")) e.odds += u.count;
    perUsageDay.set(u.day, e);
  }
  console.log(`
api-football calls per UTC day (limit ${DAILY_LIMIT}, reserve ${RESERVE}; generation stands down 200 above the reserve):`);
  for (const [day, e] of [...perUsageDay.entries()].sort()) console.log(`  ${day}  total ${pad(e.total, 5)}  of which odds ${pad(e.odds, 5)}`);

  const lock = await prisma.appLock.findMany({ select: { key: true, holder: true, acquiredAt: true, expiresAt: true } });
  const live = lock.filter((l) => l.expiresAt > now && !l.key.startsWith("vip-premium-retry:") && !l.key.startsWith("goals-retry:"));
  if (live.length) console.log(`\nLive leases: ${live.map((l) => `${l.key} (held since ${l.acquiredAt.toISOString()}, until ${l.expiresAt.toISOString()})`).join("; ")}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
