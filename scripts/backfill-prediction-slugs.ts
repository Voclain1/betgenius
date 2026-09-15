/**
 * Populates Prediction's denormalised slug keys for rows written before the
 * columns existed, and repairs any row the client extension could not reach.
 *
 * The extension in src/lib/prisma.ts covers create/update/upsert. It cannot
 * cover updateMany(), which reports a count and not the rows it touched — so a
 * bulk write to leagueName/homeTeam/awayTeam/kickoff (scripts/backfill-league-
 * names.ts does exactly that) leaves the keys stale. This is the repair, and
 * scripts/check-prediction-slugs.ts is the alarm.
 *
 * Idempotent: it writes only rows whose stored keys differ from the derived
 * ones, so a clean run touches nothing and a partial run can simply be re-run.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-prediction-slugs.ts [--apply]
 * Without --apply it reports what it would change and writes nothing.
 */
import { prisma } from "../src/lib/prisma";
import { derivePredictionSlugs } from "../src/lib/slug";

const APPLY = process.argv.includes("--apply");

// One UPDATE ... FROM (VALUES ...) per chunk rather than one statement per row.
// The first run of this backfill issued 2,322 sequential updates and Neon's
// pooler closed the connection partway through (P1017), leaving the table
// half-written. A dozen statements do the same work without holding a session
// open across thousands of round-trips.
const CHUNK = 200;

async function main() {
  const rows = await prisma.prediction.findMany({
    select: {
      id: true, status: true,
      leagueName: true, leagueApiId: true, homeTeam: true, awayTeam: true, kickoff: true,
      leagueSlugKey: true, homeSlugKey: true, awaySlugKey: true, matchSlugKey: true, h2hSlugKey: true,
    },
  });

  const stale = rows.filter((row) => {
    const next = derivePredictionSlugs(row);
    return (Object.keys(next) as (keyof typeof next)[]).some((k) => (row[k] ?? null) !== next[k]);
  });

  console.log(`${rows.length} prediction rows, ${stale.length} with stale slug keys.`);
  if (stale.length === 0) return;

  for (const row of stale.slice(0, 5)) {
    const next = derivePredictionSlugs(row);
    console.log(`  ${row.id} [${row.status}] -> league=${next.leagueSlugKey} home=${next.homeSlugKey} match=${next.matchSlugKey}`);
  }
  if (stale.length > 5) console.log(`  ... and ${stale.length - 5} more`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (let i = 0; i < stale.length; i += CHUNK) {
    const chunk = stale.slice(i, i + CHUNK);
    const params: (string | null)[] = [];
    const tuples = chunk.map((row, n) => {
      const next = derivePredictionSlugs(row);
      params.push(row.id, next.leagueSlugKey, next.homeSlugKey, next.awaySlugKey, next.matchSlugKey, next.h2hSlugKey);
      const b = n * 6;
      return `($${b + 1}::text, $${b + 2}::text, $${b + 3}::text, $${b + 4}::text, $${b + 5}::text, $${b + 6}::text)`;
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "Prediction" AS p
          SET "leagueSlugKey" = v.league,
              "homeSlugKey"   = v.home,
              "awaySlugKey"   = v.away,
              "matchSlugKey"  = v.match,
              "h2hSlugKey"    = v.h2h
         FROM (VALUES ${tuples.join(", ")}) AS v(id, league, home, away, match, h2h)
        WHERE p.id = v.id`,
      ...params,
    );
    written += chunk.length;
    console.log(`  ${written}/${stale.length}`);
  }
  console.log(`\nWrote ${written} rows.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
