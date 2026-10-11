/**
 * The calendar-month track record and the per-feed past-days results.
 *
 * WHAT THIS PROTECTS. /track-record used to read 90 days of settled rows and
 * show all-time counts; it now reports one Lagos calendar month, rates only,
 * counted in the database. VIP, Premium and Banker carry their own day-by-day
 * results that cost nothing until a reader opens a day, and never reveal a
 * locked pick. Each of those properties is pinned here.
 *
 * Run: npx tsx scripts/check-track-record.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let passed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

// The data modules import prisma; nothing here queries it.
function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}
stub("../src/lib/prisma", { prisma: {} });
// React's cache() exists only in the Next.js server runtime; a pass-through is enough here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
stub("react", { ...require("react"), cache: <T,>(fn: T) => fn });

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

async function main() {
  const tr = await import("../src/lib/trackRecord");
  const fr = await import("../src/lib/feedResults");

  console.log("calendar month bounds (Lagos):");
  const oct = tr.lagosMonthBounds(new Date("2026-10-11T09:00:00Z"));
  eq("October 2026 starts 1 Oct 00:00 Lagos", oct.start.toISOString(), "2026-09-30T23:00:00.000Z");
  eq("...and ends 1 Nov 00:00 Lagos", oct.end.toISOString(), "2026-10-31T23:00:00.000Z");
  eq("its key", oct.key, "2026-10");
  eq("23:30 UTC on 31 Oct is already November in Lagos", tr.lagosMonthBounds(new Date("2026-10-31T23:30:00Z")).key, "2026-11");
  eq("previous month of January is December of the year before", tr.lagosMonthBounds(new Date("2027-01-05T10:00:00Z"), -1).key, "2026-12");
  eq("December's end is 1 January", tr.lagosMonthBounds(new Date("2026-12-15T10:00:00Z")).end.toISOString(), "2026-12-31T23:00:00.000Z");
  eq("month label", tr.monthLabel("2026-10"), "October 2026");

  console.log("\nrates from grouped counts:");
  const s = tr.statFromCounts([{ outcome: "WON", count: 30 }, { outcome: "LOST", count: 10 }, { outcome: "VOID", count: 2 }]);
  eq("won/lost/void/decided", [s.won, s.lost, s.void, s.decided], [30, 10, 2, 40]);
  eq("rate excludes voids", s.rate, 0.75);
  eq("no decided results: no rate", tr.statFromCounts([{ outcome: "VOID", count: 3 }]).rate, null);

  console.log("\npast days for the feed results:");
  const now = new Date("2026-10-11T09:00:00Z");
  eq("the list starts yesterday", fr.firstResultsDay(now), "2026-10-10");
  eq("day keys cross month ends", fr.shiftDayKey("2026-10-01", -1), "2026-09-30");
  eq("...and year ends", fr.shiftDayKey("2027-01-01", -1), "2026-12-31");
  eq("label", fr.resultsDayLabel("2026-10-10"), "Saturday, 10 October");
  const b = fr.resultsDayBounds("2026-10-10", now);
  eq("a past day maps to its Lagos midnight-to-midnight", b && [b.start.toISOString(), b.end.toISOString()], ["2026-10-09T23:00:00.000Z", "2026-10-10T23:00:00.000Z"]);
  eq("today is refused (it is on the feed)", fr.resultsDayBounds("2026-10-11", now), null);
  eq("the future is refused", fr.resultsDayBounds("2026-10-20", now), null);
  eq("beyond the paging limit is refused", fr.resultsDayBounds(fr.shiftDayKey("2026-10-11", -(fr.FEED_RESULTS_MAX_DAYS_BACK + 1)), now), null);
  check("the oldest allowed day is accepted", fr.resultsDayBounds(fr.shiftDayKey("2026-10-11", -fr.FEED_RESULTS_MAX_DAYS_BACK), now) !== null);
  for (const bad of ["", "2026-13-01", "2026-02-30", "10-10-2026", "2026-10-10T00:00", null]) {
    eq(`malformed day ${JSON.stringify(bad)} is refused`, fr.resultsDayBounds(bad as string | null, now), null);
  }
  eq("only VIP, Premium and Banker carry the section", fr.FEED_RESULTS_CATEGORIES, ["VIP", "PREMIUM", "BANKER"]);
  eq("a week at a time", fr.FEED_RESULTS_PAGE_DAYS, 7);

  console.log("\nthe lock:");
  const row = { id: "p1", homeTeam: "A", awayTeam: "B", kickoff: new Date("2026-10-10T15:00:00Z"), market: "Match Winner", pick: "A to win", outcome: "WON" };
  eq("a reader who can view sees the pick", fr.shapeDayResults([row], true)[0].pick, "A to win");
  const locked = fr.shapeDayResults([row], false)[0];
  eq("a reader who cannot sees no pick", locked.pick, null);
  check("...but still sees the match, market and result", locked.homeTeam === "A" && locked.market === "Match Winner" && locked.outcome === "WON");
  const route = src("src/app/api/predictions/results/route.ts");
  check("the route decides access with canViewCategory", route.includes("canViewCategory(category, viewer.tier, viewer.status, viewer.role)"));
  check("the route never lets a shared cache hold one reader's view", route.includes('"Cache-Control": "private') && !/s-maxage|public,/.test(route));
  check("the route refuses other categories", route.includes("FEED_RESULTS_CATEGORIES.includes(category)"));

  console.log("\nlight by construction:");
  const lib = src("src/lib/trackRecord.ts");
  const monthFn = lib.slice(lib.indexOf("export const getMonthTrackRecord"), lib.indexOf("/**\n * Settled record for one league"));
  check("the month record counts in the database (groupBy), not by loading rows", monthFn.includes("groupBy") && (monthFn.match(/findMany/g) ?? []).length === 1);
  check("its one row read is the 12 latest results", /take: 12/.test(monthFn));
  check("every query is bounded to a calendar month", monthFn.includes("settledInMonth(month)") && monthFn.includes("settledInMonth(previous)"));
  check("the old 90-day row read is gone", !lib.includes("getTrackRecordData") && !lib.includes("WINDOW_OPTIONS"));
  const page = src("src/app/(public)/track-record/page.tsx");
  check("the page renders the month record", page.includes("getMonthTrackRecord"));
  const feedPage = src("src/app/(public)/predictions/[category]/page.tsx");
  check("the feed page renders the section for VIP, Premium and Banker only", feedPage.includes('(cat === "VIP" || cat === "PREMIUM" || cat === "BANKER") && (\n        <FeedResults'));
  const comp = src("src/components/FeedResults.tsx");
  check("a day is fetched only when opened, and only once", comp.includes("if (!next || days[key]?.status === \"done\" || days[key]?.status === \"loading\") return;"));
  check("the client section imports no server module", !/from "@\/lib\/(prisma|feedResults|categoryPredictions)"/.test(comp));

  console.log("\nno prediction counts on /track-record:");
  const view = src("src/components/TrackRecordView.tsx");
  const trackView = view.slice(view.indexOf("export function TrackRecordView"));
  check("every rate card on the page hides counts", (trackView.match(/<RateCard /g) ?? []).length === (trackView.match(/counts=\{false\}/g) ?? []).length);
  check("no settled/won/lost totals in the masthead", !/Settled tips|"Won"|Lost \/ void|\.total\)|\.won\)|\.lost\)/.test(trackView));
  check("the copy says it is a calendar-month record", trackView.includes("calendar month"));
  check("the other pages' rate cards keep their counts by default", view.includes("counts = true"));
  check("anchors other pages link to are kept", trackView.includes('id={`category-${cat.toLowerCase().replaceAll("_", "-")}`}') && trackView.includes('id="market-over-25"'));

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures) process.exit(1);
  console.log("All track record checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
