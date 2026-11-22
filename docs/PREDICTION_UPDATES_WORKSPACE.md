# Prediction Updates workspace (issue #232)

`/admin/updates` is one admin-only place for new football evidence on existing predictions. It shows what changed and lets an administrator approve an updated explanation or keep the original. Nothing reaches the public site without an explicit administrator action, and selections never change here.

Previews from fictional, disposable data: `docs/previews/prediction-updates/` (desktop, tablet and mobile).

## 1. What the administrator sees

Three tabs. Technical filters (tier, status, kickoff range) and links to the detailed tools sit under **Advanced options**.

| Tab | Contents |
|---|---|
| **New evidence** | Open monitoring cases (`REVIEW_REQUIRED`). Upcoming matches come first, then VIP/Premium before unpublished before free, then the soonest kickoff. Matches that have started go last and are read-only. |
| **Needs review** | Cases where the evidence could not be confirmed (`UNKNOWN`, upcoming). Below them are the unreviewed historical data-quality notes from PR #231 for upcoming picks, which you can mark *Checked: keep unchanged*. These notes are labelled as data quality, not new evidence. "Evidence available" means coverage only; it is not a check of every statement. |
| **Reviewed** | The append-only decision trail, newest first: kept, explanation updated, withdrawn, restored, retained. |

Each card shows:
- the fixture, kickoff in WAT, tier and publication state;
- the current selection, confidence and odds;
- plain reasons ("A new match result is available", "Official lineup: a key player is not starting", "Fixture postponed", "Kickoff time changed");
- when the pick was last checked, when its original evidence was saved and when the latest snapshot was taken.

**Review update** opens the following:
1. **What changed**: a dated comparison of the evidence the pick was written from against the latest monitoring snapshot. It covers new results, form, table position, season record, new and cleared absences, coach and head-to-head.
2. **Statements that may now be out of date**: sentences in the published text that mention something the new evidence changed. This is a heuristic, so it says "may", never "wrong".
3. **The published explanation and the suggested update (private) side by side.** A draft is generated only when you ask, with one model request. Nothing is published until you approve it.
4. An **editable, prefilled audit note**. Then either **Approve & apply** or **Keep original**.

Unpublished picks (pending review, held drafts) offer **Compare with latest evidence**. That comparison is cache-only, makes no writes and calls no provider. Pending-review drafts are revised on the existing prediction page.

### Statuses
New evidence · Draft ready · Awaiting your decision · Needs more evidence · Retained · Updated by admin · Withdrawn · Match started (read-only).

## 2. What can and cannot change

| | Explanation update (Approve & apply) |
|---|---|
| Changes | `reasoning` and `matchPreview` only |
| Never changes | selection, market, confidence, odds, categories, status, kickoff, publication time, provenance, author, settlement |
| Audit | private `ADMIN_REWRITE_APPLIED` revision with the full before and after wording and your note |

**A separate decision is required instead of a prose update when the evidence undermines the pick.** That means a critical signal (for example a key player missing from the official lineup), a draft that points to a different selection, or a draft whose confidence is more than 5 points lower. The server refuses both drafting and applying (`DECISION_REQUIRED`). The page then offers only:
- **Keep original**;
- **Withdraw**, after a separate confirmation;
- **Qualified replacement**, for free picks only, through the existing reassessment page.

Paid replacement stays blocked, as before.

Other server-side guards, which apply to the routes and not only to the buttons:
- **Admin-authored picks** (no generation job) are never re-worded (`ADMIN_AUTHORED_PICK`).
- **Nothing is changed after kickoff.** Drafting, applying and withdrawing all return `KICKOFF_PASSED`.
- **Stale drafts cannot be applied.** A newer monitoring snapshot invalidates the draft (`REWRITE_SELECTION_OR_EVIDENCE_CHANGED`), only the latest draft applies, and a compare-and-swap on the old wording blocks concurrent edits.
- All routes are **admin-only**, and mutations are **origin-checked**, which guards against CSRF.
- **Nothing is deleted, hidden or put on public hold** by this workspace.
- **Duplicate alerts are suppressed.** An unchanged evidence signature keeps a retained case closed, and a genuinely new signature reopens it. This uses the existing monitoring signature (`lastChangeHash`).

## 3. API-Football budget: verified allocation

The allocation was verified before the reassessment threshold was changed. The daily allowance is 7,400 after the provider reserve, with a 300-request paid-only reserve inside it.

| Stops when fewer than this remain | Consumer |
|---:|---|
| 2,000 | Early-lane boost (extra discovery and odds) |
| **1,500** | **Reassessment evidence refresh** (unchanged) · European, top-match and recent enrichment |
| **1,000** | **Reassessment core monitoring** · live scores (60 s floor, ≤ 1,440 a day) |
| 750 | Early lane |
| 500 | Ordinary generation |
| 30 | VIP/Premium generation (plus the 300-request paid reserve) |

**The quota-order fix.** Before this change, all reassessment stood down below 1,500 remaining, including the cheap fixture-status check that detects postponements and kickoff changes. The worker now has two levels:
- From **1,000 to 1,499 remaining**, it keeps the core check and builds evidence from caches only.
- **Below 1,000**, it makes no call at all.

The core check is at most one batched `/fixtures` call (up to 15 ids) and up to 5 lineup calls per run, so it is bounded at about 576 a day. It never runs below the live-score reserve, so it cannot reach the early lane (750), ordinary generation (500) or paid generation. The early boost, which stops at 2,000, is unaffected. **The threshold was not lowered below 1,000.**

**Unpublished monitoring adds no API calls.** Pending-review and held drafts (up to 10 per run) share the same batched fixture call and use cache-only evidence, with no lineup calls.

**The workspace itself never calls the provider.** Every handler runs under `withNoFootballApiCalls`. The integration test confirms that `ApiUsage` is unchanged and that the worker stands down below 1,000 remaining before making any call.

## 4. Safe production activation (no flag changed in this PR)

Monitoring is controlled by `PREDICTION_REASSESSMENT_MODE` (`off` | `shadow` | `on`, default `off` in `.env.example`). It is called by the existing cron entry `6,21,36,51 * * * * /api/admin/generate/reassess?limit=3`. `deploy/ops/merge-rollout-env.py` preserves the value across deploys, and `scripts/check-rollout-env.py` checks it.

- `off`: no monitoring. The workspace shows only cases that already exist, plus the historical notes.
- `shadow` and `on`: **identical behaviour for this workflow.** Both monitor and record private cases. Neither sets a public hold on its own initiative; public holds come only from explicit administrator actions.

Recommended steps (owner approval required; nothing here changes production):
1. Merge and deploy. There is no schema change, no cron change and no flag change.
2. Read the current value on the host: `grep PREDICTION_REASSESSMENT_MODE /path/to/.env`.
3. If it is `off`, set `shadow` and redeploy with the usual rollout merge.
4. Watch it for a day:
   - `ApiUsage` attributed to `prediction-reassessment` should stay within about 600 a day;
   - the run summaries should say "stood down" only when fewer than 1,000 requests remain;
   - early-lane, ordinary and VIP/Premium generation counts should be unchanged.
5. Work the queue at `/admin/updates`. `on` adds nothing for this workflow, so staying on `shadow` is fine.

**Rollback:** set the flag to `off`. The cases and revisions stay as a private audit trail.

## 5. Tests (CI)

- `scripts/check-prediction-updates.ts` (preflight and early-fixtures workflows) covers:
  - the evidence diff, including no-diff suppression and sparse data;
  - friendly reasons and stale-statement detection;
  - decision rules, statuses and priority order;
  - the quota stop order;
  - source guards: admin-only routes, origin checks, the provider hard stop, prose-only writes, no withdrawal after kickoff;
  - the owner's UI rules: no accent edges, no tinted pills, no "AI" wording, Advanced options present;
  - that no public page reads the workspace.
- `scripts/check-prediction-updates-postgres.ts` (disposable Postgres) calls the real route handlers:
  - anonymous, member and cross-origin requests are refused;
  - cards are prioritised, including a future kickoff generated 45 days ago;
  - paging over more than 540 cases reaches a late paid case beyond the first 500, with no repeats and the order held;
  - critical, weaker-draft, admin-authored and after-kickoff requests are refused, with the rows untouched;
  - approve & apply changes the prose only, with every other field and the categories identical, and a private before/after audit;
  - a second apply is refused;
  - keep is recorded, and the Reviewed tab shows it;
  - the worker stands down below 1,000 remaining;
  - `ApiUsage` is unchanged.

  A mutation probe that removed the confidence-drop guard made this test fail.
- Existing suites still pass: reassessment, historical evidence, early evidence freshness, the evidence-review Postgres test and the rollout env check.

**Preview locally:**
```bash
BETGENIUS_DISPOSABLE_PG=yes DATABASE_URL=postgresql://…@127.0.0.1:5432/… npm run preview:prediction-updates   # fictional data
# log in as preview-admin@example.invalid / preview-only-password, open /admin/updates
# clean up: … npx tsx scripts/seed-prediction-updates-preview.ts --clean
```

## 6. Unchanged

These are untouched:
- public pages, copy, branding, SEO and the hero slider;
- the ranking and generation policies and confidence thresholds;
- paid privileges and entitlement;
- the 60 s live-score floor and the early boosts;
- the cron schedules.

The only layout change is admin-only: below the `lg` breakpoint the admin sidebar folds into a **Menu** so phones and tablets get the full width.
