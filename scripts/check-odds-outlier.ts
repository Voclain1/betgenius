/**
 * One bookmaker's wild quote must never become the "best" price.
 *
 * Real case, 17 Nov 2026, Denmark v Norway, Both Teams Score "Yes": Betfair
 * 3.50 against Bet365 1.40, Betano 1.39, 1xBet 1.36, Marathonbet 1.36. The
 * highest quote was shown as "best odds 3.50" and let a pick the market had
 * at ~73% into the 2.2-4.5 Bet of the Day band.
 *
 * Run: npx tsx scripts/check-odds-outlier.ts
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { trimOdds, trustedSelection, findSelection, qualifiesForBetOfDay, affordsBetOfDayPrice, MAX_ODDS, MIN_ODDS, type FixtureOdds, type OddsSelection } from "../src/lib/odds";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`); if (!ok) failed++; };

// ---- the real case, from the raw provider shape -------------------------
const yes: Record<string, number> = { Betfair: 3.5, Bet365: 1.4, Betano: 1.39, "1xBet": 1.36, Marathonbet: 1.36, "William Hill": 1.35, BetVictor: 1.34 };
const no: Record<string, number> = { BetVictor: 3, "1xBet": 2.93, "William Hill": 2.9, Marathonbet: 2.88, Betano: 2.85, Bet365: 2.8, Betfair: 2.75 };
const raw: any = {
  update: new Date().toISOString(),
  bookmakers: Object.keys(yes).map((name) => ({ name, bets: [{ name: "Both Teams Score", values: [{ value: "Yes", odd: String(yes[name]) }, { value: "No", odd: String(no[name]) }] }] })),
};
const trimmed = trimOdds(raw)!;
const ySel = trimmed.markets.find((m) => m.market === "Both Teams Score")!.selections.find((s) => s.value === "Yes")!;
check("trim: the lone 3.50 is not the best price", ySel.best < 1.5, `best ${ySel.best} from ${ySel.bestBookmaker}`);
check("trim: best comes from a real bookmaker in line with the market", ySel.best === 1.4 && ySel.bestBookmaker === "Bet365", JSON.stringify(ySel));
check("trim: the outlier is not kept among the named quotes", !(ySel.quotes ?? []).some((q) => q.bookmaker === "Betfair"));
check("trim: No side is untouched", trimmed.markets[0].selections.find((s) => s.value === "No")!.best === 3);

// ---- a row already in the cache with the old, bad best -------------------
const cachedYes: OddsSelection = { value: "Yes", best: 3.5, median: 1.36, bookmakers: 7, bestBookmaker: "Betfair", quotes: [{ bookmaker: "Betfair", odd: 3.5 }, { bookmaker: "Bet365", odd: 1.4 }, { bookmaker: "Betano", odd: 1.39 }, { bookmaker: "1xBet", odd: 1.36 }, { bookmaker: "Marathonbet", odd: 1.36 }] };
const cachedNo: OddsSelection = { value: "No", best: 3, median: 2.88, bookmakers: 7, bestBookmaker: "BetVictor", quotes: [{ bookmaker: "BetVictor", odd: 3 }, { bookmaker: "1xBet", odd: 2.93 }] };
const cached: FixtureOdds = { bookmakerCount: 10, update: null, markets: [{ market: "Both Teams Score", selections: [cachedYes, cachedNo] }] };

const t = trustedSelection(cachedYes);
check("cached: read-time rule corrects a stored outlier", t.best === 1.4 && t.bestBookmaker === "Bet365", JSON.stringify(t));
check("cached: idempotent", JSON.stringify(trustedSelection(t)) === JSON.stringify(t));
check("cached: findSelection returns the corrected price", findSelection(cached, "Both Teams Score", "Yes")?.best === 1.4);

const gate = qualifiesForBetOfDay({ odds: cached, marketType: "BTTS", selection: { value: "YES" }, confidence: 64 });
check("gate: the Denmark v Norway pick no longer qualifies", gate.qualifies === false, JSON.stringify(gate));
check("gate: it reports the real price (below the floor), not 3.50", gate.price !== null && gate.price < MIN_ODDS && gate.reasons.some((r) => r.includes("floor")), JSON.stringify(gate));
check("gate: nothing near the ceiling is reported", !(gate.price! > MAX_ODDS));
check("targeting: the fixture is not treated as affording a Bet of the Day on BTTS Yes", !affordsBetOfDayPrice({ ...cached, markets: [{ market: "Both Teams Score", selections: [cachedYes] }] }).affords);

// ---- honest prices are left alone ----------------------------------------
const honest: OddsSelection = { value: "Home", best: 2.6, median: 2.4, bookmakers: 8, bestBookmaker: "A", quotes: [{ bookmaker: "A", odd: 2.6 }, { bookmaker: "B", odd: 2.5 }, { bookmaker: "C", odd: 2.4 }] };
check("honest spread (8% over median) is untouched", trustedSelection(honest) === honest);
const wide: OddsSelection = { value: "Home", best: 3.4, median: 2.4, bookmakers: 8, bestBookmaker: "A", quotes: [{ bookmaker: "A", odd: 3.4 }] };
check("a 40% premium over the median is still a real quote", trustedSelection(wide).best === 3.4);
const thin: OddsSelection = { value: "Yes", best: 3.5, median: 1.4, bookmakers: 3, bestBookmaker: "Betfair", quotes: [{ bookmaker: "Betfair", odd: 3.5 }] };
check("too few bookmakers to call an outlier: unchanged (the Bet of the Day gate needs 5 anyway)", trustedSelection(thin) === thin);
const alone: OddsSelection = { value: "Yes", best: 3.5, median: 1.36, bookmakers: 7, bestBookmaker: "Betfair", quotes: [{ bookmaker: "Betfair", odd: 3.5 }] };
check("if every retained quote is an outlier, fall back to the median", trustedSelection(alone).best === 1.36);

// ---- every place that reads a price goes through the rule ----------------
const src = (f: string) => readFileSync(f, "utf8");
check("trimOdds applies the rule when odds are stored", /selections\.push\(trustedSelection\(/.test(src("src/lib/odds.ts")));
check("findSelection applies the rule on read", (src("src/lib/odds.ts").match(/trustedSelection\((exact|line)\)/g) ?? []).length === 2);
check("the targeting affordance applies the rule", /const sel = trustedSelection\(raw\)/.test(src("src/lib/odds.ts")));
check("the match odds panel applies the rule", /m\.selections\.map\(trustedSelection\)/.test(src("src/components/MatchOddsPanel.tsx")));
check("selection quotes apply the rule", /\.map\(\(s\) => trustedSelection\(/.test(src("src/lib/selectionQuote.ts")));
check("handicap lines ignore outlier quotes", /OUTLIER_RATIO/.test(src("src/lib/handicapLine.ts")));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nodds outlier checks passed");
