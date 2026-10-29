# Starting lineups and bookmaker quotes

This change completes the implementation path for gap 7 and builds on the evidence/navigation change (PR #132). Merge after #130 and #132. The timezone fix #131 is independent.

## Starting XIs

The existing `fixture-details` workload also checks upcoming published matches from 90 minutes before to 15 minutes after kickoff, only where a provider fixture id has already been resolved and competition capabilities support lineups. It collects at most eight lineup units per run, inside the existing workload time budget and the football client's daily quota gate. A date batch stays first so lineup demand does not take priority over resolving fixture identities. An individual lineup request times out after 3.5 seconds. Attempts are at least 15 minutes apart; the existing 30-minute fixture-details schedule determines actual frequency. No scheduler or database schema change is needed.

Only a complete 11-player starting XI for each exact team is displayed as provider-reported lineups. Invalid or duplicate players, partial responses, wrong team identities and wrong fixture identities are not promoted to confirmed lineups. Substitutes are separated; form leaders and top scorers never become a predicted XI. A visible WAT fetch timestamp explains when the lineup was received and that late changes can follow.

Empty, unsupported, temporary-failure and historical-not-captured states remain explicit. Existing historical matches are not backfilled by spending provider quota. Confirmed snapshots survive later failed refreshes. Lineup writes update only one JSON subfield atomically; fixture-detail writes merge their fields transactionally so concurrent refreshes cannot erase one another's data.

## Bookmaker quotes

The page reads `FixtureOddsCache`, verifies its fixture id against `FixtureDetailCache`, and never requests upstream odds. It shows only the four existing headline markets. Each selection identifies its best bookmaker/price, median and number of quoted books. New cache writes also retain up to five named prices per selection; older caches still display their attributable best/median summary. No opening odds, price movement or joint win probability is inferred.

A provider quote timestamp controls freshness when available; fetching an old quote again does not rejuvenate it. Upcoming quotes older than two hours are withheld, as are invalid/future timestamps. Without a provider timestamp the cache-fetch time is explicitly labelled as such. Completed matches may display an explicitly archived pre-match quote; a quote dated after kickoff cannot appear as a pre-match archive. No bookmaker affiliate link or betting transaction is introduced.

## Validation and rollout

Pure/render checks cover complete and partial XIs, identity errors, duplicate players, retry windows, availability messages, stale odds, invalid and after-kickoff timestamps, named prices, and cron wiring. Existing 139 prediction-view checks, market sanity, odds-breadth, enrichment-report, ad-placement and TypeScript checks pass. CI runs the new checks.

The session has no configured production database or API credentials. No production cache writes, model calls, provider requests or scheduler changes were performed. Desktop/mobile visual QA, database-backed concurrency checks and live provider coverage verification are still release checks; local regression tests are not evidence that these have occurred. After deployment, verify a supported imminent match through the regular cron, confirm its lineup timestamp and identity, and confirm stale/missing quotes degrade correctly. Monitor workload remaining counts and API usage. The same fixture-details limit now counts a mixture of date-batch and lineup units, correctly reflected by the generic processed/remaining report fields.
