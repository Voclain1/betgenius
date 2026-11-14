# Sprint 08 — hierarchy correction for review

This revision updates PR #184 on `feat/sprint08-discovery`. **Design approval is pending the owner's review.** No merge or deployment is part of this work.

## What changed

| Surface | Existing master | Earlier Sprint 08 | Correction |
|---|---|---|---|
| Homepage | Hero actions followed by category links and Genius/Featured tips | A full finder form inserted before Genius/Featured | Search entry joins the hero actions. On phones it is a labeled 44px search icon; from small screens upward it includes “Find a match”. It links to `/predictions`; no filter form, heading or finder panel occupies the feed. |
| Predictions index | Large category masthead and category directory | Large masthead followed by another finder heading, panel and controls | One concise heading, team search and a quiet Filters disclosure. Date, competition, market, status, kickoff, category, quotes and interests remain available inside. Reset is contextual. Results follow directly; existing directory links remain below. |
| Category | Category context, day navigation, view choice and predictions | Always-visible finder above day navigation | Day navigation comes first; one collapsed “Filter predictions” control replaces the large finder. The original prediction feed remains the default. Filtered results retain category scope and entitlements. |
| Match | Identity, verdict, form/statistics and analysis | Evidence guide directly after the verdict; full comparison panel | Evidence and market comparison are closed disclosures after form/statistics and odds. Their links no longer lead the section navigation. Cards lose inner decorative borders; duplicate cross-links are removed. Empty verified-data sections do not render. |

The established green accent, dark surfaces, typography, hero, match masthead, navigation, tables and prediction cards remain. The supplied references inform the compact search and disclosure hierarchy; their gold palette, decorative statistics and unsupported odds-movement indicators are not introduced.

## Actual screenshots

Both versions use the same disposable PostgreSQL database, synthetic preview fixture and dates. Master is exactly `0609bc9a1b8ded58d9dbe456a15b5c38a2ed498b`, rendered locally in Next development mode. The correction is rendered from the production build. These screenshots compare layout, not loading speed or production data. Each screenshot shows the initial viewport with secondary disclosures closed; heights are 844px on mobile and 1000px on desktop.

| Page | Master 390px | Revised 390px | Master 1440px | Revised 1440px |
|---|---|---|---|---|
| Homepage | [Reference](screenshots/master/390-home.png) | [Correction](screenshots/revised/390-home.png) | [Reference](screenshots/master/1440-home.png) | [Correction](screenshots/revised/1440-home.png) |
| Predictions index | [Reference](screenshots/master/390-index.png) | [Correction](screenshots/revised/390-index.png) | [Reference](screenshots/master/1440-index.png) | [Correction](screenshots/revised/1440-index.png) |
| Category | [Reference](screenshots/master/390-category.png) | [Correction](screenshots/revised/390-category.png) | [Reference](screenshots/master/1440-category.png) | [Correction](screenshots/revised/1440-category.png) |
| Match | [Reference](screenshots/master/390-match.png) | [Correction](screenshots/revised/390-match.png) | [Reference](screenshots/master/1440-match.png) | [Correction](screenshots/revised/1440-match.png) |

The revised index selects the synthetic fixture’s date explicitly; master’s index is a directory with no date filter. Homepage/category previews use the Tomorrow tab because the synthetic fixture is scheduled tomorrow. No fixture, score or bookmaker in these previews is real. Earlier screenshots at the root of `screenshots/` describe the superseded design; the `revised/` directory is the current review set.

## Preserved behavior and validation

Discovery parsing, bounded SQL queries, server-side entitlement checks, allowlist projection, date/timezone behavior, canonical/noindex rules, immutable publication observations and quote matching/freshness are unchanged. No provider calls, selection policies, payments, schema or scheduler changes are introduced.

The revision reruns the 44 non-browser regression suites, including seven real disposable-PostgreSQL suites, and the three existing responsive browser suites. New browser checks require category and match disclosures to start closed, form to precede the evidence guide, empty evidence/comparison to stay absent, and the homepage to contain a compact destination link without a finder form. Existing filters, personal saves, anonymous HTML/flight privacy, structured data, prices and narrow-screen checks remain covered. Final results, browser assertion count, build budgets and SHA are recorded in PR #184.

Review the screenshots before deciding on design approval. Passing tests establish behavior and measured layout constraints; they do not grant visual approval.

## Measured hierarchy and final local results

Measured heading positions from the same browser and synthetic database:

| Landmark | Master 390px | Revised 390px | Master 1440px | Revised 1440px |
|---|---:|---:|---:|---:|
| Homepage Featured heading | 963px | 965px | 728px | 730px |
| Match verdict heading | 979px | 979px | 836px | 836px |

The compact homepage entry adds only 2px to the measured Featured position, rather than inserting the previous full form. The match verdict does not move. The evidence/comparison disclosures follow verified form/statistics and odds, rather than entering the verdict-to-form reading path.

Local validation: 44 non-browser suites pass; the compact-table, odds and navigation browser suites pass; the revised Sprint 08 browser suite passes **122 assertions** at 1440/390/320px and captures 15 screenshots. Pure/render coverage remains 91 assertions and PostgreSQL coverage 83. TypeScript and production build pass. All 75 existing JS budgets pass: shared **110.4/120 KB**, match **158.2/160 KB**, without raising thresholds. These are build-size measurements, not field Core Web Vitals.

Expanded secondary content: [390px evidence](screenshots/revised/390-evidence-expanded.png), [390px comparison](screenshots/revised/390-markets-expanded.png), [1440px evidence](screenshots/revised/1440-evidence-expanded.png), [1440px comparison](screenshots/revised/1440-markets-expanded.png).
