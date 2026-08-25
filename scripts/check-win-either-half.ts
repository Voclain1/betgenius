/**
 * Verifies WIN_EITHER_HALF settlement.
 *
 * Two layers, because they fail differently:
 *
 *   1. Truth-table cases, including every awkward one — a side that wins the
 *      match having won NEITHER half, a side that loses the match having won
 *      one, drawn halves, and the guards for missing or inconsistent scores.
 *   2. REAL finished matches pulled live from api-football, resolved through
 *      the same regulationScoreOf + resolveMarket path production uses, with
 *      the expected answer computed independently from the printed scoreline.
 *
 * Layer 2 deliberately targets split-half matches — a side winning one half but
 * not the other. A clean sweep (winner wins both halves) would pass under an
 * implementation that simply returned the full-time result, so it proves
 * nothing about this market.
 *
 * Run: npx tsx --env-file=.env scripts/check-win-either-half.ts
 */
export {};

import { resolveMarket, isValidSelection, deriveMarketAndPick, type Selection } from "../src/lib/markets";
import { regulationScoreOf } from "../src/lib/settlement";

const failures: string[] = [];
let passed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed++;
  else {
    failures.push(label);
    if (got !== undefined) console.log(`        got: ${JSON.stringify(got)}`);
  }
};

const HOME: Selection = { value: "HOME" } as Selection;
const AWAY: Selection = { value: "AWAY" } as Selection;
const settle = (sel: Selection, ftH: number, ftA: number, ht: { home: number; away: number } | null) =>
  resolveMarket("WIN_EITHER_HALF", sel, ftH, ftA, ht);

async function main() {
  console.log("[1] Truth table");

  // HT 1-0, 2H 0-0 => home won H1 only.
  check("home wins first half only -> WON", settle(HOME, 1, 0, { home: 1, away: 0 }) === "WON");
  check("  ...and away LOST that same match", settle(AWAY, 1, 0, { home: 1, away: 0 }) === "LOST");

  // HT 0-0, 2H 0-1 => away won H2 only.
  check("away wins second half only -> WON", settle(AWAY, 0, 1, { home: 0, away: 0 }) === "WON");

  // HT 0-1, 2H 2-0 => away won H1, home won H2. BOTH sides win this market.
  check("split halves: away won H1 -> WON", settle(AWAY, 2, 1, { home: 0, away: 1 }) === "WON");
  check("split halves: home won H2 -> WON", settle(HOME, 2, 1, { home: 0, away: 1 }) === "WON");

  // The case that makes full-time an unsafe proxy: 1-0 HT then 1-1 2H gives a
  // 2-1 home win, but the AWAY side won neither half and the HOME side won only
  // the first. A "did the backed side win the match" shortcut gets away wrong.
  check("match winner who won only H1 -> WON", settle(HOME, 2, 1, { home: 1, away: 0 }) === "WON");
  check("loser who won NO half -> LOST", settle(AWAY, 2, 1, { home: 1, away: 0 }) === "LOST");

  // 1-1 from HT 1-0 / 2H 0-1: home won H1, away won H2 — a DRAW where both win.
  check("drawn match, home won H1 -> WON", settle(HOME, 1, 1, { home: 1, away: 0 }) === "WON");
  check("drawn match, away won H2 -> WON", settle(AWAY, 1, 1, { home: 1, away: 0 }) === "WON");

  // 0-0 throughout: neither half won by anyone.
  check("goalless draw -> LOST for both", settle(HOME, 0, 0, { home: 0, away: 0 }) === "LOST" && settle(AWAY, 0, 0, { home: 0, away: 0 }) === "LOST");

  // 2-2 from HT 1-1 / 2H 1-1: both halves drawn, nobody wins one.
  check("both halves drawn -> LOST", settle(HOME, 2, 2, { home: 1, away: 1 }) === "LOST");

  // A 3-0 win built entirely in one half still only needs one half.
  check("clean sweep -> WON", settle(HOME, 3, 0, { home: 2, away: 0 }) === "WON");

  console.log("\n[2] Guards — must refuse rather than guess");
  check("missing halftime -> null (flagged for manual)", settle(HOME, 2, 1, null) === null);
  check("halftime greater than fulltime -> null", settle(HOME, 1, 1, { home: 2, away: 0 }) === null);
  check("non-numeric halftime -> null", settle(HOME, 1, 0, { home: NaN, away: 0 } as any) === null);
  check("invalid selection (DRAW) -> null", resolveMarket("WIN_EITHER_HALF", { value: "DRAW" } as any, 1, 0, { home: 1, away: 0 }) === null);
  check("selection shape validates", isValidSelection("WIN_EITHER_HALF", { value: "HOME" }) && !isValidSelection("WIN_EITHER_HALF", { value: "DRAW" }));
  check(
    "display strings name the team",
    deriveMarketAndPick("WIN_EITHER_HALF", HOME, "Arsenal", "Chelsea").pick === "Arsenal to win either half",
    deriveMarketAndPick("WIN_EITHER_HALF", HOME, "Arsenal", "Chelsea"),
  );

  // ---------- 3. Real matches ----------
  console.log("\n[3] Real finished matches from api-football");
  const host = process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io";
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.log("  SKIP — API_FOOTBALL_KEY not configured");
  } else {
    // Split-half fixtures identified by scripts/research-halftime-coverage.ts.
    const ids = [1557374, 1557375, 1563086, 1563087, 1557368, 1557371, 1563090, 1557376];
    let lastAt = 0;
    for (const id of ids) {
      const wait = Math.max(0, lastAt + 250 - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      const res = await fetch(`https://${host}/fixtures?id=${id}`, { headers: { "x-apisports-key": key } });
      const json = await res.json();
      const f = json.response?.[0];
      if (!f) {
        check(`fixture ${id} fetched`, false);
        continue;
      }

      // Resolve through the real production path.
      const reg = regulationScoreOf(f);
      if (!reg.ok) {
        check(`${f.teams.home.name} v ${f.teams.away.name}: regulation score resolvable`, false, reg.reason);
        continue;
      }
      const ht = reg.halftime!;
      const h2 = { home: reg.home - ht.home, away: reg.away - ht.away };

      // Expected answer derived independently, straight from the scoreline.
      const expect = (side: "HOME" | "AWAY") => {
        const wonH1 = side === "HOME" ? ht.home > ht.away : ht.away > ht.home;
        const wonH2 = side === "HOME" ? h2.home > h2.away : h2.away > h2.home;
        return wonH1 || wonH2 ? "WON" : "LOST";
      };

      const gotHome = settle(HOME, reg.home, reg.away, ht);
      const gotAway = settle(AWAY, reg.home, reg.away, ht);
      const label = `${f.teams.home.name} v ${f.teams.away.name} — HT ${ht.home}-${ht.away}, 2H ${h2.home}-${h2.away}, FT ${reg.home}-${reg.away}`;
      const ok = gotHome === expect("HOME") && gotAway === expect("AWAY");
      check(`${label}  [home ${gotHome}, away ${gotAway}]`, ok, { gotHome, gotAway, expectHome: expect("HOME"), expectAway: expect("AWAY") });

      // And the point of choosing these fixtures: at least one side must differ
      // between "won a half" and "won the match", or the case proves nothing.
      const matchWinner = reg.home > reg.away ? "HOME" : reg.away > reg.home ? "AWAY" : "DRAW";
      const differs = expect("HOME") === "WON" && expect("AWAY") === "WON" ? true : matchWinner === "DRAW" || expect(matchWinner === "HOME" ? "AWAY" : "HOME") === "WON";
      if (differs) console.log(`        (exercises the split — full-time result alone would not answer this)`);
    }
  }

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

main();
