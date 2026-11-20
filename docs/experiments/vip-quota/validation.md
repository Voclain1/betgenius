# Validation — 15 November 2026

Base master: `35015264` (#201). No production schema, flag or deployment was changed. Model/provider transports were mocked; no paid requests were made. PostgreSQL checks used two newly created, disposable local Docker containers, never a production database.

## Passing

- `npx tsc --noEmit`.
- `check:vip-quota-experiment`: disabled/invalid config, bounded allowances, expiry, unknown pricing/provider/usage, unique eligible pool, conservative cost arithmetic, scoped transport blocking, no fallback spend and baseline transport isolation.
- `check:vip-quota-postgres`: real transaction locks under concurrent reservations; durable fixture dedupe; aggregate cost ceiling; unknown-cost stop; no refunds; failed reservations included in the unchanged 12-call daily cap; paid API stop at 7,400 with the default reserve; hard clamp at 7,500 despite an oversized environment override; failed API accounting blocks dispatch. Real targeting retains the >86.96 favourite and ranking without new odds calls. An old crashed reservation survives rescheduling beyond the usual lookback; full-history exact-id checking also prevents an extra from re-buying a distant rescheduled baseline fixture. Real publication requires an active experiment and reliable usage, rollback holds drafts, repeat publication creates no second notification and kickoff checks still apply.
- `check:vip-premium-overlay`: **248 passed**, including fresh quote, minimum books, market floor, ordinary coverage, league scope, one attempt per fixture, tier floors, paid fixture ownership, gate, publication wiring, extra-day quota and unchanged candidate ranking.
- `check:vip-premium-quota`: 23 passed; 8 baseline / 12 creation-day cap unchanged.
- Existing `check:vip-premium` against disposable PostgreSQL: **0 failures**. Actual VIP/PREMIUM promotion, model/market/books/staleness rejection, wrong-intent isolation and idempotence. The script's existing integration guard was satisfied with the two separate local container servers as target/reference; no production identity or database was accessed.
- Existing `check-paid-publication-postgres.ts`: PASS for concurrent publication, idempotence, atomic entry-price evidence, one notification and rollback on invalid confirmation.
- `check:paid-spare-quota`: 64 passed.
- `check:paid-selection`: 75 passed.
- `check:paid-market-quality`: all eight component suites passed (market quality, chronological holdout, integrity guards, entry evidence, shadow integrity, holdout policy, return uncertainty, evidence gate).
- `check:qualification-research`: 72 passed.
- `check:european-clubs`: 110 passed.
- `check:alt-market-research`: 70 passed.
- `check:paid-value-integration`: 55 passed.
- `check:kickoff-assert`, `check:generation-failures`, `check:bulk-generation-dedupe`: passed.
- Existing `check-providers.ts`: 54 passed; `check-generation.ts`: 138 passed; `check-sprint11-audit.ts`: 70 passed; `check-supply-funnel.ts`: 18 passed.
- Archived historical simulation reproduced exactly; source provenance/hash and cohort/constraint assumptions are committed.
- Read-only report smoke test against disposable PostgreSQL: refused writable-session use by design, and ran with session-level read-only enforcement. Attributed the seeded test promotion, reserved and recorded costs separately. These are synthetic test rows, not production results.
- `git diff --check`.

## Existing checks that cannot be presented as green

- `check-market-confirmed.ts` is a **live-population audit**, not a fixed regression fixture. Against the local two-row odds fixture it fails the expected populated-market counts (no BTTS, Over/Under or Double Chance quotes) and the population-level “overwhelming majority rejected” assumption. It supplies no production verdict here. The actual gate's fixed-fixture regression and database promotion tests pass.
- `check-market-confirmed-curation.ts` fails one legacy reporting assertion: it expects `marketConfirmedProtected`, which current curation does not return. **The identical failure was reproduced on unchanged master `35015264` in a separate worktree**, against the same disposable local database. All that script's actual tag-protection, removal, tier, feed-limit and idempotence assertions pass. This PR does not repair an unrelated reporting-field test.

## Not established

A build against the deployed production database, new production supply, marginal production cost, settled production returns and calibration are not established by this PR. The historical artifact is explicitly a capacity bound with budget sensitivities, not a replay of unknown model outcomes. Full operational evaluation starts only after approval and uses the read-only reporting/rollback procedure in README.md.
