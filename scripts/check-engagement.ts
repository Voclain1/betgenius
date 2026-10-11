/**
 * Field web vitals and engagement events (SEO-109, SEO-502): the page
 * template every event is reported under, the GA4 event shape for each
 * metric, and that no call site sends free text.
 *
 * Run: npx tsx scripts/check-engagement.ts
 */
export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_METRICS, pageTemplate, webVitalEvent } from "../src/lib/engagement";

let failures = 0;
let passed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

console.log("page templates:");
const cases: Array<[string, string]> = [
  ["/", "home"],
  ["/predictions", "predictions_hub"],
  ["/predictions/today", "category_feed"],
  ["/predictions/vip?date=yesterday", "category_feed"],
  ["/predictions/match/arsenal-vs-chelsea-2026-10-12", "match"],
  ["/predictions/league/premier-league", "league"],
  ["/predictions/cup/fa-cup", "cup"],
  ["/predictions/team/arsenal", "team"],
  ["/predictions/h2h/arsenal-vs-chelsea", "h2h"],
  ["/guides", "guides_hub"],
  ["/guides/how-to-read-football-predictions", "guide"],
  ["/track-record", "track_record"],
  ["/pricing", "pricing"],
  ["/methodology", "trust"],
  ["/something-new", "other"],
];
for (const [path, want] of cases) eq(path, pageTemplate(path), want);

console.log("\nweb-vitals events:");
eq("only LCP, INP and CLS are sent", FIELD_METRICS, ["LCP", "INP", "CLS"]);
eq("FCP is not sent", webVitalEvent({ name: "FCP", value: 900, id: "v1" }, "/"), null);
eq("TTFB is not sent", webVitalEvent({ name: "TTFB", value: 120, id: "v1" }, "/"), null);
const lcp = webVitalEvent({ name: "LCP", value: 2310.4, delta: 2310.4, id: "v1-1", rating: "good" }, "/predictions/match/a-vs-b-2026-10-12");
eq("LCP: named after the metric, integer value, template and rating", lcp, {
  name: "LCP",
  params: { value: 2310, metric_value: 2310.4, metric_id: "v1-1", metric_rating: "good", page_template: "match", non_interaction: true },
});
const cls = webVitalEvent({ name: "CLS", value: 0.123, delta: 0.05, id: "v1-2", rating: "needs-improvement" }, "/");
eq("CLS: the delta scaled by 1000 so GA4 can sum it", cls?.params.value, 50);
eq("INP rating passes through", webVitalEvent({ name: "INP", value: 320, id: "v1-3", rating: "poor" }, "/")?.params.metric_rating, "poor");

console.log("\nwiring and privacy:");
check("WebVitals is mounted in the root layout", src("src/app/layout.tsx").includes("<WebVitals />"));
const sites = [
  "src/components/ReasoningExcerpt.tsx",
  "src/components/PredictionViewSwitch.tsx",
  "src/components/FeedResults.tsx",
].map(src).join("\n");
const calls = sites.match(/trackEngagement\([^)]*\)/g) ?? [];
check("four engagement call sites", calls.length === 4, String(calls.length));
check("call sites send only fixed keys (no team, user or free text)", calls.every((c) => !/homeTeam|awayTeam|pick|email|name:|user/i.test(c)), calls.join(" | "));

console.log(`\n${passed} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log("All engagement checks passed.");
