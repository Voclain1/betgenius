/**
 * Research probe, second pass: per-fixture bookmaker depth for the candidate
 * senior women's competitions, against two men's baselines.
 *
 * The league-level /odds feed only returns fixtures inside the provider's
 * pricing lead time, so the first pass (research-womens-coverage.ts) could not
 * tell "unpriced" from "not priced YET". This asks /odds?fixture= for each
 * upcoming fixture in the next 10 days, and for fixtures finished in the last
 * 7 days (the provider keeps pre-match odds for about a week), and reports
 * depth by days-to-kickoff.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/research-womens-odds-depth.ts
 */
export {};

import { MIN_BOOKMAKERS } from "../src/lib/odds";

const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY is not configured");
let lastAt = 0;
let calls = 0;
async function call<T>(path: string, params: Record<string, string | number>): Promise<{ response: T }> {
  const wait = Math.max(0, lastAt + 250 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  calls++;
  const url = new URL(`https://${host}${path}`);
  for (const [n, v] of Object.entries(params)) url.searchParams.set(n, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key! } });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json() as Promise<{ response: T }>;
}

type Fixture = { fixture: { id: number; date: string; status: { short: string } }; teams: { home: { name: string }; away: { name: string } } };
type Odds = { bookmakers: Array<{ bets: Array<{ id: number }> }> };

const LEAGUES: Array<[number, string]> = [
  [39, "BASELINE men: Premier League"],
  [88, "BASELINE men: Eredivisie"],
  [525, "UEFA Champions League Women"],
  [44, "FA WSL"],
  [142, "Liga F (Primera División Femenina)"],
  [82, "Frauen Bundesliga"],
  [64, "Première Ligue (Feminine Division 1)"],
  [139, "Serie A Women"],
  [254, "NWSL"],
  [549, "Damallsvenskan"],
  [725, "Toppserien"],
  [91, "Eredivisie Women"],
  [146, "Super League Women (Belgium)"],
  [484, "Frauenliga (Austria)"],
  [74, "Brasileiro Women"],
  [1191, "UEFA Europa Cup Women"],
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : 0);
const PER_SIDE = 6;

(async () => {
  const now = new Date();
  for (const [id, label] of LEAGUES) {
    const seasons = await call<Array<{ seasons: Array<{ year: number; current: boolean }> }>>("/leagues", { id });
    const season = seasons.response[0]?.seasons.find((s) => s.current)?.year;
    if (!season) { console.log(`${id} ${label}: no current season`); continue; }
    const ahead = (await call<Fixture[]>("/fixtures", { league: id, season, from: iso(now), to: iso(new Date(now.getTime() + 10 * 86_400_000)) })).response
      .filter((f) => f.fixture.status.short === "NS").slice(0, PER_SIDE);
    const behind = (await call<Fixture[]>("/fixtures", { league: id, season, from: iso(new Date(now.getTime() - 7 * 86_400_000)), to: iso(new Date(now.getTime() - 86_400_000)) })).response
      .filter((f) => ["FT", "AET", "PEN"].includes(f.fixture.status.short)).slice(-PER_SIDE);

    const measure = async (fs: Fixture[]) => {
      const out: Array<{ days: number; books: number; x12: boolean; goals: boolean; btts: boolean }> = [];
      for (const f of fs) {
        const o = (await call<Odds[]>("/odds", { fixture: f.fixture.id })).response[0];
        const books = o?.bookmakers ?? [];
        const has = (bet: number) => books.filter((b) => b.bets.some((x) => x.id === bet)).length >= MIN_BOOKMAKERS;
        out.push({ days: Math.round((new Date(f.fixture.date).getTime() - now.getTime()) / 86_400_000), books: books.length, x12: has(1), goals: has(5), btts: has(8) });
      }
      return out;
    };
    const up = await measure(ahead);
    const past = await measure(behind);
    const fmt = (xs: typeof up) =>
      xs.length
        ? `n=${xs.length} priced=${xs.filter((x) => x.books > 0).length} books(min/med/max)=${Math.min(...xs.map((x) => x.books))}/${median(xs.map((x) => x.books))}/${Math.max(...xs.map((x) => x.books))} >=${MIN_BOOKMAKERS}bk=${xs.filter((x) => x.books >= MIN_BOOKMAKERS).length} 1X2@${MIN_BOOKMAKERS}=${xs.filter((x) => x.x12).length} OU@${MIN_BOOKMAKERS}=${xs.filter((x) => x.goals).length} BTTS@${MIN_BOOKMAKERS}=${xs.filter((x) => x.btts).length} [days:books ${xs.map((x) => `${x.days}:${x.books}`).join(" ")}]`
        : "n=0";
    console.log(`${String(id).padStart(4)} ${label} (season ${season})\n       upcoming ${fmt(up)}\n       last 7d  ${fmt(past)}`);
  }
  console.log(`\n${calls} provider calls`);
})();
