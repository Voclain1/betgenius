# Early prediction engine — wider coverage and recoverable triage (21 November 2026)

## Publication contract (unchanged for paid/normal lanes)

- The dedicated early FREE lane uses the existing 70% Genius confidence floor to qualify for **automatic** publication, plus current fixture identity, credible two-team form/season evidence, valid structured market/selection, exact bookmaker opening quote, quote freshness, minimum bookmaker depth, and the system minimum odds. The atomic publisher rechecks the exact price inside a transaction, with an immutable price receipt.
- Dedicated VIP/Premium, Bet of the Day, Goals, combos and admin-authored rows are never auto-published by the early lane. VIP ~75% and Premium ~80% gates are unchanged.
- Near-qualified early picks (65–69% with credible supporting data) and otherwise credible picks with missing, stale, short-priced, thin or mismatched bookmaker lines go into the **existing PENDING_REVIEW admin queue**. Human publication is an explicit editorial decision, not an automatic odds bypass.
- Weak/incomplete early picks more than **72 hours** before kickoff move into recoverable **DRAFT/early hold** with a private audit revision; they are not deleted or archived. The early publisher rechecks those drafts every scheduled cycle. If they become fully eligible they can be auto-published; if credible/near-qualified they go into admin review; any still held entering the final 72-hour period goes to admin for a deliberate decision, never to automatic publication.
- The 48-hour ordinary generation window continues to be isolated. A held early pick entering the ordinary 48h band goes to human review, not through early auto-publication.
- These holds are distinct from **published-tip reassessment holds** shown in /admin/reassessment; those protect previously published picks against changed evidence.

## Capacity model

- **No fixed per-day or per-league caps** on discovering or queuing early fixtures; all four catalogue tiers are covered on a rotating basis, subject to the existing competition eligibility and strong-club checks.
- Horizons: CORE 14 days, SECONDARY 10 days, FALLBACK 7 days, DEEP_FALLBACK 5 days. Quality filters for selective lower leagues are retained.
- Scheduled discovery, odds warming, generation and publication now run four times per hour, with a short stagger. Each call has a **per-run** batch/time limit and hard provider-quota headroom. Those are production safety measures, not lifetime caps; the queue resumes every cycle. Removing API limits or trying unlimited parallel requests would be unreliable and could consume quota reserved for normal and paid tips.
- Odds warming processes the full active early queue rather than just the first 400 entries, retries unpriced markets on an 8h/4h/2h lead-time-dependent backoff, and continues to require 3/4/5 genuinely quoting bookmakers (according to lead time) for automatic publication. No bookmaker prices or odds are fabricated.
- Early generation prioritizes fixtures with qualified opening prices, but also generates unpriced candidates for quality screening and later admin review/hold. Previously, any missing opening quote prevented analysis altogether.
- The existing normal engine and VIP/Premium passes remain active. Do **not** retire the normal engine until live measurements prove adequate early coverage, pre-kickoff freshness, qualification rates and settling quality.

## Verification / deployment

- Pure regressions: `npm run check:early-fixtures`, `npm run check:early-odds`.
- Full PR CI including operation tests, production build, browser checks, and PostgreSQL publication checks.
- After merging, verify VPS deploy preserves all three rollout flags, ops crontab is updated, and `JobRun` shows discovery/odds/generation/publication/reassessment with meaningful results.
- Daily operational metrics: leagues sampled, queued by lead-time band, quote coverage by 2–3 / 4–5 / 6–7 / 8–10 / 11–14 day bands, auto-published with price receipts, admin-review ready, held, restored, explicit failures, and provider quota.
