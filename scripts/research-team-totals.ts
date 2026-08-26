/**
 * RESEARCH ONLY — Team Total Goals (per-team over/under).
 *
 * Two questions, same method as Win Either Half and Draw No Bet:
 *
 *   1. Does it settle from data already fetched, without inventing anything?
 *      A team total needs ONE side's goal count, which is literally
 *      regulationHomeScore or regulationAwayScore. That is strictly less than
 *      OVER_UNDER needs — no sum — so the settlement risk is lower than an
 *      existing market's, not merely comparable.
 *
 *   2. Does a real bookmaker market back the LINE? This is the question that
 *      sank Asian Handicap: a line nobody quotes is a line we invented. The
 *      raw /odds probe is what answers it, since trimOdds keeps only the four
 *      headline markets.
 *
 * Also samples the real distribution of per-team goals, because that is what
 * says which lines are worth offering at all — a line the data almost never
 * crosses is a market in name only.
 *
 * Costs real api-football calls. Run: npx tsx scripts/research-team-totals.ts [perTier]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

type Tier = "top" | "mid" | "minor" | "world" | "cup";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getOdds, getFixturesByLeague, resolveSeason } = await import("../src/lib/football/api-football");
  const { LEAGUE_CATALOGUE } = await import("../src/lib/leagues");

  const perTier = Number(process.argv[2] ?? 3);

  // ------------------------------------------------------- bookmaker backing
  console.log("=== TEAM TOTALS: does a real market quote the line? ===\n");

  const priced = await prisma.fixtureOddsCache.findMany({
    where: { fetchedAt: { not: null }, fixtureApiId: { not: null } },
    select: { fixtureApiId: true },
    take: 8,
  });

  // Names api-football uses for full-match team totals. Half-specific variants
  // are excluded deliberately: they would need a half-time score, which is a
  // different settlement basis and a separate decision.
  const WANTED = /^(Total - (Home|Away)|(Home|Away) Team Total Goals)$/i;
  const HALF = /half/i;

  const byMarket = new Map<string, { fixtures: Set<number>; lines: Map<string, number>; books: number }>();
  let probed = 0;

  for (const p of priced) {
    const res = await getOdds(p.fixtureApiId!);
    probed++;
    const books = (Array.isArray(res) ? res[0]?.bookmakers : undefined) ?? [];
    for (const b of books) {
      for (const bet of b.bets ?? []) {
        if (!WANTED.test(bet.name) || HALF.test(bet.name)) continue;
        const e = byMarket.get(bet.name) ?? { fixtures: new Set<number>(), lines: new Map<string, number>(), books: 0 };
        e.fixtures.add(p.fixtureApiId!);
        e.books++;
        for (const v of bet.values ?? []) e.lines.set(v.value, (e.lines.get(v.value) ?? 0) + 1);
        byMarket.set(bet.name, e);
      }
    }
  }

  console.log(`probed ${probed} known-priced fixtures\n`);
  if (byMarket.size === 0) {
    console.log("  NONE — no full-match team-total market found");
  }
  for (const [name, e] of byMarket) {
    console.log(`  ${name}`);
    console.log(`     fixtures: ${e.fixtures.size}/${probed}   bookmaker-entries: ${e.books}`);
    const lines = [...e.lines].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`     lines quoted: ${lines.map(([l, c]) => `${l}(${c})`).join(" ")}`);
    // Whole-number lines push when the total lands exactly on them. Half-lines
    // cannot, which is why every OVER_UNDER we generate uses 2.5.
    const whole = [...e.lines.keys()].filter((l) => /(^|\s)(Over|Under)\s+\d+(\.0)?$/i.test(l));
    console.log(`     whole-number (pushable) lines seen: ${whole.length ? whole.join(" | ") : "none"}`);
  }

  // -------------------------------------------------- settlement + coverage
  console.log("\n\n=== COVERAGE AND REAL DISTRIBUTION BY TIER ===\n");
  console.log("A team total settles from ONE side's goals — already present whenever a full-time score is.\n");

  const byTier = new Map<Tier, typeof LEAGUE_CATALOGUE>();
  for (const l of LEAGUE_CATALOGUE) {
    const tier = (l.kind === "cup" ? "cup" : (l.tier as Tier)) as Tier;
    if (!byTier.has(tier)) byTier.set(tier, [] as any);
    (byTier.get(tier) as any).push(l);
  }

  const allTeamGoals: number[] = [];
  let checked = 0;
  let withScore = 0;

  for (const [tier, leagues] of byTier) {
    let tChecked = 0;
    let tWith = 0;
    const goals: number[] = [];

    for (const league of leagues.slice(0, perTier)) {
      const season = await resolveSeason(league.id, new Date());
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fixtures = await getFixturesByLeague(league.id, season, from, to);
      const finished = (fixtures ?? []).filter((f: any) => ["FT", "AET", "PEN"].includes(f.fixture?.status?.short));
      for (const f of finished.slice(0, 6)) {
        tChecked++;
        const s = f.score?.fulltime;
        if (Number.isFinite(s?.home) && Number.isFinite(s?.away)) {
          tWith++;
          goals.push(s!.home as number, s!.away as number);
        }
      }
    }

    checked += tChecked;
    withScore += tWith;
    allTeamGoals.push(...goals);
    const pct = tChecked ? `${((tWith / tChecked) * 100).toFixed(0)}%` : "-";
    console.log(`${tier.padEnd(7)} ${String(tChecked).padStart(3)} finished fixtures — per-team goals available ${pct}`);
  }

  console.log(`\nOVERALL  ${withScore}/${checked} fixtures usable (${((withScore / Math.max(1, checked)) * 100).toFixed(1)}%)`);

  // Which lines the data actually discriminates on.
  console.log(`\nreal per-team goal distribution (${allTeamGoals.length} team-innings):`);
  const dist = new Map<number, number>();
  for (const g of allTeamGoals) dist.set(g, (dist.get(g) ?? 0) + 1);
  for (const [g, c] of [...dist].sort((a, b) => a[0] - b[0])) {
    console.log(`   ${g} goal(s): ${String(c).padStart(4)}  ${"#".repeat(Math.round((c / allTeamGoals.length) * 60))}`);
  }
  console.log("\nshare of team-innings clearing each candidate line:");
  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    const over = allTeamGoals.filter((g) => g > line).length;
    const share = (over / allTeamGoals.length) * 100;
    // A line is only useful if it splits the outcomes; near 0% or 100% means
    // the pick is decided before the match starts.
    const useful = share >= 15 && share <= 85 ? "usable" : "one-sided";
    console.log(`   Over ${line}: ${share.toFixed(1)}%   Under ${line}: ${(100 - share).toFixed(1)}%   -> ${useful}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
