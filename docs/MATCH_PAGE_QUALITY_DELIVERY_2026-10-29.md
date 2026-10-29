# Match-page quality delivery — 29 October 2026

## Scope and merge order

1. PR #130: shared competition-stage rule and generation rejection.
2. PR #131: independent WAT kickoff formatting and day grouping.
3. This change: original generation evidence, targeted numerical H2H validation, existing-analysis conflict notices, dated recent results, explicit statistical scope/sample sizes, contextual timestamps and conditional navigation. Based on #130; merge #130 first.
4. Follow-up: cached confirmed lineups and timestamped headline odds.

## What is corrected

Generation validates explicit last-N H2H win counts, goal averages and all-over-2.5 claims against exactly that subset of supplied meetings. It checks previews, key factors and every market reasoning. A mismatch fails before persistence. This is not a comprehensive numerical or football-fact verifier; paraphrases and unsupported claim forms can escape detection. Unknown samples are not guessed.

The match page compares existing prose with its original AIJob.context. When a supported check detects a conflict, it withholds that row's prose with a visible review explanation while retaining the pick and outcome. Original records are not rewritten. Locked rows are not surfaced in notices. Checks do not compare historic claims against today's cache. Unknown historic competition stages are not judged as if they were known.

The highlighted pick's original digest supplies recent results, venue statistics and H2H. If no original digest survives, the page explicitly identifies the latest cached context and its limitation. Current team news and standings remain distinct and have cache-fetch timestamps. Publication dates are not presented as corrections or refreshed-cache times. No correction timestamp is invented: no stored editorial correction has been made.

New digest writes retain competition names for recent results and competition/season identity for statistics. Older snapshots honestly say that the competition was not recorded. Recent result rows explain score orientation, venue, sample interval and the limits of the form rating. Small statistical samples remain withheld; missing never becomes zero.

The section menu links only to the verdict, form, preview, key factors, team news, statistics, H2H and published markets which will render. No empty-section links are emitted.

## Historical audit and verification

`scripts/audit-prediction-evidence.ts` is a paginated read-only audit of all published rows against stored original evidence. It emits JSONL findings and counts rows lacking original evidence. Run with the configured database connection; it performs no model/provider calls or writes. A finding is a review candidate, not authorisation for an inferred historical rewrite.

Local regression/render checks, 203 SEO checks, 49 provider checks, TypeScript, ad-placement and whitespace checks passed. Desktop/mobile browser visual review, production deployment and the full database-backed audit remain separate release checks. Do not report these as completed from local rendered markup tests.

Live evidence motivating the work:
- https://www.betgenius.ng/predictions/match/fc-midtjylland-vs-odense-2026-10-29 — narrative 8/10 wins versus H2H 7/10; all ten over 2.5 claim versus a listed 1–1.
- https://www.betgenius.ng/predictions/match/juventus-vs-rennes-2026-10-22 — League Stage - 3 versus knockout-tie prose.
- https://www.betgenius.ng/predictions/match/everton-vs-newcastle-2026-10-29 — form totals without dated underlying results and sparse cup samples.
