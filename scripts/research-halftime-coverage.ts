/**
 * Quick coverage check: does api-football reliably return score.halftime for
 * the competitions we track?
 *
 * Deliberately lighter than the odds/squad research passes — halftime score is
 * a single scalar pair on a response we ALREADY fetch, not a separate endpoint
 * with its own plan gating. What still needs checking is the same thing that
 * caught out the odds work: whether a field that is nominally present is
 * actually populated, and whether it is populated for FINISHED matches
 * specifically (an unplayed or abandoned fixture legitimately has nulls).
 *
 * One /fixtures call per competition. Read-only.
 *
 * Run: npx tsx --env-file=.env scripts/research-halftime-coverage.ts
 */
export {};

import { LEAGUE_CATALOGUE, LEAGUE_PRIORITY_ORDER } from "../src/lib/leagues";

type Envelope<T> = { errors: unknown; results: number; response: T };

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

let lastAt = 0;
async function call<T>(path: string, params: Record<string, string | number>): Promise<Envelope<T>> {
  const wait = Math.max(0, lastAt + 250 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json() as Promise<Envelope<T>>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Statuses where a halftime score MUST exist — the match reached the interval. */
const PLAYED = ["FT", "AET", "PEN"];

async function main() {
  const now = new Date();
  const from = iso(new Date(now.getTime() - 45 * 86_400_000));
  const to = iso(now);

  const rows: any[] = [];
  let totalPlayed = 0;
  let totalWithHT = 0;
  /** The case that actually exercises Win Either Half settlement. */
  const splitHalfExamples: any[] = [];

  for (const leagueId of LEAGUE_PRIORITY_ORDER) {
    const meta = LEAGUE_CATALOGUE.find((l) => l.id === leagueId);
    const seasons = await call<any[]>("/leagues", { id: leagueId });
    const list = seasons.response[0]?.seasons ?? [];
    const today = iso(now);
    const season = list.find((s: any) => s.start <= today && today <= s.end) ?? list.find((s: any) => s.current) ?? list.at(-1);
    if (!season) {
      rows.push({ league: meta?.name ?? leagueId, note: "no season metadata" });
      continue;
    }

    const fixtures = await call<any[]>("/fixtures", { league: leagueId, season: season.year, from, to });
    const played = (fixtures.response ?? []).filter((f) => PLAYED.includes(f.fixture?.status?.short));

    if (played.length === 0) {
      rows.push({ league: `${meta?.name} (${meta?.country})`, tier: meta?.tier, played: 0, note: "no finished fixtures in the last 45 days" });
      continue;
    }

    let withHT = 0;
    let withFT = 0;
    let consistent = 0;
    for (const f of played) {
      const ht = f.score?.halftime;
      const ft = f.score?.fulltime;
      const htOk = ht && ht.home != null && ht.away != null;
      const ftOk = ft && ft.home != null && ft.away != null;
      if (htOk) withHT++;
      if (ftOk) withFT++;
      // Second half is DERIVED (fulltime minus halftime), so it is only sound
      // when both are present and fulltime is not less than halftime.
      if (htOk && ftOk && ft.home >= ht.home && ft.away >= ht.away) {
        consistent++;
        const h2 = { home: ft.home - ht.home, away: ft.away - ht.away };
        const homeWonOne = ht.home > ht.away !== h2.home > h2.away;
        const awayWonOne = ht.away > ht.home !== h2.away > h2.home;
        // Keep examples where a side won exactly one half — the settlement case
        // that a clean sweep would never exercise.
        if ((homeWonOne || awayWonOne) && splitHalfExamples.length < 12) {
          splitHalfExamples.push({
            fixtureId: f.fixture.id,
            league: meta?.name,
            match: `${f.teams.home.name} v ${f.teams.away.name}`,
            halftime: `${ht.home}-${ht.away}`,
            fulltime: `${ft.home}-${ft.away}`,
            secondHalf: `${h2.home}-${h2.away}`,
          });
        }
      }
    }

    totalPlayed += played.length;
    totalWithHT += withHT;
    rows.push({
      league: `${meta?.name} (${meta?.country})`,
      tier: meta?.tier,
      kind: meta?.kind,
      played: played.length,
      withHalftime: withHT,
      withFulltime: withFT,
      derivableSecondHalf: consistent,
      coverage: `${((withHT / played.length) * 100).toFixed(1)}%`,
      verdict: withHT === played.length ? "FULL" : withHT === 0 ? "NONE" : "PARTIAL",
    });
  }

  console.log(JSON.stringify({ window: { from, to }, perCompetition: rows }, null, 2));
  console.log("\n=== AGGREGATE ===");
  console.log(`finished fixtures sampled: ${totalPlayed}`);
  console.log(`with a halftime score:     ${totalWithHT} (${((totalWithHT / Math.max(1, totalPlayed)) * 100).toFixed(2)}%)`);
  console.log(`competitions FULL:    ${rows.filter((r) => r.verdict === "FULL").length}`);
  console.log(`competitions PARTIAL: ${rows.filter((r) => r.verdict === "PARTIAL").length}`);
  console.log(`competitions NONE:    ${rows.filter((r) => r.verdict === "NONE").length}`);
  console.log(`competitions with no finished fixtures to test: ${rows.filter((r) => r.note).length}`);
  console.log("\n=== SPLIT-HALF EXAMPLES (a side won exactly one half — the real settlement test) ===");
  for (const e of splitHalfExamples) console.log(`  ${String(e.fixtureId).padEnd(9)} ${e.match} — HT ${e.halftime}, 2H ${e.secondHalf}, FT ${e.fulltime}  [${e.league}]`);
}

main();
