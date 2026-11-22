# Historical Fixture Evidence & Disclaimer Remediation (22 November 2026)

Builds on PR #226 (evidence-readiness guard and four-state detail banner), PR #227 (per-part freshness provenance) and PR #228 (three-way match resolution). Nothing here replaces those; it extends them to every historical row and every admin surface.

## 0. Evidence basis

| Source | Used? |
|---|---|
| Code and git history | **Yes**: every root cause below is confirmed in code |
| Production database | **No**: no credentials in this session. **No production count in this document is measured.** |
| The existing read-only diagnostic (`scripts/diagnose-missing-evidence.ts`, PR #226) | **Could not have been run by anyone**: its documented command failed immediately (top-level `await` is rejected by `tsx` in this repo's CJS output). Fixed here, extended, and verified on a disposable Postgres. |

**To produce the historical counts (read-only, no provider calls):**

```bash
npm run diagnose:missing-evidence -- --days=30   # or a wider window
```

The output gives: counts by classification × status × tier (paid/free) × competition; reason codes; and the **editorial verification list**, the prediction ids that are flagged, published or awaiting a decision, and not yet reviewed. Published picks come first, then upcoming fixtures, then insufficient before uncertain. The output contains ids and codes only: no team names, reasoning, prompts or provider errors.

## 1. Root causes (code-confirmed)

1. **One boolean, one sentence, several meanings.** Every admin surface except PR #226's detail banner showed "Generated with no live data — every football-data lookup came back empty" whenever `contextComplete=false`: the prediction list icon, the generation panel card, and the bulk-generation result. Over time that flag meant different things:

   | Period / lane | `contextComplete=false` meant |
   |---|---|
   | Ordinary/paid lanes, before #226 | the digest was empty (`isDigestEmpty`); a row with no league id was always "complete" |
   | Early lane, #218 (21 Nov) → #227 (22 Nov) | **any cached part older than 12 h (team) or 24 h (standings)**: real evidence, judged stale against a floor that contradicted the 48 h refresh tier |
   | After #226 | no substantive sporting evidence, or (early lane) stale parts |
   | After #227 | lead-time-aware staleness, or superseded by a played match |

   So a flagged early-lane row from 19–22 Nov most likely **had real evidence**, yet the admin list told reviewers it was generated from nothing.

2. **Genuinely missing evidence did happen.** Before #226, generation called the model even with an empty digest, which produced reasoning with unsupported claims (the Oxford United v Tottenham Hotspur U21 incident). Those rows are correctly flagged, and #226 stops new ones.

3. **"Complete" never meant "current".** For rows without provenance (everything before 22 Nov), nothing checked how old the latest saved result was at generation, or whether a match the team had already played was missing.

4. **Recurring causes across competitions (structural; production distribution not measured):**
   - youth/reserve sides and cup ties (team ids without season statistics);
   - early-lane competitions whose standings were never cached (scope covered PUBLISHED leagues only, fixed in #227);
   - international breaks (a latest result older than 21 days).

   The diagnostic's `byClassCompetition` and `reasonCodes` show the real distribution.

## 2. Classification (read-only, computed on read)

`src/lib/ai/historicalEvidence.ts`, applied to the immutable `AIJob.context` snapshot:

| Class | Rule | Admin warning |
|---|---|---|
| **Evidence available** *(coverage, not verification: the saved evidence covered both teams and was current at generation; it does not independently verify each statement in the reasoning)* | Both sides have sporting evidence and recent results. Each side's latest saved result is ≤ 21 days old at generation. No known match was missed at generation. Fresh provenance (jobs from 22 Nov) or a historical completeness flag of `true`. | none |
| **Freshness uncertain** | Real evidence, but at least one of: the old incomplete flag; aged/superseded/unverified provenance; a latest result > 21 days old; season statistics only; a known match played (or unconfirmed) before generation but missing from the evidence; unknown generation time | "Football evidence was saved, but whether it was current when this pick was written needs verification." |
| **Evidence insufficient** | No substantive sporting evidence (#226's test), or one side has neither results nor season statistics | "Meaningful football evidence was missing when this pick was written. Statements in its reasoning may be unsupported." |
| **Snapshot unavailable** | Generated, but no readable snapshot was saved | "The evidence behind this pick cannot be reconstructed. This does not show that the pick is wrong." |
| *Not generated* | Admin-authored rows | none (never flagged) |

- **Never verified merely because cached data exists:** a complete flag with a 30-day-old latest result is *uncertain*.
- **Never "wrong" merely because of an old flag:** every warning is a request to verify.
- **Missed-match detection uses captured kickoffs only** (from 19 Nov 2026) and #228's resolution: played only when a result is confirmed; postponed, abandoned or awarded matches are ignored; otherwise "unconfirmed". Earlier rows say the check is unavailable rather than failing it.

## 3. Admin review (`/admin/evidence-review`, admin-only)

- **Scope, with two independent date dimensions:**
  - **Generated** (by `Prediction.createdAt`): last 7/30/90/365 days or any time, or an explicit date range. "Last N days" uses exactly the diagnostic's predicate, so the two reconcile.
  - **Kickoff**: an explicit date range, or upcoming vs played.
- **Filters:** classification, status, tier (VIP/Premium vs free), reviewed vs not.
- **Paging over the whole matching population.** There is no recency cap. The list uses a stable keyset cursor (newest generation first), so rows are never skipped or repeated; it shows 25 at a time with "Load more".
- **Counts come from a separate full-scope summary.** They cover the entire scope up to 20,000 rows; beyond that the page says so and asks you to narrow the dates.
- **Each row shows:** the original selection, confidence, preview and reasoning; per-side evidence (recent results, season stats, latest-result age at generation); head-to-head and table rows; the freshness record; and **a plain-language reason for each flag**.
- **Actions:**
  - **Retain unchanged**: a private `EVIDENCE_REVIEW_RETAINED` revision. The prediction is not touched.
  - **Open private review**: published picks **before kickoff** only. Sets the existing reassessment to `REVIEW_REQUIRED` with `publicHold: false` and writes a private `EVIDENCE_REVIEW_OPENED` revision. Rewrite (preview, then explicit approval, prose only) and withdrawal then run through the **existing** `/admin/reassessment` controls, unchanged. When no monitoring snapshot exists, the credible saved generation snapshot is used as the rewrite evidence; the reassessment worker replaces it with a newer one on its next check, which invalidates any stale draft.
  - **Pending-review picks**: the existing draft rewrite on the prediction page.
  - **Picks whose match has started**: retain only. Settled picks are never rewritten or withdrawn after the fact.
- **The detail page banner** now shows the class, its warning and every reason, and states that it is an administrator note that never appears publicly. The prediction list and generation panel no longer say "no live data".

## 4. Guarantees (asserted in CI)

- **No prediction row is written** by the review service. Asserted in source, and in the Postgres test by comparing every seeded row (selection, confidence, reasoning, status, publication time, categories, `updatedAt`) before and after all actions. A deliberate mutation probe makes that test fail.
- **Review records are private** (`publiclyVisible: false`); **no public hold** is ever set.
- **No public page or component** reads the classification.
- **No API-Football requests**: both API handlers and the detail classification run under `withNoFootballApiCalls`; the integration test checks the `ApiUsage` count is unchanged. The engine is untouched: the 60 s live-score policy, early boosts, VIP/Premium reserves, thresholds and schedules are all unchanged.
- **Paid picks keep their categories and visibility.** Paid replacement stays blocked by the existing resolve route.

## 5. Counts and cases for editorial verification

**Not measured in this session.** Run the diagnostic (§0). Every id in `editorialVerification.items` needs an individual decision on `/admin/evidence-review`. Suggested order:
1. Published, upcoming, insufficient: verify the claims, then retain, or open a private review to rewrite or withdraw.
2. Published, upcoming, uncertain: check the reasons (missed match, old results), then retain or rewrite.
3. Published, settled: retain with a note. Never rewritten.
4. Pending review and held drafts: rewrite the draft or decide on publication as usual.

## 6. Deployment and validation

1. Merge after review; deploy as usual. **No schema change, no environment change, no cron change.**
2. On the production host (read-only): `npm run diagnose:missing-evidence -- --days=30`. Record `historicalClassification.byClass` and the editorial list.
3. In `/admin/evidence-review`, set the scope to match:
   - Generated: **Last 30 days**; no generated-date or kickoff-date range;
   - Status **All**, Tier **All**, Kickoff **All**, Review **All**;
   - tick all four classes.

   The class counts beside the checkboxes must equal the diagnostic's `byClass`. This parity is asserted in CI on seeded rows with distinct creation and kickoff dates. A kickoff-date filter is a different scope and will not match.
4. Work the editorial list: set Review to **Not yet reviewed** and use "Load more" until the list ends.
5. Spot-check that a reviewed published pick's public page shows the original selection with no review wording.
6. Confirm `ApiUsage` shows no `evidence-review` attribution (there should be none: the routes make no provider calls).
