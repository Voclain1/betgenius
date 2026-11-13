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
- [x] Implement training-only segment selection and strictly later holdout comparison with regression checks against holdout outcome leakage.\n- [ ] Execute this comparison against verified production observations with sufficient samples, settlement timing and price provenance.
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
