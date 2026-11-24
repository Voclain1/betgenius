/**
 * Pre-prediction match pages, shared indexability, preview sitemap entries,
 * duplicate-publication classification and structured data (issue #237).
 * In-memory Prisma stand-in: no database, no network, nothing written.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-match-preview.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePrisma } from "./lib/fakePrisma";
import { createSitemapFixtures } from "./lib/sitemapFixtures";

const react = require("react");
react.cache = (fn: unknown) => fn;
(globalThis as any).AsyncLocalStorage ??= require("node:async_hooks").AsyncLocalStorage;
const tables: Record<string, any[]> = { prediction: [], upcomingFixture: [], teamEnrichmentCache: [], leagueEnrichmentCache: [], h2HCache: [] };
const fake = createFakePrisma(tables, { seed: 237 });
(globalThis as any).prisma = fake.client;

let passes = 0; let failures = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  if (ok) passes++; else { failures++; console.log(`  FAIL  ${label}${detail !== "" ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

async function main() {
  const { matchPageIndexable, matchPreviewMode, previewTierEligible, PREVIEW_INDEX_MAX_DAYS } = await import("../src/lib/matchIndexability");
  const preview = await import("../src/lib/matchPreview");
  const { matchSlug } = await import("../src/lib/slug");
  const { leaguesInTiers } = await import("../src/lib/leagues");
  const { classifyDuplicate, explainRelation } = await import("../src/lib/duplicatePublication");
  const { sportsEventJsonLd } = await import("../src/lib/seo");
  const { assessMatchEvidence } = await import("../src/lib/matchEvidence");

  const NOW = new Date("2026-11-24T12:00:00Z");
  const DAY = 86_400_000;
  const CORE = leaguesInTiers(["CORE"])[0];
  const FALLBACK = leaguesInTiers(["FALLBACK"])[0];
  const fx = createSitemapFixtures(NOW.getTime());

  // ---- 1. shared indexability matrix -------------------------------------
  console.log("1. matchPageIndexable");
  check("mode parsing defaults to off", matchPreviewMode(undefined) === "off" && matchPreviewMode("true") === "off" && matchPreviewMode("on") === "on" && matchPreviewMode("noindex") === "noindex");
  const base = { evidenceSubstantive: true, mode: "on" as const, kickoff: new Date(NOW.getTime() + 6 * DAY), now: NOW, leagueApiId: CORE };
  check("published substantive -> index (any mode)", matchPageIndexable({ ...base, state: "published", mode: "off" }).indexable);
  check("published thin -> noindex", !matchPageIndexable({ ...base, state: "published", evidenceSubstantive: false }).indexable);
  check("preview substantive on -> index", matchPageIndexable({ ...base, state: "preview" }).indexable);
  check("preview mode noindex -> noindex", !matchPageIndexable({ ...base, state: "preview", mode: "noindex" }).indexable);
  check("preview mode off -> noindex", !matchPageIndexable({ ...base, state: "preview", mode: "off" }).indexable);
  check("preview thin -> noindex", !matchPageIndexable({ ...base, state: "preview", evidenceSubstantive: false }).indexable);
  check("preview fallback tier -> noindex", !matchPageIndexable({ ...base, state: "preview", leagueApiId: FALLBACK }).indexable && !previewTierEligible(FALLBACK));
  check("preview beyond 14 days -> noindex", !matchPageIndexable({ ...base, state: "preview", kickoff: new Date(NOW.getTime() + (PREVIEW_INDEX_MAX_DAYS + 1) * DAY) }).indexable);
  check("preview after kickoff -> noindex", !matchPageIndexable({ ...base, state: "preview", kickoff: new Date(NOW.getTime() - 1) }).indexable);
  check("no page -> noindex", !matchPageIndexable({ ...base, state: "none" }).indexable);

  // ---- 2. fixture data ---------------------------------------------------
  const fixture = (id: number, home: string, away: string, h: number, a: number, daysOut: number, over: Record<string, any> = {}) => ({
    fixtureApiId: id, leagueApiId: CORE, leagueName: "Premier League", homeTeamApiId: h, awayTeamApiId: a, homeTeam: home, awayTeam: away,
    kickoff: new Date(NOW.getTime() + daysOut * DAY), status: "NS", round: "Regular Season - 14", discoveredAt: NOW, lastSeenAt: NOW, earlyQueuedAt: null, updatedAt: NOW, ...over,
  });
  const warmTeam = (id: number, fetchedAt: Date) => fx.teamCache(id, { teamDigestJson: fx.warmDigest, fetchedAt });
  const t1 = new Date(NOW.getTime() - 3 * 3_600_000), t2 = new Date(NOW.getTime() - 1 * 3_600_000);
  const load = () => {
    tables.upcomingFixture = [
      fixture(1, "Alpha FC", "Beta FC", 11, 12, 6),                       // warm -> indexable
      fixture(2, "Gamma FC", "Delta FC", 13, 14, 6),                      // cold caches -> thin
      fixture(3, "Eps FC", "Zeta FC", 15, 16, 6, { leagueApiId: FALLBACK }), // fallback tier
      fixture(4, "Eta FC", "Theta FC", 17, 18, 6),                        // has a published pick
      fixture(5, "Iota FC", "Kappa FC", 19, 20, 6, { status: "PST" }),    // postponed
      fixture(6, "Lambda FC", "Mu FC", 21, 22, 6),                        // collision twin A
      fixture(7, "Lambda FC", "Mu FC", 23, 24, 6),                        // collision twin B (same slug)
      fixture(8, "Nu FC", "Xi FC", 25, 26, 20),                           // too far out
    ];
    tables.prediction = [fx.prediction({ fixtureApiId: 4, homeTeam: "Eta FC", awayTeam: "Theta FC", homeTeamApiId: 17, awayTeamApiId: 18, kickoff: new Date(NOW.getTime() + 6 * DAY), leagueApiId: CORE })];
    tables.teamEnrichmentCache = [warmTeam(11, t1), warmTeam(12, t2), warmTeam(15, t1), warmTeam(16, t1), warmTeam(17, t1), warmTeam(18, t1), warmTeam(21, t1), warmTeam(22, t1), warmTeam(23, t1), warmTeam(24, t1), warmTeam(25, t1), warmTeam(26, t1)];
    tables.leagueEnrichmentCache = []; tables.h2HCache = [];
    fake.reset();
  };

  console.log("2. mode off changes nothing");
  load(); delete process.env.MATCH_PREVIEW_MODE;
  check("resolve returns none in mode off, with no queries", (await preview.resolvePreviewBySlug("alpha-fc-vs-beta-fc-" + new Date(NOW.getTime() + 6 * DAY).toISOString().slice(0, 10), NOW)).kind === "none" && fake.calls.length === 0);
  check("sitemap entries empty in mode off, with no queries", (await preview.getPreviewSitemapEntries(NOW)).length === 0 && fake.calls.length === 0);

  console.log("3. preview resolution + sitemap parity");
  process.env.MATCH_PREVIEW_MODE = "on";
  load();
  const slugOf = (f: any) => matchSlug(f)!;
  const rows = tables.upcomingFixture;
  const resolved = new Map<number, string>();
  for (const f of rows) resolved.set(f.fixtureApiId, (await preview.resolvePreviewBySlug(slugOf(f), NOW)).kind);
  check("warm fixture resolves to a preview", resolved.get(1) === "preview", [...resolved]);
  check("fixture with a published prediction is NOT a preview (published page owns the URL)", resolved.get(4) === "none");
  check("postponed fixture is not a preview", resolved.get(5) === "none");
  check("slug collision resolves to nothing for both", resolved.get(6) === "none" && resolved.get(7) === "none");
  check("unknown slug resolves to nothing", (await preview.resolvePreviewBySlug("nobody-vs-nobody-2026-12-01", NOW)).kind === "none");
  check("malformed slug resolves to nothing", (await preview.resolvePreviewBySlug("not-a-slug", NOW)).kind === "none");

  const entries = await preview.getPreviewSitemapEntries(NOW);
  const listed = new Set(entries.map((e) => e.slug));
  check("sitemap lists exactly the warm CORE fixture", listed.size === 1 && listed.has(slugOf(rows[0])), [...listed]);
  check("sitemap lastmod = newest evidence cache fetch, not rediscovery time", entries[0]?.lastModified?.getTime() === t2.getTime(), entries[0]?.lastModified);

  // parity: the page decision (previewEvidenceFor + matchPageIndexable) == sitemap membership, for every fixture
  let parityBreaks = 0;
  for (const f of rows) {
    const res = await preview.resolvePreviewBySlug(slugOf(f), NOW);
    let pageIndexable = false;
    if (res.kind === "preview") {
      const ev = (await preview.previewEvidenceFor([res.fixture])).get(res.fixture.fixtureApiId)!;
      pageIndexable = matchPageIndexable({ state: "preview", evidenceSubstantive: ev.evidence.substantive, mode: matchPreviewMode(), kickoff: res.fixture.kickoff, now: NOW, leagueApiId: res.fixture.leagueApiId }).indexable;
    }
    if (pageIndexable !== listed.has(slugOf(f))) parityBreaks++;
  }
  check("page robots and sitemap membership agree for every fixture (parity)", parityBreaks === 0, parityBreaks);

  // noindex mode: pages render but the sitemap is empty
  process.env.MATCH_PREVIEW_MODE = "noindex";
  check("noindex mode resolves previews", (await preview.resolvePreviewBySlug(slugOf(rows[0]), NOW)).kind === "preview");
  check("noindex mode lists nothing", (await preview.getPreviewSitemapEntries(NOW)).length === 0);
  process.env.MATCH_PREVIEW_MODE = "on";

  console.log("4. publication transition keeps one canonical URL");
  tables.prediction.push(fx.prediction({ fixtureApiId: 1, homeTeam: "Alpha FC", awayTeam: "Beta FC", homeTeamApiId: 11, awayTeamApiId: 12, kickoff: rows[0].kickoff, leagueApiId: CORE }));
  const afterPublish = await preview.getPreviewSitemapEntries(NOW);
  check("a published pick removes the preview entry (published branch lists the same URL)", afterPublish.length === 0);
  const res = await preview.resolvePreviewBySlug(slugOf(rows[0]), NOW);
  check("published slug is owned by the prediction page", res.kind === "none" && (res as any).reason === "published");

  console.log("5. rescheduling (stateless redirect)");
  load();
  let cur = tables.upcomingFixture;
  const oldSlug = slugOf(cur[0]); // alpha-fc-vs-beta-fc-<day+6>
  cur[0].kickoff = new Date(cur[0].kickoff.getTime() + 2 * DAY);
  const redirect = await preview.resolvePreviewBySlug(oldSlug, NOW);
  check("old slug of a rescheduled fixture redirects to the new canonical", redirect.kind === "redirect" && (redirect as any).to === slugOf(cur[0]), redirect);
  cur[0].status = "PST";
  check("postponed fixture: old slug does not redirect", (await preview.resolvePreviewBySlug(oldSlug, NOW)).kind === "none");
  load(); cur = tables.upcomingFixture;
  cur[5].kickoff = new Date(cur[5].kickoff.getTime() + 2 * DAY); // Lambda/Mu twins end up on different days
  const twinOld = "lambda-fc-vs-mu-fc-" + new Date(NOW.getTime() + 3 * DAY).toISOString().slice(0, 10);
  check("two current pages for one pairing are ambiguous: no redirect", (await preview.resolvePreviewBySlug(twinOld, NOW)).kind === "none");
  load();
  const pubRow = tables.prediction[0]; // fixture 4 published
  const movedSlug = "eta-fc-vs-theta-fc-" + new Date(NOW.getTime() + 4 * DAY).toISOString().slice(0, 10);
  const toPublished = await preview.resolvePreviewBySlug(movedSlug, NOW);
  check("old slug of a fixture that is now published redirects to the published slug", toPublished.kind === "redirect" && (toPublished as any).to === pubRow.matchSlugKey, toPublished);
  check("implausible far-future slug date does no redirect work", (await (async () => { fake.reset(); const r = await preview.resolvePreviewBySlug("alpha-fc-vs-beta-fc-2027-06-01", NOW); return r.kind === "none" && fake.calls.length <= 1; })()));
  check("no schema dependency for redirects", !read("prisma/schema.prisma").includes("FixtureSlugAlias"));

  console.log("6. sitemap query bounds are constant in fixture count");
  const bigLoad = (n: number) => {
    load();
    tables.upcomingFixture = Array.from({ length: n }, (_, i) => fixture(1000 + i, `Club ${i} A`, `Club ${i} B`, 5000 + i * 2, 5001 + i * 2, 3 + (i % 8)));
    tables.teamEnrichmentCache = Array.from({ length: n * 2 }, (_, i) => warmTeam(5000 + i, t1));
    fake.reset();
  };
  bigLoad(40); const small = await preview.getPreviewSitemapEntries(NOW); const smallCalls = fake.calls.length;
  bigLoad(240); const large = await preview.getPreviewSitemapEntries(NOW); const largeCalls = fake.calls.length;
  check("40 and 240 fixtures all indexable (warm)", small.length === 40 && large.length === 240, [small.length, large.length]);
  check("query count does not grow with fixtures (no N+1)", largeCalls === smallCalls && largeCalls <= 6, [smallCalls, largeCalls]);
  check("sitemap order is deterministic", JSON.stringify(large.map((e) => e.slug)) === JSON.stringify((await preview.getPreviewSitemapEntries(NOW)).map((e) => e.slug)));

  console.log("7. no draft / paid / pick leakage on preview pages");
  const view = read("src/components/MatchPreviewPage.tsx");
  for (const forbidden of ["PredictionCard", "MatchVerdict", "MatchOddsPanel", "PublishedMarketComparison", "MatchEvidenceGuide", "getPublishedByMatchSlug", "prisma.prediction", "KeyFactors", "MatchLineups", "TeamNewsBody"])
    check(`MatchPreviewPage does not use ${forbidden}`, !view.includes(forbidden));
  check("preview h1 never says prediction", view.includes('headingSuffix="match preview"'));
  check("preview copy carries no 'AI' wording", !/\bAI\b|artificial intelligence/i.test(view + read("src/components/UpcomingPreviews.tsx")));
  const ld: any = sportsEventJsonLd({ homeTeam: "A", awayTeam: "B", kickoff: NOW, league: "Premier League", description: "d", url: "/x" });
  check("SportsEvent has no competition-level superEvent", !("superEvent" in ld) && !JSON.stringify(ld).includes("superEvent"));
  check("SportsEvent has no invented offers, organizer or location", !("offers" in ld) && !("organizer" in ld) && !("location" in ld));
  check("SportsEvent keeps startDate and grounded sport", typeof ld.startDate === "string" && ld.sport === "Soccer");
  check("no superEvent anywhere in src", !/superEvent/.test(read("src/lib/seo.tsx").replace(/\/\/.*superEvent.*/g, "")) );

  console.log("8. page wiring");
  const page = read("src/app/(public)/predictions/match/[slug]/page.tsx");
  check("page decides robots through matchPageIndexable (published and preview)", (page.match(/matchPageIndexable\(/g) ?? []).length >= 2);
  check("page redirects rescheduled previews permanently", page.includes("permanentRedirect"));
  check("sitemap builder uses the same preview source", read("src/lib/sitemapEntries.ts").includes("getPreviewSitemapEntries"));
  check("league page links only indexable previews", read("src/components/UpcomingPreviews.tsx").includes("listIndexablePreviews") );
  const evNoAnalysis = assessMatchEvidence({ homeDigest: null, awayDigest: null, standings: null, homeTeamApiId: 1, awayTeamApiId: 2, h2hMeetings: [], matchPreview: null, analysisJson: null });
  check("empty preview evidence is thin (noindex)", !evNoAnalysis.substantive);

  console.log("9. duplicate classification");
  const sel = (marketType: string, selection: unknown) => ({ marketType, selection });
  check("same market + same selection (key order ignored) = SAME_SELECTION", classifyDuplicate(sel("OVER_UNDER", { side: "OVER", line: 2.5 }), sel("OVER_UNDER", { line: 2.5, side: "OVER" })) === "SAME_SELECTION");
  check("same market, other outcome = CONFLICTING_SELECTION", classifyDuplicate(sel("MATCH_WINNER", { outcome: "HOME" }), sel("MATCH_WINNER", { outcome: "AWAY" })) === "CONFLICTING_SELECTION");
  check("different market = DISTINCT_MARKET", classifyDuplicate(sel("MATCH_WINNER", { outcome: "HOME" }), sel("BTTS", { yes: true })) === "DISTINCT_MARKET");
  check("every relation has a plain-language explanation without ids", ["SAME_SELECTION", "CONFLICTING_SELECTION", "DISTINCT_MARKET"].every((r) => explainRelation(r as any).length > 20 && !/\b[a-z0-9]{20,}\b/.test(explainRelation(r as any))));
  const bulk = read("src/app/api/admin/predictions/bulk/route.ts");
  check("bulk route supports a no-write dry run", bulk.includes("dryRun") && bulk.includes("reviews"));
  check("bulk route re-checks the duplicate inside the publish transaction", bulk.includes("duplicatePublishGuard(") && read("src/lib/duplicatePublication.ts").includes("reviewFeaturedDuplicate(tx, locked)") && read("src/lib/duplicatePublication.ts").includes("pg_advisory_xact_lock"));
  check("an undecided duplicate fails closed", read("src/lib/duplicatePublication.ts").includes("throw new DuplicateReviewRequired(review)"));
  check("an override needs a reason and is recorded for audit", bulk.includes("MIN_OVERRIDE_REASON") && read("src/lib/duplicatePublication.ts").includes("DUPLICATE_OVERRIDE_JOB"));
  check("bulk route never deletes, unpublishes or rewrites a published row", !/prediction\.(delete|deleteMany)|status:\s*"ARCHIVED"/.test(bulk));
  check("raw 'DUPLICATE_FIXTURE: <id>' text is gone", !bulk.includes("DUPLICATE_FIXTURE:") );
  const admin = read("src/app/admin/predictions/page.tsx");
  check("admin queue no longer alerts about duplicates after publishing", !admin.includes("share a match with another published FEATURED pick"));
  check("admin queue reviews before publishing (dry run first)", admin.includes("dryRun: true") && admin.includes("DuplicatePublishReview"));
  check("review panel adds no coloured accent edge or tinted pill", !/border-[lr]-(brand|red|emerald|amber|green|yellow)|bg-(brand|red|emerald|amber|green|yellow)-?\d*\/\d+/.test(read("src/components/admin/DuplicatePublishReview.tsx") + read("src/components/UpcomingPreviews.tsx") + view));

  console.log("10. admin metrics");
  const { leadBucket, leadHistogram } = await import("../src/lib/earlyLaneMetrics");
  check("lead buckets: boundaries", leadBucket(47) === "<2d" && leadBucket(48) === "2-3d" && leadBucket(72) === "3-5d" && leadBucket(120) === "5-7d" && leadBucket(168) === "7-10d" && leadBucket(240) === "7-10d" && leadBucket(241) === ">10d");
  const h = leadHistogram([{ at: NOW, kickoff: new Date(NOW.getTime() + 4 * DAY) }, { at: NOW, kickoff: new Date(NOW.getTime() - DAY) }]);
  check("histogram ignores non-positive leads", h["3-5d"] === 1 && Object.values(h).reduce((a, b) => a + b, 0) === 1);
  const route = read("src/app/api/admin/early-metrics/route.ts");
  check("metrics route is admin-only", route.includes("isAdmin(session?.user.role)") && route.includes("403") && !route.includes("CRON_SECRET"));

  console.log(`\n${failures ? "FAIL" : "PASS"} — ${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
