/**
 * Global competition audit probe (Sprint 05 continuation).
 *
 * The audit set is every competition with a fixture today or tomorrow (UTC)
 * that the league catalogue does not know. That is the same definition that
 * produced "217 uncatalogued competitions" on 13 Nov 2026. For each one it
 * collects:
 *
 *   identity / season / coverage   one /leagues?current=true call for all
 *   upcoming                       /fixtures?date= for today, +1 and +2 (3 calls)
 *   history                        /fixtures?date= for the 7 previous days (7 calls)
 *   bookmakers                     /odds?fixture= on the soonest unstarted fixture
 *                                  of each competition that the fixed rules have not
 *                                  already excluded, most fixtures first, until the
 *                                  call cap
 *   existing coverage              predictions BetGenius holds for that id (read-only
 *                                  database, last 60 days), when a database is configured
 *
 * Then it applies decideEligibility (src/lib/generation/globalCompetitionAudit.ts)
 * and prints one AUDIT_ROW line per competition plus a summary.
 *
 * Provider calls are hard-capped at MAX_CALLS (90, about 1.2% of the daily
 * 7,500). Read-only everywhere.
 *
 * Run: npx tsx --env-file=.env scripts/research-global-competitions.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { LEAGUE_CATALOGUE } from "../src/lib/leagues";
import { auditCompetitions, decideEligibility, summariseAudit, type CompetitionEvidence } from "../src/lib/generation/globalCompetitionAudit";

type Env<T> = { errors: unknown; results: number; response: T };
const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

const MAX_CALLS = 90;
let calls = 0;
let lastAt = 0;
async function call<T>(path: string, params: Record<string, string | number>): Promise<Env<T> | null> {
  if (calls >= MAX_CALLS) return null;
  const wait = Math.max(0, lastAt + 250 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  calls++;
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) { console.log(`  ${path} HTTP ${res.status}`); return null; }
  return (await res.json()) as Env<T>;
}

type LeagueRow = { league: { id: number; name: string; type: string }; country: { name: string }; seasons: Array<{ year: number; start: string; end: string; current: boolean; coverage: any }> };
type FixtureRow = { fixture: { id: number; date: string; status: { short: string } }; league: { id: number; name: string; country: string; season: number }; goals: { home: number | null; away: number | null }; score: { halftime: { home: number | null; away: number | null } } };
type OddsRow = { bookmakers: Array<{ id: number }> };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function existingPredictions(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!process.env.DATABASE_URL || !ids.length) return out;
  const { prisma } = await import("../src/lib/prisma");
  try {
    if (process.env.REQUIRE_READ_ONLY === "1") {
      const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
      if (ro?.transaction_read_only !== "on") throw new Error("refusing: session is not read-only");
      console.log("database session verified read-only");
    }
    const rows = await prisma.prediction.groupBy({ by: ["leagueApiId"], where: { leagueApiId: { in: ids }, createdAt: { gte: new Date(Date.now() - 60 * DAY) } }, _count: { _all: true } });
    for (const r of rows) if (r.leagueApiId != null) out.set(r.leagueApiId, r._count._all);
  } finally {
    await prisma.$disconnect();
  }
  return out;
}

async function main() {
  const now = new Date();
  const asOf = iso(now);
  const catalogued = new Set<number>(LEAGUE_CATALOGUE.map((l) => l.id));

  const leagues = (await call<LeagueRow[]>("/leagues", { current: "true" }))?.response ?? [];
  const leagueById = new Map(leagues.map((l) => [l.league.id, l]));
  console.log(`provider lists ${leagues.length} competitions with a current season`);

  const forward: FixtureRow[] = [];
  for (let d = 0; d < 3; d++) forward.push(...((await call<FixtureRow[]>("/fixtures", { date: iso(new Date(now.getTime() + d * DAY)) }))?.response ?? []));
  const backward: FixtureRow[] = [];
  for (let d = 1; d <= 7; d++) backward.push(...((await call<FixtureRow[]>("/fixtures", { date: iso(new Date(now.getTime() - d * DAY)) }))?.response ?? []));

  // The audit set: uncatalogued competitions with a fixture today or tomorrow.
  const auditDates = new Set([asOf, iso(new Date(now.getTime() + DAY))]);
  const auditIds = new Set<number>();
  for (const f of forward) if (!catalogued.has(f.league.id) && auditDates.has(f.fixture.date.slice(0, 10))) auditIds.add(f.league.id);
  console.log(`audit set: ${auditIds.size} uncatalogued competitions with fixtures on ${[...auditDates].join(", ")}`);

  const evidence = new Map<number, CompetitionEvidence & { _sample: number | null }>();
  for (const id of auditIds) {
    const l = leagueById.get(id);
    const anyFx = forward.find((f) => f.league.id === id) ?? backward.find((f) => f.league.id === id);
    const s = l?.seasons.find((x) => x.current) ?? null;
    const up = forward.filter((f) => f.league.id === id && f.fixture.status.short === "NS" && new Date(f.fixture.date) > now)
      .sort((a, b) => a.fixture.date.localeCompare(b.fixture.date));
    const fin = backward.filter((f) => f.league.id === id && ["FT", "AET", "PEN"].includes(f.fixture.status.short));
    evidence.set(id, {
      id,
      name: l?.league.name ?? anyFx?.league.name ?? `league ${id}`,
      country: l?.country.name ?? anyFx?.league.country ?? "?",
      type: l?.league.type ?? "?",
      season: s?.year ?? null, seasonStart: s?.start ?? null, seasonEnd: s?.end ?? null, current: !!s?.current,
      coverage: {
        odds: !!s?.coverage?.odds, standings: !!s?.coverage?.standings, fixtureStats: !!s?.coverage?.fixtures?.statistics_fixtures,
        events: !!s?.coverage?.fixtures?.events, lineups: !!s?.coverage?.fixtures?.lineups,
      },
      upcoming: up.length,
      finished: fin.length,
      finishedWithScore: fin.filter((f) => f.goals.home != null && f.goals.away != null).length,
      finishedWithHalfTime: fin.filter((f) => f.score?.halftime?.home != null && f.score?.halftime?.away != null).length,
      sampledBookmakers: [],
      existingPredictions: 0,
      _sample: up[0]?.fixture.id ?? null,
    });
  }

  // Bookmaker sample: only where the fixed rules leave the decision open.
  const open = [...evidence.values()]
    .filter((e) => e._sample != null && decideEligibility(e, asOf).decision !== "EXCLUDE")
    .sort((a, b) => b.upcoming - a.upcoming || a.id - b.id);
  let sampled = 0;
  for (const e of open) {
    const r = await call<OddsRow[]>("/odds", { fixture: e._sample! });
    if (!r) break;
    e.sampledBookmakers = [r.response?.[0]?.bookmakers?.length ?? 0];
    sampled++;
  }
  console.log(`bookmaker samples: ${sampled} of ${open.length} open competitions (call cap ${MAX_CALLS})`);

  const existing = await existingPredictions([...auditIds]).catch((e) => { console.log(`existing-coverage read skipped: ${e.message}`); return new Map<number, number>(); });
  const rows = auditCompetitions([...evidence.values()].map(({ _sample, ...e }) => ({ ...e, existingPredictions: existing.get(e.id) ?? 0 })), asOf);
  for (const r of rows) console.log(`AUDIT_ROW ${JSON.stringify(r)}`);
  const s = summariseAudit(rows);
  console.log(`\nSUMMARY ${JSON.stringify(s)}`);
  console.log(`INCLUDE: ${rows.filter((r) => r.decision === "INCLUDE").map((r) => `${r.id} ${r.country}/${r.name}`).join("; ") || "none"}`);
  console.log(`provider calls used: ${calls} (cap ${MAX_CALLS})`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
