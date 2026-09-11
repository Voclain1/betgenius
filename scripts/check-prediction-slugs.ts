/**
 * Fails when a Prediction's stored slug keys disagree with what src/lib/slug.ts
 * derives from that same row.
 *
 * The four public scope pages now resolve their slug with a WHERE on these
 * columns. That makes a stale key indistinguishable from a missing page: the
 * query matches nothing and the route 404s, silently, for a prediction that is
 * published and perfectly valid. Typecheck cannot see it and no page test would
 * either, because the data is what is wrong, not the code — the same class of
 * failure scripts/check-schema-sync.ts exists for.
 *
 * PUBLISHED rows are the failure condition; drafts only warn, since nothing
 * routes to them and generation may not have filled their teams in yet.
 *
 * Run: npx tsx scripts/check-prediction-slugs.ts
 */
import { prisma } from "../src/lib/prisma";
import { derivePredictionSlugs } from "../src/lib/slug";

async function main() {
  const rows = await prisma.prediction.findMany({
    select: {
      id: true, status: true,
      leagueName: true, leagueApiId: true, homeTeam: true, awayTeam: true, kickoff: true,
      leagueSlugKey: true, homeSlugKey: true, awaySlugKey: true, matchSlugKey: true, h2hSlugKey: true,
    },
  });

  const drifted: { id: string; status: string; field: string; stored: string | null; derived: string | null }[] = [];
  for (const row of rows) {
    const next = derivePredictionSlugs(row);
    for (const field of Object.keys(next) as (keyof typeof next)[]) {
      const stored = (row[field] ?? null) as string | null;
      if (stored !== next[field]) drifted.push({ id: row.id, status: row.status, field, stored, derived: next[field] });
    }
  }

  const published = drifted.filter((d) => d.status === "PUBLISHED");
  const drafts = drifted.filter((d) => d.status !== "PUBLISHED");

  console.log(`Checked ${rows.length} prediction rows.`);
  if (drafts.length > 0) console.log(`WARN: ${drafts.length} stale key(s) on non-published rows (not routable, not fatal).`);

  if (published.length === 0) {
    console.log("PASS: every published row's slug keys match src/lib/slug.ts.");
    return;
  }

  console.error(`\nFAIL: ${published.length} stale slug key(s) on PUBLISHED rows.`);
  console.error("Each one is a scope page that will 404 for a published prediction.\n");
  for (const d of published.slice(0, 20)) {
    console.error(`  ${d.id} ${d.field}: stored=${JSON.stringify(d.stored)} derived=${JSON.stringify(d.derived)}`);
  }
  if (published.length > 20) console.error(`  ... and ${published.length - 20} more`);
  console.error("\nRepair: npx tsx scripts/backfill-prediction-slugs.ts --apply");
  process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
