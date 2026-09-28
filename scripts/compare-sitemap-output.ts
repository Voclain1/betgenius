/**
 * Old-vs-new sitemap comparison against a REAL Postgres.
 *
 * scripts/check-sitemap-scoping.tsx proves parity over an in-memory Prisma
 * stand-in. This runs the same comparison — master's implementation, frozen in
 * scripts/lib/legacySitemapEntries.ts, against the per-type builders — through
 * the real Prisma engine and real Postgres, so GROUP BY, NULL ordering, JSON
 * and date semantics are the database's own rather than a model of them.
 *
 * FAILS CLOSED. The target must be:
 *   - given explicitly as SITEMAP_COMPARE_DATABASE_URL (never DATABASE_URL);
 *   - on a loopback host (127.0.0.1 / localhost / ::1) — a database this
 *     machine is running for the purpose, which cannot be Production;
 *   - different from every normal database identity in the environment and
 *     .env / .env.local (the same identities scripts/lib/dbSafety.ts guards).
 * The comparison itself runs on a read-only session. --seed-synthetic, which
 * writes, additionally refuses unless the target has no predictions at all.
 *
 * Run (against a disposable local Postgres with the schema pushed):
 *   SITEMAP_COMPARE_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/db \
 *     npx tsx scripts/compare-sitemap-output.ts --seed-synthetic
 */
import { defaultEnvFiles, normalDatabaseIdentities, readOnlyUrl } from "./lib/dbSafety";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(2);
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

const target = process.env.SITEMAP_COMPARE_DATABASE_URL;
if (!target) refuse("SITEMAP_COMPARE_DATABASE_URL is not set");
const targetHost = hostOf(target);
if (!targetHost) refuse("SITEMAP_COMPARE_DATABASE_URL does not parse");
if (!LOOPBACK.has(targetHost)) refuse(`target host ${targetHost} is not loopback — only a local, purpose-run database is accepted`);
const identities = normalDatabaseIdentities({ ...process.env, SITEMAP_COMPARE_DATABASE_URL: undefined }, defaultEnvFiles());
const clash = identities.find((id) => id.host === targetHost);
if (clash) refuse(`target host matches the normal database named by ${clash.source}`);

const seed = process.argv.includes("--seed-synthetic");

async function seedSynthetic(url: string) {
  const { PrismaClient, Prisma } = await import("@prisma/client");
  const writer = new PrismaClient({ datasources: { db: { url } } });
  try {
    const existing = await writer.prediction.count();
    if (existing > 0) refuse(`--seed-synthetic needs an empty database; this one has ${existing} predictions`);

    const { createSitemapFixtures } = await import("./lib/sitemapFixtures");
    const fx = createSitemapFixtures(Date.now());
    const grid = fx.evidenceGrid();
    const corpus = fx.generalCorpus(13, 30);
    const data = {
      prediction: [...grid.prediction, ...corpus.prediction],
      teamEnrichmentCache: [...grid.teamEnrichmentCache, ...corpus.teamEnrichmentCache],
      leagueEnrichmentCache: [...grid.leagueEnrichmentCache, ...corpus.leagueEnrichmentCache],
      h2HCache: [...grid.h2HCache, ...corpus.h2HCache],
    };

    const author = await writer.user.create({ data: { email: "sitemap-compare@localhost.invalid" } });
    const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as any));
    const batches = <T,>(items: T[], size = 1000) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

    for (const batch of batches(data.prediction)) {
      await writer.prediction.createMany({
        data: batch.map(({ categories: _categories, ...row }) => ({
          ...row,
          authorId: author.id,
          selection: json(row.selection),
          analysisJson: json(row.analysisJson),
        })),
      });
    }
    const links = data.prediction.flatMap((p) => (p.categories as { category: string }[]).map((c) => ({ predictionId: p.id, category: c.category })));
    for (const batch of batches(links)) await writer.predictionCategoryLink.createMany({ data: batch });
    for (const batch of batches(data.teamEnrichmentCache)) {
      await writer.teamEnrichmentCache.createMany({
        data: batch.map((t) => ({ ...t, statsJson: json(t.statsJson), lastFixtures: json(t.lastFixtures), teamDigestJson: json(t.teamDigestJson), squadJson: json(t.squadJson), coachJson: json(t.coachJson) })),
      });
    }
    for (const batch of batches(data.leagueEnrichmentCache)) {
      await writer.leagueEnrichmentCache.createMany({
        data: batch.map((l) => ({ ...l, standingsJson: json(l.standingsJson), upcomingJson: json(l.upcomingJson), topScorersJson: json(l.topScorersJson), topAssistsJson: json(l.topAssistsJson), topCardsJson: json(l.topCardsJson) })),
      });
    }
    for (const batch of batches(data.h2HCache)) {
      await writer.h2HCache.createMany({ data: batch.map((h) => ({ ...h, meetingsJson: json(h.meetingsJson) })) });
    }
    console.log(`seeded ${data.prediction.length} predictions, ${links.length} category links, ${data.teamEnrichmentCache.length} team / ${data.leagueEnrichmentCache.length} league / ${data.h2HCache.length} h2h cache rows`);
  } finally {
    await writer.$disconnect();
  }
}

async function main() {
  if (seed) await seedSynthetic(target!);

  // Everything below reads through the app's own client on a read-only session.
  process.env.DATABASE_URL = readOnlyUrl(target!);
  process.env.DATABASE_URL_UNPOOLED = readOnlyUrl(target!);
  const react = require("react");
  react.cache = (fn: unknown) => fn;

  const { SITEMAP_BUILDERS } = await import("../src/lib/sitemapEntries");
  const { legacyGetSitemapEntries } = await import("./lib/legacySitemapEntries");
  const { SITEMAP_TYPES, sitemapType } = await import("../src/lib/sitemapXml");
  const { prisma } = await import("../src/lib/prisma");

  const lastmod = (value: unknown) => (value == null ? "" : value instanceof Date ? value.toISOString() : String(value));
  const describe = (e: { url: string; lastModified?: unknown; changeFrequency?: string; priority?: number }) =>
    `${e.url} | ${lastmod(e.lastModified)} | ${e.changeFrequency ?? ""} | ${e.priority ?? ""}`;

  const started = Date.now();
  const legacy = await legacyGetSitemapEntries();
  const legacyMs = Date.now() - started;

  let differences = 0;
  for (const type of SITEMAP_TYPES) {
    const t0 = Date.now();
    const fresh = await SITEMAP_BUILDERS[type]();
    const ms = Date.now() - t0;
    const expected = new Set(legacy.filter((e) => sitemapType(e.url) === type).map(describe));
    const actual = new Set(fresh.map(describe));
    const missing = [...expected].filter((x) => !actual.has(x));
    const extra = [...actual].filter((x) => !expected.has(x));
    differences += missing.length + extra.length;
    console.log(`${type.padEnd(10)} master ${String(expected.size).padStart(5)}  new ${String(actual.size).padStart(5)}  missing ${missing.length}  extra ${extra.length}  (${ms} ms)`);
    for (const line of [...missing.map((m) => `  - ${m}`), ...extra.map((x) => `  + ${x}`)].slice(0, 10)) console.log(line);
  }
  console.log(`\nmaster built all seven in ${legacyMs} ms (every child request paid this).`);
  console.log(differences === 0 ? "ZERO differences in URL / lastmod / changefreq / priority." : `${differences} differences.`);
  await prisma.$disconnect();
  if (differences) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
