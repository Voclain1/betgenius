/**
 * Verifies the Market-Confirmed gate against REAL cached bookmaker odds.
 *
 * The de-vig is the part that must be right. A bookmaker's prices sum to more
 * than 100% — that excess is margin, not belief — so 1/price OVERSTATES every
 * outcome. If the normalisation were wrong, picks would clear a 75% bar the
 * market actually prices well below, which is the exact failure this pipeline
 * exists to prevent. So: real fixtures, real prices, and an assertion that
 * every normalised market sums to 1.
 *
 * Read-only. Run: npx tsx scripts/check-market-confirmed.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const mc = await import("../src/lib/marketConfirmed");
  const { impliedProbability } = await import("../src/lib/odds");
  const { matchKey } = await import("../src/lib/slug");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const cached = await prisma.fixtureOddsCache.findMany({
    where: { fetchedAt: { not: null } },
    select: { matchKey: true, oddsJson: true, fetchedAt: true },
  });
  console.log(`cached priced fixtures: ${cached.length}\n`);

  let mwChecked = 0;
  let ouChecked = 0;
  let bttsChecked = 0;
  let dcChecked = 0;
  const overrounds: number[] = [];
  const devigDeltas: number[] = [];

  for (const c of cached) {
    const odds = c.oddsJson as any;
    if (!odds?.markets) continue;

    const mw = odds.markets.find((m: any) => m.market === "Match Winner");
    if (mw) {
      const legs = ["Home", "Draw", "Away"].map((v) => mw.selections.find((s: any) => s.value === v));
      if (legs.every(Boolean)) {
        // Raw reciprocals: the book's overround, which must exceed 1.
        overrounds.push(legs.reduce((sum: number, s: any) => sum + 1 / s.median, 0));
        const devigged = ["Home", "Draw", "Away"].map(
          (v) => mc.devigProbability(odds, "Match Winner", v)?.probability ?? NaN,
        );
        if (devigged.every((p) => Number.isFinite(p))) {
          mwChecked++;
          const total = devigged.reduce((a, b) => a + b, 0);
          if (Math.abs(total - 100) > 0.01) {
            failures++;
            console.log(`  FAIL  Match Winner sums to ${total.toFixed(3)}% on ${c.matchKey}`);
          }
          const rawFav = Math.max(...legs.map((s: any) => impliedProbability(s.median)));
          devigDeltas.push(rawFav - Math.max(...devigged));
        }
      }
    }

    const y = mc.devigProbability(odds, "Both Teams Score", "Yes")?.probability;
    const n = mc.devigProbability(odds, "Both Teams Score", "No")?.probability;
    if (y != null && n != null) {
      bttsChecked++;
      if (Math.abs(y + n - 100) > 0.01) {
        failures++;
        console.log(`  FAIL  BTTS sums to ${(y + n).toFixed(3)}%`);
      }
    }

    const o = mc.devigProbability(odds, "Goals Over/Under", "Over 2.5")?.probability;
    const u = mc.devigProbability(odds, "Goals Over/Under", "Under 2.5")?.probability;
    if (o != null && u != null) {
      ouChecked++;
      if (Math.abs(o + u - 100) > 0.01) {
        failures++;
        console.log(`  FAIL  Over/Under 2.5 sums to ${(o + u).toFixed(3)}%`);
      }
    }

    const dcAll = ["Home/Draw", "Away/Draw", "Home/Away"].map(
      (v) => mc.devigProbability(odds, "Double Chance", v)?.probability,
    );
    for (const p of dcAll) {
      if (p == null) continue;
      dcChecked++;
      if (p < 0 || p > 100) {
        failures++;
        console.log(`  FAIL  Double Chance out of range: ${p}`);
      }
    }
    // Each outcome appears in exactly two of the three pairings, so the three
    // Double Chance probabilities must sum to 200%.
    if (dcAll.every((p) => p != null)) {
      const total = (dcAll as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 200) > 0.02) {
        failures++;
        console.log(`  FAIL  Double Chance triple sums to ${total.toFixed(2)}%, expected 200%`);
      }
    }
  }

  console.log("de-vig correctness on real prices:");
  check("Match Winner normalises to 100%", mwChecked > 0, `${mwChecked} fixtures`);
  check("Both Teams Score normalises to 100%", bttsChecked > 0, `${bttsChecked} fixtures`);
  check("Over/Under normalises to 100% on the same line", ouChecked > 0, `${ouChecked} fixtures`);
  check("Double Chance derived, bounded, and sums to 200%", dcChecked > 0, `${dcChecked} selections`);

  if (overrounds.length) {
    const s = [...overrounds].sort((a, b) => a - b);
    console.log(
      `\n  real bookmaker overround: min ${(s[0] * 100).toFixed(1)}%  median ${(s[Math.floor(s.length / 2)] * 100).toFixed(1)}%  max ${(s[s.length - 1] * 100).toFixed(1)}%  (n=${s.length})`,
    );
    check("every book's raw prices exceed 100%, so the vig is real", s[0] > 1.0, `min ${(s[0] * 100).toFixed(1)}%`);
  }
  if (devigDeltas.length) {
    const s = [...devigDeltas].sort((a, b) => a - b);
    console.log(
      `  de-vig lowers the favourite by: min ${s[0].toFixed(1)}pp  median ${s[Math.floor(s.length / 2)].toFixed(1)}pp  max ${s[s.length - 1].toFixed(1)}pp`,
    );
    check("de-vig always LOWERS the raw implied probability", s[0] >= -0.001, `min delta ${s[0].toFixed(3)}pp`);
  }

  console.log("\ngate against real predictions:");
  const preds = await prisma.prediction.findMany({
    where: { homeTeamApiId: { not: null }, awayTeamApiId: { not: null }, kickoff: { not: null } },
    select: {
      id: true, marketType: true, selection: true, confidence: true, market: true, pick: true,
      homeTeam: true, awayTeam: true, homeTeamApiId: true, awayTeamApiId: true, kickoff: true,
    },
  });
  const byKey = new Map(cached.map((c) => [c.matchKey, c]));

  const reasons = new Map<string, number>();
  let confirmed = 0;
  const passes: string[] = [];
  for (const p of preds) {
    const k = matchKey(p);
    const entry = k ? byKey.get(k) : null;
    const v = mc.evaluateMarketConfirmed({
      marketType: p.marketType,
      selection: p.selection as any,
      confidence: p.confidence,
      odds: (entry?.oddsJson as any) ?? null,
      fetchedAt: entry?.fetchedAt ?? null,
      // Judged at the quote's own fetch time, so historical rows are tested on
      // the gate's real rules rather than on the world having moved on since.
      now: entry?.fetchedAt ? new Date(entry.fetchedAt) : new Date(),
    });
    if (v.confirmed) {
      confirmed++;
      passes.push(
        `${p.homeTeam} v ${p.awayTeam}: ${p.pick} — model ${v.modelProbability}% vs market ${v.marketProbability?.toFixed(1)}% (gap ${v.gapPP?.toFixed(1)}pp, ${v.bookmakers} books)`,
      );
    } else {
      reasons.set(v.reason ?? "?", (reasons.get(v.reason ?? "?") ?? 0) + 1);
    }
  }
  console.log(`  evaluated ${preds.length}, confirmed ${confirmed} (${((confirmed / preds.length) * 100).toFixed(1)}%)`);
  for (const [r, c] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`     ${String(c).padStart(4)}  ${r}`);
  for (const p of passes.slice(0, 10)) console.log(`     PASS ${p}`);

  check("the gate rejects the overwhelming majority", confirmed < preds.length * 0.2, `${confirmed}/${preds.length}`);
  check(
    "excluded market types never confirm, even at 99% model confidence",
    !preds.some(
      (p) =>
        ["CORRECT_SCORE", "WIN_EITHER_HALF", "SAME_GAME_DOUBLE", "OTHER"].includes(p.marketType) &&
        mc.evaluateMarketConfirmed({
          marketType: p.marketType,
          selection: p.selection as any,
          confidence: 99,
          odds: null,
          fetchedAt: new Date(),
        }).confirmed,
    ),
  );

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
