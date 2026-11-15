/**
 * VIP/Premium Sprint 11: checks for the production validation audit and the
 * safeguards it added. Pure: no database, no network.
 *
 *   1. Double Chance: the legacy (pre-fix) signal is reproduced exactly; the
 *      fix changes only away Double Chance; home DC and other markets are
 *      unchanged in both label orders.
 *   2. Dry-day first-failure classification, every branch, in pipeline order.
 *   3. Spare-quota run summary: modes, slots, would-be targets deduplicated.
 *   4. Guards found missing by the audit: the production probe reports
 *      PAID_SPARE_QUOTA_WIDENING; the Sprint 11 workflow is read-only and has
 *      no schedule; the audit script makes no provider call and no write; the
 *      alternative-market runner's screen-only mode makes no provider call.
 *
 * Run: npx tsx scripts/check-sprint11-audit.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureOdds, OddsSelection } from "../src/lib/odds";
import { lopsidednessSignal } from "../src/lib/marketConfirmed";
import {
  classifyDryDay, compareDcSignals, legacyLopsidednessSignal, summariseSpareQuotaRuns, wilsonPct, type DryDayInput,
} from "../src/lib/sprint11Audit";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`); }
}
const sel = (value: string, median: number, bookmakers = 6): OddsSelection => ({ value, best: median, median, bookmakers, bestBookmaker: "b" });
function odds(mw: [number, number, number], dc: Array<[string, number]>, extra: FixtureOdds["markets"] = []): FixtureOdds {
  return {
    bookmakerCount: 6, update: null,
    markets: [
      { market: "Match Winner", selections: [sel("Home", mw[0]), sel("Draw", mw[1]), sel("Away", mw[2])] },
      { market: "Double Chance", selections: dc.map(([v, p]) => sel(v, p)) },
      ...extra,
    ],
  };
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

console.log("1. Double Chance fix, legacy reproduction");
{
  // Away favourite, feed label "Draw/Away" (as api-football writes it).
  const away = odds([5.5, 4.2, 1.6], [["Home/Draw", 2.4], ["Draw/Away", 1.13], ["Home/Away", 1.3]]);
  const c = compareDcSignals(away);
  check("away favourite with 'Draw/Away': fixed signal is away Double Chance at 75+", c.fixed?.market === "Double Chance" && c.fixed.value === "Away/Draw" && c.fixed.probability >= 75, c.fixed);
  check("away favourite with 'Draw/Away': legacy signal is not away DC", !(c.legacy?.market === "Double Chance" && c.legacy.value === "Away/Draw"), c.legacy);
  check("away favourite with 'Draw/Away': classified NEWLY_TARGETABLE", c.kind === "NEWLY_TARGETABLE", c.kind);

  // Same fixture, exact 'Away/Draw' label (19 of 1,531 cached quotes): legacy matched it.
  const exact = odds([5.5, 4.2, 1.6], [["Home/Draw", 2.4], ["Away/Draw", 1.13], ["Home/Away", 1.3]]);
  check("exact 'Away/Draw' label: unchanged by the fix", compareDcSignals(exact).kind === "UNCHANGED", compareDcSignals(exact).kind);

  // Home favourite: home Double Chance must be identical under both.
  const home = odds([1.45, 4.5, 7.5], [["Home/Draw", 1.08], ["Draw/Away", 2.9], ["Home/Away", 1.25]]);
  const h = compareDcSignals(home);
  check("home favourite: unchanged", h.kind === "UNCHANGED", h);
  check("home favourite: same headline under both", h.fixed?.value === h.legacy?.value && h.fixed?.probability === h.legacy?.probability);

  // Lowercase / spaced labels both ways.
  const spaced = odds([5.5, 4.2, 1.6], [["Home/Draw", 2.4], [" draw / away ", 1.13]]);
  check("spaced lowercase 'draw / away' still matches under the fix", compareDcSignals(spaced).fixed?.value === "Away/Draw");

  // No Double Chance market at all: both fall back to Match Winner.
  const noDc: FixtureOdds = { bookmakerCount: 6, update: null, markets: [{ market: "Match Winner", selections: [sel("Home", 1.2), sel("Draw", 6), sel("Away", 12)] }] };
  check("no Double Chance market: unchanged (Match Winner)", compareDcSignals(noDc).kind === "UNCHANGED" && compareDcSignals(noDc).fixed?.market === "Match Winner");

  // Away DC stronger but below the bar: no targeting change.
  const weak = odds([3.0, 3.3, 2.4], [["Home/Draw", 1.6], ["Draw/Away", 1.4]]);
  const w = compareDcSignals(weak);
  check("away DC stronger but under 75: not counted as newly targetable", w.kind !== "NEWLY_TARGETABLE", w);

  check("null odds: BOTH_NONE", compareDcSignals(null).kind === "BOTH_NONE");
  check("legacy wrapper equals lopsidednessSignal when no away label differs", JSON.stringify(legacyLopsidednessSignal(home)) === JSON.stringify(lopsidednessSignal(home)));
  check("legacy wrapper does not mutate its input", away.markets[1].selections.length === 3);
}

console.log("2. Dry-day classification (first failing stage)");
{
  const base: DryDayInput = { covered: 10, inPaidScope: 5, pricedInScope: 5, targetable: 3, attempted: 3, drafts: 6, draftsAt75: 2, promoted: 1, published: 0, generationFailures: 0, standDowns: 0 };
  const cases: Array<[Partial<DryDayInput>, string]> = [
    [{ covered: 0 }, "NO_ELIGIBLE_FIXTURES"],
    [{ inPaidScope: 0 }, "OUTSIDE_PAID_SCOPE"],
    [{ pricedInScope: 0 }, "NO_VALID_BOOKMAKER_EVIDENCE"],
    [{ targetable: 0, attempted: 0 }, "TARGETING_EXCLUDED"],
    [{ attempted: 0, standDowns: 2 }, "PROVIDER_OR_QUOTA_LIMITATION"],
    [{ attempted: 0, standDowns: 0 }, "OTHER_VERIFIED"],
    [{ drafts: 0, draftsAt75: 0, generationFailures: 2 }, "GENERATION_FAILURE"],
    [{ draftsAt75: 0 }, "MODEL_CONFIDENCE_BELOW_FLOOR"],
    [{ promoted: 0 }, "MARKET_QUALIFICATION_FAILURE"],
    [{}, "PUBLISHING_FAILURE"],
  ];
  for (const [patch, want] of cases) {
    const got = classifyDryDay({ ...base, ...patch });
    check(`${JSON.stringify(patch)} -> ${want}`, got === want, got);
  }
  check("attempted without being targetable at the close is not TARGETING_EXCLUDED", classifyDryDay({ ...base, targetable: 0 }) === "PUBLISHING_FAILURE");
}

console.log("3. Spare-quota run summary");
{
  const t = (fixture: string, m: number) => ({ fixture, kickoff: "2026-11-16T15:00:00.000Z", leagueApiId: 1, marketProbability: m });
  const s = summariseSpareQuotaRuns([
    { ranAt: new Date(), spare: { mode: "shadow", slots: { "2026-11-16": 2 }, eligible: 3, qualifiedFromCache: 1, wouldTarget: [t("A vs B", 78)] } },
    { ranAt: new Date(), spare: { mode: "shadow", slots: { "2026-11-16": 1 }, eligible: 2, qualifiedFromCache: 1, wouldTarget: [t("A vs B", 80)] } },
    { ranAt: new Date(), spare: null },
  ]);
  check("modes counted, absent included", s.modes.shadow === 2 && s.modes.absent === 1, s.modes);
  check("would-be targets deduplicated by fixture+kickoff", s.wouldTarget.length === 1 && s.wouldTarget[0].runs === 2 && s.wouldTarget[0].maxMarket === 80, s.wouldTarget);
  check("slots per day: maximum seen", s.slotsByDay["2026-11-16"] === 2);
  check("no 'on' mode reported", !s.modes.on);
}

console.log("4. Guards the audit found missing");
{
  const diag = read(".github/workflows/diagnose-generation.yml");
  check("production probe reports PAID_SPARE_QUOTA_WIDENING", /for n in [^\n]*PAID_SPARE_QUOTA_WIDENING/.test(diag));
  check("production probe reports the deployed APP_TAG", /deployed APP_TAG=/.test(diag));
  const wf = read(".github/workflows/sprint11-production-audit.yml");
  check("Sprint 11 workflow has no schedule", !/^\s*schedule:/m.test(wf));
  check("Sprint 11 workflow forces read-only sessions", /default_transaction_read_only=on/.test(wf) && /REQUIRE_READ_ONLY: "1"/.test(wf));
  check("Sprint 11 workflow exports no model key", !/ANTHROPIC_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY/.test(wf));
  const audit = read("scripts/audit-sprint11.ts");
  check("audit script imports no provider or api-football client", !/ai\/providers|ai\/generate|football\/api-football|completeWithFallback/.test(audit));
  check("audit script performs no write", !/prisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(audit));
  check("audit script refuses without a read-only session", /REQUIRE_READ_ONLY !== "1"/.test(audit) && /transaction_read_only !== "on"/.test(audit));
  const runner = read("scripts/run-alt-market-experiment.ts");
  check("alt-market runner has a screen-only mode", /ALT_MARKET_SCREEN_ONLY/.test(runner));
  check("screen-only skips the credential call", /if \(!screenOnly\) try \{\s*const info = await admin\.models\.retrieve/.test(runner));
  const screenReturn = runner.indexOf("if (screenOnly) {");
  check("screen-only returns before the first model request", screenReturn > 0 && screenReturn < runner.indexOf("completeWithFallback(request") && /if \(screenOnly\) \{[\s\S]{0,400}?return;/.test(runner));
  check("a billed run still needs the confirmation string", /!screenOnly && process\.env\.ALT_MARKET_CONFIRM !== "RUN-ALT-MARKET-S10"/.test(runner));
  const alt = read(".github/workflows/alt-market-research.yml");
  check("alt-market workflow offers a screen job without the model key", /screen\)/.test(alt) || /job == 'screen'/.test(alt));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
