# Generation scheduling

How the scheduled generation passes are ordered, and why the order is load-bearing.

Scheduling for this app lives in **cron-job.org**, not in the repository —
`vercel.json` carries only `/api/admin/settle` and `/api/admin/curate-accumulators`,
because this plan's own crons are capped at once per day. Everything else is
external, which means **nothing in this repository can enforce what follows.** That
is exactly why it is written down.

## The constraint

> The dedicated VIP/PREMIUM pass must run **before** ordinary generation, not after.

It is not a preference or a tuning choice. Run it second and it does nothing at
all, silently, forever.

### Why

Both passes draw from the same pool: fixtures in the `GenerationAttempt` ledger
that still need predictions. `selectCandidates` only ever offers fixtures with no
predictions yet, so once ordinary generation has claimed a fixture it is gone —
`SUCCEEDED`, and permanently invisible to any targeted pass.

The window is narrow. Measured over 455 ledger rows across seven days, a fixture
stays `PENDING` for a median of **23 minutes** (p10 8, p90 113) before ordinary
generation takes it. Ordinary generation runs every 15 minutes, so in practice the
pool is empty almost all of the time: a spot check found **every** in-scope fixture
in the next 72 hours already `SUCCEEDED`, and a 21-tick poll across 3.7 hours found
zero claimable in-scope fixtures at any point.

So the paid pass does not compete on equal terms. It either goes first, or it
starves.

### What going second looks like

Nothing. No error, no failed run, no alert. The route returns HTTP 200 with
`claimed: 0`, which is indistinguishable from a legitimately quiet day. That is
the failure mode this document exists to prevent, and it has already happened
twice in this codebase:

- **Market-Confirmed** ran 82 jobs across 22 days, produced 168 drafts and
  promoted **3 rows (1.8%)**. Part of that was cold odds; 60.7% of its drafts were
  also rejected `MODEL_BELOW_FLOOR` because it had no targeting at all. It looked
  like it was working. It was scheduled, it was running, and it was returning 200s.
- **Bet of the Day** was built, wired and never scheduled: **0 jobs and 0 tagged
  rows in 90 days.** When its targeting was finally measured it returned 12 targets
  of which **0 were claimable** — all already `SUCCEEDED`, nine of them outside the
  generation window entirely. It would have produced `claimed: 0` on every run from
  the day it was switched on.

Both were discovered by auditing production rows, not by anything failing.

## Scheduler configuration

All entries: **GET**, header `Authorization: Bearer <CRON_SECRET>`, timezone
**Africa/Lagos**. Prepend the production domain to each path.

| Order | Endpoint | Schedule | Notes |
|---|---|---|---|
| 1 | `/api/admin/generate/run?vipPremium=1` | `5,20,35,50 * * * *` | **Must stay ahead of row 2.** |
| 2 | `/api/admin/generate/run` | `10,25,40,55 * * * *` | Ordinary generation. Pre-existing; do not move. |

The 5-minute lead is the whole mechanism. `10,25,40,55` is not a proposal — it is
the cadence ordinary generation already runs on, inferred from 461 real `AIJob`
timestamps, and it should not be changed to accommodate anything. The paid pass
was slotted around it.

This interleaving is an established pattern here rather than a new idea:
`/api/admin/refresh-insights` already sits at `8,23,38,53`, deliberately offset
from generation by two minutes.

### Operational notes

- **A failed poke is normal. Do not alert on it.** The database is Neon serverless
  and drops connections under sustained use — three drops were observed inside a
  single working session, one of which killed a long-running poller outright. The
  route already treats a held lock as a non-error for the same reason.
- **Most pokes are no-ops, and they are cheap.** The pass is capped at
  `VIP_PREMIUM_DAILY_QUOTA` (6) attempts per day, so the large majority of its 96
  daily runs do nothing. A run with no claimable in-scope fixture returns before
  any odds warming, so an empty tick spends **zero** api-football calls — only
  database reads.
- **The pass prices its own candidates.** It does not depend on the enrichment odds
  workload having run first, so it carries no ordering constraint against that job.
  This is deliberate: depending on an external scheduler to have warmed odds is
  what left Market-Confirmed reading quotes that did not exist yet.
- **Do not schedule Bet of the Day** on the strength of this document. Its
  targeting defect is fixed, but whether it should run at all is a separate,
  unmade decision.

## Confirming it is actually working

Ordering silently reversed is invisible from the outside, so check the output
rather than the configuration:

```
npm run verify:vip-premium
```

It reports attempts, promotions per active day against the modelled forecasts
(1.65 VIP/day, 1.00 PREMIUM/day), and the `MODEL_BELOW_FLOOR` rate against the
predecessor's 60.7% baseline — printing `STILL DOMINANT — targeting is not doing
its job; do not raise the quota` when the rate has not improved.

**The signature of wrong ordering is attempts near zero while the route returns
200s.** If the pass has been scheduled for several days and
`attempts (AIJobs with VIP_PREMIUM intent)` is still 0, the ordering is wrong or
the job is not firing — not that the market has been quiet. A genuinely quiet
market produces attempts that fail the gate, not an absence of attempts.

Two figures are forecasts made before the pass was built, and are expected to be
wrong in some direction; the point of recording them is that being wrong is
detectable:

| Figure | Forecast | Basis |
|---|---|---|
| VIP promotions | 1.65/day | Gate replay over 213 paid-tier-eligible rows, 31 days |
| PREMIUM promotions | 1.00/day | Same replay at the 80 market floor |
| `MODEL_BELOW_FLOOR` | well under 60.7% | Predecessor's untargeted rate; targeting should reduce it |

## A note on tests and the live quota

`scripts/check-vip-premium-gate.ts` seeds `AIJob` rows carrying real
`VIP_PREMIUM` intent. `vipPremiumGeneratedToday` counts exactly those rows inside
today's Lagos bounds, so seeded jobs at a default `createdAt` consume the live
daily quota while the test runs — observed once, standing a poller down with
"quota spent for today" while the true remaining quota was six.

The seeded jobs are dated to a far-future day, and the test asserts the live quota
is untouched while its own rows exist. **Any future test that writes an
intent-carrying `AIJob` must do the same.**
