/**
 * Why the Genius feed is empty: settlement/curation runs, what curation would
 * select today, and what each Lagos day's feeds actually carried.
 *
 * READ-ONLY. No provider calls, no writes. Safe against production.
 *
 * Run: npx tsx --env-file=.env scripts/measure-genius.ts [days=7]
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { prisma } from "../src/lib/prisma";
import { lagosDateKey, lagosDayBounds } from "../src/lib/lagosDate";
import { JOB_SETTLE } from "../src/lib/jobRuns";
import { planCuration, GENIUS_CONFIDENCE_FLOOR, type CurationRow } from "../src/lib/geniusCuration";

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
    console.log("session verified read-only");
  }
  const days = Math.max(1, Number(process.argv[2]) || 7);

  console.log("\n1. Settlement runs (curation runs inside them), last 48h:");
  const runs = await prisma.jobRun.findMany({ where: { job: JOB_SETTLE, ranAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, orderBy: { ranAt: "asc" } });
  for (const r of runs) {
    const c = (r.detail as any)?.curation;
    const g = c?.genius;
    console.log(`   ${r.ranAt.toISOString().slice(0, 16)} ok=${r.ok} ${r.summary ?? ""}${g ? ` | genius considered ${g.considered} selected ${g.selected} +${g.added?.length ?? "?"} -${g.removed?.length ?? "?"}` : " | no curation detail"}`);
  }
  const otherJobs = await prisma.jobRun.groupBy({ by: ["job"], where: { ranAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, _count: true });
  console.log(`   all jobs, last 48h: ${otherJobs.map((j) => `${j.job} ${j._count}`).join(", ")}`);
  const lastSettle = await prisma.jobRun.findFirst({ where: { job: JOB_SETTLE }, orderBy: { ranAt: "desc" } });
  console.log(`   last settle run ever: ${lastSettle?.ranAt.toISOString() ?? "never"} ${lastSettle?.summary ?? ""}`);
  if (lastSettle?.detail) console.log(`   last settle detail keys: ${Object.keys(lastSettle.detail as any).join(",")}`);

  console.log("\n2. Per Lagos kickoff day: published picks (excluding hidden combo legs) and what each feed carried:");
  for (let off = -days + 1; off <= 2; off++) {
    const { start, end } = lagosDayBounds(off);
    const rows = await prisma.prediction.findMany({
      where: { status: "PUBLISHED", kickoff: { gte: start, lt: end } },
      select: { confidence: true, marketType: true, provenance: true, categories: { select: { category: true } } },
    });
    const cats = (r: (typeof rows)[number]) => r.categories.map((c) => c.category);
    const legs = rows.filter((r) => r.marketType !== "SAME_GAME_DOUBLE" && cats(r).includes("SAME_GAME_DOUBLE")).length;
    const vis = rows.filter((r) => !(r.marketType !== "SAME_GAME_DOUBLE" && cats(r).includes("SAME_GAME_DOUBLE")));
    const count = (c: string) => vis.filter((r) => cats(r).includes(c)).length;
    console.log(`   ${lagosDateKey(start)} (${off >= 0 ? "+" : ""}${off}): published ${vis.length} (+${legs} legs), conf>=${GENIUS_CONFIDENCE_FLOOR}: ${vis.filter((r) => r.confidence >= GENIUS_CONFIDENCE_FLOOR).length} | GENIUS ${count("GENIUS")} FEATURED ${count("FEATURED")} BANKER ${count("BANKER")} VIP ${count("VIP")} PREMIUM ${count("PREMIUM")} BOTD ${count("BET_OF_THE_DAY")}`);
  }

  console.log("\n3. What curation would select for GENIUS today (pure plan, nothing written):");
  const { start, end } = lagosDayBounds(0);
  const raw = await prisma.prediction.findMany({
    where: {
      status: "PUBLISHED", kickoff: { gte: start, lt: end },
      NOT: { marketType: { not: "SAME_GAME_DOUBLE" }, categories: { some: { category: "SAME_GAME_DOUBLE" } } },
    },
    select: { id: true, leagueApiId: true, confidence: true, provenance: true, marketType: true, createdAt: true, kickoff: true, fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, homeTeam: true, awayTeam: true, categories: { select: { category: true } } },
  });
  const rows: CurationRow[] = raw.map((r) => ({ ...r, categories: r.categories.map((c) => c.category) }));
  const plan = planCuration("GENIUS", rows);
  console.log(`   considered ${plan.considered}, selected ${plan.selected}, would add ${plan.added.length}, would remove ${plan.removed.length}`);
  const byId = new Map(raw.map((r) => [r.id, r]));
  for (const id of plan.selectedIds.slice(0, 15)) {
    const r = byId.get(id)!;
    console.log(`     ${r.confidence}% ${r.homeTeam} v ${r.awayTeam} [league ${r.leagueApiId}] ${r.categories.map((c) => c.category).join("/")}`);
  }

  console.log("\n4. GENIUS tags by kickoff month (all time):");
  const tagged = await prisma.prediction.findMany({ where: { categories: { some: { category: "GENIUS" } } }, select: { kickoff: true, status: true } });
  const byMonth: Record<string, number> = {};
  for (const t of tagged) { const k = `${t.kickoff?.toISOString().slice(0, 7) ?? "none"} ${t.status}`; byMonth[k] = (byMonth[k] ?? 0) + 1; }
  console.log(`   ${Object.entries(byMonth).sort().map(([k, v]) => `${k}: ${v}`).join(" | ") || "none"}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
