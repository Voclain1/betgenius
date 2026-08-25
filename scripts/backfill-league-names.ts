/**
 * Repairs predictions whose leagueName is a placeholder rather than a real
 * competition.
 *
 * These rows predate normalizeLeagueName. Generation now REFUSES to persist a
 * placeholder (src/lib/ai/generate.ts throws), so this is a one-off repair of
 * what already landed, not an ongoing corrective.
 *
 * The repair is mechanical, not a lookup: every affected row carries a
 * leagueApiId, so the real name comes straight from LEAGUE_CATALOGUE. Nothing
 * is guessed — a row whose id is not in the catalogue is reported and left
 * alone rather than filled with something plausible, which is the failure mode
 * that made placeholders preferable to a wrong-but-believable name in the
 * first place.
 *
 * Dry by default. Pass --apply to write.
 *
 * Run: npx tsx scripts/backfill-league-names.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { normalizeLeagueName, LEAGUE_CATALOGUE } = await import("../src/lib/leagues");

  const apply = process.argv.includes("--apply");
  // Widened to number keys: LEAGUE_CATALOGUE's ids are a literal union, which
  // would otherwise reject a lookup by a plain number read from the database.
  const catalogue = new Map<number, string>(LEAGUE_CATALOGUE.map((l) => [l.id as number, l.name]));

  const rows = await prisma.prediction.findMany({
    select: { id: true, leagueApiId: true, leagueName: true, status: true, homeTeam: true, awayTeam: true },
  });

  const broken = rows.filter((r) => !normalizeLeagueName(r.leagueName));
  console.log(`${rows.length} predictions, ${broken.length} with an unusable leagueName\n`);

  const fixable: Array<{ id: string; from: string | null; to: string; label: string }> = [];
  const unfixable: typeof broken = [];

  for (const r of broken) {
    const real = r.leagueApiId != null ? catalogue.get(r.leagueApiId) : undefined;
    if (real) {
      fixable.push({ id: r.id, from: r.leagueName, to: real, label: `${r.homeTeam} v ${r.awayTeam} [${r.status}]` });
    } else {
      unfixable.push(r);
    }
  }

  for (const f of fixable) {
    console.log(`  ${f.label}`);
    console.log(`     "${f.from}"  ->  "${f.to}"`);
  }
  for (const u of unfixable) {
    console.log(`  SKIP  ${u.homeTeam} v ${u.awayTeam} — leagueApiId ${u.leagueApiId ?? "null"} is not in the catalogue`);
  }

  console.log(`\nfixable: ${fixable.length}   unfixable: ${unfixable.length}`);

  if (!apply) {
    console.log("\nDRY RUN — pass --apply to write.");
  } else if (fixable.length) {
    // Grouped by target name so one statement covers each competition, and so
    // a partial failure cannot leave half a competition renamed.
    const byName = new Map<string, string[]>();
    for (const f of fixable) {
      if (!byName.has(f.to)) byName.set(f.to, []);
      byName.get(f.to)!.push(f.id);
    }
    await prisma.$transaction(
      [...byName].map(([name, ids]) =>
        prisma.prediction.updateMany({ where: { id: { in: ids } }, data: { leagueName: name } }),
      ),
    );
    console.log(`\napplied to ${fixable.length} row(s).`);

    const after = await prisma.prediction.findMany({ select: { leagueName: true } });
    const stillBroken = after.filter((r) => !normalizeLeagueName(r.leagueName)).length;
    console.log(`re-checked: ${stillBroken} row(s) still unusable (expected ${unfixable.length})`);
    if (stillBroken !== unfixable.length) process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
