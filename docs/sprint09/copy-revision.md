# Sprint 09 — production copy revision

PR #195, branch `feat/sprint09-performance`. This revision changes presentation and authored visitor copy only. **Editorial and visual approval remain with the owner. Do not merge or deploy.**

## Context review and presentation

Reviewed the dashboard, all filters and labels, monthly/category/market/league comparisons, historical-result rows, empty and insufficient-result states, estimated-return section, expanded calculation methods, individual prediction pages, expanded record explanations, archive navigation and both metadata descriptions.

“Prediction Results” is the primary heading. Win Rate and its checked win/loss count now appear before search controls in the initial mobile viewport. “Predictions” and “Finished results” retain their separate counts. A visible short note distinguishes all recorded results from the checked results used for Win Rate; longer explanations remain under “How Results Are Calculated”.

Individual pages separate the result (Won/Lost/Void/Pending) from its check status. Match, prediction, final score, publication date and Odds at Publication remain prominent. Missing past odds say “Not available”; the reason and incomplete change history sit under “About this prediction record”. Category and outcome codes are displayed as football labels rather than internal enum names. Existing green branding, typography and compact ruled layout are preserved.

## Copy-change audit

| Before | Visitor wording now |
|---|---|
| Performance, in context | Prediction Results |
| Published predictions. Recorded outcomes. Evidence you can inspect. | See how past predictions finished and compare results over time. |
| Published records | Predictions |
| Recorded settled | Finished results |
| Verified decided | Checked wins & losses |
| Verified win rate | Win Rate, accompanied by the checked-result explanation |
| Insufficient sample | Not enough results yet |
| Publicly readable records only | Public predictions |
| Your currently accessible records | Predictions included in your plan |
| Period & filters | Dates & filters |
| Primary category / Recorded outcome | Category / Result |
| WON / LOST / VOID / PENDING / OTHER | Won / Lost / Void / Pending / Other results |
| Monthly history | Monthly Performance |
| By primary category / By market / By competition | Results by Category / Results by Market / Results by League |
| n=… / … decided | … checked |
| Publication-price illustration | Estimated Returns |
| Indicative ROI | Estimated return |
| Insufficient qualifying price evidence | Not enough confirmed past odds |
| Eligible / excluded / net units | Predictions included / left out / estimated profit or loss in points |
| Flat-stake illustration | Assuming 1 point on each included prediction |
| Immutable publication-selection observation / structured selection | A matching choice and odds recorded around publication |
| Settlement resolver | The final score agrees with the result |
| Verified/bounded cohort / database rows | Predictions in the chosen period, with the 5,000-prediction limit explained plainly |
| Original-version / historical correction ledger | A full history of earlier choices and result changes is not available |
| Calculation methods & evidence limits | How Results Are Calculated |
| Historical results | Past Predictions |
| Recorded published selection | Our prediction |
| Publication-price observation | Odds at Publication |
| Independent settlement verification unavailable | Not fully checked |
| Publication evidence & version history | About this prediction record |
| Match reference and published reasoning | Match details and analysis |
| Metadata about verified samples and publication-price evidence | Past predictions, wins, losses, monthly results and how figures are calculated |

The rewrite does not disguise gaps. It retains the 20-result thresholds, checked-vs-all result distinction, incomplete checks, repeated entries, current category membership, limited periods and 5,000-prediction cap. It explains that some part-win/part-loss bets and quarter-goal lines are left out, missing prices are never replaced with today’s odds, and recorded odds do not prove a bookmaker accepted a bet. Estimated returns explicitly use a 1-point assumption and are **not real bets or anyone’s earnings**. Earlier published choices and result changes cannot be fully reconstructed. The code and internal technical documentation retain their precise terminology.

## Automated production-copy check

`npm run check:sprint09-copy` parses the authored TypeScript/TSX for the two pages, dashboard and shared display-label modules. It checks visible JSX text, string/template copy, metadata, accessible labels, titles and placeholders. Prohibited terms include the requested research/database phrases, immutable/cohort/resolver/ledger/observation/indicative/eligible/ROI/settlement, and prohibited public wording concerning automated authorship.

Imports, comments, identifiers and non-display attributes (for example the existing internal anchor `indicative-returns`) are allowed. Internal calculation/data modules, tests and documentation are outside the visitor-copy scan. Ten negative examples prove that forbidden copy is detected; an allowance test proves that internal identifiers, comments and anchors can retain the terminology. The check runs in the existing CI workflow before browser validation.

Numerical calculation assertions and evidence requirements were not relaxed. Browser assertions now use the new human-readable labels and also check that figures precede search, the result/score/date/odds labels are visible, and exclusions remain explained. Security, cache, entitlement, metadata, pagination and responsive checks are retained.

## Before-and-after review screenshots

All images come from the running production-mode local application, with the same synthetic records and reporting period. The small synthetic-preview label is added by the capture harness. “Before” is the prior PR head `39e809fc3c314fb60a7530541fe0a20dc863cc07`; “After” is this revision. These compare language and presentation, not prediction performance.

| View | Before 390px | After 390px | Before 1440px | After 1440px |
|---|---|---|---|---|
| Dashboard | [Before](screenshots/before-copy/390-dashboard.png) | [After](screenshots/current/390-dashboard.png) | [Before](screenshots/before-copy/1440-dashboard.png) | [After](screenshots/current/1440-dashboard.png) |
| Category / market results | [Before](screenshots/before-copy/390-breakdowns.png) | [After](screenshots/current/390-breakdowns.png) | [Before](screenshots/before-copy/1440-breakdowns.png) | [After](screenshots/current/1440-breakdowns.png) |
| Past predictions | [Before](screenshots/before-copy/390-history.png) | [After](screenshots/current/390-history.png) | [Before](screenshots/before-copy/1440-history.png) | [After](screenshots/current/1440-history.png) |
| Individual prediction | [Before](screenshots/before-copy/390-record.png) | [After](screenshots/current/390-record.png) | [Before](screenshots/before-copy/1440-record.png) | [After](screenshots/current/1440-record.png) |
| Expanded calculations | [Before](screenshots/before-copy/390-methodology.png) | [After](screenshots/current/390-methodology.png) | [Before](screenshots/before-copy/1440-methodology.png) | [After](screenshots/current/1440-methodology.png) |
| Missing past odds | [Before](screenshots/before-copy/390-missing-price.png) | [After](screenshots/current/390-missing-price.png) | [Before](screenshots/before-copy/1440-missing-price.png) | [After](screenshots/current/1440-missing-price.png) |
| Empty results | [Before](screenshots/before-copy/390-empty.png) | [After](screenshots/current/390-empty.png) | [Before](screenshots/before-copy/1440-empty.png) | [After](screenshots/current/1440-empty.png) |
| Not enough checked prices | [Before](screenshots/before-copy/390-insufficient.png) | [After](screenshots/current/390-insufficient.png) | [Before](screenshots/before-copy/1440-insufficient.png) | [After](screenshots/current/1440-insufficient.png) |

## Validation and unchanged safeguards

- Production-copy QA passes across all five visitor sources.
- The 98 numerical/evidence/render assertions and 38 real PostgreSQL checks pass. All original calculation, deduplication, historical-price, partial-return and evidence eligibility rules remain unchanged.
- All 44 existing non-browser regression suites and 71 track-record checks pass, including entitlement, publication, reliability, payment and SEO coverage. Disposable integration tests run in their isolated schema to keep preview fixtures out of the existing bounded API test bucket.
- The revised browser suite passes at 1440/390/320px, including paid-data HTML/flight protection, expired-subscription denial, private no-store responses, canonical/noindex, empty/missing states and zero sideways overflow. The final assertion count and CI status are recorded in PR #195.
- TypeScript and production build pass. All 76 performance budgets pass unchanged; shared JavaScript remains 110.4/120 KB. No field loading-speed or usability-study claim is made.

The calculation and data-access modules are unchanged. No settlement, publication, prediction-selection, subscription, payment, provider or scheduler policies change. No schema, migration or new production secret is required. The revision is ready for owner review once final-head CI is green; no editorial or visual approval is claimed.
