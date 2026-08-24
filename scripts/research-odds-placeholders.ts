/**
 * Third probe: the first pass flagged "price <= 1.00 quoted" on 44 of 47
 * fixtures that had odds at all. A price of 1.00 or below pays nothing, so
 * either the feed is padded with placeholders (which would make any automatic
 * "pick the high odd" selection unsafe) or it is confined to exotic markets
 * we would never surface. This finds out which, by naming the markets and
 * bookmakers those prices come from.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-odds-placeholders.ts
 */
export {};

type ApiEnvelope<T> = { errors: unknown; results: number; response: T };

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");

let lastAt = 0;
async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<ApiEnvelope<T>> {
  const wait = Math.max(0, lastAt + 250 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const url = new URL(`https://${host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json() as Promise<ApiEnvelope<T>>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Markets we would ever put in front of a reader — everything else is noise for this question. */
const HEADLINE_MARKETS = ["Match Winner", "Double Chance", "Goals Over/Under", "Both Teams Score"];

async function main() {
  const now = new Date();
  const today = iso(now);

  // Today's slate across the whole feed — the widest sample for the cheapest
  // number of calls, since we only care about price shapes, not about leagues.
  const fixtures: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await call<any[]>("/odds", { date: today, page });
    fixtures.push(...(r.response ?? []));
    if ((r.response ?? []).length === 0) break;
  }

  const lowByMarket = new Map<string, { count: number; samples: string[] }>();
  const lowByBookmaker = new Map<string, number>();
  let totalPrices = 0;
  let lowPrices = 0;
  const headlineLows: any[] = [];
  const headlineSpread: Record<string, { min: number; max: number; n: number }> = {};

  for (const entry of fixtures) {
    for (const b of entry.bookmakers ?? []) {
      for (const bet of b.bets ?? []) {
        for (const v of bet.values ?? []) {
          const odd = Number(v.odd);
          totalPrices++;
          if (HEADLINE_MARKETS.includes(bet.name) && Number.isFinite(odd)) {
            const s = (headlineSpread[bet.name] ??= { min: Infinity, max: -Infinity, n: 0 });
            s.min = Math.min(s.min, odd);
            s.max = Math.max(s.max, odd);
            s.n++;
          }
          if (!Number.isFinite(odd) || odd > 1) continue;
          lowPrices++;
          const rec = lowByMarket.get(bet.name) ?? { count: 0, samples: [] };
          rec.count++;
          if (rec.samples.length < 3) rec.samples.push(`${b.name}: ${v.value} @ ${v.odd}`);
          lowByMarket.set(bet.name, rec);
          lowByBookmaker.set(b.name, (lowByBookmaker.get(b.name) ?? 0) + 1);
          if (HEADLINE_MARKETS.includes(bet.name)) {
            headlineLows.push({ fixture: entry.fixture?.id, market: bet.name, bookmaker: b.name, value: v.value, odd: v.odd });
          }
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        fixturesInspected: fixtures.length,
        totalPrices,
        pricesAtOrBelow1: lowPrices,
        shareAtOrBelow1: `${((lowPrices / totalPrices) * 100).toFixed(2)}%`,
        // The question that decides safety: do any of the four markets we would
        // ever display carry an unpayable price?
        headlineMarketLows: headlineLows.slice(0, 20),
        headlineMarketLowCount: headlineLows.length,
        headlineMarketPriceRange: headlineSpread,
        lowPriceMarkets: [...lowByMarket.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 20)
          .map(([market, v]) => ({ market, count: v.count, samples: v.samples })),
        lowPriceBookmakers: [...lowByBookmaker.entries()].sort((a, b) => b[1] - a[1]),
      },
      null,
      2,
    ),
  );
}

main();
