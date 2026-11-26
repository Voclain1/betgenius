/**
 * READ-ONLY: why did Banker fall? Per Lagos kickoff day (21 days): Banker rows
 * actually tagged, what the production planner (planBankerCuration) would pick
 * from the same published rows now, and the confidence supply behind it, split
 * by generator (early lane vs regular) and by when the row was generated.
 * Aggregates only (the repository is public). No provider or model calls.
 *
 *   REQUIRE_READ_ONLY=1 npx tsx scripts/diagnose-banker.ts [days]
 */
import { PrismaClient } from "@prisma/client";
import { lagosDateKey } from "../src/lib/lagosDate";
import { planBankerCuration, BANKER_CONFIDENCE_FLOOR, type CurationRow } from "../src/lib/geniusCuration";

const db = new PrismaClient();
const days = Number(process.argv[2] ?? 21);
const out = (section: string, data: unknown) => console.log(JSON.stringify({ section, ...(data as object) }));
const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const H = 3_600_000;

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [r] = await db.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (r?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
  }
  const now = new Date();
  const from = new Date(+now - days * 24 * H), until = new Date(+now + 3 * 24 * H);
  const rows = await db.prediction.findMany({
    where: { kickoff: { gte: from, lt: until }, status: { in: ["PUBLISHED", "PENDING_REVIEW", "DRAFT", "APPROVED", "ARCHIVED"] } },
    select: { id: true, status: true, leagueApiId: true, confidence: true, provenance: true, marketType: true, createdAt: true, publishedAt: true, kickoff: true,
      fixtureApiId: true, homeTeamApiId: true, awayTeamApiId: true, aiJobId: true, outcome: true, approvedById: true,
      categories: { select: { category: true, manual: true } } },
  });
  const jobIds = [...new Set(rows.map((r) => r.aiJobId).filter((x): x is string => !!x))];
  const jobs = new Map<string, { intent: string | null; model: string }>();
  for (let i = 0; i < jobIds.length; i += 500)
    for (const j of await db.aIJob.findMany({ where: { id: { in: jobIds.slice(i, i + 500) } }, select: { id: true, prompt: true, model: true } })) {
      let intent: string | null = null; try { intent = JSON.parse(j.prompt)?.intent ?? null; } catch { /* ignore */ }
      jobs.set(j.id, { intent, model: j.model.split(":")[0] });
    }
  const lane = (r: (typeof rows)[number]) => { const j = r.aiJobId ? jobs.get(r.aiJobId) : null; return j?.intent === "EARLY_FREE" ? "early" : j?.intent ?? (r.aiJobId ? "regular" : "noJob"); };
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) { const d = lagosDateKey(r.kickoff!); byDay.set(d, [...(byDay.get(d) ?? []), r]); }

  const table: Record<string, unknown> = {};
  for (const [day, rs] of [...byDay.entries()].sort()) {
    const pub = rs.filter((r) => r.status === "PUBLISHED" && r.marketType !== "SAME_GAME_DOUBLE" && !r.categories.some((c) => c.category === "SAME_GAME_DOUBLE"));
    const banker = rs.filter((r) => r.categories.some((c) => c.category === "BANKER"));
    const curation: CurationRow[] = pub.map((r) => ({ ...r, model: null, categories: r.categories.map((c) => c.category), manualCategories: r.categories.filter((c) => c.manual).map((c) => c.category) }));
    // What the planner picks from these rows if it ran at the start of the day (nothing kicked off yet).
    const dayStart = new Date(Math.min(...pub.map((r) => +r.kickoff!)) - H);
    const plan = pub.length ? planBankerCuration(curation, dayStart) : { selectedIds: [] as string[] };
    const fixtures = (xs: typeof rows) => new Set(xs.map((r) => r.fixtureApiId ?? `${r.homeTeamApiId}-${r.awayTeamApiId}`)).size;
    const at75 = pub.filter((r) => r.confidence >= BANKER_CONFIDENCE_FLOOR);
    const all = rs.filter((r) => r.marketType !== "SAME_GAME_DOUBLE");
    const unpub75 = all.filter((r) => r.status !== "PUBLISHED" && r.confidence >= BANKER_CONFIDENCE_FLOOR);
    const conf: Record<string, number> = {}; const laneMix: Record<string, number> = {}; const lane75: Record<string, number> = {};
    for (const r of pub) { inc(conf, r.confidence >= 80 ? "80+" : r.confidence >= 75 ? "75-79" : r.confidence >= 70 ? "70-74" : "<70"); inc(laneMix, lane(r)); if (r.confidence >= 75) inc(lane75, lane(r)); }
    const unpubStatus: Record<string, number> = {}; for (const r of unpub75) inc(unpubStatus, `${r.status}:${lane(r)}`);
    const settled = banker.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
    table[day] = {
      bankerTagged: banker.length, bankerPublished: banker.filter((r) => r.status === "PUBLISHED").length, plannerWouldPick: plan.selectedIds.length,
      publishedSingles: pub.length, publishedFixtures: fixtures(pub), published75: at75.length, fixtures75: fixtures(at75),
      unpublished75: unpub75.length, unpublished75ByStatus: unpubStatus,
      meanConfPublished: pub.length ? Math.round((pub.reduce((a, r) => a + r.confidence, 0) / pub.length) * 10) / 10 : null,
      confBands: conf, laneMix, lane75,
      bankerRecord: settled.length ? `${settled.filter((r) => r.outcome === "WON").length}/${settled.length}` : null,
    };
  }
  out("bankerByKickoffDay", { floor: BANKER_CONFIDENCE_FLOOR, table });

  // Confidence by GENERATION day (when written), regular vs early lane, all stated picks (any status).
  const gen: Record<string, Record<string, { n: number; sum: number; at75: number }>> = {};
  for (const r of rows) {
    if (r.marketType === "SAME_GAME_DOUBLE" || !r.aiJobId) continue;
    const d = lagosDateKey(r.createdAt), l = lane(r);
    const g = ((gen[d] ??= {})[l] ??= { n: 0, sum: 0, at75: 0 }); g.n++; g.sum += r.confidence; if (r.confidence >= 75) g.at75++;
  }
  out("confidenceByGenerationDay", { byDay: Object.fromEntries(Object.entries(gen).sort().map(([d, m]) => [d, Object.fromEntries(Object.entries(m).map(([l, g]) => [l, { n: g.n, mean: Math.round((g.sum / g.n) * 10) / 10, at75: g.at75, pct75: Math.round((1000 * g.at75) / g.n) / 10 }]))])) });

  // Curation job evidence: when were BANKER links last written, per kickoff day.
  const links = await db.predictionCategoryLink.findMany({ where: { category: "BANKER", prediction: { kickoff: { gte: from, lt: until } } }, select: { createdAt: true, manual: true, prediction: { select: { kickoff: true } } } });
  const lastLink: Record<string, string> = {}; const manual: Record<string, number> = {};
  for (const l of links) { const d = lagosDateKey(l.prediction.kickoff!); if (!lastLink[d] || l.createdAt.toISOString() > lastLink[d]) lastLink[d] = l.createdAt.toISOString(); if (l.manual) inc(manual, d); }
  out("bankerLinks", { lastLinkByDay: lastLink, manualByDay: manual });
  // Recent publication activity: who publishes and when (bulk admin vs automatic), by kickoff day.
  const pubBy: Record<string, Record<string, number>> = {};
  for (const r of rows) if (r.status === "PUBLISHED" && r.publishedAt) { const d = lagosDateKey(r.kickoff!); inc((pubBy[d] ??= {}), `${lane(r)}:${r.approvedById ? "approved" : "auto"}`); }
  out("publishedByLaneAndPath", { byDay: Object.fromEntries(Object.entries(pubBy).sort()) });
}
main().catch((e) => { console.error(String(e?.message ?? e).slice(0, 500)); process.exit(1); }).finally(() => db.$disconnect());
