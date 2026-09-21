/**
 * Bet of the Day lifecycle: the homepage slot shows only a LIVE pick, while
 * the tagged row (and its result) stays in the data as history.
 *
 * No database: the prediction and odds reads are replaced in memory so the real
 * getBetOfTheDay / getCurrentBetOfTheDay run unchanged.
 *
 * Run: npx tsx scripts/check-betofday-lifecycle.ts
 */
export {};

import { readFileSync } from "node:fs";

// getBetOfTheDay is wrapped in React's cache(), which only dedupes inside a
// server render. Outside one, make it a pass-through (as check-betofday-targeting does).
const react = require("react");
react.cache = (fn: unknown) => fn;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

type Row = { id: string; status: string; outcome: string; kickoff: Date | null; tags: string[] };

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { betOfTheDayState, isCurrentBetOfTheDay } = await import("../src/lib/betOfTheDayStatus");

  const NOW = new Date("2026-09-22T12:00:00Z");
  const hour = 3_600_000;

  console.log("\nstate rules:");
  check("upcoming, unsettled, published is LIVE", betOfTheDayState({ outcome: "PENDING", kickoff: new Date(NOW.getTime() + hour), status: "PUBLISHED" }, NOW) === "LIVE");
  check("kicked off but unsettled is STARTED", betOfTheDayState({ outcome: "PENDING", kickoff: new Date(NOW.getTime() - 60_000) }, NOW) === "STARTED");
  check("kickoff exactly now is STARTED", betOfTheDayState({ outcome: "PENDING", kickoff: NOW }, NOW) === "STARTED");
  check("settled is SETTLED", betOfTheDayState({ outcome: "WON", kickoff: new Date(NOW.getTime() - 3 * hour) }, NOW) === "SETTLED");
  check("settled even if the kickoff was moved later", betOfTheDayState({ outcome: "VOID", kickoff: new Date(NOW.getTime() + hour) }, NOW) === "SETTLED");
  check("withdrawn is WITHDRAWN", betOfTheDayState({ outcome: "PENDING", kickoff: new Date(NOW.getTime() + hour), status: "ARCHIVED" }, NOW) === "WITHDRAWN");
  check("no kickoff is never current", !isCurrentBetOfTheDay({ outcome: "PENDING", kickoff: null }, NOW));

  // In-memory stand-in for the two reads getBetOfTheDay makes.
  const rows: Row[] = [];
  const db = prisma as unknown as Record<string, Record<string, unknown>>;
  db.prediction.findFirst = async (args: { where: { status?: string; categories?: { some: { category: string } } } }) => {
    const tag = args.where.categories?.some.category;
    const row = rows.find((r) => (!args.where.status || r.status === args.where.status) && (!tag || r.tags.includes(tag)));
    return row
      ? {
          id: row.id, homeTeam: "Home", awayTeam: "Away", leagueApiId: 39, leagueName: "Premier League", kickoff: row.kickoff,
          market: "Goals", pick: "Over 2.5", marketType: "OVER_UNDER", selection: null, confidence: 70, reasoning: "",
          matchPreview: null, outcome: row.outcome, category: "FEATURED", homeTeamApiId: 1, awayTeamApiId: 2, betOfDayPinnedAt: null,
        }
      : null;
  };
  db.fixtureOddsCache.findUnique = async () => null;

  const { getBetOfTheDay, getCurrentBetOfTheDay } = await import("../src/lib/betOfTheDay");

  const today: Row = { id: "botd-today", status: "PUBLISHED", outcome: "PENDING", kickoff: new Date(NOW.getTime() + 2 * hour), tags: ["BET_OF_THE_DAY"] };
  rows.push(today);

  console.log("\nhomepage slot follows the pick's lifecycle:");
  check("before kickoff it is on the homepage", (await getCurrentBetOfTheDay(NOW))?.row.id === "botd-today");

  const afterKickoff = new Date(NOW.getTime() + 2 * hour + 60_000);
  check("started but unsettled: gone from the homepage", (await getCurrentBetOfTheDay(afterKickoff)) === null);
  check("...still returned as the tagged pick", (await getBetOfTheDay())?.row.id === "botd-today");

  today.outcome = "WON";
  const evening = new Date(NOW.getTime() + 6 * hour);
  check("settled: gone from the homepage", (await getCurrentBetOfTheDay(evening)) === null);
  const history = await getBetOfTheDay();
  check("settled pick remains in the data with its result", history?.row.id === "botd-today" && history.row.outcome === "WON");
  check("...and keeps its tag", today.tags.includes("BET_OF_THE_DAY"));

  today.status = "ARCHIVED";
  check("withdrawn: not shown anywhere as current", (await getCurrentBetOfTheDay(NOW)) === null);
  today.status = "PUBLISHED";

  console.log("\na new valid selection reactivates the slot:");
  // What setBetOfTheDay does: the tag moves; the old row itself is untouched.
  today.tags = [];
  rows.unshift({ id: "botd-tomorrow", status: "PUBLISHED", outcome: "PENDING", kickoff: new Date(evening.getTime() + 20 * hour), tags: ["BET_OF_THE_DAY"] });
  check("the new pick appears on the homepage", (await getCurrentBetOfTheDay(evening))?.row.id === "botd-tomorrow");
  check("the settled row still exists with its outcome", rows.some((r) => r.id === "botd-today" && r.outcome === "WON"));

  console.log("\nno current pick renders no homepage section:");
  rows.length = 0;
  check("nothing tagged is null", (await getCurrentBetOfTheDay(evening)) === null);

  console.log("\nwiring:");
  const home = readFileSync("src/app/(public)/page.tsx", "utf8");
  check("homepage reads the current-only helper", home.includes("getCurrentBetOfTheDay()") && !/\bgetBetOfTheDay\(\)/.test(home));
  check("homepage section is conditional", /\{betOfTheDay && \(/.test(home));
  const lib = readFileSync("src/lib/betOfTheDay.ts", "utf8");
  const current = lib.slice(lib.indexOf("export async function getCurrentBetOfTheDay"), lib.indexOf("export async function setBetOfTheDay"));
  check("the current-only read never writes or deletes", !/delete|update|create/i.test(current.replace(/\/\*\*[\s\S]*?\*\//g, "")));
  const page = readFileSync("src/app/(public)/predictions/bet-of-the-day/page.tsx", "utf8");
  check("the dedicated page labels a finished pick", page.includes("has finished — result:") && page.includes("inactive={!live}"));
  check("...and does not index it as a recommendation", /!isCurrentBetOfTheDay\(row\)[\s\S]*?index: false/.test(page));

  if (failures) {
    console.error(`\n${failures} Bet of the Day lifecycle check(s) failed`);
    process.exit(1);
  }
  console.log("\nBet of the Day lifecycle checks passed");
  await prisma.$disconnect().catch(() => {});
})();
