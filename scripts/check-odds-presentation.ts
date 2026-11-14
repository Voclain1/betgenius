/**
 * Sprint 05 — how an existing price is written (pure, no DB, no network).
 *
 * Proves the formatter keeps BetGenius's decimal convention and never turns a
 * missing or broken price into a number, and that the odds surfaces changed in
 * this sprint stay presentation-only:
 *   - valid prices keep two decimals, exactly toFixed(2) (no new rounding);
 *   - missing, non-numeric, ≤ 1, NaN and infinite prices are all "unavailable";
 *   - the changed components no longer print a raw `.toFixed(2)` price, and no
 *     longer claim "Price now" / "Closing price" / "best available prices";
 *   - none of them imports a data, odds-engine, generation or settlement module.
 *
 * Run: npx tsx scripts/check-odds-presentation.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validOdds, formatOdds } from "../src/lib/oddsFormat";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

console.log("\nvalid prices keep the existing convention");
for (const v of [1.01, 1.5, 1.85, 2, 3.333, 10, 18.4, 250.005]) check(`${v} → ${v.toFixed(2)}`, formatOdds(v) === v.toFixed(2) && validOdds(v) === v);
check("two decimals even for round prices", formatOdds(2) === "2.00" && formatOdds(1.5) === "1.50");
check("the value is never altered, only written", validOdds(1.8549) === 1.8549);

console.log("\nunavailable, never a made-up number");
for (const [label, v] of [["null", null], ["undefined", undefined], ["0", 0], ["1 (pays nothing)", 1], ["0.5", 0.5], ["negative", -2.1], ["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["numeric string", "1.85"], ["object", {}], ["boolean", true]] as const) {
  check(`${label} → unavailable`, validOdds(v) === null && formatOdds(v) === null);
}

console.log("\nthe changed surfaces");
const root = join(__dirname, "..");
const src = (f: string) => readFileSync(join(root, f), "utf8");
const CHANGED = [
  "src/components/OddsFigure.tsx", "src/components/PredictionCard.tsx", "src/components/ComboCard.tsx", "src/components/TrendCard.tsx",
  "src/components/BetOfTheDayCard.tsx", "src/components/personal/DashboardParts.tsx", "src/lib/oddsFormat.ts",
];
for (const f of ["src/components/ComboCard.tsx", "src/components/TrendCard.tsx", "src/components/personal/DashboardParts.tsx", "src/components/BetOfTheDayCard.tsx"]) {
  check(`${f}: no raw price.toFixed(2) left`, !/(odds|price)\)?\.toFixed\(2\)|\.odds as number\)\.toFixed/.test(src(f)));
}
check("PredictionCard: paid price goes through OddsFigure", /<OddsFigure value=\{paid\.price\.odds\}/.test(src("src/components/PredictionCard.tsx")));
check("PredictionCard: no 'Price now' or 'Closing price' claim", !/Price now|Closing price/.test(src("src/components/PredictionCard.tsx")));
check("PredictionCard: quote labels say what the data is", /current: "Latest quote"/.test(src("src/components/PredictionCard.tsx")) && /closing: "Last quote before kickoff"/.test(src("src/components/PredictionCard.tsx")) && /entry: "Price when published"/.test(src("src/components/PredictionCard.tsx")));
check("ComboCard: no 'best available prices' claim for build-time prices", !/best available prices/.test(src("src/components/ComboCard.tsx")) && /prices when this multi bet was built/.test(src("src/components/ComboCard.tsx")));
check("saved rows say the price is the one saved", /tail="when saved"/.test(src("src/components/personal/DashboardParts.tsx")));
check("no 'live' or 'now' claim was added to an odds label", CHANGED.every((f) => !/(odds|price|quote)[^\n]{0,40}\b(live now|right now)\b/i.test(src(f))));
check("no changed file says AI in user-facing text", CHANGED.every((f) => !/>[^<]*\bAI\b[^<]*</.test(src(f))));

console.log("\nboundary with the odds engine and the reliability workstream");
const DENY = /prisma|lib\/odds["']|oddsRefresh|matchOdds|marketConfirmed|paidFeedData|accumulatorTiers|generation|settle|entitlement|predictionDiscovery|PredictionDiscovery|PublishedMarketComparison|selectionQuote|predictionVisibility/;
for (const f of CHANGED) {
  const imports = [...src(f).matchAll(/^import (?!type ).* from "([^"]+)"/gm)].map((m) => m[1]);
  check(`${f}: no data/odds-engine/discovery import`, imports.every((i) => !DENY.test(i)), imports.filter((i) => DENY.test(i)).join());
}
check("oddsFormat and OddsFigure are client-safe: no database or server imports", !/prisma|next\/headers|server-only/.test(src("src/lib/oddsFormat.ts") + src("src/components/OddsFigure.tsx")));
check("OddsFigure adds no client JavaScript", !/^["']use client["']/m.test(src("src/components/OddsFigure.tsx")));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
