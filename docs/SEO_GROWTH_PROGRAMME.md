# BetGenius SEO Growth Programme

**Objective:** grow qualified organic traffic to 10,000 monthly sessions while increasing registrations and paid subscriptions.

**Operating rule:** technical health, index quality, content quality, authority and conversion are separate workstreams with separate acceptance gates. A task is complete only when its local checks pass and the required production/Search Console evidence is recorded.

## Phase 0 — Baseline and governance (Days 1–5)

| ID | Task | Owner | Dependency | Acceptance gate | Status |
|---|---|---|---|---|---|
| SEO-001 | Validate Search Console domain property and sitemap submission | SEO lead | Access | Property covers all protocols/subdomains; sitemap fetch succeeds | Complete: domain property confirmed; sitemap Success, read 2026-09-10 |
| SEO-002 | Validate GA4 collection and organic channel attribution | Analytics | Access | Realtime visit recorded; source/medium and page_view visible | Ready |
| SEO-003 | Define organic conversion events | Analytics/Product | SEO-002 | Registration, checkout and purchase events documented and tested | Ready |
| SEO-004 | Export 16-month GSC query/page baseline | SEO lead | SEO-001 | Brand/non-brand, country, device and page-template views saved | In progress: live query/page and index baseline recorded; 16-month export, country and device cuts pending |
| SEO-005 | Create weekly scorecard | SEO lead | SEO-002/004 | Visibility, traffic, conversion, index and CWV tabs populated | Ready |
| SEO-006 | Record editorial and release workflow | SEO/Engineering | None | Named approver, QA gates and rollback owner documented | Ready |

## Phase 1 — Index control and technical foundations (Days 3–14)

| ID | Task | Owner | Dependency | Acceptance gate | Status |
|---|---|---|---|---|---|
| SEO-101 | Add the missing Fixtures H1 and useful page introduction | Engineering/Content | None | Exactly one visible H1; metadata remains accurate; mobile QA passes | Implemented locally |
| SEO-102 | Exclude unstable relative-date query views from indexing | Engineering | None | Yesterday/tomorrow category views emit `noindex,follow`; today remains indexable | Implemented locally |
| SEO-103 | Split sitemap by static, league, team, match, H2H and cup templates | Engineering | SEO-104 | Sitemap index validates; each child contains canonical indexable 200 URLs only | Implemented locally; build and preview validation pending |
| SEO-104 | Define index eligibility for H2H/team/match templates | SEO/Data/Engineering | SEO-004 | Threshold uses real evidence; excluded pages leave sitemap and emit noindex | H2H implemented locally; empty teams already gated; stricter team gate awaits GSC evidence |
| SEO-105 | Audit Search Console exclusions by template | SEO lead | SEO-001/103 | 25 examples reviewed per major exclusion reason | Complete: all five reasons inspected; 500-example dominant backlog classified and recorded in `docs/SEO_SEARCH_CONSOLE_BASELINE.md` |
| SEO-112 | Tighten sitemap eligibility for weak H2H and match pages | SEO/Data/Engineering | SEO-105 | Shared evidence rules remove thin inventory without suppressing pages solely by age | Implemented locally: H2H and match gates cover 95.2% of the sampled discovery backlog; SEO 76/76, typecheck and Adsterra gate passed; production sitemap baseline 3,895/3,895; deployment response pending |
| SEO-106 | Add automated sitemap parity checks | Engineering | SEO-103/104 | CI fails on sitemap 4xx, redirect, noindex or canonical mismatch | Implemented locally; production baseline 3,895/3,895 passed on 2026-09-10 |
| SEO-107 | Create metadata length and duplication report | Engineering/SEO | None | Template report generated without treating length as an automatic error | Implemented; production baseline: 3,895 crawled, 0 duplicate groups, 715 long-title flags, 1,063 long-description flags, 1 H1 error |
| SEO-110 | Enforce metadata length budgets on dynamic templates | Engineering/SEO | SEO-107 | Concise titles and descriptions across match, team, league, H2H and cup templates | Implemented locally; typecheck passed and SEO regression suite passed 66/66; post-deployment crawl pending |
| SEO-111 | Improve thin but useful public pages | Content/Engineering | SEO-107 | Evidence-led H2H interpretation and useful live scores, multi-bet and pricing guidance; low-evidence URLs remain excluded | Implemented locally; typecheck and 66/66 SEO checks passed; pricing desktop/390px visual QA passed with no browser errors; database-backed page QA and post-deployment crawl pending |
| SEO-108 | Validate structured data on five representative templates | SEO/Engineering | SEO-001 | Rich Results/schema checks logged; visible content matches markup | Implemented locally: homepage WebSite added, false competition-as-organizer claim removed, homepage/match/league/team/H2H assertions added; typecheck and 76/76 SEO checks passed; preview Rich Results and production validation pending |
| SEO-109 | Establish field CWV monitoring | Engineering | Traffic/GA4 | Mobile p75 LCP, INP and CLS available by template | Backlog |

## Phase 2 — Core search hubs (Weeks 3–6)

| ID | Task | Acceptance gate | Status |
|---|---|---|---|
| SEO-201 | Upgrade `/predictions` as the primary football-predictions hub | Unique answer, live inventory, method, track record and internal links | Implemented locally; desktop and 390px visual QA passed with no browser errors; production validation pending |
| SEO-202 | Upgrade `/predictions/today` for daily intent | Date/freshness visible; no false guarantees; strong related navigation | Backlog |
| SEO-203 | Upgrade `/track-record` and methodology | Immutable wins/losses, samples, calibration and limitations explained | Implemented locally: all-time outcomes, measurement dates, calculation rules, sample gates, publication-window definition and confidence/calibration limits; typecheck passed, database-backed visual and production validation pending |
| SEO-204 | Build Banker market hub | Live picks plus historical performance and method | Backlog |
| SEO-205 | Build Over 2.5 market hub | Live data, definition, evidence and record | Backlog |
| SEO-206 | Build BTTS market hub | Live data, definition, evidence and record | Backlog |
| SEO-207 | Build Double Chance market hub | Live data, definition, evidence and record | Backlog |
| SEO-208 | Upgrade EPL, UCL, NPFL, La Liga and Serie A hubs | Query-led titles, useful intros, current modules, proof and links | Backlog |
| SEO-209 | Add named author/reviewer profiles | Credentials are factual and every editorial asset is attributable | Backlog |

## Phase 3 — Editorial authority (Weeks 5–12)

| ID | Task | Acceptance gate | Status |
|---|---|---|---|
| SEO-301 | Establish `/guides/` publishing architecture | Article schema, author, reviewed date, TOC and related links validate | Backlog |
| SEO-302 | Publish first eight evergreen betting-literacy guides | Original examples, editorial review and product pathway on each | Backlog |
| SEO-303 | Launch weekly NPFL analysis | Four consecutive editions published on schedule | Backlog |
| SEO-304 | Publish monthly model-performance report | Reproducible data, samples, losses and corrections included | Backlog |
| SEO-305 | Launch tournament hub framework | Stable URLs available 4–8 weeks before major events | Backlog |
| SEO-306 | Refresh pages ranking positions 4–20 | GSC query evidence recorded before and after update | Backlog |

## Phase 4 — Authority and digital PR (Months 2–6)

| ID | Task | Acceptance gate | Status |
|---|---|---|---|
| SEO-401 | Build Nigeria football-prediction data report | Original dataset, methodology and downloadable visuals published | Backlog |
| SEO-402 | Build NPFL trend asset | Club-level insights are current, cited and embeddable | Backlog |
| SEO-403 | Create responsible-betting probability calculator | Accurate calculation, disclaimer and mobile QA pass | Backlog |
| SEO-404 | Build qualified outreach list | Relevant journalists, analysts and communities; no bulk lists | Backlog |
| SEO-405 | Run one evidence-led campaign per month | Personalised outreach logged; earned links/mentions measured | Backlog |
| SEO-406 | Monitor brand/entity consistency | BetGenius Nigeria identity and factual descriptions remain consistent | Backlog |

## Phase 5 — Conversion and retention (Months 2–6)

| ID | Task | Acceptance gate | Status |
|---|---|---|---|
| SEO-501 | Map organic landing page journeys | Each priority page has one primary next action | Backlog |
| SEO-502 | Instrument prediction and track-record engagement | Events visible in GA4 DebugView and standard reports | Backlog |
| SEO-503 | Improve contextual internal links | Match → league/team/market/record pathways are relevant and crawlable | Backlog |
| SEO-504 | Test organic registration CTA | Experiment has hypothesis, sample threshold and guardrails | Backlog |
| SEO-505 | Report organic registration and subscription conversion | Weekly dashboard includes assisted and last-click outcomes | Backlog |

## Phase 6 — Scale and consolidation (Months 4–12)

| ID | Task | Acceptance gate | Status |
|---|---|---|---|
| SEO-601 | Expand only validated topic clusters | Expansion requires impressions, engagement or conversion evidence | Backlog |
| SEO-602 | Consolidate cannibalising pages monthly | Redirect/canonical decision documented; rankings monitored | Backlog |
| SEO-603 | Prune weak index inventory quarterly | No useful page is removed without query/link/conversion review | Backlog |
| SEO-604 | Protect performance budgets | Field CWV stays good at p75 as ads and features grow | Backlog |
| SEO-605 | Review 10K traffic model quarterly | Forecast uses current CTR, rank, seasonality and conversion data | Backlog |

## Release gates

Every implementation batch must pass:

1. Typecheck and targeted tests.
2. SEO acceptance checks for metadata, canonical, robots, H1 and schema.
3. Desktop and 390px visual review for changed public pages.
4. Production HTTP/HTML verification after deployment.
5. Search Console validation or annotation where indexing is involved.
6. GA4 event verification where tracking is involved.
7. Adsterra regression check: configured unit keys, sandbox isolation, reserved sizes, route policy and every intended placement must remain intact. SEO work must not remove, duplicate, expose or silently relocate an ad unit.

Lab checks are not field performance. Local HTML is not production. Search Console discovery is not indexing, and indexing is not traffic.

## Weekly operating rhythm

- **Monday:** Search Console/GA4 review, anomalies, rankings and priorities.
- **Tuesday–Wednesday:** engineering and content production.
- **Thursday:** QA, editorial review and release readiness.
- **Friday:** deploy approved batch, verify production, record learning and update forecast.

## Current execution order

1. Complete SEO-004/005 with the 16-month, country and device GSC cuts plus GA4 organic/conversion baseline.
2. Implement SEO-112 using the live indexing evidence, then rerun sitemap parity and the Adsterra regression gate.
3. Release SEO-101–112 and SEO-201/203 only after full local checks and an explicit production confirmation.
4. Verify production HTTP/HTML, child sitemaps, representative URL eligibility and ad placements before requesting Search Console validation.
5. Upgrade SEO-202 and expand SEO-204–208 using measured non-brand query demand.
