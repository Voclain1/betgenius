/**
 * End-to-end verification for European Handicap generation.
 *
 * Deliberately does NOT persist. Generation is exercised through
 * generatePredictionForFixture (the model call) rather than
 * generateAndPersistPrediction, so a verification run cannot leave test
 * predictions in the production feed. The persistence-side behaviour it skips
 * — forcing the sourced line, deriving the pick, resolving the outcome — is
 * deterministic and checked directly at the bottom instead.
 *
 * Run: npx tsx scripts/verify-european-handicap.ts [perTier] [generatePerTier]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

type Tier = "top" | "mid" | "minor" | "world";

async function main() {
  const { getFixturesByLeague, resolveSeason } = await import("../src/lib/football/api-football");
  const { LEAGUE_CATALOGUE } = await import("../src/lib/leagues");
  const { MIN_BOOKMAKERS } = await import("../src/lib/odds");
  const { sourceHandicapLine, isHandicapEligibleLeague, evaluateHandicapEdge } = await import("../src/lib/handicapLine");
  const { buildGenerationDigest } = await import("../src/lib/ai/generationContext");
  const { generatePredictionForFixture } = await import("../src/lib/ai/analysis");
  const { isValidSelection, deriveMarketAndPick, resolveMarket } = await import("../src/lib/markets");
  const { prisma } = await import("../src/lib/prisma");

  const perTier = Number(process.argv[2] ?? 8);
  const genPerTier = Number(process.argv[3] ?? 1);

  const byTier = new Map<Tier, any[]>();
  for (const l of LEAGUE_CATALOGUE as readonly any[]) {
    const t = l.tier as Tier;
    if (!["top", "mid", "minor", "world"].includes(t)) continue;
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(l);
  }

  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 96 * 3600 * 1000).toISOString().slice(0, 10);

  console.log("=".repeat(72));
  console.log("PART 1 — TIER GATE (no network: pure league-id check)");
  console.log("=".repeat(72));
  for (const t of ["top", "mid", "minor", "world"] as Tier[]) {
    const ids = (byTier.get(t) ?? []).map((l) => l.id);
    const eligible = ids.filter((id) => isHandicapEligibleLeague(id)).length;
    console.log(`  ${t.padEnd(6)} ${String(eligible).padStart(2)}/${String(ids.length).padStart(2)} leagues eligible  ${t === "world" ? "<= must be 0/N" : ""}`);
  }
  console.log(`  null league id eligible? ${isHandicapEligibleLeague(null)}  (must be false)`);
  console.log(`  unknown league id eligible? ${isHandicapEligibleLeague(999999)}  (must be false)`);

  console.log("\n" + "=".repeat(72));
  console.log(`PART 2 — LIVE LINE SOURCING (MIN_BOOKMAKERS=${MIN_BOOKMAKERS}, all three selections must clear it)`);
  console.log("=".repeat(72));

  const passing: { tier: Tier; fixture: any; league: any; line: any }[] = [];
  const tierStats: Record<string, { probed: number; pass: number; unpriced: number; thin: number }> = {};

  for (const tier of ["top", "mid", "minor", "world"] as Tier[]) {
    tierStats[tier] = { probed: 0, pass: 0, unpriced: 0, thin: 0 };
    const fixtures: any[] = [];
    for (const l of byTier.get(tier) ?? []) {
      if (fixtures.length >= perTier) break;
      const season = await resolveSeason(l.id, now);
      const rows = await getFixturesByLeague(l.id, season, from, to);
      for (const f of rows ?? []) if (f.fixture?.status?.short === "NS") fixtures.push({ f, league: l });
    }
    console.log(`\n${tier.toUpperCase()}`);
    for (const { f, league } of fixtures.slice(0, perTier)) {
      const gated = isHandicapEligibleLeague(league.id);
      if (!gated) {
        console.log(`  SKIP (tier gate)  ${f.teams.home.name} vs ${f.teams.away.name} [${league.name}]`);
        continue;
      }
      tierStats[tier].probed++;
      const res = await sourceHandicapLine(f.fixture.id);
      if (res.ok) {
        tierStats[tier].pass++;
        const l = res.line;
        const q = l.quotes.map((x) => `${x.value} ${x.median}(${x.bookmakers}b)`).join("  ");
        console.log(`  PASS  ${(f.teams.home.name + " vs " + f.teams.away.name).slice(0, 40).padEnd(42)} line=${l.line > 0 ? "+" : ""}${l.line} depth=${l.depth}/${l.bookmakerCount}books`);
        console.log(`        ${q}`);
        passing.push({ tier, fixture: f, league, line: l });
      } else {
        if (res.reason.includes("no bookmakers")) tierStats[tier].unpriced++;
        else tierStats[tier].thin++;
        console.log(`  NONE  ${(f.teams.home.name + " vs " + f.teams.away.name).slice(0, 40).padEnd(42)} ${res.reason}`);
      }
    }
  }

  console.log("\n---- candidacy pass rate by tier (eligible fixtures only) ----");
  for (const [t, s] of Object.entries(tierStats)) {
    const rate = s.probed ? `${s.pass}/${s.probed} (${((100 * s.pass) / s.probed).toFixed(0)}%)` : "0 probed (gate excluded all)";
    console.log(`  ${t.padEnd(6)} ${rate.padEnd(20)} unpriced=${s.unpriced} thin=${s.thin}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("PART 3 — REAL GENERATION ON A SOURCED LINE (model call, not persisted)");
  console.log("=".repeat(72));

  const wanted: Tier[] = ["top", "mid", "minor"];
  let attempts = 0;
  let honoured = 0;
  let gatePass = 0;
  let gateReject = 0;
  const sides: Record<string, number> = {};
  const sidesKept: Record<string, number> = {};
  for (const tier of wanted) {
    const picks = passing.filter((p) => p.tier === tier).slice(0, genPerTier);
    for (const p of picks) {
      attempts++;
      const home = p.fixture.teams.home.name;
      const away = p.fixture.teams.away.name;
      console.log(`\n[${tier}] ${home} vs ${away}  — sourced line ${p.line.line > 0 ? "+" : ""}${p.line.line} (depth ${p.line.depth})`);
      try {
        const { digest } = await buildGenerationDigest({
          home,
          away,
          league: p.league.name,
          kickoff: p.fixture.fixture.date,
          homeApiId: p.fixture.teams.home.id,
          awayApiId: p.fixture.teams.away.id,
          leagueApiId: p.league.id,
          round: p.fixture.league?.round ?? null,
        });
        const { output } = await generatePredictionForFixture({
          digest,
          tiers: ["FEATURED"],
          handicapLine: { line: p.line.line, quotes: p.line.quotes },
        });
        for (const pred of output.predictions) {
          const forced = pred.selection && typeof pred.selection === "object"
            ? { ...(pred.selection as any), line: p.line.line }
            : pred.selection;
          const valid = isValidSelection(pred.marketType, forced);
          const { market, pick } = deriveMarketAndPick(pred.marketType, forced as any, home, away, { market: "Other", pick: "" });
          const okMarket = pred.marketType === "EUROPEAN_HANDICAP";
          const modelLine = (pred.selection as any)?.line;
          const lineHonoured = modelLine === p.line.line;
          if (okMarket && valid) honoured++;
          const confidence = Math.min(90, Math.max(0, Math.round(pred.confidence)));
          const edge = evaluateHandicapEdge(p.line, (forced as any)?.value ?? "", confidence);
          sides[(forced as any)?.value ?? "?"] = (sides[(forced as any)?.value ?? "?"] ?? 0) + 1;
          if (edge.passes) { gatePass++; sidesKept[(forced as any)?.value ?? "?"] = (sidesKept[(forced as any)?.value ?? "?"] ?? 0) + 1; }
          else gateReject++;
          console.log(`   marketType=${pred.marketType} ${okMarket ? "OK" : "<= WRONG MARKET"}`);
          console.log(`   model line=${modelLine} vs sourced=${p.line.line} ${lineHonoured ? "(honoured)" : "(OVERRIDDEN server-side)"}`);
          console.log(`   selection=${JSON.stringify(forced)} valid=${valid}`);
          console.log(`   -> ${market}: "${pick}" @ ${confidence}%`);
          console.log(`   VALUE GATE: ${edge.passes ? "PASS" : "REJECT"} — best ${edge.price}, implied ${edge.impliedProbability}%, edge ${edge.edgePP}pp`);
          if (!edge.passes) console.log(`               ${edge.reason}`);
          console.log(`   ${edge.passes ? "PERSISTED" : "NOT A CANDIDATE — no pick for this fixture"}`);
        }
      } catch (err: any) {
        console.log(`   GENERATION FAILED: ${err?.message ?? err}`);
      }
    }
  }
  console.log(`\ngeneration attempts: ${attempts}`);
  console.log(`  produced a valid EUROPEAN_HANDICAP pick : ${honoured}`);
  console.log(`  cleared the value gate (would persist)  : ${gatePass}`);
  console.log(`  rejected by the value gate (no pick)    : ${gateReject}`);
  console.log(`  sides the model chose     : ${JSON.stringify(sides)}`);
  console.log(`  sides surviving the gate  : ${JSON.stringify(sidesKept)}`);

  console.log("\n" + "=".repeat(72));
  console.log("PART 4 — SETTLEMENT (deterministic; three-way, no VOID)");
  console.log("=".repeat(72));
  const cases: [number, string, number, number, string][] = [
    // line, selection, homeScore, awayScore, expected
    [-1, "HOME", 3, 1, "WON"],   // 3-1, home -1 => 2-1 home wins
    [-1, "DRAW", 2, 1, "WON"],   // 2-1, home -1 => 1-1 draw
    [-1, "HOME", 2, 1, "LOST"],  // same game, backing home loses
    [-1, "AWAY", 1, 1, "WON"],   // 1-1, home -1 => 0-1 away
    [1, "HOME", 0, 1, "LOST"],   // 0-1, home +1 => 1-1 draw, home loses
    [1, "DRAW", 0, 1, "WON"],
    [2, "HOME", 0, 1, "WON"],    // 0-1, home +2 => 2-1
    [-2, "AWAY", 1, 0, "WON"],   // 1-0, home -2 => -1-0 away
  ];
  let sFail = 0;
  for (const [line, value, hs, as, expected] of cases) {
    const got = resolveMarket("EUROPEAN_HANDICAP" as any, { value, line } as any, hs, as);
    const ok = got === expected;
    if (!ok) sFail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${hs}-${as} line ${line > 0 ? "+" : ""}${line} backing ${value.padEnd(4)} => ${got} (expected ${expected})`);
  }
  const voidCase = resolveMarket("EUROPEAN_HANDICAP" as any, { value: "HOME", line: -1 } as any, 2, 1);
  console.log(`  ${voidCase !== "VOID" ? "PASS" : "FAIL"}  adjusted tie never returns VOID (got ${voidCase})`);
  if (voidCase === "VOID") sFail++;

  console.log("\n  rejected selections (must all be false):");
  for (const bad of [{ value: "HOME", line: 0 }, { value: "HOME", line: -0.5 }, { value: "HOME", line: -0.25 }, { value: "MAYBE", line: -1 }, { value: "HOME" }]) {
    const v = isValidSelection("EUROPEAN_HANDICAP" as any, bad);
    console.log(`    ${v ? "FAIL" : "PASS"}  ${JSON.stringify(bad)} -> valid=${v}`);
    if (v) sFail++;
  }
  console.log(`\nsettlement failures: ${sFail}`);
  await prisma.$disconnect();
}

main();
