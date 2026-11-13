import assert from "node:assert/strict";
import { auditPaidQuoteEvidence, verifiedEntryPrice } from "../src/lib/paidEntryEvidence";
const kickoff = new Date("2026-11-13T17:00:00Z");
const good = { entryPrice: 1.88, quoteFetchedAt: "2026-11-13T15:00:00Z", confirmedAt: "2026-11-13T15:05:00Z" };
assert.equal(verifiedEntryPrice(good, kickoff), 1.88);
assert.equal(verifiedEntryPrice({ ...good, quoteFetchedAt: null }, kickoff), null);
assert.equal(verifiedEntryPrice({ ...good, confirmedAt: "2026-11-13T18:00:00Z" }, kickoff), null);
assert.equal(verifiedEntryPrice({ ...good, quoteFetchedAt: "2026-11-13T16:00:00Z", confirmedAt: "2026-11-13T15:05:00Z" }, kickoff), null);
assert.equal(verifiedEntryPrice({ ...good, entryPrice: 1 }, kickoff), null);
assert.equal(verifiedEntryPrice({}, kickoff), null);
assert.equal(verifiedEntryPrice({ ...good, quoteFetchedAt: "2026-11-12T08:00:00Z" }, kickoff), null);
assert.equal(verifiedEntryPrice({ ...good, quoteFetchedAt: "2026-11-13T09:04:00Z" }, kickoff), null);
const sourced = { ...good, entryPriceBasis: "BOOKMAKER_MEDIAN_INDICATIVE", entryBookmakers: 6,
  entryQuoteSelection: { market: "Match Winner", value: "Home" },
  entryQuoteSources: [{ bookmaker: "Bookmaker A", odd: 1.9 }] };
assert.equal(auditPaidQuoteEvidence(sourced, kickoff).usable, true);
assert.equal(auditPaidQuoteEvidence({ ...sourced, entryPriceBasis: "DERIVED" }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, entryQuoteSources: [] }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, entryBookmakers: 0 }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, entryQuoteSelection: null }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, confirmedAt: "2026-11-13T18:00:00Z" }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, quoteFetchedAt: "2026-11-12T08:00:00Z" }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...sourced, entryPrice: null }, kickoff).usable, false);

const published = { ...sourced, confirmedAt: "2026-11-13T15:15:00Z" };
const promotionAndPublication = { ...sourced, publicationQuoteEvidence: published };
assert.equal(auditPaidQuoteEvidence(promotionAndPublication, kickoff).usable, true);
assert.equal(auditPaidQuoteEvidence(promotionAndPublication.publicationQuoteEvidence, kickoff).usable, true);
assert.equal(auditPaidQuoteEvidence({ ...published, entryPriceBasis: "UNAVAILABLE" }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...published, entryQuoteSources: [{ bookmaker: "", odd: 1.9 }] }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...published, entryQuoteSources: [{ bookmaker: "Bookmaker A", odd: 0 }] }, kickoff).usable, false);
assert.equal(auditPaidQuoteEvidence({ ...published, confirmedAt: "2026-11-13T17:01:00Z" }, kickoff).usable, false);
console.log("paid entry evidence: all assertions passed");
