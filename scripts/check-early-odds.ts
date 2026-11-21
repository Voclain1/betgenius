/**
 * Provider-free regression checks for the 14-day early FREE odds lifecycle.
 * Run npx tsx scripts/check-early-odds.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FixtureOdds } from "../src/lib/odds";
import { earlyOddsBand, earlyOddsRefreshDue, earlyQuotedSelection,
  earlyFixturePricedForGeneration } from "../src/lib/generation/earlyOddsPolicy";
import { earlyOddsFloorCrossing, oddsMovementSignal } from "../src/lib/reassessment/evidence";
import { classifyEarlyDisposition, EARLY_HOLD_UNTIL_HOURS } from "../src/lib/generation/earlyTriage";

const now = new Date("2026-11-20T12:00:00Z");
const HOUR = 3_600_000;
const ahead = (days: number) => new Date(now.getTime() + days * 24 * HOUR);
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
const makeOdds = (price: number, books: number, updated = ago(1).toISOString()): FixtureOdds => ({
  update: updated, bookmakerCount: books,
  markets: [{ market: "Match Winner", selections: [
    { value: "Home", median: price, best: price + 0.02,
      bookmakers: books, bestBookmaker: "Example bookmaker" },
  ] }],
});
const selection = { value: "HOME" };
const priced = (days: number, price = 1.34, books = 5, updated = ago(1).toISOString()) =>
  earlyQuotedSelection({ odds: makeOdds(price, books, updated),
    fetchedAt: now, kickoff: ahead(days), now, marketType: "MATCH_WINNER", selection });

assert.equal(earlyOddsBand(ahead(12), now).minBooks, 3);
assert.equal(earlyOddsBand(ahead(6), now).minBooks, 4);
assert.equal(earlyOddsBand(ahead(2.5), now).minBooks, 5);
assert.equal(earlyOddsBand(ahead(12), now).maxQuoteAgeMs, 24 * HOUR);
assert.equal(priced(14, 1.34, 3).ok, true, "verified early core fixture is eligible");
assert.equal(priced(10, 1.34, 2).ok, false, "two early bookmakers are too thin");
assert.equal(priced(6, 1.34, 3).ok, false, "4–7 days requires four books");
assert.equal(priced(6, 1.34, 4).ok, true);
assert.equal(priced(2.5, 1.34, 4).ok, false, "near kickoff requires five books");
assert.equal(priced(2.5, 1.34, 5).ok, true);
assert.equal(priced(12, 1.11, 3).ok, false, "below 1.12 held");
assert.equal(priced(12, 1.12, 3).ok, true, "1.12 inclusive floor");
assert.equal(priced(12, 1.34, 3, ago(25).toISOString()).ok, false, "old provider quote rejected");
assert.equal(priced(6, 1.34, 4, ago(13).toISOString()).ok, false, "mid-range stale provider quote rejected");
assert.equal(priced(14.1, 1.34, 5).ok, false, "beyond 14 days not published automatically");
assert.equal(earlyQuotedSelection({ odds: makeOdds(1.30, 5), fetchedAt: now,
  now, kickoff: ahead(5), marketType: "MATCH_WINNER",
  selection: { value: "AWAY" } }).ok, false, "wrong selection is not a verified price");
assert.equal(earlyQuotedSelection({ odds: { ...makeOdds(1.30, 5), update: null },
  fetchedAt: now, now, kickoff: ahead(5), marketType: "MATCH_WINNER", selection }).ok, false,
  "unknown provider timestamp cannot masquerade as fresh");

assert.equal(earlyFixturePricedForGeneration({
  odds: makeOdds(1.13, 3), fetchedAt: now, kickoff: ahead(12), now,
}), true);
assert.equal(earlyFixturePricedForGeneration({
  odds: makeOdds(1.11, 3), fetchedAt: now, kickoff: ahead(12), now,
}), false, "don't consume inference for an unpayably short fixture");
assert.equal(earlyFixturePricedForGeneration({
  odds: makeOdds(1.34, 2), fetchedAt: now, kickoff: ahead(12), now,
}), false, "too-thin markets remain queued");
assert.equal(earlyOddsRefreshDue({
  kickoff: ahead(12), now, fetchedAt: ago(13), lastAttemptAt: ago(13),
}), true);
assert.equal(earlyOddsRefreshDue({
  kickoff: ahead(12), now, fetchedAt: ago(3), lastAttemptAt: ago(3),
}), false);
assert.equal(earlyOddsRefreshDue({
  kickoff: ahead(12), now, fetchedAt: null, lastAttemptAt: ago(2),
}), false, "empty-market retry backs off");
assert.equal(earlyOddsRefreshDue({
  kickoff: ahead(12), now, fetchedAt: null, lastAttemptAt: ago(13),
}), true, "retry later when quotes may open");
assert.equal(earlyOddsRefreshDue({
  kickoff: ahead(1), now, fetchedAt: null, lastAttemptAt: null,
}), false, "existing near-kickoff workflow remains separate");

const old = { median: 1.30, bookmakers: 3, at: ago(24) };
const moved = { median: 1.10, bookmakers: 3, at: ago(1) };
assert.equal(oddsMovementSignal(old, moved, now, ahead(12))[0]?.source, "odds",
  "three-book early quotes can flag a meaningful move");
assert.equal(earlyOddsFloorCrossing(old, moved, now, ahead(12))[0]?.severity, "MODERATE",
  "drop below 1.12 is material even when the price moves only slightly");
assert.equal(earlyOddsFloorCrossing(old, { ...moved, bookmakers: 2 }, now, ahead(12)).length, 0,
  "thin quotes cannot place a live hold");

const warm = readFileSync("src/lib/generation/earlyOdds.ts", "utf8");
const earlyRun = readFileSync("src/lib/generation/earlyGeneration.ts", "utf8");
const publish = readFileSync("src/lib/generation/earlyPublication.ts", "utf8");
const publisher = readFileSync("src/lib/predictions.ts", "utf8");
const monitor = readFileSync("src/lib/reassessment/worker.ts", "utf8");
const cron = readFileSync("deploy/ops/crontab", "utf8");
assert.ok(warm.includes("MIN_QUOTA_REMAINING = 1_800") && warm.includes("refreshOddsCache("));
assert.ok(earlyRun.includes("earlyFixturePricedForGeneration("));
assert.ok(publish.includes("earlyQuotedSelection(") &&
  publish.includes("publishEarlyFreePredictionAtomically("));
assert.ok(publisher.includes('kind: "EARLY_PUBLICATION_PRICE"') &&
  publisher.includes("tx.predictionRevision.create(") &&
  publisher.includes("tx.predictionReassessment.upsert(") &&
  publisher.includes("await recordPredictionEvents(tx, locked, updated"));
assert.ok(monitor.includes("14 * 86_400_000") &&
  monitor.includes("earlyOddsFloorCrossing("));
assert.ok(cron.includes("/api/admin/generate/early-odds?limit=10"));
assert.ok(cron.includes("/api/admin/generate/early-discover?batch=12"));
assert.ok(cron.includes("/api/admin/generate/early-run?limit=8"));
assert.ok(cron.includes("/api/admin/generate/early-publish?limit=16"));
const triage = (confidence: number, leadHours: number, evidenceCredible: boolean,
  autoEligible: boolean, pricedExactSelection: boolean) => classifyEarlyDisposition({
    confidence, leadHours, evidenceCredible, autoEligible, pricedExactSelection,
  });
assert.equal(EARLY_HOLD_UNTIL_HOURS, 72);
assert.equal(triage(72, 180, true, true, true), "auto", "fully qualified priced early tip is automatic");
assert.equal(triage(72, 180, true, true, false), "review", "credible unpriced prediction goes to admin");
assert.equal(triage(68, 180, true, false, false), "review", "near confidence with no price goes to admin");
assert.equal(triage(57, 180, false, false, false), "hold", "weak far-ahead fixture stays held");
assert.equal(triage(57, 70, false, false, false), "review", "weak hold reaches human review inside 72h");
assert.equal(triage(80, 180, true, false, true), "review", "a quote never bypasses the evidence gate");
assert.ok(earlyRun.includes("const chosen = [...priced, ...unpriced].slice(0, limit)") &&
  !earlyRun.includes('skipped: "opening bookmaker prices not yet sufficiently verified"'),
  "unpriced early fixtures also reach generation");
assert.ok(publish.includes('status: "DRAFT"') && publish.includes('kind: desired === "DRAFT" ? "EARLY_HOLD"') &&
  publish.includes('kind: "EARLY_HOLD"') && publish.includes('status: "PENDING_REVIEW"'),
  "low-credibility holds are durable and later rejoin ordinary admin review");
assert.ok(publisher.includes("publishPaidPredictionAtomically("),
  "paid atomic publication stays independent");
console.log("PASS: early odds, quote-independent generation, recoverable holds, review and atomic price-verified publication");
