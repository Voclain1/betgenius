import { GENERATION_TIER_ORDER, LEAGUE_CATALOGUE, generationTierOf, type GenerationTier } from "@/lib/leagues";
import { matchKey } from "@/lib/slug";

/**
 * Per-competition coverage funnel, computed from rows the pipeline already
 * writes (ledger, predictions, odds cache). Pure: the caller does the bounded
 * reads. Shared by scripts/measure-league-coverage.ts and /admin/paid-ops so
 * both count a fixture the same way.
 *
 *   discovered  a ledger row exists (discovery queued it)
 *   succeeded / failed / abandoned / pending   its ledger state
 *   priced      the odds cache holds a pre-kickoff quote with >= minBookmakers
 *   predicted   a prediction row exists for the fixture (any status)
 *   published   ... and it is PUBLISHED
 *   vip/premium ... and it carries that category
 */
export const WELSH_NAME = /\b(wales|welsh|cymru)\b/i;

export type FunnelLedgerRow = { matchKey: string; leagueApiId: number | null; leagueName: string | null; kickoff: Date; status: string; attempts: number };
export type FunnelPredictionRow = {
  leagueApiId: number | null; leagueName: string | null; kickoff: Date | null; status: string;
  homeTeamApiId: number | null; awayTeamApiId: number | null; categories: string[];
};
export type FunnelOddsRow = { matchKey: string; bookmakerCount: number | null; fetchedAt: Date | null };

export type FunnelLeague = {
  leagueApiId: number | null; name: string | null; tier: GenerationTier | null;
  discovered: number; succeeded: number; failed: number; abandoned: number; pending: number;
  priced: number; predicted: number; published: number; vip: number; premium: number;
};
export type TierKey = GenerationTier | "UNCATALOGUED";
export type CoverageFunnel = {
  leagues: FunnelLeague[];
  byTier: Partial<Record<TierKey, { leagues: number; discovered: number; succeeded: number; published: number; vip: number; premium: number }>>;
  starvedByTier: Partial<Record<TierKey, number>>;
  starvedTop: Array<{ leagueApiId: number | null; name: string | null; count: number }>;
};

const catalogueName = new Map<number, string>(LEAGUE_CATALOGUE.map((l) => [l.id, `${l.name} (${l.country})`]));

export function auditCoverageFunnel(input: {
  ledger: FunnelLedgerRow[];
  predictions: FunnelPredictionRow[];
  odds: FunnelOddsRow[];
  now: Date;
  minBookmakers: number;
}): CoverageFunnel {
  const oddsBy = new Map(input.odds.map((o) => [o.matchKey, o]));
  const byLeague = new Map<string, FunnelLeague>();
  const get = (id: number | null, name: string | null): FunnelLeague => {
    const k = String(id ?? `name:${name ?? "?"}`);
    let row = byLeague.get(k);
    if (!row) {
      row = {
        leagueApiId: id, name: (id != null ? catalogueName.get(id) : null) ?? name, tier: generationTierOf(id),
        discovered: 0, succeeded: 0, failed: 0, abandoned: 0, pending: 0, priced: 0, predicted: 0, published: 0, vip: 0, premium: 0,
      };
      byLeague.set(k, row);
    }
    return row;
  };

  const starved = new Map<string, { leagueApiId: number | null; name: string | null; count: number; tier: TierKey }>();
  for (const l of input.ledger) {
    const row = get(l.leagueApiId, l.leagueName);
    row.discovered++;
    if (l.status === "SUCCEEDED") row.succeeded++;
    else if (l.status === "FAILED") row.failed++;
    else if (l.status === "ABANDONED") row.abandoned++;
    else row.pending++;
    const q = oddsBy.get(l.matchKey);
    if (q?.fetchedAt && q.fetchedAt < l.kickoff && (q.bookmakerCount ?? 0) >= input.minBookmakers) row.priced++;
    if (l.status === "PENDING" && l.attempts === 0 && l.kickoff <= input.now) {
      const k = String(l.leagueApiId);
      const s = starved.get(k) ?? { leagueApiId: l.leagueApiId, name: row.name, count: 0, tier: row.tier ?? "UNCATALOGUED" };
      s.count++;
      starved.set(k, s);
    }
  }
  // One fixture counts once per league even when it carries several markets.
  const predictedKeys = new Set<string>();
  const publishedKeys = new Set<string>();
  let unkeyed = 0;
  for (const p of input.predictions) {
    if (p.status === "ARCHIVED") continue;
    const key = matchKey({ homeTeamApiId: p.homeTeamApiId, awayTeamApiId: p.awayTeamApiId, kickoff: p.kickoff }) ?? `unkeyed:${unkeyed++}`;
    const row = get(p.leagueApiId, p.leagueName);
    const fixtureKey = `${row.leagueApiId}:${key}`;
    if (!predictedKeys.has(fixtureKey)) { predictedKeys.add(fixtureKey); row.predicted++; }
    if (p.status !== "PUBLISHED") continue;
    if (!publishedKeys.has(fixtureKey)) { publishedKeys.add(fixtureKey); row.published++; }
    if (p.categories.includes("VIP")) row.vip++;
    if (p.categories.includes("PREMIUM")) row.premium++;
  }

  const tierRank = (t: GenerationTier | null) => (t ? GENERATION_TIER_ORDER.indexOf(t) : GENERATION_TIER_ORDER.length);
  const leagues = [...byLeague.values()].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.discovered - a.discovered || (a.name ?? "").localeCompare(b.name ?? ""));
  const byTier: CoverageFunnel["byTier"] = {};
  for (const l of leagues) {
    const t: TierKey = l.tier ?? "UNCATALOGUED";
    const s = (byTier[t] ??= { leagues: 0, discovered: 0, succeeded: 0, published: 0, vip: 0, premium: 0 });
    s.leagues++; s.discovered += l.discovered; s.succeeded += l.succeeded; s.published += l.published; s.vip += l.vip; s.premium += l.premium;
  }
  const starvedByTier: CoverageFunnel["starvedByTier"] = {};
  for (const s of starved.values()) starvedByTier[s.tier] = (starvedByTier[s.tier] ?? 0) + s.count;
  const starvedTop = [...starved.values()].sort((a, b) => b.count - a.count).slice(0, 15).map(({ leagueApiId, name, count }) => ({ leagueApiId, name, count }));
  return { leagues, byTier, starvedByTier, starvedTop };
}
