import assert from "node:assert/strict";
import { periodBounds, sentenceText, topPerFixture, trendBadge, trendPrice, trendSelection, trendSentence } from "../src/lib/trendCards";
import type { FixtureOdds } from "../src/lib/odds";

const base = { teamName: "Vélez", scope: "ALL" as const, leagueName: null, sampleSize: 6, exact: true };

// --- Sentences read as the badge claims, with "at least" only on unproven runs ---
assert.equal(sentenceText(trendSentence({ ...base, type: "UNBEATEN_STREAK", count: 6 })), "Vélez are unbeaten in 6 consecutive matches");
assert.equal(sentenceText(trendSentence({ ...base, type: "WIN_STREAK", count: 6, exact: false })), "Vélez have won at least 6 matches in a row");
assert.equal(sentenceText(trendSentence({ ...base, type: "WINLESS_STREAK", count: 4, scope: "AWAY" })), "Vélez are without a win in 4 consecutive away matches");
assert.equal(sentenceText(trendSentence({ ...base, type: "OVER_25", count: 8, sampleSize: 10 })), "Over 2.5 goals were scored in 8 of Vélez's last 10 matches");
assert.equal(sentenceText(trendSentence({ ...base, type: "FAILED_TO_SCORE", count: 7, sampleSize: 10, scope: "COMPETITION", leagueName: "Primera División" })), "Vélez failed to score in 7 of their last 10 Primera División matches");
const parts = trendSentence({ ...base, type: "BTTS", count: 9, sampleSize: 10 });
assert.deepEqual(parts.filter((p) => p.figure).map((p) => p.text), ["9", "10"], "every number is marked for emphasis");

// --- Badges ---
assert.deepEqual(trendBadge({ type: "UNBEATEN_STREAK", count: 21, sampleSize: 21, exact: true }), { title: "Unbeaten", figure: "21", tone: "positive" });
assert.equal(trendBadge({ type: "WIN_STREAK", count: 6, sampleSize: 6, exact: false }).figure, "6+", "an unproven run is shown as a minimum");
assert.deepEqual(trendBadge({ type: "WINLESS_STREAK", count: 5, sampleSize: 5, exact: true }), { title: "Winless", figure: "5", tone: "negative" });
assert.equal(trendBadge({ type: "OVER_25", count: 8, sampleSize: 10, exact: true }).figure, "8 of 10");

// --- The bet is the literal claim, from the trend team's side ---
assert.deepEqual(trendSelection("WIN_STREAK", "AWAY"), { market: "Match Winner", value: "Away" });
assert.deepEqual(trendSelection("UNBEATEN_STREAK", "HOME"), { market: "Double Chance", value: "Home/Draw" });
assert.deepEqual(trendSelection("UNBEATEN_STREAK", "AWAY"), { market: "Double Chance", value: "Draw/Away" });
assert.deepEqual(trendSelection("LOSS_STREAK", "HOME"), { market: "Match Winner", value: "Away" }, "a losing run backs the opponent");
assert.deepEqual(trendSelection("WINLESS_STREAK", "HOME"), { market: "Double Chance", value: "Draw/Away" }, "a winless run backs the opponent or the draw");
assert.deepEqual(trendSelection("CLEAN_SHEET", "HOME"), { market: "Both Teams Score", value: "No" });

const odds = (bookmakers: number): FixtureOdds => ({
  bookmakerCount: bookmakers,
  update: null,
  markets: [
    { market: "Match Winner", selections: [{ value: "Home", best: 1.75, median: 1.7, bookmakers, bestBookmaker: "X" }, { value: "Away", best: 4.8, median: 4.5, bookmakers, bestBookmaker: "X" }] },
    { market: "Double Chance", selections: [{ value: "Draw/Away", best: 2.1, median: 2.0, bookmakers, bestBookmaker: "X" }] },
    { market: "Goals Over/Under", selections: [{ value: "Over 2.5", best: 1.9, median: 1.85, bookmakers, bestBookmaker: "X" }] },
  ],
});
assert.deepEqual(trendPrice(odds(8), "WIN_STREAK", "HOME", "Vélez", "Aldosivi"), { label: "Vélez", odds: 1.75 });
assert.deepEqual(trendPrice(odds(8), "WINLESS_STREAK", "HOME", "Vélez", "Aldosivi"), { label: "Aldosivi or draw", odds: 2.1 });
assert.deepEqual(trendPrice(odds(8), "OVER_25", "AWAY", "Vélez", "Aldosivi"), { label: "Over 2.5", odds: 1.9 });
assert.equal(trendPrice(odds(3), "WIN_STREAK", "HOME", "Vélez", "Aldosivi"), null, "a price from too few books is not shown");
assert.equal(trendPrice(odds(8), "BTTS", "HOME", "Vélez", "Aldosivi"), null, "no quote for the exact selection means no price");
assert.equal(trendPrice(null, "WIN_STREAK", "HOME", "Vélez", "Aldosivi"), null);

// --- One card per fixture, strongest first ---
const row = (predictionId: string, strength: number, count = 5, exact = true) => ({ predictionId, strength, evidence: { type: "WIN_STREAK" as const, exact, count, sampleSize: count } });
const top = topPerFixture([row("a", 0.6), row("b", 0.9), row("a", 0.95), row("c", 0.7), row("d", 0.8)], 3);
assert.deepEqual(top.map((r) => [r.predictionId, r.strength]), [["a", 0.95], ["b", 0.9], ["d", 0.8]]);
assert.equal(topPerFixture([row("a", 0.6, 6, false), row("b", 0.6, 6, true)], 1)[0].predictionId, "b", "a proven run outranks an equal unproven one");

// --- Periods in Lagos time ---
const tuesdayNight = new Date("2026-09-15T22:30:00Z"); // Tue 23:30 WAT
assert.equal(periodBounds("today", tuesdayNight).start.toISOString(), "2026-09-14T23:00:00.000Z");
assert.equal(periodBounds("tomorrow", tuesdayNight).start.toISOString(), "2026-09-15T23:00:00.000Z");
assert.deepEqual(Object.values(periodBounds("weekend", tuesdayNight)).map((d) => d.toISOString()), ["2026-09-18T23:00:00.000Z", "2026-09-20T23:00:00.000Z"], "weekend is the coming Saturday and Sunday");
const sunday = new Date("2026-09-20T10:00:00Z");
assert.equal(periodBounds("weekend", sunday).start.toISOString(), "2026-09-18T23:00:00.000Z", "on Sunday the weekend is the current one");

assert.equal(sentenceText(trendSentence({ ...base, teamName: "Stade Rennais", type: "BTTS", count: 9, sampleSize: 10 })), "Both teams scored in 9 of Stade Rennais' last 10 matches");

console.log("trend card checks passed");
