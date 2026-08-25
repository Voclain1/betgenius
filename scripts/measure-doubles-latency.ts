/**
 * Real latency distribution for generation, and specifically for the
 * multi-market (doubles) path.
 *
 * The question is not "how many fixtures fit in 30s" — one already costs ~24s.
 * It is whether ONE is reliably safe. A single data point cannot answer that,
 * so this reads AIJob.durationMs, which the pipeline has been recording for
 * every job all along, and looks at the TAIL rather than the average: a p50
 * that fits says nothing useful if p95 does not.
 *
 * durationMs covers the model call only. The end-to-end request also pays for
 * digest building (api-football fetches) and the persist, so the reported
 * request time is larger — that gap is measured here too, against the one real
 * doubles run.
 *
 * Read-only. Run: npx tsx scripts/measure-doubles-latency.ts
 */
export {};
const react = require("react");
react.cache = (fn: any) => fn;

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function describe(label: string, xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  console.log(`${label}  n=${s.length}`);
  if (!s.length) return;
  console.log(`   min ${(s[0]/1000).toFixed(1)}s  p50 ${(pct(s,50)/1000).toFixed(1)}s  p75 ${(pct(s,75)/1000).toFixed(1)}s  p90 ${(pct(s,90)/1000).toFixed(1)}s  p95 ${(pct(s,95)/1000).toFixed(1)}s  max ${(s[s.length-1]/1000).toFixed(1)}s  mean ${(mean/1000).toFixed(1)}s`);
  const over = (t: number) => s.filter((x) => x >= t * 1000).length;
  console.log(`   >=20s: ${over(20)} (${(over(20)/s.length*100).toFixed(1)}%)   >=25s: ${over(25)} (${(over(25)/s.length*100).toFixed(1)}%)   >=30s: ${over(30)} (${(over(30)/s.length*100).toFixed(1)}%)`);
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");

  const jobs = await prisma.aIJob.findMany({
    where: { durationMs: { not: null } },
    select: { id: true, durationMs: true, prompt: true, createdAt: true, model: true, outputTokens: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const isDoubles = (p: string) => {
    try { return (JSON.parse(p)?.categories ?? []).includes("SAME_GAME_DOUBLE"); } catch { return false; }
  };

  const all = jobs.map((j) => j.durationMs!).filter((d) => d > 0);
  const doubles = jobs.filter((j) => isDoubles(j.prompt)).map((j) => j.durationMs!).filter((d) => d > 0);
  const single = jobs.filter((j) => !isDoubles(j.prompt)).map((j) => j.durationMs!).filter((d) => d > 0);

  console.log("=== MODEL CALL LATENCY (AIJob.durationMs) ===\n");
  describe("all jobs        ", all);
  console.log("");
  describe("single-market   ", single);
  console.log("");
  describe("multi-market    ", doubles);

  // Output tokens are the mechanism: a doubles job writes 2-3 predictions'
  // worth of reasoning, so it should be visibly larger.
  const tok = (xs: typeof jobs) => {
    const t = xs.map((j) => j.outputTokens ?? 0).filter((n) => n > 0);
    return t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0;
  };
  console.log(`\nmean output tokens — single ${tok(jobs.filter((j) => !isDoubles(j.prompt)))}, multi ${tok(jobs.filter((j) => isDoubles(j.prompt)))}`);

  // By provider/model: a failover to a slower provider is a latency cliff.
  console.log("\nby model:");
  const byModel = new Map<string, number[]>();
  for (const j of jobs) {
    const k = j.model ?? "(unknown)";
    if (!byModel.has(k)) byModel.set(k, []);
    byModel.get(k)!.push(j.durationMs!);
  }
  for (const [m, xs] of [...byModel].sort((a, b) => b[1].length - a[1].length)) {
    const s = [...xs].sort((a, b) => a - b);
    console.log(`   ${m.padEnd(28)} n=${String(s.length).padStart(4)}  p50 ${(pct(s,50)/1000).toFixed(1)}s  p95 ${(pct(s,95)/1000).toFixed(1)}s  max ${(s[s.length-1]/1000).toFixed(1)}s`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
