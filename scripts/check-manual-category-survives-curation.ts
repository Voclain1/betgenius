/**
 * An admin's hand-assigned category tag must survive automatic curation.
 *
 * Curation re-ranks GENIUS / VIP / PREMIUM / BANKER on every run and removes
 * any tag it did not choose itself, so a tag an admin added by hand used to be
 * gone by the next run. PredictionCategoryLink.manual marks such tags and
 * curation treats them as fixed points.
 *
 * Run: npx tsx scripts/check-manual-category-survives-curation.ts
 */
export {};
const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { planCuration, planBankerCuration, type CurationRow } from "../src/lib/geniusCuration";
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };

const kickoff = new Date(Date.now() + 20 * 3_600_000);
const row = (id: string, fixture: number, over: Partial<CurationRow> = {}): CurationRow => ({
  id, leagueApiId: 39, confidence: 60, provenance: "STANDARD_CURATED", status: "PUBLISHED", marketType: "MATCH_WINNER",
  createdAt: new Date(Date.now() - 3_600_000), kickoff, fixtureApiId: fixture, homeTeamApiId: fixture * 2, awayTeamApiId: fixture * 2 + 1,
  categories: ["TODAY"], ...over,
} as CurationRow);

for (const category of ["VIP", "PREMIUM", "GENIUS"] as const) {
  // A low-confidence pick an admin tagged by hand: curation would otherwise drop it.
  const hand = row("hand", 1, { categories: ["TODAY", category], manualCategories: [category] });
  const auto = row("auto", 2, { categories: ["TODAY", category] });
  const plan = planCuration(category, [hand, auto]);
  check(`${category}: a hand-assigned tag is not removed`, !plan.removed.includes("hand") && plan.selectedIds.includes("hand"));
  check(`${category}: an automatic tag that fails the bar still is removed`, plan.removed.includes("auto"));
}

const handBanker = row("hb", 3, { categories: ["TODAY", "BANKER"], manualCategories: ["BANKER"] });
const autoBanker = row("ab", 4, { categories: ["TODAY", "BANKER"] });
const bp = planBankerCuration([handBanker, autoBanker], new Date());
check("BANKER: a hand-assigned tag is not removed", !bp.removed.includes("hb"));
check("BANKER: an automatic tag below the floor is removed", bp.removed.includes("ab"));

// The writer and the dedup step must carry the flag.
const preds = readFileSync("src/lib/predictions.ts", "utf8");
check("setPredictionCategories stores manual on the links it creates", /manual: isManual\(category\)/.test(preds));
check("an automatic rewrite keeps existing manual flags", /heldManual\.has\(category\)/.test(preds));
check("only tags the admin ADDS become manual", /!heldAll\.has\(category\)/.test(preds));
for (const f of ["src/app/api/admin/predictions/[id]/route.ts", "src/app/api/admin/predictions/bulk/route.ts", "src/app/api/admin/predictions/route.ts"]) {
  check(`${f} saves with manual: true`, /manual: true/.test(readFileSync(f, "utf8")));
}
check("the dedicated-pick dedup never deletes a manual paid tag", /manual: false/.test(readFileSync("src/lib/vipPremiumPipeline.ts", "utf8")));

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
