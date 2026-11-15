/**
 * Checks for the supply-funnel first-loss classifier and the funnel script's
 * safety. Pure: no database, no network.
 *
 * Run: npx tsx scripts/check-supply-funnel.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECOVERABLE_CANDIDATES, supplyFirstLoss } from "../src/lib/supplyFunnel";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`); }
}

type In = Parameters<typeof supplyFirstLoss>[0];
const base: In = {
  vip: false, group: "PAID_CORE", inScope: true, priced5: true, closing: 80, attempted: false, draftMax: null,
  promoted: false, published: false, dayQuotaSpent: false, coveredLate: false, ordinaryAt75: false, ordinaryRule: null,
};
const cases: Array<[string, Partial<In>, string]> = [
  ["in VIP", { vip: true }, "VIP"],
  ["promoted and published", { attempted: true, promoted: true, published: true, draftMax: 80 }, "VIP"],
  ["promoted, never published", { attempted: true, promoted: true, draftMax: 80 }, "PROMOTED_NOT_PUBLISHED"],
  ["attempted, draft >= 75 rejected", { attempted: true, draftMax: 78 }, "GATE_REJECTED"],
  ["attempted, drafts < 75", { attempted: true, draftMax: 70 }, "MODEL_BELOW_FLOOR"],
  ["widened, never in scope", { group: "PAID_WIDENED", inScope: false }, "WIDENED_NOT_IN_SCOPE"],
  ["widened, ordinary pick refused by #175", { group: "PAID_WIDENED", inScope: false, ordinaryAt75: true, ordinaryRule: "NOT_VIP_ROUTE" }, "ORDINARY_RULE_REJECTED"],
  ["covered inside 12h", { coveredLate: true }, "COVERED_TOO_LATE"],
  ["no 5-book quote", { priced5: false, closing: null }, "NO_ODDS_IN_SCOPE"],
  ["not lopsided", { closing: 70 }, "MARKET_NOT_LOPSIDED"],
  ["not lopsided, ordinary refused", { closing: 70, ordinaryAt75: true, ordinaryRule: "MODEL_MARKET_DISAGREE" }, "ORDINARY_RULE_REJECTED"],
  ["lopsided, quota spent", { dayQuotaSpent: true }, "QUOTA_SPENT"],
  ["lopsided, quota left, never attempted", {}, "NOT_ATTEMPTED_LOPSIDED"],
];
for (const [name, patch, want] of cases) {
  const got = supplyFirstLoss({ ...base, ...patch });
  check(`${name} -> ${want}`, got === want, got);
}
check("attempt outcome wins over scope (a widened attempt is judged by its result)", supplyFirstLoss({ ...base, group: "PAID_WIDENED", inScope: false, attempted: true, draftMax: 70 }) === "MODEL_BELOW_FLOOR");
check("intentional and scarcity classes are not counted recoverable",
  ["VIP", "WIDENED_NOT_IN_SCOPE", "ORDINARY_RULE_REJECTED", "MARKET_NOT_LOPSIDED", "MODEL_BELOW_FLOOR", "GATE_REJECTED"].every((k) => !RECOVERABLE_CANDIDATES.has(k as never)));

const script = readFileSync(join(__dirname, "measure-supply-funnel.ts"), "utf8");
check("funnel script refuses without a read-only session", /REQUIRE_READ_ONLY !== "1"/.test(script) && /transaction_read_only !== "on"/.test(script));
check("funnel script never writes", !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(script));
check("funnel script calls no provider or api-football", !/ai\/providers|ai\/generate|football\/api-football|refreshOddsCache|completeWithFallback/.test(script));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
