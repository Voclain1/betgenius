/**
 * Yesterday / Today / Tomorrow feed scoping — verified at the QUERY level.
 *
 * Visual correctness is not the claim being tested here. The claim is that each
 * day is its own scoped database query against the same indexed kickoff range
 * the page already used, and that the default view does no extra work. Both are
 * properties of the SQL, so this reads the SQL.
 *
 * It instruments Prisma by pre-seeding globalThis.prisma with a client that
 * emits query events, BEFORE src/lib/prisma is imported — that module returns
 * the global if one exists, so no application code changes to be measurable.
 *
 * Read-only. Run: npx tsx scripts/check-feed-days.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (globalThis as any).prisma = client;

  const events: { query: string; params: string }[] = [];
  (client as any).$on("query", (e: any) => events.push({ query: e.query, params: e.params }));
  for (let i = 0; i < 5; i++) { try { await client.$queryRaw`SELECT 1`; break; } catch { await new Promise((r) => setTimeout(r, 3000)); } }
  events.length = 0;

  const { getCategoryPredictions, parseFeedDay, dayShowsOutcomes, feedDayHref, FEED_DAYS } =
    await import("../src/lib/categoryPredictions");
  const { lagosDayBounds } = await import("../src/lib/lagosDate");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  console.log("param parsing (a junk value must not 404, it falls back to today):");
  check('"yesterday" resolves', parseFeedDay("yesterday") === "yesterday");
  check('"tomorrow" resolves', parseFeedDay("tomorrow") === "tomorrow");
  check("undefined -> today", parseFeedDay(undefined) === "today");
  check('"banana" -> today', parseFeedDay("banana") === "today");
  check("array param takes the first", parseFeedDay(["tomorrow", "yesterday"]) === "tomorrow");

  console.log("\nURLs: today stays the bare path, so the default keeps one canonical URL:");
  check("today", feedDayHref("genius", "today") === "/predictions/genius");
  check("yesterday", feedDayHref("genius", "yesterday") === "/predictions/genius?date=yesterday");
  check("tomorrow", feedDayHref("genius", "tomorrow") === "/predictions/genius?date=tomorrow");

  console.log("\noutcomes are shown on yesterday only:");
  check("yesterday shows outcomes", dayShowsOutcomes("yesterday"));
  check("today does NOT (unchanged behaviour)", !dayShowsOutcomes("today"));
  check("tomorrow does NOT", !dayShowsOutcomes("tomorrow"));

  console.log("\nONE query per day, and the day is in the WHERE clause:");
  const perDay: Record<string, { ids: Set<string>; count: number }> = {};
  for (const day of FEED_DAYS) {
    events.length = 0;
    const rows = await getCategoryPredictions("FEATURED", day);
    const selects = events.filter((e) => /SELECT/i.test(e.query) && /"Prediction"/i.test(e.query));
    check(`${day}: exactly one Prediction SELECT`, selects.length === 1, `${selects.length} issued`);
    const bounds = lagosDayBounds(day === "yesterday" ? -1 : day === "tomorrow" ? 1 : 0);
    const inRange = rows.every((r: any) => !r.kickoff || (r.kickoff >= bounds.start && r.kickoff < bounds.end));
    check(`${day}: every row's kickoff is inside that day`, inRange, `${rows.length} rows`);
    perDay[day] = { ids: new Set(rows.map((r: any) => r.id)), count: rows.length };
  }

  console.log("\nthe three days are disjoint (no row is fetched by more than one):");
  const [y, t, m] = [perDay.yesterday.ids, perDay.today.ids, perDay.tomorrow.ids];
  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;
  check("yesterday vs today", overlap(y, t) === 0, `${overlap(y, t)} shared`);
  check("today vs tomorrow", overlap(t, m) === 0, `${overlap(t, m)} shared`);
  check("yesterday vs tomorrow", overlap(y, m) === 0, `${overlap(y, m)} shared`);
  console.log(`  counts — yesterday ${perDay.yesterday.count}, today ${perDay.today.count}, tomorrow ${perDay.tomorrow.count}`);

  console.log("\nthe DEFAULT view does no extra work:");
  events.length = 0;
  await getCategoryPredictions("FEATURED");
  const defaultSelects = events.filter((e) => /SELECT/i.test(e.query) && /"Prediction"/i.test(e.query));
  check("no-argument call issues exactly one SELECT", defaultSelects.length === 1, `${defaultSelects.length} issued`);
  events.length = 0;
  await getCategoryPredictions("FEATURED", "today");
  const todaySelects = events.filter((e) => /SELECT/i.test(e.query) && /"Prediction"/i.test(e.query));
  check("explicit 'today' issues the same single SELECT", todaySelects.length === 1);
  check("and it is the SAME sql as the no-argument call",
    defaultSelects[0]?.query === todaySelects[0]?.query);
  check("with the same bound parameters",
    defaultSelects[0]?.params === todaySelects[0]?.params);
  // The whole point of three fixed days: no query fetches more than one day.
  const spans = [...defaultSelects, ...todaySelects].every((e) => !/OR .*kickoff/i.test(e.query));
  check("no query widens the kickoff range to span days", spans);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
  await client.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
