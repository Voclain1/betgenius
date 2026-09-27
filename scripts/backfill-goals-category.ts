/**
 * Bring existing rows' GOALS tag into line with their market.
 *
 * From this change on, GOALS is derived inside setPredictionCategories on every
 * category write (src/lib/goalsCategory.ts). Rows written before it existed
 * carry no GOALS tag at all, so the Goals feed, its track-record card and its
 * sitemap entry would stay empty for every fixture generated before deploy.
 *
 * Deliberately narrow. Writes ONLY PredictionCategoryLink rows with category
 * GOALS: adds the link where the market qualifies and it is missing, removes it
 * where the market does not qualify and it is present. The primary `category`
 * column, outcome, status, settlement, selection and every other tag are never
 * touched — GOALS is appended, never primary, so no row changes the feed it was
 * published under. Idempotent: a second run finds nothing to do.
 *
 * Same rule as live writes, via withGoalsCategory, so a row cannot be tagged
 * here that setPredictionCategories would untag on its next save. Same-game-
 * double source legs are excluded by that rule.
 *
 * Dry run by default, on a read-only Postgres session — the dry run cannot
 * write even by accident. Writing requires --apply.
 *
 * Run: npx tsx --env-file=.env scripts/backfill-goals-category.ts [--apply]
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

import { GOALS, withGoalsCategory } from "../src/lib/goalsCategory";

export type GoalsBackfillRow = {
  id: string;
  status: string;
  marketType: string;
  selection: unknown;
  categories: { category: string }[];
};

/** Which rows need GOALS added, and which need it removed. Pure, so the check suite can pin it. */
export function planGoalsBackfill(rows: readonly GoalsBackfillRow[]): { add: GoalsBackfillRow[]; remove: GoalsBackfillRow[] } {
  const add: GoalsBackfillRow[] = [];
  const remove: GoalsBackfillRow[] = [];
  for (const row of rows) {
    const held = row.categories.map((c) => c.category);
    const has = held.includes(GOALS);
    const should = withGoalsCategory(held, row).includes(GOALS);
    if (should && !has) add.push(row);
    else if (!should && has) remove.push(row);
  }
  return { add, remove };
}

const tally = (rows: readonly GoalsBackfillRow[]) =>
  rows.reduce<Record<string, number>>((acc, r) => {
    const line = (r.selection as { line?: number } | null)?.line;
    const key = `${r.status} ${r.marketType}${line != null ? ` ${line}` : ""}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

async function main() {
  const apply = process.argv.includes("--apply");
  const { PrismaClient } = await import("@prisma/client");
  const { readOnlyUrl } = await import("./lib/dbSafety");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ datasources: { db: { url: apply ? url : readOnlyUrl(url) } } });

  try {
    // Every candidate for either direction: rows that could qualify, and rows
    // that hold the tag. Nothing else can change.
    const rows = (await prisma.prediction.findMany({
      where: { OR: [{ marketType: "OVER_UNDER" }, { categories: { some: { category: GOALS } } }] },
      select: { id: true, status: true, marketType: true, selection: true, categories: { select: { category: true } } },
    })) as GoalsBackfillRow[];

    const { add, remove } = planGoalsBackfill(rows);
    console.log(`scanned ${rows.length} rows (OVER_UNDER or already tagged ${GOALS})`);
    console.log(`would add ${GOALS}: ${add.length}`, tally(add));
    console.log(`would remove ${GOALS}: ${remove.length}`, tally(remove));

    if (apply && (add.length || remove.length)) {
      await prisma.$transaction([
        ...(add.length
          ? [prisma.predictionCategoryLink.createMany({ data: add.map((r) => ({ predictionId: r.id, category: GOALS })), skipDuplicates: true })]
          : []),
        ...(remove.length
          ? [prisma.predictionCategoryLink.deleteMany({ where: { predictionId: { in: remove.map((r) => r.id) }, category: GOALS } })]
          : []),
      ]);
    }
    console.log(`\n${apply ? "APPLIED" : "DRY RUN (read-only session) — re-run with --apply to write"}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so the check suite can import planGoalsBackfill without opening a connection.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
