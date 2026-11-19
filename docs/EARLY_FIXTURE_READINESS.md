# BetGenius — early generation and continuous prediction reassessment

## Implementation on draft PR #209

Scope: 14-day fixture discovery, 5–7-day generation and evidence-based early
publication of free selections, plus post-publication monitoring and transparent
revision history. The live website is **unchanged** until reviewed rollout.
No weaker VIP/Premium bookmaker/price, model-confidence or quality gates.

Implemented components:
- Independent stable-ID fixture cache, 14d CORE/10d SECONDARY cursor and bounded
  48–168h free candidate queue (API quota protected).
- Dedicated early FREE singles generator with its own scheduled endpoint
  (not the regular adaptive combo worker).
- Early FREE publisher that refuses unsupported, stale-fixture, 80%-below,
  incomplete-evidence, paid, Goals dedicated, BoTD and combo selections;
  standard transactional publication, notification and category curation.
- Week-ahead Genius and Banker curation, early Weekend/Midweek periods, and
  additional *Upcoming predictions* in free category pages without disturbing
  the existing Yesterday/Today/Tomorrow tabs or site design.
- Continuous post-publication fixture status/time, new injuries, suspensions,
  recent form, manager changes, confirmed XI and fresh bookmaker-consensus
  market movement checks; comparisons require current, grounded evidence.
- Immutable original published selection/price and append-only revision records;
  saved-user notifications; publicly gated history pages; admin health dashboard
  and decisions to keep, withdraw or replace with a **new** free prediction.
  VIP/Premium replacements and critical market revisions never bypass human
  review or the dedicated paid gate.

### Not yet verified/unsupported inputs
Weather conditions and separate player fitness reports are **not** independently
verified by a mapped, reliable provider in the current repository. Missing feeds
must remain *unknown*: do not infer a fit player or favourable weather. Do not
claim weather-driven revision until coverage, coordinates, timing, provenance,
cost and tests are available.

### Required staged release — NOT EXECUTED
- Run typecheck, all dedicated CI, paid entitlement/quote integrity tests and
  preview Postgres integration tests with the updated schema.
- Review and apply Prisma schema additions to an isolated/preview database
  first. The existing preflight compares schema to live DB and will fail until
  approved migration; **do not disable the preflight or bypass database checks**.
- Deploy all three flags initially OFF:
  `EARLY_FIXTURE_MODE=off`, `EARLY_FREE_PUBLICATION_MODE=off`,
  `PREDICTION_REASSESSMENT_MODE=off`.
- With the existing CRON_SECRET, configure these jobs in cron-job.org AFTER
  database deployment (no external scheduler was modified in this PR):
  1. `/api/admin/generate/early-discover?batch=3` every 30min;
  2. `/api/admin/generate/early-run?limit=3` every 30min after discovery;
  3. `/api/admin/generate/early-publish?limit=6` every 30min after generation;
  4. `/api/admin/generate/reassess?limit=3` every 15min.
- Turn on capture SHADOW first; verify recorded fixture counts and API headroom.
  Then enable early capture ON + early publication SHADOW, inspect qualifying
  reasons, and enable publication ON only when results meet thresholds.
  Monitor reassessment SHADOW (records cases but cannot edit public picks),
  then enable ON after user, saved-pick and paid evidence regression checks.
- All modes may be set to OFF immediately on regression; preserve audit records.

### Acceptance criteria
1. On Wednesday, actual qualifying Friday/Saturday/Sunday tips are on Weekend;
   Midweek/Goals/Genius/Banker pages expose eligible *future published* picks
   without manufacturing selections or weakening thresholds.
2. Verified injury, lineup, fixture, form or bookmaker evidence causes an
   appropriate flagged case, analysis and timestamped revision; admin KEEP,
   WITHDRAW and qualified FREE REPLACE are traceable. No secret overwrites.
3. Paid publication quotes, VIP/Premium odds windows, no-paywall-leak rules,
   saved-pick original snapshots, settlement and notifications remain intact.
4. Real production end-to-end run, accurate timestamps, limited API spend,
   no duplicate generation and no errors not accounted for by job diagnostics.

**Keep PR #209 in DRAFT and do not merge as complete until the above is proven.**
