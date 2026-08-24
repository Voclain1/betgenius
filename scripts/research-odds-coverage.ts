/**
 * Research probe: does API-Football's /odds endpoint actually return real
 * bookmaker prices for the competitions we already track?
 *
 * Answers four questions, per competition, from the live API:
 *   1. Coverage      — do upcoming fixtures have odds at all?
 *   2. Lead time     — how far before kickoff do prices first appear?
 *   3. Depth         — how many bookmakers, how many markets, per fixture?
 *   4. Degeneracy    — is a "populated" response actually usable, or is it a
 *                      single bookmaker quoting one market, or placeholder
 *                      prices, or results>0 with an empty response array?
 *
 * Read-only. Writes nothing to the database and touches no app code.
 * Run: npx tsx --env-file=.env scripts/research-odds-coverage.ts
 */
export {};

import { LEAGUE_PRIORITY_ORDER, LEAGUE_CATALOGUE } from "../src/lib/leagues";

type ApiEnvelope<T> = { errors: unknown; results: number; response: T; paging?: { current: number; total: number } };

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

// Same 250ms pacing the app's client uses (240 req/min, under the 300/min cap).
const MIN_GAP_MS = 250;
let lastAt = 0;
let calls = 0;

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<ApiEnvelope<T>> {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  calls++;
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<ApiEnvelope<T>>;
}

function errorsOf(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return null;
  if (value && typeof value === "object" && Object.keys(value).length === 0) return null;
  return value || null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hoursUntil = (dateStr: string, now: Date) => (new Date(dateStr).getTime() - now.getTime()) / 3_600_000;

function leadBucket(hours: number): string {
  if (hours < 0) return "past";
  if (hours < 6) return "<6h";
  if (hours < 24) return "6-24h";
  if (hours < 72) return "1-3d";
  if (hours < 168) return "3-7d";
  return "7d+";
}

/** One fixture's odds response, reduced to the facts that decide usability. */
type OddsProbe = {
  fixtureId: number;
  label: string;
  kickoff: string;
  hoursToKickoff: number;
  bucket: string;
  results: number;
  errors: unknown;
  bookmakers: number;
  bookmakerNames: string[];
  /** Distinct market (bet) names across all bookmakers on this fixture. */
  markets: number;
  marketNames: string[];
  /** The Match Winner (1X2) line from the first bookmaker that quotes it. */
  matchWinner: { bookmaker: string; home: number; draw: number; away: number; overround: number } | null;
  /** Best (highest) price offered on any 1X2 selection, across every bookmaker. */
  bestPrice: { selection: string; odd: number; bookmaker: string } | null;
  /** How stale the API says the quote is. */
  updateAt: string | null;
  degenerate: string[];
};

async function probeFixture(fixtureId: number, label: string, kickoff: string, now: Date): Promise<OddsProbe> {
  const odds = await call<any[]>("/odds", { fixture: fixtureId });
  const entry = odds.response?.[0];
  const bookmakers: any[] = entry?.bookmakers ?? [];
  const marketNames = [...new Set(bookmakers.flatMap((b) => (b.bets ?? []).map((bet: any) => bet.name)))] as string[];

  let matchWinner: OddsProbe["matchWinner"] = null;
  let bestPrice: OddsProbe["bestPrice"] = null;
  for (const b of bookmakers) {
    const bet = (b.bets ?? []).find((x: any) => x.name === "Match Winner");
    if (!bet) continue;
    const priceOf = (name: string) => Number(bet.values.find((v: any) => v.value === name)?.odd);
    const home = priceOf("Home");
    const draw = priceOf("Draw");
    const away = priceOf("Away");
    for (const v of bet.values) {
      const odd = Number(v.odd);
      if (Number.isFinite(odd) && (!bestPrice || odd > bestPrice.odd)) bestPrice = { selection: v.value, odd, bookmaker: b.name };
    }
    if (!matchWinner && [home, draw, away].every(Number.isFinite)) {
      const overround = 1 / home + 1 / draw + 1 / away;
      matchWinner = { bookmaker: b.name, home, draw, away, overround: Number(overround.toFixed(4)) };
    }
  }

  // Degeneracy checks — the point of the probe. A response can be "successful"
  // and still be unusable, and each of these has a different remedy.
  const degenerate: string[] = [];
  if (odds.results > 0 && bookmakers.length === 0) degenerate.push("results>0 but no bookmakers in response");
  if (bookmakers.length > 0 && bookmakers.length < 3) degenerate.push(`thin book (${bookmakers.length} bookmaker(s))`);
  if (bookmakers.some((b) => (b.bets ?? []).length === 0)) degenerate.push("bookmaker present with zero markets");
  if (bookmakers.length > 0 && !matchWinner) degenerate.push("no complete Match Winner (1X2) line");
  if (matchWinner && (matchWinner.overround < 1 || matchWinner.overround > 1.25)) {
    degenerate.push(`implausible 1X2 overround ${matchWinner.overround}`);
  }
  if (bookmakers.some((b) => (b.bets ?? []).some((bet: any) => (bet.values ?? []).some((v: any) => Number(v.odd) <= 1)))) {
    degenerate.push("price <= 1.00 quoted (placeholder)");
  }

  return {
    fixtureId,
    label,
    kickoff,
    hoursToKickoff: Number(hoursUntil(kickoff, now).toFixed(1)),
    bucket: leadBucket(hoursUntil(kickoff, now)),
    results: odds.results,
    errors: errorsOf(odds.errors),
    bookmakers: bookmakers.length,
    bookmakerNames: bookmakers.map((b) => b.name).slice(0, 12),
    markets: marketNames.length,
    marketNames: marketNames.slice(0, 25),
    matchWinner,
    bestPrice,
    updateAt: entry?.update ?? null,
    degenerate,
  };
}

async function main() {
  const now = new Date();
  const from = iso(now);
  const to = iso(new Date(now.getTime() + 14 * 86_400_000));

  // Reference catalogues first: how many bookmakers and markets exist on this
  // plan at all, which bounds every per-fixture number below.
  const [bookmakerList, betList, mapping] = await Promise.all([
    call<any[]>("/odds/bookmakers"),
    call<any[]>("/odds/bets"),
    call<any[]>("/odds/mapping"),
  ]);

  const perLeague: any[] = [];
  const byBucket = new Map<string, { sampled: number; withOdds: number; bookmakerTotal: number }>();
  const bookmakerFrequency = new Map<string, number>();

  for (const leagueId of LEAGUE_PRIORITY_ORDER) {
    const meta = LEAGUE_CATALOGUE.find((l) => l.id === leagueId);
    const seasonsRaw = await call<any[]>("/leagues", { id: leagueId });
    const seasons = seasonsRaw.response[0]?.seasons ?? [];
    const today = iso(now);
    const season =
      seasons.find((s: any) => s.start <= today && today <= s.end) ?? seasons.find((s: any) => s.current) ?? seasons.at(-1);
    const coverage = season?.coverage?.odds ?? null;

    const report: any = {
      leagueId,
      name: meta ? `${meta.name} (${meta.country})` : String(leagueId),
      tier: meta?.tier ?? "unknown",
      kind: meta?.kind ?? "unknown",
      season: season?.year ?? null,
      advertisedOddsCoverage: coverage,
      upcomingFixtures: 0,
      sampled: [] as OddsProbe[],
    };

    if (!season) {
      report.note = "no season metadata";
      perLeague.push(report);
      continue;
    }

    const fixtures = await call<any[]>("/fixtures", { league: leagueId, season: season.year, from, to });
    const upcoming = (fixtures.response ?? [])
      .filter((f) => f.fixture?.status?.short === "NS" && hoursUntil(f.fixture.date, now) > 0)
      .sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime());
    report.upcomingFixtures = upcoming.length;
    report.fixturesErrors = errorsOf(fixtures.errors);

    if (upcoming.length === 0) {
      report.note = "no upcoming fixtures in the next 14 days";
      perLeague.push(report);
      continue;
    }

    // Sample across the lead-time range rather than the first three fixtures:
    // "do odds exist" and "how early do they exist" are different questions and
    // taking only the soonest kickoffs would answer the second one wrongly.
    const picks = [upcoming[0], upcoming[Math.floor(upcoming.length / 2)], upcoming[upcoming.length - 1]]
      .filter((f, i, arr) => f && arr.findIndex((x) => x.fixture.id === f.fixture.id) === i);

    for (const f of picks) {
      const probe = await probeFixture(f.fixture.id, `${f.teams.home.name} v ${f.teams.away.name}`, f.fixture.date, now);
      report.sampled.push(probe);
      const bucket = byBucket.get(probe.bucket) ?? { sampled: 0, withOdds: 0, bookmakerTotal: 0 };
      bucket.sampled++;
      if (probe.bookmakers > 0) bucket.withOdds++;
      bucket.bookmakerTotal += probe.bookmakers;
      byBucket.set(probe.bucket, bucket);
      for (const name of probe.bookmakerNames) bookmakerFrequency.set(name, (bookmakerFrequency.get(name) ?? 0) + 1);
    }

    const withOdds = report.sampled.filter((p: OddsProbe) => p.bookmakers > 0);
    report.verdict = withOdds.length === 0 ? "NO ODDS" : withOdds.length === report.sampled.length ? "FULL" : "PARTIAL";
    perLeague.push(report);
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        window: { from, to },
        apiCallsSpent: calls,
        catalogue: {
          bookmakers: {
            results: bookmakerList.results,
            errors: errorsOf(bookmakerList.errors),
            names: bookmakerList.response.map((b: any) => b.name),
          },
          markets: { results: betList.results, errors: errorsOf(betList.errors), sample: betList.response.slice(0, 40).map((b: any) => b.name) },
          mappingCoverage: { results: mapping.results, pages: mapping.paging?.total ?? null, errors: errorsOf(mapping.errors) },
        },
        leadTimeBuckets: [...byBucket.entries()].map(([bucket, v]) => ({
          bucket,
          sampled: v.sampled,
          withOdds: v.withOdds,
          hitRate: `${Math.round((v.withOdds / v.sampled) * 100)}%`,
          avgBookmakers: Number((v.bookmakerTotal / Math.max(1, v.withOdds)).toFixed(1)),
        })),
        bookmakerFrequency: [...bookmakerFrequency.entries()].sort((a, b) => b[1] - a[1]),
        perLeague,
      },
      null,
      2,
    ),
  );
}

main();
