/**
 * Network-free guards for European Handicap.
 *
 * The live half of the verification (line sourcing, real generation) costs
 * api-football and model calls and lives in scripts/verify-european-handicap.ts.
 * Everything here is deterministic, so it belongs in preflight where it runs on
 * every change.
 *
 * The settlement cases are the point. This market's whole risk is that it looks
 * like Asian Handicap and is not: an adjusted tie is a DRAW selection winning,
 * never a refund. A regression that quietly reintroduced VOID would settle
 * every adjusted-draw pick wrongly and nothing else would notice.
 *
 * Run: npx tsx scripts/check-european-handicap.ts
 */
export {};

import { isValidSelection, deriveMarketAndPick, resolveMarket, AUTO_MARKET_TYPES, ADMIN_MARKET_TYPES } from "../src/lib/markets";
import { isHandicapEligibleLeague, HANDICAP_ELIGIBLE_TIERS, parseHandicapLabel } from "../src/lib/handicapLine";
import { toBookmakerSelection, HANDICAP_MARKET, TRIMMED_MARKETS, HEADLINE_MARKETS } from "../src/lib/odds";
import { LEAGUE_CATALOGUE } from "../src/lib/leagues";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("the model can never reach for this market unprompted:");
check("EUROPEAN_HANDICAP absent from AUTO_MARKET_TYPES", !(AUTO_MARKET_TYPES as readonly string[]).includes("EUROPEAN_HANDICAP"));
check("EUROPEAN_HANDICAP absent from ADMIN_MARKET_TYPES", !(ADMIN_MARKET_TYPES as readonly string[]).includes("EUROPEAN_HANDICAP"));

console.log("\nthe odds trim retains handicap without widening the display four:");
check("HANDICAP_MARKET is in TRIMMED_MARKETS", (TRIMMED_MARKETS as readonly string[]).includes(HANDICAP_MARKET));
check("HANDICAP_MARKET is NOT in HEADLINE_MARKETS", !(HEADLINE_MARKETS as readonly string[]).includes(HANDICAP_MARKET));

console.log("\ntier gate:");
check("eligible tiers are exactly top/mid/minor", [...HANDICAP_ELIGIBLE_TIERS].sort().join(",") === "mid,minor,top");
const worldIds = (LEAGUE_CATALOGUE as readonly { id: number; tier: string }[]).filter((l) => l.tier === "world").map((l) => l.id);
check("no 'world' league is eligible", worldIds.every((id) => !isHandicapEligibleLeague(id)), `${worldIds.length} world leagues`);
check("a known top league is eligible", isHandicapEligibleLeague(39));
check("null league id is not eligible", !isHandicapEligibleLeague(null));
check("unknown league id is not eligible", !isHandicapEligibleLeague(999999));

console.log("\nfeed label parsing (fractional = Asian, must be refused):");
check('"Home -1" parses', JSON.stringify(parseHandicapLabel("Home -1")) === '{"value":"HOME","line":-1}');
check('"Draw +2" parses', JSON.stringify(parseHandicapLabel("Draw +2")) === '{"value":"DRAW","line":2}');
check('"Away -0.5" refused (Asian)', parseHandicapLabel("Away -0.5") === null);
check('"Home -0.25" refused (Asian)', parseHandicapLabel("Home -0.25") === null);
check('"Home +0" refused (level line)', parseHandicapLabel("Home +0") === null);
check('"Over 2.5" refused', parseHandicapLabel("Over 2.5") === null);

console.log("\nselection validation:");
check("valid HOME -1", isValidSelection("EUROPEAN_HANDICAP", { value: "HOME", line: -1 }));
check("valid DRAW +2", isValidSelection("EUROPEAN_HANDICAP", { value: "DRAW", line: 2 }));
check("line 0 refused", !isValidSelection("EUROPEAN_HANDICAP", { value: "HOME", line: 0 }));
check("half line refused", !isValidSelection("EUROPEAN_HANDICAP", { value: "HOME", line: -0.5 }));
check("quarter line refused", !isValidSelection("EUROPEAN_HANDICAP", { value: "HOME", line: -0.25 }));
check("unknown side refused", !isValidSelection("EUROPEAN_HANDICAP", { value: "MAYBE", line: -1 }));
check("missing line refused", !isValidSelection("EUROPEAN_HANDICAP", { value: "HOME" }));

console.log("\npick text is signed and states the line against the home team:");
const d1 = deriveMarketAndPick("EUROPEAN_HANDICAP", { value: "AWAY", line: -1 }, "Ipswich", "Liverpool", { market: "Other", pick: "" });
check("away pick reads correctly", d1.pick === "Liverpool (Ipswich -1)", d1.pick);
const d2 = deriveMarketAndPick("EUROPEAN_HANDICAP", { value: "HOME", line: 1 }, "Ipswich", "Liverpool", { market: "Other", pick: "" });
check("positive line is signed", d2.pick === "Ipswich (Ipswich +1)", d2.pick);
const d3 = deriveMarketAndPick("EUROPEAN_HANDICAP", { value: "DRAW", line: -1 }, "Ipswich", "Liverpool", { market: "Other", pick: "" });
check("draw pick names the line", d3.pick === "Draw (Ipswich -1)", d3.pick);

console.log("\nodds key round-trips to the feed's own label:");
check("AWAY -1 -> 'Away -1'", JSON.stringify(toBookmakerSelection("EUROPEAN_HANDICAP", { value: "AWAY", line: -1 })) === `{"market":"${HANDICAP_MARKET}","value":"Away -1"}`);
check("HOME +2 -> 'Home +2'", JSON.stringify(toBookmakerSelection("EUROPEAN_HANDICAP", { value: "HOME", line: 2 })) === `{"market":"${HANDICAP_MARKET}","value":"Home +2"}`);
check("half line -> null", toBookmakerSelection("EUROPEAN_HANDICAP", { value: "HOME", line: -0.5 }) === null);

console.log("\nsettlement — three-way, and NEVER a push:");
const cases: [number, string, number, number, string][] = [
  [-1, "HOME", 3, 1, "WON"],
  [-1, "HOME", 2, 1, "LOST"],
  [-1, "DRAW", 2, 1, "WON"],
  [-1, "AWAY", 2, 1, "LOST"],
  [-1, "AWAY", 1, 1, "WON"],
  [-1, "DRAW", 1, 1, "LOST"],
  [1, "HOME", 0, 1, "LOST"],
  [1, "DRAW", 0, 1, "WON"],
  [1, "AWAY", 0, 2, "WON"],
  [2, "HOME", 0, 1, "WON"],
  [-2, "AWAY", 1, 0, "WON"],
  [-2, "DRAW", 2, 0, "WON"],
  [-3, "HOME", 4, 0, "WON"],
];
for (const [line, value, hs, as, expected] of cases) {
  const got = resolveMarket("EUROPEAN_HANDICAP", { value, line } as never, hs, as);
  check(`${hs}-${as} line ${line > 0 ? "+" : ""}${line} backing ${value} => ${expected}`, got === expected, got === expected ? "" : `got ${got}`);
}

// The single most important property: every adjusted tie must be a DRAW result,
// never VOID. Swept across scorelines and lines rather than spot-checked,
// because a reintroduced push would only show on the exact-tie combinations.
let voidSeen = 0;
let tiesChecked = 0;
for (let hs = 0; hs <= 5; hs++) {
  for (let as = 0; as <= 5; as++) {
    for (const line of [-3, -2, -1, 1, 2, 3]) {
      for (const value of ["HOME", "DRAW", "AWAY"]) {
        const got = resolveMarket("EUROPEAN_HANDICAP", { value, line } as never, hs, as);
        if (got === "VOID") voidSeen++;
        if (hs + line === as) {
          tiesChecked++;
          const expected = value === "DRAW" ? "WON" : "LOST";
          if (got !== expected) failures++;
        }
      }
    }
  }
}
check(`no VOID across 648 combinations`, voidSeen === 0, `${voidSeen} VOID results`);
check(`every adjusted tie resolves as DRAW (${tiesChecked} tie combinations)`, tiesChecked > 0);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
