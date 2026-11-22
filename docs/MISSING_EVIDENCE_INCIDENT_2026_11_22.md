# Incident: predictions generated with no usable live football data

Date: 22 November 2026. Example reported from admin:
Oxford United vs Tottenham Hotspur U21 (EFL Trophy), kick-off 24 Nov 2026,
Under 2.5 at 60%, PENDING_REVIEW. Admin reports many similar warnings.

## Confirmed from source

1. `buildGenerationDigest` can produce an empty digest when team IDs are
missing, caches have no usable result, competition/season is unsupported, or
provider calls fail. Without run-time evidence we **cannot** identify the
actual cause or claim the account has no API access.
2. Prior code continued to `generatePredictionForFixture` with this empty
digest, then saved speculative reasoning under `contextComplete=false`.
3. The model prompt forbids invented statistics, but this has not stopped
plausible unsupported "last five games" claims. Existing admin warnings do
not prevent a human approving such a draft.
4. Early FREE automatic publication has an existing stronger gate for
two-sided form and season statistics, but this safeguard does not make
evidence-free drafts useful or safe for admin review.

## Implementation

- Evidence readiness checks **actual results, season statistics, domestic
standings, observed H2H meetings or played league table rows**. Merely having
team names, an injury lookup flag or empty H2H does not qualify.
- If no usable evidence: **no model call and no new prediction**. A typed
`FootballEvidenceUnavailableError` is recorded in GenerationFailure.
- The ordinary worker retains the fixture in the generation ledger and
retries after four hours **without consuming its three strike allowance**.
The scheduled generator still covers all configured leagues. The ordinary
retry can refresh caches under its existing quota policy; early generation
remains strictly cache-only. No new API endpoints or quota increases.
- Existing published or pending predictions are never deleted, changed or
rewritten automatically. The admin warning now correctly says "insufficient
verified evidence", rather than claiming every API lookup actually ran.
- Include a **read-only** `scripts/diagnose-missing-evidence.ts` script.
It aggregates recent row counts by competition, missing team IDs and
recorded team-cache error categories, without printing raw errors/team names
or using API-Football. Execute only through an authorized read-only database
environment.

## Mandatory follow-up (not falsely claimed complete)

1. Run the diagnostic against production with **read-only credentials** and
examine the sanitized aggregate. Check account/plan/quota with the existing
quota observability (not a new paid data source).
2. If missing IDs dominate, fix fixture identity mappings. If cache errors
show 401/403/quota, correct provider access or throttling. If only sparse cup
data is involved, keep the fixture in retry/manual review without pretending
that missing matches equal a definite Under/Over edge.
3. Review existing `contextComplete=false` pending rows before publication.
Do not silently remove published tips; any published correction follows the
existing admin-only editorial workflow.
4. Verify in CI: zero-evidence gate, retry, generation accounting, existing
paid/free safeguards, full production build and regression tests.
5. Verify that the missing-evidence warning rate declines after changes;
no "fixed API" claim until production data proves it.

## Explicit non-changes

No edits to published rows, odds thresholds, betting markets, entitlement,
VIP/Premium curation, pricing, cron schedules, or API-Football request pacing.

## Correctness clarification: early-generation false-positive warning

The original `contextComplete` flag has **two meanings**. For an ordinary
fixture, it was set false when `isDigestEmpty` was true. For the dedicated
early FREE fixture lane, it was also set false when **any input cache was stale**
(`sources.stale?.length > 0`), even if some saved digest fields included
legitimate previous match scores, league statistics or played tables. The
admin UI falsely rendered both cases as "every lookup came back empty" and
"used team names alone".

The corrective PR now computes an admin-only summary from the original
`AIJob.context` snapshot, using `parseStoredContext` (supports legacy v1/v2).
The admin banner distinguishes **saved match evidence, freshness needs review**
from **no substantive sporting evidence saved** and **snapshot unavailable**.
It shows counts of recorded last-five matches, statistics, H2H and table rows.
The stored digest never leaves the admin API in raw form. This explains why
someone can observe genuinely accurate form or league positions even where
the old generic warning appeared.

**Do not claim any particular existing prediction has verified accurate facts**
without inspecting its own snapshot. The persisted snapshot shows what the
model was sent, not third-party factual validation or current freshness.
New truly evidence-free fixture generation is still deferred before the model;
real but stale/cached evidence is not rejected as "no data".
