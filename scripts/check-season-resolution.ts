/**
 * Season resolution for the football data caches, and team crests.
 *
 * The Premier League page showed the finished 2025/26 table (38 played) in
 * October 2026 because the refresh resolved the season from an old
 * prediction's kickoff and from a season list cached in memory with no
 * expiry. These pin the rules that replaced that.
 *
 * Pure. Run: npx tsx scripts/check-season-resolution.ts
 */
export {};

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { pickSeason } = await import("../src/lib/football/api-football");
  const { currentSeasonDate } = await import("../src/lib/enrichment");
  const { teamCrestUrl } = await import("../src/lib/leagues");

  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };
  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

  const epl = [
    { year: 2024, start: "2024-08-16", end: "2025-05-25", current: false },
    { year: 2025, start: "2025-08-15", end: "2026-05-24", current: false },
    { year: 2026, start: "2026-08-21", end: "2027-05-23", current: true },
  ];
  check("in season -> that season", pickSeason(epl, d("2026-10-08")) === 2026, String(pickSeason(epl, d("2026-10-08"))));
  check("spring belongs to the season that started the previous August", pickSeason(epl, d("2026-03-01")) === 2025);
  check("summer break -> last season's final table", pickSeason(epl, d("2026-07-01")) === 2025);

  // The failure: a list fetched before 2026 was added, with 2025 still flagged current.
  const staleList = [
    { year: 2024, start: "2024-08-16", end: "2025-05-25", current: false },
    { year: 2025, start: "2025-08-15", end: "2026-05-24", current: true },
  ];
  check("a list without the new season does not invent it", pickSeason(staleList, d("2026-10-08")) === 2025);

  const calendar = [
    { year: 2025, start: "2025-03-01", end: "2025-11-30", current: false },
    { year: 2026, start: "2026-02-28", end: "2026-12-06", current: true },
  ];
  check("calendar-year league", pickSeason(calendar, d("2026-10-08")) === 2026);
  check("calendar-year league before kickoff -> last season", pickSeason(calendar, d("2026-01-15")) === 2025);
  check("empty list -> heuristic (Oct 2026 -> 2026)", pickSeason([], d("2026-10-08")) === 2026);
  check("empty list -> heuristic (Mar 2027 -> 2026)", pickSeason([], d("2027-03-08")) === 2026);

  const now = d("2026-10-08");
  check("past kickoff resolves by today", currentSeasonDate(d("2026-05-10"), now).getTime() === now.getTime());
  check("future kickoff is kept", currentSeasonDate(d("2026-10-18"), now).getTime() === d("2026-10-18").getTime());
  check("no kickoff resolves by today", currentSeasonDate(null, now).getTime() === now.getTime());

  check("crest URL is API-Football's team media path", teamCrestUrl(42) === "https://media.api-sports.io/football/teams/42.png");

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
