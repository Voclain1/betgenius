# VIP Sprint 04 — evidence and release gates

This PR is diagnostic-first. It must not change paid subscription entitlements, reveal paid predictions, or activate an unvalidated market filter.

## What the new analysis does
- Segments settled, published VIP/Premium selections by market, competition, price band, confidence band, and generation-model identifier.
- Computes Wilson 95% win-rate intervals; suppresses ROI when fewer than 30 settled observations have valid entry prices.
- Splits chronologically by kickoff, keeping same-kickoff observations on one side of the split. In-sample ROI is never proof of a deployable edge.
- Reports missing entry prices explicitly. Neither cached post-kickoff prices nor derived market probabilities can substitute for an executable historical entry quote.
- Exposes diagnostic summaries in the existing admin-only Paid Operations page.
- Includes pure candidate-integrity guards for duplicates, contradictory markets, stale prices, imminent kickoffs, invalid odds, and invalid confidence. These guards are NOT wired to production selection yet.

## Verification checklist
- [x] GitHub preflight and dedicated market-quality CI succeeded on earlier commits.
- [ ] CI on final PR head succeeds.
- [ ] Read-only production audit run with a restricted DB role; capture sample counts, quote coverage and validation warnings.
- [ ] Check the actual source and timestamp of every historical entry price. The optional marketConfirmation.entryPrice field is not by itself evidence that an executable quote was frozen at publication.
- [x] Stop labeling generation-model providers as bookmaker providers. Historical bookmaker identity remains unknown; provider segments must not be used for decisions until a bookmaker identifier is actually persisted.
- [ ] Wire safeguards into the real paid-selection flow only after compatibility and shadow-mode verification.
- [x] Implement training-only segment selection and strictly later holdout comparison with regression checks against holdout outcome leakage.
- [ ] Execute this comparison against verified production observations with sufficient samples, settlement timing and price provenance.
- [ ] Verify paid entitlement access, paid-content redaction, and subscription regressions.
- [ ] Verify production performance and query volume of the admin diagnostics page.
- [ ] Record rollback and confirm no live feature flags were activated.

## Running locally

`npm run check:paid-market-quality`

`REQUIRE_READ_ONLY=1 npm run report:paid-market-quality -- 90`

The report requires a PostgreSQL connection whose `SHOW transaction_read_only` returns `on`. Do not use a write-capable production role and do not place credentials in a PR or CI log.

## Decision policy
Never infer a positive expected-value edge from a profitable-looking subgroup, an in-sample result, a missing odds field, or a model-market disagreement. Keep `PAID_SELECTION_MODE=shadow` and value selection disabled until prospective evidence justifies an explicit reviewed rollout. A quiet day is preferable to publishing weak paid picks.

## Rollback
Revert PR #178 to remove the added diagnostics and scripts. Since this PR must not activate new live selection rules, no paid selection mode change or data migration should be required. If that changes before merge, update this section and add a tested rollback procedure.

## Production read-only audit — 13 November 2026

An initial audit was completed in a verified `BEGIN READ ONLY` PostgreSQL transaction on the production VPS. It used the existing database account with transaction read-only mode, **not** a dedicated restricted database role. The stricter restricted-role release checkbox therefore remains open.

- 7,883 total prediction rows in the production database.
- In the last 90 days, 600 **unique** settled published predictions linked to VIP or PREMIUM. Tier counts overlap; do not sum VIP and PREMIUM as unique selections.
- 12 of those 600 have `Prediction.odds`; 103 have `marketConfirmation`; **zero** have `marketConfirmation.entryPrice`.
- Consequently, historical paid ROI cannot be verified. Do not backfill prices from newer quotes or treat win rate as profitability.
- The generation-model provider is not a bookmaker. Only explicit named bookmaker quotes are usable as bookmaker attribution.
- Forward-looking quote evidence records the indicative median, selection, named bookmaker samples, and timestamps when available. This is **not** evidence of a subscriber's actual filled price.

## Publication-time blocker — must resolve before 100/100

The current implementation freezes `marketConfirmation` at **promotion**, while the automatic publisher rechecks a newer quote before publication. The later quote is not yet stored as a separate immutable publication snapshot. A retry may also occur after a previously held publication. Until this is implemented and tested, do **not** describe the promotion quote as a verified publication-time entry price.

Release acceptance requires:
1. Store promotion and publication evidence separately without overwriting either snapshot, including on retries and failed publishes.
2. Record the quote source, selection, named bookmaker, observation time, and missing-evidence reason. Never synthesize a bookmaker fill.
3. Test first publish, stale/missing quote, publish failure, retry, concurrent attempt, and no change to entitlement/redaction.
4. Re-run CI on the final commit; perform a read-only post-deployment evidence check.
5. Keep live selection behavior and paid access unchanged. Any activation of market-based filtering requires separate prospective validation and explicit approval.

## Release verification matrix (must pass before merge)

| Gate | Evidence required |
| --- | --- |
| TypeScript, preflight, market-quality checks | Green on final PR SHA, not an earlier commit |
| Subscription, Paystack entitlement, one-time fallback | Green in dedicated PR workflow on final SHA |
| Publication evidence | First publish writes exactly one snapshot; retry does not replace it |
| Concurrency | Two competing database writers cannot overwrite each other's publication snapshot; verify against isolated PostgreSQL, not only pure unit tests |
| Failure recovery | Failed evidence write cannot misreport a successfully published pick; missing evidence is auditable |
| Content access | FREE/VIP/PREMIUM and expired subscriptions remain correctly gated |
| Operational rollback | Preserve all paid content and subscription records; revert application commit only if needed; never delete historical evidence |
| Post-release | Read-only audit of published paid rows, quote timestamps, missing evidence, publication errors and feed counts |

The pure tests for competing snapshot writers demonstrate the decision policy, **not** a real PostgreSQL concurrency execution. The latter remains an explicit release blocker. The publisher's underlying review transition also needs a dedicated race test before claiming full concurrent-publish safety.

Do not interpret CI success as proof of a positive ROI or of actual bookmaker execution prices.
