/**
 * Child-sitemap isolation, sitemap parity and crawler-page query bounds —
 * verified at the QUERY level against an in-memory Prisma stand-in
 * (scripts/lib/fakePrisma.ts). No database, no network, nothing written.
 *
 * What this guards, and why each part exists:
 *
 *  1. ISOLATION. /sitemaps/<type>.xml used to build all seven sitemaps and keep
 *     one — static.xml scored every fixture's match evidence and read every h2h
 *     cache. That took the function to its 2 GB ceiling in production. Each
 *     builder is checked for the tables and columns it touches, and the route
 *     is checked (source and runtime) for never building everything.
 *
 *  2. PARITY. The per-type builders must list exactly the URLs, lastmods,
 *     changefreqs and priorities master listed, for the same database. The
 *     reference is master's code, frozen verbatim in
 *     scripts/lib/legacySitemapEntries.ts, run over the same data. Datasets
 *     cover every evidence threshold (exhaustive grid), row-ordering cases,
 *     null/malformed cache JSON, Lagos-midnight kickoffs, spelling variants,
 *     cups and the track-record gate on both sides.
 *
 *  3. SITEMAP == ROBOTS. Independently of master, every match/h2h slug the
 *     sitemap lists is checked against the page's OWN indexability decision
 *     (assessMatchEvidence / isSubstantiveH2H fed by the page getters), so a
 *     noindex URL cannot be listed and an indexable one cannot be dropped.
 *
 *  4. CACHE + ROUTE. Per-deployment, per-type cache keys; errors never cached;
 *     a good stored value survives a failed rebuild; 503 + Retry-After when a
 *     build fails with no good entry to serve (cold); the unknown-type XML 404,
 *     XML well-formedness and the sitemap index. The in-memory incremental
 *     cache below drives Next's no-request-store path. The App Router path
 *     Production takes (stale body served, refresh on waitUntil, failed
 *     refresh keeps and keeps serving the stale sitemap) was verified by
 *     reading the Next 14.2.15 source, not on a real Vercel deployment.
 *
 *  5. CRAWLER PAGES. The match footer and league page link lookups are bounded
 *     (no whole-corpus read), constant in query count (no N+1), and give the
 *     same answers the global indexes gave.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-sitemap-scoping.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";
import { createFakePrisma, type FakeCall } from "./lib/fakePrisma";

// React's cache() only exists in the react-server build. Outside Next it must
// be a pass-through: these checks swap the dataset between scenarios, and a
// memoising stand-in would hand one scenario's answers to the next.
const react = require("react");
react.cache = (fn: unknown) => fn;
// Next's server runtime installs this global before any request; its storage
// modules (used by unstable_cache) refuse to load without it.
(globalThis as any).AsyncLocalStorage ??= require("node:async_hooks").AsyncLocalStorage;
// The sitemap cache key carries a Vercel deployment discriminator. Pin it to
// the local fallback so key assertions do not depend on the runner's env.
delete process.env.VERCEL_DEPLOYMENT_ID;
delete process.env.VERCEL_GIT_COMMIT_SHA;

const repoRoot = join(__dirname, "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

const tables: Record<string, any[]> = { prediction: [], teamEnrichmentCache: [], leagueEnrichmentCache: [], h2HCache: [] };
const fake = createFakePrisma(tables, { seed: 20260928 });
(globalThis as any).prisma = fake.client;

// unstable_cache needs Next's incremental cache; outside a Next server it reads
// globalThis.__incrementalCache. This is a faithful-enough in-memory one.
const dataCache = new Map<string, any>();
let dataCacheStale = false;
(globalThis as any).__incrementalCache = {
  isOnDemandRevalidate: false,
  async fetchCacheKey(key: string) {
    return key;
  },
  async get(key: string) {
    const value = dataCache.get(key);
    return value ? { value, isStale: dataCacheStale } : null;
  },
  async set(key: string, data: any) {
    if (data) dataCache.set(key, data);
  },
};

let failures = 0;
let passes = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  if (ok) passes++;
  else failures++;
  if (!ok) console.log(`  FAIL  ${label}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 800)}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}`);

async function main() {
  const { SITEMAP_BUILDERS, getSitemapEntries } = await import("../src/lib/sitemapEntries");
  const { legacyGetSitemapEntries } = await import("./lib/legacySitemapEntries");
  const { SITEMAP_TYPES, sitemapType, urlsetXml, SITEMAP_RETRY_AFTER_SECONDS } = await import("../src/lib/sitemapXml");
  const { compactEntries, expandEntries, guardSize, sitemapCacheDeployment } = await import("../src/lib/sitemapCache");
  const { GET: childSitemap } = await import("../src/app/sitemaps/[type]/route");
  const { GET: sitemapIndex } = await import("../src/app/sitemap.xml/route");
  const scope = await import("../src/lib/predictionScope");
  const { derivePredictionSlugs, h2hPairKey, matchKey, matchSlug, teamSlug } = await import("../src/lib/slug");
  const { assessMatchEvidence } = await import("../src/lib/matchEvidence");
  const { isSubstantiveH2H } = await import("../src/lib/h2hEvidence");
  const { CUP_CONFIGS } = await import("../src/lib/cupConfig");
  const { absoluteUrl } = await import("../src/lib/seo");
  const { MatchPageFooterLinks } = await import("../src/components/MatchPageFooterLinks");

  type SitemapType = (typeof SITEMAP_TYPES)[number];

  // --- datasets (scripts/lib/sitemapFixtures.ts) ----------------------------
  const now = Date.now();
  const { createSitemapFixtures } = await import("./lib/sitemapFixtures");
  const { warmDigest, standingRow, teamCache, leagueCache, evidenceGrid, generalCorpus } = createSitemapFixtures(now);

  function load(data: { prediction: any[]; teamEnrichmentCache?: any[]; leagueEnrichmentCache?: any[]; h2HCache?: any[] }) {
    tables.prediction = data.prediction;
    tables.teamEnrichmentCache = data.teamEnrichmentCache ?? [];
    tables.leagueEnrichmentCache = data.leagueEnrichmentCache ?? [];
    tables.h2HCache = data.h2HCache ?? [];
    fake.reset();
    fake.clearFailures();
  }

  // --- comparison helpers --------------------------------------------------
  const lastmodOf = (e: MetadataRoute.Sitemap[number]) =>
    e.lastModified == null ? "" : e.lastModified instanceof Date ? e.lastModified.toISOString() : String(e.lastModified);
  const describe = (e: MetadataRoute.Sitemap[number]) => `${e.url} | ${lastmodOf(e)} | ${e.changeFrequency ?? ""} | ${e.priority ?? ""}`;
  const ORDERED_TYPES = new Set<SitemapType>(["static", "categories", "cups"]);

  async function compareWithLegacy(label: string) {
    fake.reset();
    const legacy = await legacyGetSitemapEntries();
    let allMatch = true;
    for (const type of SITEMAP_TYPES) {
      fake.reset();
      const fresh = await SITEMAP_BUILDERS[type]();
      const expected = legacy.filter((e) => sitemapType(e.url) === type).map(describe);
      const actual = fresh.map(describe);
      const same = ORDERED_TYPES.has(type)
        ? JSON.stringify(actual) === JSON.stringify(expected)
        : JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
      if (!same) {
        allMatch = false;
        const missing = expected.filter((x) => !actual.includes(x)).slice(0, 5);
        const extra = actual.filter((x) => !expected.includes(x)).slice(0, 5);
        check(`${label}: ${type} matches master exactly`, false, { expected: expected.length, actual: actual.length, missing, extra });
      } else {
        check(`${label}: ${type} matches master exactly`, true);
      }
      if (!ORDERED_TYPES.has(type)) {
        const urls = fresh.map((e) => e.url);
        check(`${label}: ${type} output is in stable URL order`, JSON.stringify(urls) === JSON.stringify([...urls].sort()));
      }
      check(`${label}: ${type} builder emits only ${type} URLs`, fresh.every((e) => sitemapType(e.url) === type), fresh.find((e) => sitemapType(e.url) !== type)?.url);
    }
    return { legacy, allMatch };
  }

  const HEAVY_TABLES = ["teamEnrichmentCache", "leagueEnrichmentCache", "h2HCache"];
  const HEAVY_COLUMNS = ["matchPreview", "analysisJson", "reasoning", "meetingsJson", "teamDigestJson", "standingsJson", "squadJson", "statsJson"];
  const selectsAny = (call: FakeCall, columns: string[]) => {
    const select = call.args?.select;
    if (!select) return call.method === "findMany" || call.method === "findUnique" || call.method === "findFirst"; // no select = whole row
    return columns.some((c) => select[c]);
  };

  /** A prediction read is bounded when its WHERE narrows by key/range/IN, not just status and not-null checks. */
  function isBoundedWhere(where: any): boolean {
    if (!where || typeof where !== "object") return false;
    for (const [key, value] of Object.entries(where)) {
      if (key === "AND" || key === "OR") {
        const parts = Array.isArray(value) ? value : [value];
        if (key === "OR" ? parts.length > 0 && parts.every(isBoundedWhere) : parts.some(isBoundedWhere)) return true;
        continue;
      }
      if (key === "status") continue;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        if ("in" in ops || "startsWith" in ops || "gte" in ops || "gt" in ops || "lt" in ops || "lte" in ops) return true;
        if ("equals" in ops && ops.equals !== null) return true;
      } else if (value !== null && value !== undefined) {
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  section("1. Child-sitemap isolation — each builder reads only its own inputs");
  load(generalCorpus(7, 40));
  const expectations: Record<SitemapType, { heavyTablesAllowed: string[]; heavyColumnsAllowed: string[]; predictionFindManyAllowed: boolean }> = {
    static: { heavyTablesAllowed: [], heavyColumnsAllowed: [], predictionFindManyAllowed: false },
    categories: { heavyTablesAllowed: [], heavyColumnsAllowed: [], predictionFindManyAllowed: true },
    leagues: { heavyTablesAllowed: [], heavyColumnsAllowed: [], predictionFindManyAllowed: false },
    cups: { heavyTablesAllowed: [], heavyColumnsAllowed: [], predictionFindManyAllowed: false },
    teams: { heavyTablesAllowed: [], heavyColumnsAllowed: [], predictionFindManyAllowed: false },
    matches: {
      heavyTablesAllowed: ["teamEnrichmentCache", "leagueEnrichmentCache", "h2HCache"],
      heavyColumnsAllowed: ["matchPreview", "analysisJson", "meetingsJson", "teamDigestJson", "standingsJson"],
      predictionFindManyAllowed: true,
    },
    h2h: { heavyTablesAllowed: ["h2HCache"], heavyColumnsAllowed: ["meetingsJson"], predictionFindManyAllowed: false },
  };
  for (const type of SITEMAP_TYPES) {
    fake.reset();
    await SITEMAP_BUILDERS[type]();
    const calls = [...fake.calls];
    const rule = expectations[type];
    const touchedHeavy = [...new Set(calls.filter((c) => HEAVY_TABLES.includes(c.model)).map((c) => c.model))];
    check(`${type}: touches no enrichment/h2h cache beyond ${rule.heavyTablesAllowed.join(", ") || "none"}`,
      touchedHeavy.every((t) => rule.heavyTablesAllowed.includes(t)), touchedHeavy);
    const heavyCols = HEAVY_COLUMNS.filter((c) => !rule.heavyColumnsAllowed.includes(c));
    const offending = calls.filter((c) => selectsAny(c, heavyCols) && !(c.method === "groupBy" || c.method === "aggregate"));
    check(`${type}: selects none of ${heavyCols.join("/")}`, offending.length === 0, offending.map((c) => `${c.model}.${c.method} ${JSON.stringify(c.args?.select)}`));
    const predictionFindMany = calls.filter((c) => c.model === "prediction" && c.method === "findMany");
    if (!rule.predictionFindManyAllowed) {
      check(`${type}: no per-row prediction read (aggregates/GROUP BY only)`, predictionFindMany.length === 0, predictionFindMany.map((c) => c.args?.where));
    }
    const unbounded = predictionFindMany.filter((c) => !isBoundedWhere(c.args?.where));
    check(`${type}: every prediction row read is bounded (key/IN/range WHERE)`, unbounded.length === 0, unbounded.map((c) => c.args?.where));
    if (type !== "matches") {
      check(`${type}: never selects the reasoning/preview/analysis columns`,
        !calls.some((c) => c.model === "prediction" && c.args?.select && (c.args.select.matchPreview || c.args.select.analysisJson || c.args.select.reasoning)));
    }
  }
  // Explicit named assertions (the incident's specific regressions).
  for (const type of ["static", "categories", "leagues", "cups", "teams"] as const) {
    fake.reset();
    await SITEMAP_BUILDERS[type]();
    check(`${type}: does not execute match evidence work (no team/league cache, no preview/analysis read)`,
      !fake.calls.some((c) => c.model === "teamEnrichmentCache" || c.model === "leagueEnrichmentCache" || (c.model === "prediction" && c.args?.select?.matchPreview)));
    check(`${type}: does not execute H2H evidence work (no h2h cache read, no pair grouping)`,
      !fake.calls.some((c) => c.model === "h2HCache" || (c.method === "groupBy" && JSON.stringify(c.args?.by) === JSON.stringify(["homeTeam", "awayTeam", "homeTeamApiId", "awayTeamApiId"]))));
  }
  fake.reset();
  await SITEMAP_BUILDERS.static();
  check("static: does not build the full track-record report (one settled GROUP BY, no 90-day row read)",
    fake.calls.filter((c) => c.model === "prediction").every((c) => c.method !== "findMany") &&
      fake.calls.filter((c) => c.method === "groupBy" && JSON.stringify(c.args?.by) === '["outcome"]').length === 1);

  // Route-level: the route must never build everything and filter.
  const routeSource = read("src/app/sitemaps/[type]/route.ts");
  check("route: never calls getSitemapEntries (build-everything-then-filter)", !routeSource.includes("getSitemapEntries"));
  check("route: never filters entries by sitemapType after building", !routeSource.includes("sitemapType(") && !/\.filter\(/.test(routeSource));
  check("route: serves via the per-type cached builder", routeSource.includes("getCachedSitemapEntries(type)"));
  const cacheSource = read("src/lib/sitemapCache.ts");
  check("cache: builds with SITEMAP_BUILDERS[type] only", cacheSource.includes("SITEMAP_BUILDERS[type]()") && !cacheSource.includes("getSitemapEntries"));
  check("builders: one per SITEMAP_TYPE, no extras",
    JSON.stringify(Object.keys(SITEMAP_BUILDERS).sort()) === JSON.stringify([...SITEMAP_TYPES].sort()));
  const entriesSource = read("src/lib/sitemapEntries.ts");
  const builderBodies = entriesSource
    .split(/\nasync function /)
    .slice(1)
    .map((chunk) => chunk.slice(chunk.indexOf("{"), chunk.indexOf("\n}\n")));
  check("builders: seven builder bodies found", builderBodies.length === 7, builderBodies.length);
  check("builders: no builder calls another type's builder or getSitemapEntries",
    builderBodies.every((body) => !/\b(staticEntries|categoryEntries|leagueEntries|cupEntries|teamEntries|matchEntries|h2hEntries|getSitemapEntries)\(\)/.test(body)));

  // Runtime through the real route: static.xml does no match/h2h work.
  dataCache.clear();
  fake.reset();
  const staticResponse = await childSitemap(new Request("https://example.test/sitemaps/static.xml"), { params: { type: "static.xml" } });
  check("route static.xml: 200", staticResponse.status === 200, staticResponse.status);
  check("route static.xml: no match/h2h/enrichment work executed",
    !fake.calls.some((c) => HEAVY_TABLES.includes(c.model) || (c.model === "prediction" && c.method === "findMany")), fake.calls.map((c) => `${c.model}.${c.method}`));
  for (const type of SITEMAP_TYPES) {
    fake.reset();
    const response = await childSitemap(new Request(`https://example.test/sitemaps/${type}.xml?cb=${Math.random()}`), { params: { type: `${type}.xml` } });
    const body = await response.text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    check(`route ${type}.xml: 200 and only ${type} URLs`, response.status === 200 && locs.every((u) => sitemapType(u.replaceAll("&amp;", "&")) === type), { status: response.status });
  }

  // ==========================================================================
  section("2. Parity with master — exhaustive evidence grid");
  const grid = evidenceGrid();
  load(grid);
  const gridFixtures = new Set(grid.prediction.filter((p) => p.status === "PUBLISHED").map((p) => p.matchSlugKey)).size;
  console.log(`  grid: ${grid.prediction.length} predictions, ${gridFixtures} published fixtures`);
  const { legacy: gridLegacy } = await compareWithLegacy("grid");
  const gridMatches = gridLegacy.filter((e) => sitemapType(e.url) === "matches").length;
  const gridH2H = gridLegacy.filter((e) => sitemapType(e.url) === "h2h").length;
  check("grid: exercises both sides of the match gate", gridMatches > 0 && gridMatches < gridFixtures, { gridMatches, gridFixtures });
  check("grid: exercises both sides of the h2h gate", gridH2H > 0 && gridH2H < gridFixtures, { gridH2H });
  check("grid: spans several evidence batches", gridFixtures > 2 * scope.SITEMAP_EVIDENCE_BATCH, { gridFixtures, batch: scope.SITEMAP_EVIDENCE_BATCH });

  section("3. Sitemap == page robots decision (no noindex leak, no indexable drop)");
  const listedMatches = new Set((await SITEMAP_BUILDERS.matches()).map((e) => e.url));
  const listedH2H = new Set((await SITEMAP_BUILDERS.h2h()).map((e) => e.url));
  let matchLeaks = 0;
  let matchDrops = 0;
  let h2hLeaks = 0;
  let h2hDrops = 0;
  // A non-array meetingsJson makes the H2H page itself throw (computeH2HStats
  // reduces over it) — pre-existing, identical on master, and only reachable
  // with a cache row this codebase never writes. Such pages have no robots
  // decision to compare, so they are counted and reported, not scored.
  let h2hPageErrors = 0;
  const slugs = [...new Set(grid.prediction.filter((p) => p.status === "PUBLISHED").map((p) => p.matchSlugKey as string))];
  for (const slug of slugs) {
    // Exactly the match page's loadMatch(): getPublishedByMatchSlug +
    // getMatchTeamDigests + getH2HMeetings -> assessMatchEvidence.
    const { rows, match } = await scope.getPublishedByMatchSlug(slug);
    if (!match) continue;
    const [digests, h2hMeetings] = await Promise.all([
      scope.getMatchTeamDigests(match.homeTeamApiId, match.awayTeamApiId, match.leagueApiId),
      scope.getH2HMeetings(match.homeTeamApiId, match.awayTeamApiId),
    ]);
    const evidence = assessMatchEvidence({
      homeDigest: digests.home, awayDigest: digests.away, standings: digests.standings,
      homeTeamApiId: match.homeTeamApiId, awayTeamApiId: match.awayTeamApiId, h2hMeetings,
      matchPreview: rows.find((r) => r.matchPreview)?.matchPreview ?? null,
      analysisJson: rows.find((r) => r.analysisJson)?.analysisJson ?? null,
    });
    const listed = listedMatches.has(absoluteUrl(`/predictions/match/${slug}`));
    if (listed && !evidence.substantive) matchLeaks++;
    if (!listed && evidence.substantive) matchDrops++;
  }
  const h2hSlugs = [...new Set(grid.prediction.filter((p) => p.status === "PUBLISHED").map((p) => p.h2hSlugKey as string))];
  for (const slug of h2hSlugs) {
    let page: Awaited<ReturnType<typeof scope.getH2HBySlug>>;
    try {
      page = await scope.getH2HBySlug(slug);
    } catch {
      h2hPageErrors++;
      continue;
    }
    if (!page.pair) continue;
    const listed = listedH2H.has(absoluteUrl(`/predictions/h2h/${slug}`));
    const indexable = isSubstantiveH2H(page.meetings);
    if (listed && !indexable) h2hLeaks++;
    if (!listed && indexable) h2hDrops++;
  }
  check(`matches: no noindex page listed (${slugs.length} fixtures checked)`, matchLeaks === 0, matchLeaks);
  check("matches: no indexable page missing", matchDrops === 0, matchDrops);
  check(`h2h: no noindex page listed (${h2hSlugs.length} pairs checked)`, h2hLeaks === 0, h2hLeaks);
  check("h2h: no indexable page missing", h2hDrops === 0, h2hDrops);
  console.log(`  note: ${h2hPageErrors} grid H2H pages throw on malformed (non-array) meetingsJson — same on master, see comment above`);

  section("4. Parity with master — seeded general corpora (both sides of the track-record gate)");
  for (const [seed, settled] of [[11, 5], [12, 19], [13, 20], [14, 60], [15, 0], [16, 120]] as const) {
    load(generalCorpus(seed, settled));
    await compareWithLegacy(`seed ${seed}/${settled} settled`);
  }
  load({ prediction: [] });
  await compareWithLegacy("empty database");
  fake.reset();
  const everything = await getSitemapEntries();
  check("getSitemapEntries (offline union) still covers every type", everything.length >= 1 + 18 + CUP_CONFIGS.length);

  section("5. No N+1 — evidence query count grows with corpus/batch, not corpus");
  load(grid);
  await scope.getSubstantiveMatchSlugs();
  const matchCalls = fake.calls.length;
  const batches = Math.ceil(gridFixtures / scope.SITEMAP_EVIDENCE_BATCH);
  check(`matches evidence: ${matchCalls} queries for ${gridFixtures} fixtures (<= 1 + 4 x ${batches} batches)`, matchCalls <= 1 + 4 * batches, matchCalls);
  fake.reset();
  await scope.getSubstantiveH2HSlugs();
  const pairCount = new Set(grid.prediction.map((p) => h2hPairKey(p.homeTeamApiId, p.awayTeamApiId))).size;
  check(`h2h evidence: ${fake.calls.length} queries for ${pairCount} pairs`, fake.calls.length <= 1 + Math.ceil(pairCount / scope.SITEMAP_EVIDENCE_BATCH), fake.calls.length);
  check("h2h evidence: never reads per-row predictions", !fake.calls.some((c) => c.model === "prediction" && c.method === "findMany"));

  // ==========================================================================
  section("6. Persistent cache + route behaviour");
  load(generalCorpus(21, 30));
  dataCache.clear();
  dataCacheStale = false;
  for (const type of SITEMAP_TYPES) await childSitemap(new Request(`https://example.test/sitemaps/${type}.xml`), { params: { type: `${type}.xml` } });
  const keys = [...dataCache.keys()];
  check("cache: one independent entry per sitemap type", keys.length === SITEMAP_TYPES.length, keys.length);
  check("cache: every key names its deployment and type", SITEMAP_TYPES.every((type) => keys.filter((k) => k.includes(`sitemap,v1,local,${type}-`)).length === 1), keys);
  check("cache: keys carry no database identifier or credential", keys.every((k) => !/postgres|neon|password|DATABASE/i.test(k)), keys);
  check("cache: deployment id wins when Vercel provides it",
    sitemapCacheDeployment({ VERCEL_DEPLOYMENT_ID: "dpl_abc", VERCEL_GIT_COMMIT_SHA: "0123abc" } as any) === "dpl_abc");
  check("cache: commit SHA is the fallback discriminator",
    sitemapCacheDeployment({ VERCEL_GIT_COMMIT_SHA: "0123abc" } as any) === "0123abc");
  check("cache: outside Vercel the discriminator is the constant \"local\"",
    sitemapCacheDeployment({} as any) === "local" && sitemapCacheDeployment({ VERCEL_DEPLOYMENT_ID: "", VERCEL_GIT_COMMIT_SHA: "" } as any) === "local");

  fake.reset();
  const cachedAgain = await childSitemap(new Request("https://example.test/sitemaps/matches.xml?bust=1"), { params: { type: "matches.xml" } });
  check("cache: a repeat (even with a cache-busting query string) runs no queries", cachedAgain.status === 200 && fake.calls.length === 0, fake.calls.length);

  // Round trip through the compact cache shape is byte-identical XML.
  for (const type of SITEMAP_TYPES) {
    const built = await SITEMAP_BUILDERS[type]();
    check(`cache: ${type} compact round-trip renders identical XML`, urlsetXml(expandEntries(compactEntries(built))) === urlsetXml(built));
  }

  // Failure with no good entry (cold cache) -> 503, nothing cached. This is
  // the only case the route answers 503.
  dataCache.clear();
  fake.failOn("prediction.aggregate");
  const failed = await childSitemap(new Request("https://example.test/sitemaps/static.xml"), { params: { type: "static.xml" } });
  check("failure: cold build error returns 503", failed.status === 503, failed.status);
  check("failure: Retry-After set", failed.headers.get("retry-after") === String(SITEMAP_RETRY_AFTER_SECONDS), failed.headers.get("retry-after"));
  check("failure: no-store so no cache layer keeps it", failed.headers.get("cache-control") === "no-store", failed.headers.get("cache-control"));
  check("failure: XML body", (await failed.text()).startsWith("<?xml"));
  check("failure: error was not cached", dataCache.size === 0, dataCache.size);

  // A good build, then a failing rebuild must not destroy the good value.
  //
  // This harness has no App Router request store, so Next 14.2.15 takes its
  // no-store branch, which rebuilds a stale entry inline — here the rebuild's
  // error reaches the route, which answers 503. PRODUCTION takes the App
  // Router branch instead: the stale sitemap is returned to the triggering
  // request, the refresh runs on waitUntil (awaited before that request fully
  // closes), a failed refresh is caught and logged, and the good entry keeps
  // being served. That path was verified against the Next source
  // (unstable-cache.js, pipe-readable.js), not a real Vercel deployment. What
  // both paths share, and what is asserted here, is that the failure never
  // replaces the good cached sitemap.
  fake.clearFailures();
  const good = await childSitemap(new Request("https://example.test/sitemaps/static.xml"), { params: { type: "static.xml" } });
  const goodBody = await good.text();
  const storedBefore = JSON.stringify([...dataCache.values()]);
  dataCacheStale = true; // force a rebuild attempt
  fake.failOn("prediction.aggregate");
  const failedRebuild = await childSitemap(new Request("https://example.test/sitemaps/static.xml"), { params: { type: "static.xml" } });
  check("failure (no-store harness path): failed inline rebuild is a 503, never a half-built sitemap", failedRebuild.status === 503, failedRebuild.status);
  check("failure: last good cached value survives a failed rebuild", JSON.stringify([...dataCache.values()]) === storedBefore);
  dataCacheStale = false;
  fake.clearFailures();
  const afterRecovery = await childSitemap(new Request("https://example.test/sitemaps/static.xml"), { params: { type: "static.xml" } });
  check("failure: good value served again once fresh", (await afterRecovery.text()) === goodBody);

  // Unknown type: the existing XML 404, untouched, and no database work.
  fake.reset();
  const unknown = await childSitemap(new Request("https://example.test/sitemaps/nope.xml"), { params: { type: "nope.xml" } });
  check("unknown type: 404", unknown.status === 404, unknown.status);
  check("unknown type: same XML body as before", (await unknown.text()) === '<?xml version="1.0" encoding="UTF-8"?><error>Unknown sitemap</error>');
  check("unknown type: application/xml", unknown.headers.get("content-type") === "application/xml; charset=utf-8");
  check("unknown type: no database work", fake.calls.length === 0, fake.calls.length);
  const bare = await childSitemap(new Request("https://example.test/sitemaps/static"), { params: { type: "static" } });
  check("type without .xml still resolves (unchanged parseType)", bare.status === 200, bare.status);

  // Size guard measures, never truncates.
  const huge = Array.from({ length: 50_001 }, (_, i) => [`/predictions/match/x-${i}`, null, "weekly", 0.7] as any);
  const originalError = console.error;
  const originalWarn = console.warn;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => logged.push(String(a[0]));
  console.warn = (...a: unknown[]) => logged.push(String(a[0]));
  const measured = guardSize("matches", huge);
  console.error = originalError;
  console.warn = originalWarn;
  check("guard: counts every URL (no truncation)", measured.urls === 50_001 && huge.length === 50_001);
  check("guard: logs past the 50k protocol limit", logged.some((l) => l.includes("exceeds the 50000-URL sitemap limit")), logged);

  section("7. XML validity and sitemap index");
  load(generalCorpus(31, 30));
  const indexResponse = sitemapIndex();
  const indexBody = await indexResponse.text();
  const indexLocs = [...indexBody.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
  check("index: is a <sitemapindex> (what check-sitemap-parity.mjs detects)", /<sitemapindex\b/i.test(indexBody));
  check("index: lists exactly the seven child sitemaps", JSON.stringify(indexLocs) === JSON.stringify(SITEMAP_TYPES.map((t) => absoluteUrl(`/sitemaps/${t}.xml`))), indexLocs);
  const parityScript = read("scripts/check-sitemap-parity.mjs");
  check("parity script: still parses <loc> with the regex this suite uses", parityScript.includes("/<loc>\\s*([^<]+?)\\s*<\\/loc>/gi") && parityScript.includes("<sitemapindex\\b"));
  for (const type of SITEMAP_TYPES) {
    dataCache.clear();
    const response = await childSitemap(new Request(`https://example.test/sitemaps/${type}.xml`), { params: { type: `${type}.xml` } });
    const xml = await response.text();
    const wellFormed =
      xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') &&
      xml.endsWith("</urlset>") &&
      (xml.match(/<url>/g)?.length ?? 0) === (xml.match(/<\/url>/g)?.length ?? 0) &&
      !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml) &&
      [...xml.matchAll(/<url>(.*?)<\/url>/g)].every((m) => /^<loc>https?:\/\/[^<]+<\/loc>(<lastmod>[^<]+<\/lastmod>)?(<changefreq>[a-z]+<\/changefreq>)?(<priority>[0-9.]+<\/priority>)?$/.test(m[1]));
    check(`xml: ${type}.xml is a well-formed urlset`, wellFormed, xml.slice(0, 300));
    check(`xml: ${type}.xml lastmods are ISO timestamps`, [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].every((m) => !Number.isNaN(Date.parse(m[1])) && m[1].endsWith("Z")));
  }
  check("xml: special characters are escaped", urlsetXml([{ url: "https://x.test/a?b=1&c='d'" }]).includes("https://x.test/a?b=1&amp;c=&apos;d&apos;"));

  // ==========================================================================
  section("8. Crawler pages — bounded, constant-count link lookups with the same answers");
  // The global indexes are themselves order-dependent in two places: a team id
  // published under two spellings resolves to whichever row sorts first by
  // publishedAt (ties and NULLs are in database order), and two slugs for one
  // matchKey resolve to whichever row the unordered read returned last. Those
  // answers cannot be compared run to run — not even global against global —
  // so this corpus gives every team id one spelling and every row a distinct
  // publishedAt. Everything else about it is the general corpus.
  const s8 = generalCorpus(41, 30);
  const spellingById = new Map<number, string>();
  s8.prediction = s8.prediction.map((p, i) => {
    const row = { ...p, publishedAt: new Date(now - i * 60_000) };
    for (const [nameKey, idKey] of [["homeTeam", "homeTeamApiId"], ["awayTeam", "awayTeamApiId"]] as const) {
      if (row[idKey] == null) continue;
      if (!spellingById.has(row[idKey])) spellingById.set(row[idKey], row[nameKey]);
      row[nameKey] = spellingById.get(row[idKey]);
    }
    return { ...row, ...derivePredictionSlugs(row) };
  });
  load(s8);
  // Footer: previous meetings + upcoming fixtures + table neighbours.
  const published = tables.prediction.filter((p) => p.status === "PUBLISHED" && p.homeTeamApiId != null && p.awayTeamApiId != null && p.kickoff);
  const subject = published[0];
  const pastMeetings = published
    .filter((p) => h2hPairKey(p.homeTeamApiId, p.awayTeamApiId) === h2hPairKey(subject.homeTeamApiId, subject.awayTeamApiId))
    .map((p, i) => ({ fixtureApiId: i, date: new Date(p.kickoff).toISOString(), leagueName: "L", leagueApiId: 1, homeTeamApiId: p.homeTeamApiId, homeTeam: p.homeTeam, awayTeamApiId: p.awayTeamApiId, awayTeam: p.awayTeam, homeGoals: 1, awayGoals: 1 }));
  // Upcoming links resolve by "home-vs-away-" prefix and take the first index
  // entry that matches — database order again when a pairing has several
  // published dates — so the comparison uses pairings with exactly one.
  const slugsForPrefix = (prefix: string) => new Set(published.map((p) => p.matchSlugKey).filter((s: string | null) => !!s && s.startsWith(prefix)));
  const upcoming = published
    .filter((p) => slugsForPrefix(`${teamSlug(p.homeTeam)}-vs-${teamSlug(p.awayTeam)}-`).size === 1)
    .slice(0, 25)
    .map((p, i) => ({ id: i, date: new Date(p.kickoff).toISOString(), homeTeam: p.homeTeam, awayTeam: p.awayTeam }));
  upcoming.push({ id: 999, date: new Date(now).toISOString(), homeTeam: "Nobody FC", awayTeam: "Nowhere Utd" });
  const standings = [...new Set(tables.prediction.flatMap((p) => [p.homeTeamApiId, p.awayTeamApiId]))].filter((id) => id != null).map((id, i) => standingRow(id, i % 4));
  standings.push({ ...standingRow(424242, 3), teamName: "Arsenal" }); // no id match, name fallback
  standings.push({ ...standingRow(515151, 3), teamName: "Unpublished Town" });
  tables.leagueEnrichmentCache = [leagueCache(39, { standingsJson: standings, upcomingJson: upcoming })];

  // Legacy footer decisions, from the global indexes the component used to read.
  const globalMatchIndex = await scope.getPublishedMatchIndex();
  const globalTeamIndex = await scope.getPublishedTeamIndex();
  const legacyPrevious = pastMeetings
    .map((m) => {
      const key = matchKey({ homeTeamApiId: m.homeTeamApiId, awayTeamApiId: m.awayTeamApiId, kickoff: m.date });
      const slug = key ? globalMatchIndex[key] : null;
      return slug && slug !== "current" ? slug : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  const legacyUpcoming = upcoming
    .map((f) => Object.entries(globalMatchIndex).find(([, slug]) => slug.startsWith(`${teamSlug(f.homeTeam)}-vs-${teamSlug(f.awayTeam)}-`))?.[1] ?? null)
    .filter((s): s is string => !!s && s !== "current")
    .slice(0, 4);
  const legacyNearby = standings
    .filter((r) => r.teamId !== subject.homeTeamApiId && r.teamId !== subject.awayTeamApiId && r.played > 0)
    .map((r) => scope.publishedTeamHref(globalTeamIndex, r.teamId, r.teamName))
    .filter(Boolean)
    .slice(0, 6);

  fake.reset();
  const element = await MatchPageFooterLinks({
    leagueApiId: 39, leagueName: "Premier League", currentSlug: "current", h2hMeetings: pastMeetings, standings,
    homeTeamApiId: subject.homeTeamApiId, awayTeamApiId: subject.awayTeamApiId,
  });
  const footerCalls = [...fake.calls];
  const hrefs: string[] = [];
  const walk = (node: any) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.props?.href) hrefs.push(node.props.href);
    walk(node.props?.children);
  };
  walk(element);
  const footerPrediction = footerCalls.filter((c) => c.model === "prediction");
  check("footer: exactly two prediction queries regardless of how many links it resolves (no N+1)", footerPrediction.length === 2, footerPrediction.length);
  check("footer: every prediction query is bounded", footerPrediction.every((c) => isBoundedWhere(c.args?.where)), footerPrediction.map((c) => c.args?.where));
  check("footer: does not read the global match or team index", !footerPrediction.some((c) => JSON.stringify(c.args?.where) === JSON.stringify({ status: "PUBLISHED", homeTeam: { not: null }, awayTeam: { not: null }, kickoff: { not: null } })));
  const expectedHrefs = [
    ...legacyPrevious.map((s) => `/predictions/match/${s}`),
    ...legacyUpcoming.map((s) => `/predictions/match/${s}`),
    ...legacyNearby.map((s) => `/predictions/team/${s}`),
  ];
  const renderedLinks = hrefs.filter((h) => !h.startsWith("/predictions/league/"));
  check(`footer: renders the same ${expectedHrefs.length} links the global indexes produced`,
    JSON.stringify([...renderedLinks].sort()) === JSON.stringify([...expectedHrefs].sort()), { renderedLinks, expectedHrefs });
  check("footer: exercised all three link kinds", legacyPrevious.length > 0 && legacyUpcoming.length > 0 && legacyNearby.length > 0,
    { previous: legacyPrevious.length, upcoming: legacyUpcoming.length, nearby: legacyNearby.length });

  // Bounded team index == global index, for every club in the table.
  fake.reset();
  const boundedTeams = await scope.getPublishedTeamIndexFor(standings.map((r) => ({ teamId: r.teamId, teamName: r.teamName })));
  check("team index: one bounded query for a whole table", fake.calls.length === 1 && isBoundedWhere(fake.calls[0].args?.where), fake.calls.length);
  check("team index: same link for every club as the global index",
    standings.every((r) => scope.publishedTeamHref(boundedTeams, r.teamId, r.teamName) === scope.publishedTeamHref(globalTeamIndex, r.teamId, r.teamName)));

  // League page: getLeagueClubs + the bounded match index it now uses.
  fake.reset();
  const clubs = await scope.getLeagueClubs(standings);
  const clubPredictionCalls = fake.calls.filter((c) => c.model === "prediction");
  check("league clubs: one bounded prediction query for the whole grid", clubPredictionCalls.length === 1 && isBoundedWhere(clubPredictionCalls[0].args?.where), clubPredictionCalls.length);
  check("league clubs: same club links as the global index",
    clubs.every((club, i) => club.slug === scope.publishedTeamHref(globalTeamIndex, standings[i].teamId, standings[i].teamName)));

  const upcomingSlugs = upcoming.map((f) => matchSlug({ homeTeam: f.homeTeam, awayTeam: f.awayTeam, kickoff: f.date })).filter((s): s is string => !!s);
  fake.reset();
  const leagueIndex = await scope.getPublishedMatchIndexFor({
    slugs: upcomingSlugs,
    kickoff: { gte: new Date(now - 72 * 3600_000), lte: new Date(now + 48 * 3600_000) },
  });
  check("league match index: one bounded query", fake.calls.length === 1 && isBoundedWhere(fake.calls[0].args?.where), fake.calls.length);
  const globalSlugs = new Set(Object.values(globalMatchIndex));
  const boundedSlugs = new Set(Object.values(leagueIndex));
  check("league previews: same upcoming-fixture links as the global index",
    upcomingSlugs.every((slug) => globalSlugs.has(slug) === boundedSlugs.has(slug)));
  const recentKeys = published
    .filter((p) => Math.abs(new Date(p.kickoff).getTime() - now) <= 36 * 3600_000)
    .map((p) => matchKey(p))
    .filter((k): k is string => !!k);
  check("league results: every recent fixture key resolves as it did globally",
    recentKeys.length > 0 && recentKeys.every((k) => leagueIndex[k] === globalMatchIndex[k]), { recent: recentKeys.length });
  check("league match index: smaller than the global index it replaces", Object.keys(leagueIndex).length < Object.keys(globalMatchIndex).length);

  const footerSource = read("src/components/MatchPageFooterLinks.tsx");
  const leagueSource = read("src/app/(public)/predictions/league/[slug]/page.tsx");
  check("source: match footer no longer calls the global match/team index",
    !footerSource.includes("getPublishedMatchIndex()") && !footerSource.includes("getPublishedTeamIndex()"));
  check("source: league page no longer calls the global match index", !leagueSource.includes("getPublishedMatchIndex()"));
  const clubsSource = read("src/lib/predictionScope.ts");
  const clubsBody = clubsSource.slice(clubsSource.indexOf("export const getLeagueClubs"), clubsSource.indexOf("export type H2HPageData"));
  check("source: getLeagueClubs no longer calls the global team index", !clubsBody.includes("getPublishedTeamIndex()"));

  // Match page team reads: narrow select, shared by digest + form comparison.
  tables.teamEnrichmentCache = [teamCache(77, { teamDigestJson: warmDigest, lastFixtures: [] })];
  fake.reset();
  await scope.getTeamDigest(77);
  const teamRead = fake.calls.find((c) => c.model === "teamEnrichmentCache");
  check("match page: team read selects only digest/lastFixtures/fetchedAt (no squad/coach/stats JSON)",
    !!teamRead?.args?.select && !teamRead.args.select.squadJson && !teamRead.args.select.coachJson && !teamRead.args.select.statsJson && teamRead.args.select.teamDigestJson && teamRead.args.select.lastFixtures,
    teamRead?.args?.select);
  const formSource = read("src/components/MatchFormComparison.tsx");
  check("match page: form comparison shares the narrow read", formSource.includes("getTeamMatchEnrichment(") && !formSource.includes("getTeamEnrichment("));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
