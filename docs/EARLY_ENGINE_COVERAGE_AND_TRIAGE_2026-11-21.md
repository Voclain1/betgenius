# Early prediction engine — wider coverage and recoverable triage (21 November 2026)

## Publication contract (unchanged for paid/normal lanes)

- The dedicated early FREE lane uses the existing 70% Genius confidence floor to qualify for **automatic** publication, plus current fixture identity, credible two-team form/season evidence, valid structured market/selection, exact bookmaker opening quote, quote freshness, minimum bookmaker depth, and the system minimum odds. The atomic publisher rechecks the exact price inside a transaction, with an immutable price receipt.
- Dedicated VIP/Premium, Bet of the Day, Goals, combos and admin-authored rows are never auto-published by the early lane. VIP ~75% and Premium ~80% gates are unchanged.
- Near-qualified early picks (65–69% with credible supporting data) and otherwise credible picks with missing, stale, short-priced, thin or mismatched bookmaker lines go into the **existing PENDING_REVIEW admin queue**. Human publication is an explicit editorial decision, not an automatic odds bypass. Early generation explicitly retains underpriced or market-anomalous drafts that the ordinary engine would reject; an immutable job warning vetoes their automatic publication both before and within the atomic publishing transaction.
- Weak/incomplete early picks more than **72 hours** before kickoff move into recoverable **DRAFT/early hold** with a private audit revision; they are not deleted or archived. The early publisher rechecks those drafts every scheduled cycle. If they become fully eligible they can be auto-published; if credible/near-qualified they go into admin review; any still held entering the final 72-hour period goes to admin for a deliberate decision, never to automatic publication.
- The 48-hour ordinary generation window continues to be isolated. A held early pick entering the ordinary 48h band goes to human review, not through early auto-publication.
- These holds are distinct from **published-tip reassessment holds** shown in /admin/reassessment; those protect previously published picks against changed evidence.

## Capacity model

- **No fixed per-day or per-league caps** on discovering or queuing early fixtures. CORE/SECONDARY stay the priority; a fallback-league slot is rotated within the existing four discovery calls per twice-hourly pass, not added on top. New fallback scans reuse previously cached season metadata; a competition missing season metadata is deferred, rather than spending an additional /leagues request.
- Horizons: CORE 14 days, SECONDARY 10 days, FALLBACK 7 days, DEEP_FALLBACK 5 days. Quality filters for selective lower leagues are retained.
- Provider-facing discovery and odds warming retain the **original twice-hourly schedule**, four scans per discovery pass, four bookmaker fetch attempts per warming pass, original lead-time odds retry intervals, and the provider quota reserves. The database-only triage can process more previously generated rows per pass. No extra odds API provider calls are scheduled.
- Odds warming processes the full active early queue rather than only the first 400, but fetches at most four fixtures every half-hour, with the original 12h/6h/3h missing-price backoff and 12h/8h/3h existing-quote refresh rules. Automatic publication still requires 3/4/5 genuinely quoting bookmakers according to lead time; no odds are fabricated.
- Early generation prioritizes fixtures with qualified opening prices, but also generates unpriced candidates for quality screening and later admin review/hold. It passes `cacheOnly: true` through all team, standings and H2H evidence gathering and reads bookmaker prices from `FixtureOddsCache` without attempting a new provider call. Missing/stale supporting evidence cannot qualify a row for auto-publication. The system still uses its existing forecast-model provider, which can have separate inference costs.
- The existing normal engine and VIP/Premium passes remain active. Do **not** retire the normal engine until live measurements prove adequate early coverage, pre-kickoff freshness, qualification rates and settling quality.

## Verification / deployment

- Pure regressions: `npm run check:early-fixtures`, `npm run check:early-odds`. They assert the early-only cache guarantee and existing API-Football call cadence.
- Full PR CI including operation tests, production build, browser checks, and PostgreSQL publication checks.
- After merging, verify VPS deploy preserves all three rollout flags, ops crontab is updated, and `JobRun` shows discovery/odds/generation/publication/reassessment with meaningful results.
- Daily operational metrics: leagues sampled, queued by lead-time band, quote coverage by 2–3 / 4–5 / 6–7 / 8–10 / 11–14 day bands, auto-published with price receipts, admin-review ready, held, restored, explicit failures, and provider quota.
