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
- [x] CI on reviewed head `3ea0856266ff093308caebfbc700da833033d9cd` succeeded (preflight; paid-market-quality unit and disposable PostgreSQL publication jobs). Recheck if this PR changes.
- [ ] Read-only production audit run with a restricted DB role; capture sample counts, quote coverage and validation warnings.
- [ ] Check the actual source and timestamp of every historical entry price. The optional marketConfirmation.entryPrice field is not by itself evidence that an executable quote was frozen at publication.
- [x] Stop labeling generation-model providers as bookmaker providers. Historical bookmaker identity remains unknown; provider segments must not be used for decisions until a bookmaker identifier is actually persisted.
- [ ] Wire safeguards into the real paid-selection flow only after compatibility and shadow-mode verification.
- [x] Implement training-only segment selection and strictly later holdout comparison with regression checks against holdout outcome leakage.
- [ ] Execute this comparison against verified production observations with sufficient samples, settlement timing and price provenance.
- [x] Subscription, Paystack and one-time fallback regression scripts passed in the dedicated workflow. Paid-content redaction is covered by existing preflight checks; manual post-deployment verification remains open.
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

## Publication-time implementation — verified in isolated PostgreSQL

The VIP/Premium auto-publisher now uses a dedicated transaction in `publishPaidPredictionAtomically`. A conditional status update claims the row, then the same transaction writes publication status, an append-only publication-time indicative quote snapshot, and the notification event. Concurrent attempts and retries cannot publish the same row twice. The shared manual-review and Goals publishing function is unchanged.

The `postgres-publication` GitHub Actions job provisions a disposable PostgreSQL 16 service and verifies four concurrent attempts produce one publication and one event, retries do not republish, and missing confirmation rolls back status and notifications. Both it and the existing unit job passed at `3ea0856`.

These tests verify transaction safety, not historical ROI, bookmaker execution, or the safety of turning on value-based selection. The paid-selection mode stays shadow-only. Cleanup after a successful publish remains a separate operation; it must not be misrepresented as part of the atomic publication transaction.

**Remaining operational gates:** run the read-only evidence report using a restricted database role, validate the admin diagnostics page and query performance in the target environment, and verify post-deployment feed counts and access after an explicitly approved release. No production write or deploy is authorized by this document.

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

The pure snapshot tests supplement the dedicated PostgreSQL race/rollback test. Re-run both jobs on any later commit; a green result is required before release.

Do not interpret CI success as proof of a positive ROI or of actual bookmaker execution prices.
