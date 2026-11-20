# Automatic odds floor and football market-breadth audit — 20 Nov 2026

**Status:** Proposed change on a draft pull request. **Not deployed.** The operational test of the separate early-fixture system on 21 November must remain independent. This proposal does not claim measured profitability or settled success.

## Problem statement

An owner-observed pattern is repeated **team Under 2.5 goals** at very low prices (for example 1.02 or 1.04), followed by very short Double Chance tips. Six 1.04 legs produce only 1.2653 combined decimal odds before bookmaker variation, despite exposing the user to six independent ways to lose (and actual leg results are correlated/variable). A user-facing “safe” label cannot make that attractive.

This is not just a content/UI problem. It is a policy/data mismatch:

1. `src/lib/ai/analysis.ts` explicitly favours conservative markets, especially the Genius and paid risk instructions. The dedicated paid prompt considers Double Chance first, Draw No Bet second, conservative O/U third.
2. `src/lib/shortPriceGuard.ts` previously stopped only Double Chance with median price strictly under 1.10, only on normal scheduled generation. Team Total had no equivalent floor. The dedicated Goals generation was exempt.
3. `src/lib/markets.ts` offers `TEAM_TOTAL` lines 0.5/1.5/2.5, with 2.5 UNDER-only, to avoid implausible Over 2.5. Its prior research sample counted only 16% of team-innings exceeding 2.5, making Under 2.5 a widely successful but potentially almost unpayable selection.
4. `src/lib/odds.ts` intentionally caches only four normal displayed betting markets (Match Winner, Double Chance, Goals Over/Under, Both Teams Score) plus sourced Handicap Result. It does **not** persist bookmaker quotes for the team-goals markets, even though `scripts/research-team-totals.ts` already probes such raw markets.
5. Paid VIP/Premium selections have a **separate** fair-price test: `PAID_MIN_FAIR_ODDS = 1.15` (derived from a maximum 86.96% de-vigged market probability), plus independent confidence, 5-books, quote-age and tier gates. That is **not** the same thing as a verified executable 1.15 bookmaker offer. It must not be silently replaced by an ordinary free-tip threshold.
6. `docs/PAID_VALUE_CALIBRATION_2026-11-13.md` reports 2,400 out-of-sample settled singles with **no credibly positive estimated value**, and a VIP median near-close quote of 1.19. This implies **no evidence that simply excluding odds under 1.12 creates a profitable product**.

## Immediate proposed rule on this branch

- **Ordinary automated and dedicated Goals:** reject supported, exactly mapped market selections whose **median** cached bookmaker odds are strictly below **1.12**. Using median avoids qualifying a prediction from one unusually high and unavailable quote. The same market's exact selection/line must match.
- **TEAM_TOTAL:** temporarily **hold every auto-generated team-goals pick** until an exact executable team-total price is retained and checked. This intentionally prevents the reported 1.02–1.04 Under 2.5 failure from bypassing the check via a missing cache market. It temporarily lowers team-total coverage and should be replaced promptly by price-backed support.
- **Retry:** allow one additional reasoned generation attempt, explicitly naming the rejected price/market. Never mechanically increase risk or replace the selection with a different market without a fresh assessment. If no suitable pick remains, skip that fixture rather than fabricate value.
- **No policy changes** to manual admin entry, the distinct European Handicap sourced-line route, the dedicated VIP/Premium publisher gate, or Bet of the Day’s existing 2.20–4.50 price band.
- **Missing quote limitation (important):** ordinary market types that cannot be matched to a retained price remain under their existing policy, not validated against 1.12. In particular Draw No Bet, Win Either Half, HT/FT and Correct Score do **not** acquire a genuine bookmaker price merely because the new rule exists. Also, where no cached odds are available, a mapped market currently continues through the pre-existing generation path. The 1.12 rule is a minimum for **priced** automatic selections; it is not yet a guarantee for every displayed tip.
- **No changes to earlier already published predictions** and no retroactive rewriting. Release tests must check future generated rows after deployment, not claim to “fix” old picks.

## Markets: source and activation matrix

The raw API-Football /odds feed can return a large bookmaker-specific catalogue. `src/lib/odds.ts` documents 338 distinct raw market names, but these must **not** be exposed wholesale. A selection is a prediction only if its exact price, name, settlement definition and historical data can be verified.

| Proposed market | Existing BetGenius state | Needed evidence before production | Recommendation |
| --- | --- | --- | --- |
| Match winner / Double Chance / Total Match Goals / BTTS | Structured, model-supported, full-time-settleable; four markets retained in odds cache | Compare per-market calibration, settlement, median price, >1.12 eligibility and rejection rates across leagues | **Retain**, improve selection ranking and avoid artificially defaulting to DC |
| Team goals Over/Under: home, away | Structured and full-time-settleable; raw market probe already exists; missing from trimmed cache | Normalize `Total - Home`, `Total - Away`, and any equivalent provider names; preserve exact half-lines, opposing outcome pair and bookmaker count; validate no confusion with first-half totals; backtest distribution per line | **Top integration priority**; release only with exact prices and regression tests |
| Draw No Bet (home/away) | Structured, full-time/push-settleable; probability can be mathematically inferred from 1X2, but not an executable DNB price | Retain actual market quotes, validate draw settlement VOID and fair odds vs executable price | **High priority** after team totals |
| Win either half (home/away) | Structured and settleable when half-time and full-time data are available; not priced in retained quote cache | Check feed market name and two-half coverage by competition, actual bookmaker median and no impossible settlement assumptions | **High research priority**, evidence-dependent |
| Half-time result (1X2) | Not currently a dedicated generated market type | Add precise HT selection schema, actual half-time goals source, quoted “1st Half Winner” equivalent and settlement tests | **Candidate** once data coverage is confirmed |
| First-half goals Over/Under 0.5, 1.5 | Not a dedicated generated market | Quote exact first-half line, reliable half-time score; separate full-match O/U from HT O/U; calibrate per competition | **Candidate**, especially over 0.5 if not near-zero-priced |
| Win to nil / Clean sheet (team) | No structured generation & not in trimmed cache | Confirm market wording and Win-to-Nil vs Clean Sheet are different outcomes; actual quotes, full-time settlement rules | **Research only** until proven quoted widely |
| Team to score in both halves / First team to score | No dedicated market, needs time-segment/goal timing data | Verify event data completeness, market settlement and all exception states | **Later**; higher data-risk |
| Asian Handicap | Deliberately not in generic market vocabulary | Quote exact available `±line` and settlement/push rules. Prior research found invented/unquoted lines among 39/41 putative candidates | **No general activation** |
| European Handicap | Already special quoted-line, three-way, independently value gated | Keep existing sourced-line protection | **Retain unchanged** |
| Correct Score / Half-time–Full-time | Already structured but long-odds/high-variance and not price-supported for ordinary selection | Verify price breadth, confidence, competition data and realized calibration | **Avoid as routine safe tips** |
| Corners, cards, player-specific props | No reliable end-to-end prediction/settlement/pricing pipeline established | Additional player/official/event data, bookmaker/coverage/settlement and calibrations | **Exclude for now** |

## Selection policy after market enrichment

1. Produce independent candidate markets **only if available evidence supports them**, with one highest-value primary tip per fixture, not a quota of different types.
2. Attach a **verified, pre-kickoff exact market price** (at least five distinct books where possible), current quote timestamp and settlement definition. Do not fill missing quotes with implied prices or displayed zero.
3. Reject selections below the product’s appropriate **price floor** and keep existing free/VIP/Premium confidence floors distinct.
4. Rank by measured calibration and a **conservative, uncertainty-adjusted value estimate** at bookmaker-executable entry price, not simply by nominal confidence or largest odds. Odds alone are not “profit”.
5. Limit excessive same-market concentration in a slate as a **secondary ranking/tie-break rule only**. Never elevate a demonstrably weaker market just for visual variety. If alternatives are not justified, publish fewer picks.
6. Use prospective shadow predictions and out-of-sample fixtures before turning on a new market. Record entry price at decision time, bookmaker coverage, rejections, score, settlement, ROI, Brier/log loss and sample sizes by league/market/odds band. Paid users must not be the experiment.
7. Keep additional /odds queries inside existing API quotas and use cached raw observations when possible; expanding the *cached subset of the same API response* is preferable to fetching hundreds of markets or multiplying scheduled calls.

## Verification and rollout

- The modified `scripts/check-short-price-guard.ts` covers Home win 1.11, Double Chance 1.11, Total Goals Under 2.5 @1.04, BTTS 1.09, the inclusive 1.12 boundary, an acceptable 1.30 price, a missing-price Team Total, and the second-pass explanation.
- Run `npm run check:short-price-guard`, `npm run check:market-sanity`, `npm run check:team-total`, `npm run check:vip-premium`, `npm run check:paid-market-quality` (if defined in package scripts), `npx tsc --noEmit`, and preflight; review each real GitHub check result rather than assuming they pass.
- Compare 7- and 14-day **read-only** market mixes before release using `scripts/measure-market-distribution.ts`, then run a **shadow** future fixture check for missed-price and rejected-pick counts. No rollout should silently starve feeds.
- After deployment check upcoming real fixtures and their actual median prices. Confirm existing published picks, paid gating, manual editing and VIP quotas remain intact.
- Stage market enrichment in a **separate** PR with API payload evidence, settlement tests, and measured improvement. No invented market or price labels.

**Decision sought:** Review the odds-floor safety proposal; do not mistake this branch for an already live change or for approval to activate unverified new betting markets.