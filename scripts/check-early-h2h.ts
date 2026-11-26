/**
 * Early-lane head-to-head pre-fetch (src/lib/generation/earlyH2H.ts).
 * Behavioural, with injected cache/budget/provider: no database, no network.
 *
 *   npx tsx scripts/check-early-h2h.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prefetchEarlyH2H, EARLY_H2H_MIN_HEADROOM, EARLY_H2H_RETRY_MS } from "../src/lib/generation/earlyH2H";
import { PAID_PRIORITY_RESERVE } from "../src/lib/football/usage";

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const NOW = new Date("2026-11-26T12:00:00Z");
const kickoff = new Date("2026-11-29T15:00:00Z");
const t = (h: number, a: number) => ({ homeTeamApiId: h, awayTeamApiId: a, kickoff });

async function main() {
  const run = async (cache: Record<string, { fetchedAt: Date | null; lastAttemptAt: Date | null }>, remaining: number, targets = [t(1, 2)]) => {
    const calls: string[] = [];
    const report = await prefetchEarlyH2H(targets, NOW, {
      remaining: async () => remaining,
      cached: async (k) => cache[k] ?? null,
      refresh: async (x) => { calls.push(`${x.pairKey}:${x.teamAApiId}-${x.teamBApiId}`); return { result: "ok" }; },
    });
    return { report, calls };
  };
  const plenty = PAID_PRIORITY_RESERVE + EARLY_H2H_MIN_HEADROOM + 100;

  const miss = await run({}, plenty);
  ok(miss.calls.length === 1 && miss.report.fetched === 1, "missing H2H is fetched once");
  ok(/:1-2$/.test(miss.calls[0]), "lower team id first, as the H2H cache keys it");
  const reversed = await run({}, plenty, [t(2, 1), t(1, 2)]);
  ok(reversed.calls.length === 1 && reversed.report.considered === 1, "the same pair in either order is fetched once");

  const pairKey = miss.calls[0].split(":")[0];
  const cached = await run({ [pairKey]: { fetchedAt: new Date("2026-10-01T00:00:00Z"), lastAttemptAt: null } }, plenty);
  ok(cached.calls.length === 0 && cached.report.alreadyCached === 1, "a cached pair costs nothing (H2H is kept for good)");

  const recentFail = await run({ [pairKey]: { fetchedAt: null, lastAttemptAt: new Date(NOW.getTime() - 2 * 3_600_000) } }, plenty);
  ok(recentFail.calls.length === 0 && recentFail.report.retryWait === 1, "a pair that failed recently is not retried");
  const oldFail = await run({ [pairKey]: { fetchedAt: null, lastAttemptAt: new Date(NOW.getTime() - EARLY_H2H_RETRY_MS - 1) } }, plenty);
  ok(oldFail.calls.length === 1, "...and is retried after the wait");

  const tight = await run({}, PAID_PRIORITY_RESERVE + EARLY_H2H_MIN_HEADROOM - 1);
  ok(tight.calls.length === 0 && tight.report.skippedBudget === 1, "no request without the headroom margin on top of the paid reserve");
  const edge = await run({}, PAID_PRIORITY_RESERVE + EARLY_H2H_MIN_HEADROOM);
  ok(edge.calls.length === 1, "exactly at the margin, the request is allowed");

  const four = await run({}, plenty, [t(1, 2), t(3, 4), t(5, 6), t(7, 8)]);
  ok(four.calls.length === 4, "bounded by the run's own fixtures (the early run selects at most 4)");

  const failing = await prefetchEarlyH2H([t(1, 2)], NOW, { remaining: async () => plenty, cached: async () => null, refresh: async () => ({ result: "failed" }) });
  ok(failing.failed === 1 && failing.fetched === 0, "a failed fetch is counted, not thrown");

  // Generation itself stays provider-call free; the pre-fetch runs before it.
  const gen = readFileSync("src/lib/generation/earlyGeneration.ts", "utf8");
  ok(gen.indexOf("prefetchEarlyH2H(") > 0 && gen.indexOf("prefetchEarlyH2H(") < gen.indexOf("withNoFootballApiCalls(() => runGeneration("), "pre-fetch first, then provider-free generation");
  ok(/\.catch\(\(\) => undefined\)/.test(gen.slice(gen.indexOf("prefetchEarlyH2H("), gen.indexOf("withNoFootballApiCalls(() => runGeneration("))), "a pre-fetch failure never blocks the early run");
  const enr = readFileSync("src/lib/enrichment.ts", "utf8");
  ok(/raw == null && !\(await hasBudget\(\)\)\) return \{ pairKey: target\.pairKey, result: "failed", detail: ODDS_BUDGET_REFUSED \}/.test(enr), "a budget refusal is never recorded as an H2H attempt");

  console.log(`PASS: early H2H pre-fetch — ${n} assertions`);
}
main().catch((e) => { console.error(e); process.exit(1); });
