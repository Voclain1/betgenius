/**
 * RESEARCH ONLY — is the AWAY lean football, or prompt bias?
 *
 * Six of six early samples chose AWAY on a home -1 line. That is either a real
 * property of the market (on a -1 line the away side covers more often than the
 * raw 1X2 suggests) or the prompt nudging the model. The difference matters:
 * one ships, the other is fixed first.
 *
 * The test is NOT "did it pick AWAY" — that proves nothing on its own. It is
 * "did it pick AWAY on fixtures where the independent evidence points the other
 * way". Two anchors are used, neither of them the model's own reasoning:
 *
 *   MARKET   the shortest of the three quoted prices on the sourced line. The
 *            book's own view, which already encodes form, position and h2h.
 *   TABLE    league position and last-5 form out of the digest, which come from
 *            api-football rather than from any pricing.
 *
 * A pick is flagged CONTRARIAN when the model takes AWAY while both anchors
 * favour HOME. That is the signature of bias; taking AWAY when the anchors also
 * favour AWAY is just agreement, and taking a genuinely contrarian position on
 * ONE anchor is what a value selection is supposed to look like.
 *
 * Costs real api-football and model calls.
 * Run: npx tsx scripts/probe-handicap-side-bias.ts [targetGenerations]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

type Tier = "top" | "mid" | "minor";

function formPoints(form: string | null | undefined): number | null {
  if (!form) return null;
  const chars = String(form).toUpperCase().replace(/[^WDL]/g, "").split("");
  if (!chars.length) return null;
  return chars.reduce((n, c) => n + (c === "W" ? 3 : c === "D" ? 1 : 0), 0);
}

async function main() {
  const { getFixturesByLeague, resolveSeason } = await import("../src/lib/football/api-football");
  const { LEAGUE_CATALOGUE } = await import("../src/lib/leagues");
  const { sourceHandicapLine, isHandicapEligibleLeague, evaluateHandicapEdge } = await import("../src/lib/handicapLine");
  const { buildGenerationDigest } = await import("../src/lib/ai/generationContext");
  const { generatePredictionForFixture } = await import("../src/lib/ai/analysis");
  const { prisma } = await import("../src/lib/prisma");

  const TARGET = Number(process.argv[2] ?? 20);

  const byTier = new Map<Tier, any[]>();
  for (const l of LEAGUE_CATALOGUE as readonly any[]) {
    const t = l.tier as Tier;
    if (!["top", "mid", "minor"].includes(t)) continue;
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(l);
  }

  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 120 * 3600 * 1000).toISOString().slice(0, 10);

  // Collect eligible fixtures, round-robin across tiers so one big league does
  // not dominate the sample.
  const pool: { tier: Tier; f: any; league: any }[] = [];
  for (const tier of ["top", "mid", "minor"] as Tier[]) {
    for (const l of byTier.get(tier) ?? []) {
      if (!isHandicapEligibleLeague(l.id)) continue;
      const season = await resolveSeason(l.id, now);
      const rows = await getFixturesByLeague(l.id, season, from, to);
      for (const f of rows ?? []) if (f.fixture?.status?.short === "NS") pool.push({ tier, f, league: l });
      if (pool.filter((p) => p.tier === tier).length >= 20) break;
    }
  }
  console.log(`eligible upcoming fixtures collected: ${pool.length}`);

  // Source lines, and deliberately keep a MIX of line signs. A sample that is
  // all -1 would only ever ask the model one question.
  const sourced: { tier: Tier; f: any; league: any; line: any }[] = [];
  for (const p of pool) {
    if (sourced.length >= TARGET * 2) break;
    const res = await sourceHandicapLine(p.f.fixture.id);
    if (res.ok) sourced.push({ ...p, line: res.line });
  }
  const neg = sourced.filter((s) => s.line.line < 0);
  const pos = sourced.filter((s) => s.line.line > 0);
  console.log(`lines sourced: ${sourced.length}  (home-handicapped ${neg.length}, away-handicapped ${pos.length})`);

  // Interleave so both line signs are represented in whatever we get through.
  const ordered: typeof sourced = [];
  for (let i = 0; i < Math.max(neg.length, pos.length); i++) {
    if (pos[i]) ordered.push(pos[i]);
    if (neg[i]) ordered.push(neg[i]);
  }
  const sample = ordered.slice(0, TARGET);
  console.log(`generating for ${sample.length} fixtures\n`);

  const rows: any[] = [];
  for (const s of sample) {
    const home = s.f.teams.home.name;
    const away = s.f.teams.away.name;
    try {
      const { digest } = await buildGenerationDigest({
        home,
        away,
        league: s.league.name,
        kickoff: s.f.fixture.date,
        homeApiId: s.f.teams.home.id,
        awayApiId: s.f.teams.away.id,
        leagueApiId: s.league.id,
        round: s.f.league?.round ?? null,
      });
      const { output } = await generatePredictionForFixture({
        digest,
        tiers: ["FEATURED"],
        handicapLine: { line: s.line.line, quotes: s.line.quotes },
      });
      const pred = output.predictions[0];
      if (!pred) continue;
      const pick = (pred.selection as any)?.value ?? "?";
      const confidence = Math.min(90, Math.max(0, Math.round(pred.confidence)));
      const edge = evaluateHandicapEdge(s.line, pick, confidence);

      // MARKET anchor: shortest price on the line is the book's favourite.
      const marketFav = [...s.line.quotes].sort((a: any, b: any) => a.best - b.best)[0].value;

      // TABLE anchor: league position and last-5 form, straight from the digest.
      const d: any = digest;
      const hRank = d?.teams?.home?.rank ?? null;
      const aRank = d?.teams?.away?.rank ?? null;
      const hForm = formPoints(d?.teams?.home?.form);
      const aForm = formPoints(d?.teams?.away?.form);
      let tableFav: string | null = null;
      if (hRank != null && aRank != null && hRank !== aRank) tableFav = hRank < aRank ? "HOME" : "AWAY";
      else if (hForm != null && aForm != null && hForm !== aForm) tableFav = hForm > aForm ? "HOME" : "AWAY";

      rows.push({
        tier: s.tier, home, away, line: s.line.line, pick, confidence,
        edge: edge.edgePP, passes: edge.passes, price: edge.price,
        marketFav, tableFav, hRank, aRank, hForm, aForm,
        reasoning: String(pred.reasoning).slice(0, 130),
      });
      const flag = pick === "AWAY" && marketFav === "HOME" && tableFav === "HOME" ? "  <== CONTRARIAN (both anchors say HOME)" : "";
      console.log(`[${s.tier}] ${(home + " vs " + away).slice(0, 34).padEnd(36)} line ${s.line.line > 0 ? "+" : ""}${s.line.line}  pick=${pick.padEnd(4)} ${confidence}%  edge=${String(edge.edgePP).padStart(5)}pp ${edge.passes ? "KEEP" : "drop"}  market=${String(marketFav).padEnd(4)} table=${String(tableFav ?? "-").padEnd(4)} rank ${hRank ?? "-"}v${aRank ?? "-"} form ${hForm ?? "-"}v${aForm ?? "-"}${flag}`);
    } catch (err: any) {
      console.log(`[${s.tier}] ${home} vs ${away} — generation failed: ${err?.message ?? err}`);
    }
  }

  const count = (pred: (r: any) => boolean) => rows.filter(pred).length;
  console.log(`\n${"=".repeat(78)}\nSELECTION DISTRIBUTION (${rows.length} generations)\n${"=".repeat(78)}`);
  for (const v of ["HOME", "DRAW", "AWAY"]) {
    const n = count((r) => r.pick === v);
    console.log(`  ${v.padEnd(5)} ${String(n).padStart(3)}  (${rows.length ? ((100 * n) / rows.length).toFixed(0) : 0}%)`);
  }
  console.log("\nby line sign:");
  for (const [label, pred] of [["home-handicapped (line < 0)", (r: any) => r.line < 0], ["away-handicapped (line > 0)", (r: any) => r.line > 0]] as const) {
    const sub = rows.filter(pred);
    if (!sub.length) { console.log(`  ${label}: none in sample`); continue; }
    const parts = ["HOME", "DRAW", "AWAY"].map((v) => `${v} ${sub.filter((r) => r.pick === v).length}`).join("  ");
    console.log(`  ${label}: n=${sub.length}  ${parts}`);
  }
  console.log("\nagreement with the anchors:");
  console.log(`  pick == market favourite : ${count((r) => r.pick === r.marketFav)}/${rows.length}`);
  console.log(`  pick == table favourite  : ${count((r) => r.tableFav && r.pick === r.tableFav)}/${count((r) => r.tableFav)}`);

  const contrarian = rows.filter((r) => r.pick === "AWAY" && r.marketFav === "HOME" && r.tableFav === "HOME");
  console.log(`\nCONTRARIAN AWAY picks (both anchors favour HOME): ${contrarian.length}/${rows.length}`);
  for (const r of contrarian) {
    console.log(`  ${r.home} vs ${r.away} [${r.tier}] line ${r.line > 0 ? "+" : ""}${r.line}`);
    console.log(`     rank ${r.hRank} v ${r.aRank}, form ${r.hForm} v ${r.aForm}, market favours HOME, model took AWAY @ ${r.confidence}%`);
    console.log(`     "${r.reasoning}..."`);
  }
  const kept = rows.filter((r) => r.passes);
  console.log(`\nsurviving the value gate: ${kept.length}/${rows.length}`);
  if (kept.length) {
    const parts = ["HOME", "DRAW", "AWAY"].map((v) => `${v} ${kept.filter((r) => r.pick === v).length}`).join("  ");
    console.log(`  sides among survivors: ${parts}`);
  }
  await prisma.$disconnect();
}

main();
