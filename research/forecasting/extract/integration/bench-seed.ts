/**
 * Seed a THROWAWAY local database with SYNTHETIC rows at production-like
 * VOLUME (not production-like content), to measure extractor time, memory and
 * snapshot duration. Used by bench-local-extract.sh only. Fictional ids.
 *
 * Volumes follow the audit figures in the research brief: ~7,900 predictions,
 * ~4,400 fixture ids, ~5,150 jobs. A configurable share of jobs carry v1
 * contexts padded to ~150 KB (the measured size of real v1 raw payloads);
 * the rest carry small v2 digests. Padding uses random hex so TOAST cannot
 * compress it far below real payloads.
 */
export {};

import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const url = process.env.BENCH_ADMIN_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("BENCH_ADMIN_URL must point at a local throwaway database");
const FIXTURES = Number(process.env.BENCH_FIXTURES ?? 4400);
const JOBS = Number(process.env.BENCH_JOBS ?? 5150);
const V1_JOBS = Number(process.env.BENCH_V1_JOBS ?? 1500);
const PREDICTIONS = Number(process.env.BENCH_PREDICTIONS ?? 7900);
const V1_KB = Number(process.env.BENCH_V1_KB ?? 150);

const db = new PrismaClient({ datasourceUrl: url });
const hex = (n: number) => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
const START = Date.parse("2025-08-01T00:00:00Z");

function fr(id: number, date: string, h: number, a: number) {
  return { fixture: { id, date, status: { short: "FT" } }, league: { id: 9901, name: "Synthetic League" },
    teams: { home: { id: h, name: `Synthetic ${h}` }, away: { id: a, name: `Synthetic ${a}` } }, goals: { home: 1, away: 0 } };
}

function v1(home: number, away: number, kickoff: string) {
  const injuries = Array.from({ length: Math.max(1, Math.floor((V1_KB * 1024) / 1100)) }, (_, i) => ({
    player: { id: i, name: `Synthetic Player ${i}`, photo: `https://example.invalid/${hex(40)}.png`, type: "Missing Fixture", reason: "Knee Injury" },
    team: { id: home, name: `Synthetic ${home}`, logo: `https://example.invalid/${hex(40)}.png` },
    fixture: { id: 1, timezone: "UTC", date: "2025-09-01T15:00:00+00:00", timestamp: 0 },
    league: { id: 9901, season: 2025, name: "Synthetic League", country: "Nowhere", logo: `https://example.invalid/${hex(40)}.png`, flag: null },
    pad: hex(600),
  }));
  const last = [0, 1, 2, 3, 4].map((i) => fr(80_000_000 + i, new Date(Date.parse(kickoff) - (i + 3) * 7 * 86_400_000).toISOString(), home, 99_999));
  return { v: 1, home: `Synthetic ${home}`, away: `Synthetic ${away}`, league: "Synthetic League", kickoff,
    homeContext: { statistics: null, injuries, lastFixtures: last }, awayContext: { statistics: null, injuries: [], lastFixtures: [] },
    standings: null, h2h: [fr(81_000_000, "2025-03-01T15:00:00+00:00", away, home)] };
}

function v2(home: number, away: number, kickoff: string) {
  const team = (id: number) => ({ name: `Synthetic ${id}`, apiId: id, rank: null, points: null, overall: null, home: null, away: null,
    goalsForAvg: null, goalsAgainstAvg: null, cleanSheets: null, failedToScore: null, form: "WDLWW", streak: null, biggest: null, formations: [],
    cards: null, penalties: null, availability: [], availabilityAsOf: null, keyPlayers: [],
    last5: [0, 1, 2, 3, 4].map((i) => ({ opponent: "Synthetic Opp", venue: i % 2 ? "away" : "home", result: "W", goalsFor: 2, goalsAgainst: 1,
      date: new Date(Date.parse(kickoff) - (i + 3) * 7 * 86_400_000).toISOString().slice(0, 10), competition: "Synthetic League",
      opponentApiId: 99_000 + i, competitionApiId: 9901 })) });
  return { v: 2, digest: { v: 2, fixture: { home: `Synthetic ${home}`, away: `Synthetic ${away}`, league: "Synthetic League", kickoff },
    teams: { home: team(home), away: team(away) }, h2h: null, standings: null, notes: hex(3000),
    coverage: { stats: false, form: true, availability: false, h2h: false, standings: false } } };
}

async function main() {
  await db.user.create({ data: { id: "bench-author", email: "bench@example.invalid" } });
  const fixtures = Array.from({ length: FIXTURES }, (_, i) => {
    const kickoff = new Date(START + i * 2 * 3_600_000 + 86_400_000);
    return { id: 92_000_000 + i, home: 98_000 + (i % 400), away: 98_400 + (i % 400), kickoff };
  });
  const jobs = Array.from({ length: JOBS }, (_, j) => fixtures[j % FIXTURES]);
  for (let j = 0; j < JOBS; j += 50) {
    const batch = jobs.slice(j, j + 50).map((f, k) => {
      const idx = j + k;
      const ko = f.kickoff.toISOString();
      return { id: `benchjob${String(idx).padStart(6, "0")}`, userId: "bench-author", prompt: "synthetic", model: "synthetic:engine", rawOutput: "{}",
        createdAt: new Date(f.kickoff.getTime() - 20 * 3_600_000), context: (idx < V1_JOBS ? v1(f.home, f.away, ko) : v2(f.home, f.away, ko)) as any };
    });
    await db.aIJob.createMany({ data: batch });
    process.stdout.write(`\rjobs ${Math.min(j + 50, JOBS)}/${JOBS}`);
  }
  process.stdout.write("\n");
  const preds = Array.from({ length: PREDICTIONS }, (_, p) => {
    const f = fixtures[p % FIXTURES];
    return { id: `benchpred${p}`, category: "TODAY", market: "Match Winner", pick: "Home", confidence: 60, reasoning: "synthetic", authorId: "bench-author",
      fixtureApiId: f.id, leagueApiId: 9901, homeTeamApiId: f.home, awayTeamApiId: f.away, kickoff: f.kickoff, marketType: "MATCH_WINNER",
      selection: { value: "HOME" }, finalHomeScore: 1, finalAwayScore: 0, outcome: "WON", settledAt: new Date(f.kickoff.getTime() + 3 * 3_600_000),
      aiJobId: `benchjob${String(p % JOBS).padStart(6, "0")}`, createdAt: new Date(f.kickoff.getTime() - 20 * 3_600_000) };
  });
  for (let p = 0; p < preds.length; p += 500) await db.prediction.createMany({ data: preds.slice(p, p + 500) });
  const [{ size }] = await db.$queryRawUnsafe<{ size: string }[]>(`SELECT pg_size_pretty(pg_total_relation_size('"AIJob"')) AS size`);
  console.log(`seeded ${FIXTURES} fixtures, ${JOBS} jobs (${V1_JOBS} v1 at ~${V1_KB} KB), ${PREDICTIONS} predictions; AIJob on disk ${size}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
