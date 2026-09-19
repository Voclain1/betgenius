/**
 * The VIP/PREMIUM daily quota rule, proved against controlled counts.
 *
 * WHY THIS EXISTS SEPARATELY. The quota used to be checkable only through
 * vipPremiumQuotaRemaining(), which counts today's real AIJobs — so the one
 * assertion guarding it compared against live production state and failed
 * legitimately on any day the pass had already generated. That is a broken
 * check, not a broken quota: the rule itself is fixed arithmetic that must hold
 * for every input, and the count is a separate question.
 *
 * So the count is supplied here rather than read. Nothing in this file touches
 * the database, the network or today's date, and it asserts the four things the
 * quota has to get right:
 *
 *   - the day's ceiling is enforced, and never exceeded or negative;
 *   - remaining is computed correctly from a known count;
 *   - an exhausted quota stands generation down, through the real reservation
 *     path rather than a restatement of the rule;
 *   - remaining quota still permits it.
 *
 * The stand-down cases run the real reservePaidTierFixtures with the counter
 * stubbed, so what is under test is production's own decision, taken against a
 * count this file chose.
 *
 * Run: npx tsx scripts/check-vip-premium-quota.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(String(got).slice(0, 300))}`}`);
};

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}

// The reservation path writes through prisma; capture the writes instead.
let created: any[] = [];
stub("../src/lib/prisma", {
  prisma: {
    generationAttempt: {
      createMany: (args: any) => {
        created.push(args);
        return Promise.resolve({ count: args.data.length });
      },
    },
  },
});

const pipeline = require("../src/lib/vipPremiumPipeline");
const { VIP_PREMIUM_DAILY_QUOTA, vipPremiumQuotaFrom, vipPremiumQuotaExhausted } = pipeline;

/**
 * The real module with only the counter replaced, installed ONCE.
 *
 * reservePaidTierFixtures reaches it through a dynamic import, which caches the
 * module the first time it resolves — so swapping the stub between cases would
 * silently keep serving the first count, and every later case would assert
 * against the wrong number. The count is therefore a mutable binding the stub
 * reads per call, and `withGeneratedToday` only moves that binding.
 */
let generatedToday = 0;
stub("../src/lib/vipPremiumPipeline", { ...pipeline, vipPremiumGeneratedToday: () => Promise.resolve(generatedToday) });
function withGeneratedToday(count: number) {
  generatedToday = count;
}

const { reservePaidTierFixtures, PAID_TIER_GRACE_MS } = require("../src/lib/generation/paidTierGrace");
const { VIP_PROXY_LEAGUE_IDS } = require("../src/lib/ai/generationRisk");

const NOW = new Date("2026-03-04T09:00:00.000Z");

/** One fixture the paid pass could genuinely take: paid-tier league, inside its window, new to the ledger. */
function candidate(matchKey: string) {
  return {
    matchKey,
    fixtureApiId: 1,
    leagueApiId: VIP_PROXY_LEAGUE_IDS[0],
    leagueName: "Premier League",
    homeTeam: "A",
    awayTeam: "B",
    homeTeamApiId: 1,
    awayTeamApiId: 2,
    kickoff: new Date(NOW.getTime() + 24 * 3_600_000),
    round: null,
    isNewToLedger: true,
  };
}

async function main() {
  // -------------------------------------------------------------------------
  // The ceiling itself.
  // -------------------------------------------------------------------------
  check("the daily quota is a positive whole number", Number.isInteger(VIP_PREMIUM_DAILY_QUOTA) && VIP_PREMIUM_DAILY_QUOTA > 0, VIP_PREMIUM_DAILY_QUOTA);

  // -------------------------------------------------------------------------
  // Remaining, from a controlled count. Every input, not a sampled one.
  // -------------------------------------------------------------------------
  check("nothing generated leaves the full quota", vipPremiumQuotaFrom(0) === VIP_PREMIUM_DAILY_QUOTA, vipPremiumQuotaFrom(0));
  check("one generated leaves one fewer", vipPremiumQuotaFrom(1) === VIP_PREMIUM_DAILY_QUOTA - 1, vipPremiumQuotaFrom(1));
  check("the last slot leaves exactly one", vipPremiumQuotaFrom(VIP_PREMIUM_DAILY_QUOTA - 1) === 1);
  check("a spent quota leaves nothing", vipPremiumQuotaFrom(VIP_PREMIUM_DAILY_QUOTA) === 0);

  let arithmetic = true;
  for (let n = 0; n <= VIP_PREMIUM_DAILY_QUOTA; n++) if (vipPremiumQuotaFrom(n) !== VIP_PREMIUM_DAILY_QUOTA - n) arithmetic = false;
  check("remaining is the ceiling minus the count, for every count up to it", arithmetic);

  let clamped = true;
  for (let n = VIP_PREMIUM_DAILY_QUOTA; n <= VIP_PREMIUM_DAILY_QUOTA + 5; n++) if (vipPremiumQuotaFrom(n) !== 0) clamped = false;
  check("overshooting the quota never reports negative remaining", clamped, vipPremiumQuotaFrom(VIP_PREMIUM_DAILY_QUOTA + 3));

  // -------------------------------------------------------------------------
  // The two live call sites phrase the stand-down differently. They must agree.
  // -------------------------------------------------------------------------
  let agree = true;
  for (let n = 0; n <= VIP_PREMIUM_DAILY_QUOTA + 3; n++) if (vipPremiumQuotaExhausted(n) !== (vipPremiumQuotaFrom(n) <= 0)) agree = false;
  check("\"exhausted\" and \"no remaining\" are the same condition at every count", agree);
  check("the quota is not exhausted with one slot left", vipPremiumQuotaExhausted(VIP_PREMIUM_DAILY_QUOTA - 1) === false);
  check("the quota is exhausted exactly at the ceiling", vipPremiumQuotaExhausted(VIP_PREMIUM_DAILY_QUOTA) === true);
  check("the quota stays exhausted beyond the ceiling", vipPremiumQuotaExhausted(VIP_PREMIUM_DAILY_QUOTA + 1) === true);

  // -------------------------------------------------------------------------
  // Exhausted stands generation down — through the real reservation path.
  // -------------------------------------------------------------------------
  created = [];
  withGeneratedToday(VIP_PREMIUM_DAILY_QUOTA);
  const standDown = await reservePaidTierFixtures([candidate("k1"), candidate("k2")], NOW);
  check("a spent quota reserves nothing", standDown.size === 0, String(standDown.size));
  check("...and writes no ledger rows", created.length === 0, JSON.stringify(created).slice(0, 120));

  created = [];
  withGeneratedToday(VIP_PREMIUM_DAILY_QUOTA + 2);
  const overspent = await reservePaidTierFixtures([candidate("k3")], NOW);
  check("an overshot quota also stands down", overspent.size === 0 && created.length === 0);

  // -------------------------------------------------------------------------
  // Remaining quota permits it.
  // -------------------------------------------------------------------------
  created = [];
  withGeneratedToday(VIP_PREMIUM_DAILY_QUOTA - 1);
  const permitted = await reservePaidTierFixtures([candidate("k4"), candidate("k5")], NOW);
  check("the last slot still permits reservation", permitted.size === 2, String(permitted.size));
  check("...and the ledger rows are written", created.length === 1 && created[0].data.length === 2, String(created.length));
  check("...as PENDING, inside the grace window", created[0]?.data[0]?.status === "PENDING" && created[0]?.data[0]?.nextAttemptAt.getTime() === NOW.getTime() + PAID_TIER_GRACE_MS);

  created = [];
  withGeneratedToday(0);
  const fresh = await reservePaidTierFixtures([candidate("k6")], NOW);
  check("an untouched quota permits reservation", fresh.size === 1 && created.length === 1);

  // -------------------------------------------------------------------------
  // The rule stays in one place. A call site that re-derives it can drift from
  // the rule these assertions cover, so neither may restate the comparison.
  // -------------------------------------------------------------------------
  const root = join(__dirname, "..");
  const grace = readFileSync(join(root, "src/lib/generation/paidTierGrace.ts"), "utf8");
  check("the reservation path consults the shared rule", grace.includes("vipPremiumQuotaExhausted("), "not found in paidTierGrace.ts");
  check("...rather than re-deriving the ceiling", !/>=\s*VIP_PREMIUM_DAILY_QUOTA/.test(grace));

  const route = readFileSync(join(root, "src/app/api/admin/generate/run/route.ts"), "utf8");
  check("the generation route stands down on the shared remaining figure", /vipPremiumQuotaRemaining\(\)/.test(route) && /remaining <= 0/.test(route));
  check("...and does not compute remaining itself", !/Math\.max\(0,\s*VIP_PREMIUM_DAILY_QUOTA/.test(route));

  const pipelineSource = readFileSync(join(root, "src/lib/vipPremiumPipeline.ts"), "utf8");
  check("the live count is read in exactly one place", (pipelineSource.match(/export async function vipPremiumGeneratedToday/g) ?? []).length === 1);

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("VIP/PREMIUM quota checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
