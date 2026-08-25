/**
 * RESEARCH ONLY — do not build from this without reading the verdicts.
 *
 * Three candidate markets, two very different questions:
 *
 *   Handicap   needs a LINE. A handicap of -1.5 is meaningless unless a real
 *              bookmaker is quoting -1.5; inventing one would repeat exactly
 *              the fabricated-number mistake already corrected once (the
 *              Asian-line false positives that made 39 of 41 candidates look
 *              affordable on lines we never generate). So the only question
 *              that matters is whether /odds actually carries handicap markets
 *              we can read a line off. This probes the RAW response, because
 *              trimOdds keeps only the four headline markets and the cache
 *              therefore cannot answer it.
 *
 *   HT/FT      needs half-time AND full-time scores.
 *   Draw No Bet needs full-time only.
 *              Both compose from data the settlement lookup already fetches —
 *              the same basis Win Either Half was approved on — so the question
 *              is coverage, sampled per tier the same way.
 *
 * Costs real api-football calls. Run: npx tsx scripts/research-new-market-support.ts [fixturesPerTier]
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

  // ---------------------------------------------------------------- handicap
  console.log("=== HANDICAP: what /odds actually carries ===\n");

  // Probe fixtures we already know are priced, so a miss means "no handicap
  // market" rather than "no odds at all" — the confound that made the first
  // odds-coverage pass unreadable until lead time was separated out.
  const priced = await prisma.fixtureOddsCache.findMany({
    where: { fetchedAt: { not: null }, fixtureApiId: { not: null } },
    select: { fixtureApiId: true, matchKey: true },
    take: 40,
  });
  console.log(`known-priced fixtures available to probe: ${priced.length}`);

  const marketNames = new Map<string, number>();
  const handicapSamples: Array<{ fixture: number; market: string; values: string[]; books: number }> = [];
  let probed = 0;
  let empty = 0;

  for (const p of priced.slice(0, Math.max(6, perTier * 2))) {
    const res = await getOdds(p.fixtureApiId!);
    probed++;
    // /odds returns an ARRAY (one entry per fixture/bookmaker page); the
    // bookmakers live on its first element.
    const books = (Array.isArray(res) ? res[0]?.bookmakers : undefined) ?? [];
    if (books.length === 0) {
      empty++;
      continue;
    }
    for (const b of books) {
      for (const bet of b.bets ?? []) {
        marketNames.set(bet.name, (marketNames.get(bet.name) ?? 0) + 1);
      }
    }
    // Every market whose name suggests a handicap, with the actual lines quoted.
    const hcBooks = new Map<string, { values: Set<string>; books: number }>();
    for (const b of books) {
      for (const bet of b.bets ?? []) {
        if (!/handicap/i.test(bet.name)) continue;
        const e = hcBooks.get(bet.name) ?? { values: new Set<string>(), books: 0 };
        for (const v of bet.values ?? []) e.values.add(v.value);
        e.books++;
        hcBooks.set(bet.name, e);
      }
    }
    for (const [name, e] of hcBooks) {
      handicapSamples.push({ fixture: p.fixtureApiId!, market: name, values: [...e.values].slice(0, 10), books: e.books });
    }
  }

  console.log(`probed ${probed} fixtures, ${empty} returned no bookmakers\n`);
  console.log("every market name seen, by how many bookmaker-entries quote it:");
  for (const [name, count] of [...marketNames].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(count).padStart(4)}  ${name}`);
  }

  console.log("\nhandicap markets found:");
  if (handicapSamples.length === 0) {
    console.log("  NONE — no market matching /handicap/i in any probed fixture");
  } else {
    const byName = new Map<string, { fixtures: Set<number>; values: Set<string>; books: number }>();
    for (const h of handicapSamples) {
      const e = byName.get(h.market) ?? { fixtures: new Set<number>(), values: new Set<string>(), books: 0 };
      e.fixtures.add(h.fixture);
      for (const v of h.values) e.values.add(v);
      e.books += h.books;
      byName.set(h.market, e);
    }
    for (const [name, e] of byName) {
      console.log(`  ${name}`);
      console.log(`     fixtures: ${e.fixtures.size}/${probed}   bookmaker-entries: ${e.books}`);
      console.log(`     lines seen: ${[...e.values].slice(0, 12).join(" | ")}`);
    }
  }

  // ------------------------------------------------- HT/FT and Draw No Bet
  console.log("\n\n=== HT/FT and DRAW NO BET: score coverage by tier ===\n");
  console.log("HT/FT needs score.halftime AND score.fulltime; Draw No Bet needs fulltime only.\n");

  const byTier = new Map<Tier, typeof LEAGUE_CATALOGUE>();
  for (const l of LEAGUE_CATALOGUE) {
    const tier = (l.kind === "cup" ? "cup" : (l.tier as Tier)) as Tier;
    if (!byTier.has(tier)) byTier.set(tier, [] as any);
    (byTier.get(tier) as any).push(l);
  }

  const totals = { checked: 0, ft: 0, ht: 0, both: 0, htftUsable: 0, dnbUsable: 0 };

  for (const [tier, leagues] of byTier) {
    let checked = 0, ft = 0, ht = 0, both = 0;
    const sampled: string[] = [];

    for (const league of leagues.slice(0, perTier)) {
      const season = await resolveSeason(league.id, new Date());
      // Finished fixtures only: an unplayed match has no scores to check, and
      // counting it as a miss would understate coverage exactly the way the
      // first odds pass did.
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fixtures = await getFixturesByLeague(league.id, season, from, to);
      const finished = (fixtures ?? []).filter((f: any) => ["FT", "AET", "PEN"].includes(f.fixture?.status?.short));
      for (const f of finished.slice(0, 6)) {
        checked++;
        const s = f.score ?? {};
        const hasFt = Number.isFinite(s.fulltime?.home) && Number.isFinite(s.fulltime?.away);
        const hasHt = Number.isFinite(s.halftime?.home) && Number.isFinite(s.halftime?.away);
        if (hasFt) ft++;
        if (hasHt) ht++;
        if (hasFt && hasHt) both++;
        if (sampled.length < 3 && hasFt && hasHt) {
          sampled.push(`${f.teams?.home?.name} ${s.halftime!.home}-${s.halftime!.away} HT, ${s.fulltime!.home}-${s.fulltime!.away} FT ${f.teams?.away?.name}`);
        }
      }
    }

    totals.checked += checked;
    totals.ft += ft;
    totals.ht += ht;
    totals.both += both;

    const pct = (n: number) => (checked ? `${((n / checked) * 100).toFixed(0)}%` : "-");
    console.log(`${tier.padEnd(7)} sampled ${String(checked).padStart(3)} finished fixtures — fulltime ${pct(ft)}, halftime ${pct(ht)}, both ${pct(both)}`);
    for (const s of sampled) console.log(`          ${s}`);
  }

  totals.htftUsable = totals.both;
  totals.dnbUsable = totals.ft;
  const p = (n: number) => (totals.checked ? `${((n / totals.checked) * 100).toFixed(1)}%` : "-");
  console.log(`\nOVERALL  ${totals.checked} finished fixtures`);
  console.log(`  Draw No Bet settleable (fulltime present):        ${totals.dnbUsable}  ${p(totals.dnbUsable)}`);
  console.log(`  HT/FT settleable (halftime AND fulltime present): ${totals.htftUsable}  ${p(totals.htftUsable)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
