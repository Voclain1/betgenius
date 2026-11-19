# BetGenius early fixture readiness — rollout and acceptance

## Product outcome

The target is a 14-day rolling fixture calendar, first qualifying free predictions
5–7 days ahead, early Weekend/Midweek pages, and **continuous evidence-aware
reassessment after publication**. A material change must be visible, versioned
and never rewrite historical paid or saved predictions in place.

## What this first implementation delivers

- A separate upcoming-fixture store keyed by stable API-Football fixture id.
  Date, kickoff, teams, status and round refresh without creating predictions.
- A bounded CORE (14 days) / SECONDARY (10 days) discovery cursor, independent
  of the current 48-hour generation discovery and coverage assessment.
- An authenticated route at `/api/admin/generate/early-discover?batch=3`,
  recorded as `early-fixture-discovery` in durable JobRun history.
- A staged `EARLY_FIXTURE_MODE`:
  - `off` (default): no new provider calls, writes or altered period behaviour.
  - `shadow`: record fixture schedules, but never queue a prediction.
  - `on`: record schedules and queue at most 20 already-filtered free
    generation candidates per Lagos calendar day, 48–168 hours from kickoff.
- Standard generation's existing worker processes those queued candidates
  using its existing duplicate, retry and review controls. **The new route
  does not publish predictions** and makes no automatic market substitution.
- Weekend/Midweek period selection opens sooner only in `on` mode.
- Existing 12–48h VIP/Premium odds qualification and publication remain intact.

The first change is intentionally opt-in. It does not pretend that merely
capturing fixtures completes the product goal.

## Deployment sequence (NOT yet executed)

1. Validate schema and run `npm run check:early-fixtures` and
   `npm run check:period-predictions` plus existing generation and paid checks.
2. Run reviewed database schema deployment (`prisma db push`) before enabling
   `shadow`; no public/published rows should be mutated by this table addition.
3. Deploy with `EARLY_FIXTURE_MODE=off`. Confirm ordinary and paid workflows.
4. Set `shadow`, schedule externally on cron-job.org every 30 minutes with
   three leagues per call. The schedule is *not* managed in this repository.
   Check successful cursor rotation, distinct fixtures, fixture reschedules,
   API budget headroom, errors and timeouts.
5. Only after publication and reassessment work below is ready should `on`
   be enabled. The early lane never bypasses free publication review or paid gates.
6. Roll back to `off` immediately if traffic, quota, reliability or quality
   regresses; retain the harmless fixture cache.

## Remaining implementation work before this sprint is complete

**Early publication**: define strict quality gates, review/approval flow and
provenance for early free selections. Automatic publication (if introduced)
must not publish weak, unsupported or stale picks merely to fill categories.
Prove that Weekend and Midweek pages have real published qualifying selections
by Wednesday and the preceding Friday respectively, not just fixtures.

**Critical reassessment**: record the original evidence snapshot and its
freshness, detect relevant injuries, suspensions, lineup changes, venue/fixture
changes, material odds moves and verified weather where data exists. Recheck
on bounded cadence until kickoff. A missing or stale feed means unknown, not
a healthy squad, unchanged weather or a forced decision.

**Versioned outcomes**: keep the immutable published selection and price,
append every material revision/withdrawal with source/time/reason, protect
VIP/Premium evidence, reflect the change consistently in categories,
multi-bets, saved picks, notifications and results. Do not automatically
replace a paid selection or silently erase the original.

**Evidence and production verification**: replay delayed provider feeds,
postponement and duplicate identities, timezone/weekend boundaries, API
errors, quota exhaustion, and confirmed-lineup changes. Confirm live
publication and one real evidence-driven reassessment before closing sprint.

No production rollout, schema push or external cron change is part of this PR.
