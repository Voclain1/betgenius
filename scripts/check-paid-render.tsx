/**
 * The subscriber-facing VIP / Premium UI, rendered to HTML and checked.
 *
 *   - A paid card shows status, price with its provenance, publication time and
 *     the selection reason; a locked card shows none of them.
 *   - No internal assessment field (expected value, calibration, provider)
 *     reaches the markup, the badge included.
 *   - The performance panel renders the record, keeps recorded and closing
 *     prices apart, says when a return is not yet shown, renders a negative
 *     return as negative, and contains no "AI" wording.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.render.json scripts/check-paid-render.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./lib/reactCacheShim";
import { PredictionCard } from "../src/components/PredictionCard";
import { PaidPerformancePanel, PaidFeedIntro } from "../src/components/PaidPerformancePanel";
import { computePaidPerformance } from "../src/lib/paidPerformance";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${String(got).slice(0, 300)}`}`);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const NOW = new Date("2026-11-14T12:00:00.000Z");
const base = {
  id: "p1", category: "VIP", market: "Match Winner", pick: "Arsenal to win", marketType: "MATCH_WINNER", confidence: 78,
  reasoning: "Arsenal have the stronger form.", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueName: "Premier League", leagueApiId: 39,
  kickoff: new Date(NOW.getTime() + 5 * 3_600_000),
  marketConfirmation: { modelProbability: 78, marketProbability: 80, gapPP: 2, bookmakers: 9, market: "Match Winner", value: "Home", quoteFetchedAt: null, valueAssessment: { expectedValue: 0.0412, expectedValueLower: -0.02 }, calibrationVersion: "cal-20261113-1", provider: "anthropic", entryPrice: 1.38 } as any,
  paid: { status: "UPCOMING" as const, statusLabel: "Upcoming", price: { odds: 1.38, bookmakers: 9, kind: "entry" as const, at: "2026-11-13T10:00:00Z" }, publishedAt: "2026-11-13T10:00:00Z", reason: "Picked for VIP: our analysis rates it 78% and the bookmakers' prices imply 80% — two independent reads that agree." },
};

const paidHtml = renderToStaticMarkup(<PredictionCard p={base as any} />);
const paidText = text(paidHtml);
check("card: shows the status", paidText.includes("Upcoming"), paidText);
check("card: shows the price with its provenance", paidText.includes("Price when published") && paidText.includes("1.38") && paidText.includes("median of 9 books"), paidText);
check("card: shows the publication time in WAT", /Published\s+\S+ \d{2}:\d{2} WAT/.test(paidText), paidText);
check("card: shows why the pick is there", paidText.includes("two independent reads that agree"));
for (const leak of ["expectedValue", "0.0412", "valueAssessment", "calibrationVersion", "cal-20261113", "anthropic", "entryPrice"]) {
  check(`card: no internal field in the markup (${leak})`, !paidHtml.includes(leak));
}
const lockedHtml = renderToStaticMarkup(<PredictionCard p={{ ...base, pick: "LOCKED", reasoning: "Subscribe to unlock this prediction.", confidence: null, locked: true, paid: null, marketConfirmation: null } as any} />);
check("card: a locked card shows no status, price or reason", !/Price when published|Upcoming|independent reads/.test(text(lockedHtml)));
check("card: a locked card shows no pick", !text(lockedHtml).includes("Arsenal to win"));

const rows = [...Array(25)].map((_, i) => ({ id: `w${i}`, kickoff: new Date(NOW.getTime() - (i + 1) * 3_600_000), marketType: "DOUBLE_CHANCE", market: "Double Chance", pick: "Arsenal or Draw", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueName: "Premier League", outcome: "WON", entryPrice: null, closingPrice: 1.2 }))
  .concat([...Array(9)].map((_, i) => ({ id: `l${i}`, kickoff: new Date(NOW.getTime() - (50 + i) * 3_600_000), marketType: "DOUBLE_CHANCE", market: "Double Chance", pick: "Arsenal or Draw", homeTeam: "Arsenal", awayTeam: "Chelsea", leagueName: "Premier League", outcome: "LOST", entryPrice: null, closingPrice: 1.2 })));
const perf = computePaidPerformance(rows, "2026-10-03", NOW);
const panel = text(renderToStaticMarkup(<PaidPerformancePanel tier="VIP" perf={perf} />));
check("panel: headline record", panel.includes("VIP record since 3 October 2026") && panel.includes("Win rate") && panel.includes("73.5%"), panel.slice(0, 400));
check("panel: entry return not yet shown, with the reason", panel.includes("Shown once 30 settled picks carry a recorded price (0 so far)"));
check("panel: closing return shown, negative as negative", /Return at closing prices\s+−\d/.test(panel), panel);
check("panel: closing prices labelled as not the price you got", panel.includes("not necessarily the price you got"));
check("panel: market table appears at 30+ settled", panel.includes("Double chance"));
check("panel: latest settled list", panel.includes("Latest settled") && panel.includes("Arsenal v Chelsea"));
check("panel: no AI wording", !/\bAI\b/.test(panel));
const intro = text(renderToStaticMarkup(<PaidFeedIntro tier="Premium" />));
check("intro: confidence is an estimate, not a guarantee", intro.includes("not a guarantee") && !/\bAI\b/.test(intro));

console.log(`\n  ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) process.exit(1);
console.log("Paid render checks passed");
