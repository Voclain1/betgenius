# Live SEO verification — 31 October 2026

## Verified live

- The nine-section long homepage guide and seven FAQs are deployed. The homepage uses neutral match-analysis wording; no prohibited technology wording was found in the visible copy of the homepage or sampled match pages.
- All 17 distinct destination pages linked in the homepage guide/FAQ returned HTTP 200. This checks reachability, not the factual accuracy of every destination.
- A real desktop browser at 1348px displayed the guide, opened the confidence FAQ, and reported no horizontal document overflow. A screenshot of the live guide was captured. Full mobile content visual review is still outstanding; CI's header-fit check is a narrower responsive check.
- Juventus–Rennes (22 October), Midtjylland–Odense (29 October), and Porto–Estoril (31 October) show original-evidence timestamps distinct from current context. Completed pages label pre-match odds as archived; the Porto page withholds stale prices.
- PSV–Willem II (31 October) displayed two provider-reported starting XIs, formations, substitutes and a fetch timestamp. This proves one working lineup path, not comprehensive competition coverage. No additional provider requests were made by this audit.

## Confirmed defects fixed in this PR

1. Homepage contents links target heading ids, but the scroll margin was on the surrounding section. The new descendant-id offset keeps headings clear of the sticky header.
2. Midtjylland–Odense describes a most recent 1–1 meeting in its preview while claiming all ten previous H2H games exceeded 2.5 goals in a key factor. Its stored ten-game sample excludes that latest meeting, so arithmetic on the old sample alone does not find the contradiction. The new targeted check compares the entire draft across preview/key factors/reasoning and removes the unsupported universal claim through the existing prose-cleaning path. Published selections, scores and stored historical prose are not rewritten.

## Production historical audit

GitHub Actions run 41230304721 completed successfully. The database confirmed transaction_read_only=on before content was read, inside one repeatable-read snapshot. The script uses SELECT queries after that guard, makes no provider calls, and emits no stored contexts, paid selections, analysis prose or credentials.

- Published prediction rows checked: **6,412**.
- Rows without usable original stored evidence: **968**.
- Rows whose historic competition stage is unknown and skipped for that check: **764** (within rows with evidence).
- Flagged stored prediction rows: **32**, spanning **27 distinct match slugs**.
- Issue counts: **11** H2H goal-average claims; **7** H2H win-count claims; **13** competition-stage claims; **1** internal score/universal-goals contradiction.

See `PUBLISHED_EVIDENCE_AUDIT_2026-10-31.json` for the exact bounded report and its first 30 flagged rows. The sample can repeat a match because multiple predictions may belong to it. It is capped by row count, not by unique match count.

These figures describe stored analysis before display cleaning. They are not counts of confirmed currently visible errors. Existing display filters already remove supported contradictions; the new cross-field check covers the confirmed gap above. No claim is made that unflagged records are factually correct. These checks cover explicit H2H patterns and known competition stages; they do not verify every injury, player, transfer or football statistic. Missing original evidence needs a separate source-recovery review, not an invented rewrite.

## Remaining verification

- Full mobile-page visual review.
- Database concurrency integration for independent lineup/fixture JSON updates.
- Broader lineup/odds coverage and refresh reliability across competitions.
- Individual editorial review/source recovery for records lacking evidence, keeping original picks and outcomes intact.
