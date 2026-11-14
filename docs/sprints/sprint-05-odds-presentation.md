# Sprint 05 — Odds Intelligence & Presentation

Presentation only. Existing verified odds are written the same way everywhere,
a price that is not a valid decimal quote is never printed as a number, and four
labels that claimed more than the data establishes now say what the data is. The
odds engine, quote validation, freshness policy, refresh jobs, generation,
selection, publishing, settlement and schema are untouched.

Starting master: `861b96a`. Compared with open PR #184 at `c4a42ab`, which was
not touched.

## 1. Odds presentation inventory

| Surface | Component | What it shows | Data origin | Changed |
| --- | --- | --- | --- | --- |
| Match page odds panel | `MatchOddsPanel` | Best / median per selection, provider quote time, current / stale / archived / unavailable states | `FixtureOddsCache` via `matchOddsState` | no — audited, already adequate |
| VIP / Premium card | `PredictionCard` `PaidDetails` | One price with its provenance (entry / current / closing), books, time | `paidCardDetail` | labels, validity |
| Bet of the Day | `BetOfTheDayCard`, `/predictions/bet-of-the-day` | Big price, "Best of N bookmakers · age" | odds gate | validity, a11y |
| Multi bets | `ComboCard` | Leg prices, product, implied % | `ComboLeg.odds` snapshots | copy, validity, a11y |
| Trend card | `TrendCard` | "@ price" for the trend's bet | `topTrends` | validity, a11y |
| Dashboard picks / saved list | `DashboardParts` | "Odds x.xx" | `Prediction.odds`; `SavedPrediction.odds` snapshot | label, validity, a11y |
| Bet Builder, Odds Calculator | `BetBuilderClient`, `OddsCalculator` | user-entered calculation | n/a | excluded (calculators) |
| Paid performance panel | `PaidPerformancePanel` | recorded vs closing average odds, units | settled record | excluded (ROI) |
| Emails | `mail/templates.ts` | " @ x.xx" | `Prediction.odds` | excluded (not a page) |
| Published market comparison, selection quotes | `PublishedMarketComparison`, `selectionQuote` | — | PR #184 | excluded (owned by #184) |

## 2. Verified defects

Each was confirmed in code; where a browser could show it, in a render.

1. **Labels claiming more than the data says** (`PredictionCard`):
   - "Price now": `paidCardDetail` labels a quote `current` whenever kickoff is
     in the future, with no age check (the match panel withholds quotes older
     than two hours). Nothing establishes the price is live.
   - "Closing price": it is the last cached quote before kickoff, which need not
     be the closing line.
2. **"at best available prices"** (`ComboCard`): leg prices are snapshots taken
   when the multi bet was built (`ComboLeg` schema comment). The copy read as a
   current availability claim.
3. **A saved price with no context** (`SavedRow`): "Odds 2.10" did not say it is
   the price at save time (`SavedPrediction.odds` is a save-time snapshot).
4. **No validity guard on printed prices.** A present-but-invalid value printed
   as `Odds 0.50`, `Odds NaN`, `0.00`, `@ NaN`, `×Infinity` on the dashboard,
   saved list, paid card, trend card, Bet of the Day and combo card. `ComboCard`
   also accepted `Infinity` as a valid leg. Today's data carries valid prices,
   so this is defensive hardening, not an observed production fault.
5. **Screen readers heard symbols:** "@ 1.85", "×4.32", a bare "2.40" above the
   word "Odds".

Checked and found fine: two-decimal formatting (`toFixed(2)` everywhere); the
match panel's states and wording; no duplicate odds displays within a surface;
Bet of the Day shows an age beside its price.

## 3. Ownership matrix

| Area | Owner | Sprint 05 |
| --- | --- | --- |
| Odds ingestion, refresh jobs, cron, API-Football | VIP Reliability | not touched |
| Quote validation / selection / freshness policy (`lib/odds.ts`, `matchOdds.ts`) | VIP Reliability | read only, not imported |
| Evidence storage, `paidFeedData` (price kind decision), `marketConfirmed` | VIP Reliability | not touched |
| Generation, selection, publishing, settlement, entitlements | VIP Reliability | not touched |
| Discovery, category/match pages, `selectionQuote`, `PublishedMarketComparison`, `predictionVisibility` | PR #184 | not touched |
| How an already-available price is written | product | changed |

Overlap with #184's 35 files: `package.json` only (separate script lines). A
trial merge of #184 into this branch conflicts only in
`predictions/match/[slug]/page.tsx`, which already conflicts with `master` and
which this branch does not touch.

## 4. Changes made

- `src/lib/oddsFormat.ts` (new, pure): `validOdds()` (finite and > 1, the odds
  engine's own rule) and `formatOdds()` (exactly `toFixed(2)`). It never alters,
  rounds differently or substitutes a value.
- `src/components/OddsFigure.tsx` (new, server component, no client JS): one
  price with "Decimal odds" text for screen readers, the visual lead (`Odds `,
  `@`, `×`) hidden from them, optional read-aloud tail. Renders nothing for an
  invalid price, so each surface shows its own "not available" state.
- `PredictionCard`: labels now **Price when published** (unchanged), **Latest
  quote** and **Last quote before kickoff**, each beside its own timestamp; an
  invalid price takes the existing "No bookmaker quote for this market" state.
- `ComboCard`: "at the prices when this multi bet was built"; validity uses the
  shared rule; the product and leg prices are unchanged. A card with any invalid
  leg shows no prices rather than a wrong product.
- `DashboardParts`: saved rows say "Odds 2.10 **when saved**"; pick and saved
  rows omit an invalid price.
- `TrendCard`, `BetOfTheDayCard`, the Bet of the Day masthead stat: same figure,
  invalid price → no price line / "Price not available yet".
- Two Sprint 03 assertions that read the old `Odds {x.toFixed(2)}` markup now
  read the new markup; their intent (labelled "Odds", never "@", apart from
  confidence) is unchanged.

## 5. Explicit exclusions

No odds movement, bookmaker comparison, history chart, probability forecast,
calculator, modal or badge was added. Not changed: `MatchOddsPanel`, the Bet
Builder, Odds Calculator, ROI panels, emails, any data loader, `paidFeedData`.
A freshness age on the paid card was not added: it would be computed from page
load time, which the sprint rules out; the quote's own timestamp is shown
instead. A build time for multi bets was not added: it needs a new field in the
page's query.

## 6. Before and after

`docs/sprints/screenshots/sprint-05/{before,after}/odds-surfaces-{375,1440}.png`
(with the extracted text beside each). **Demonstration data**: invented fixtures
and prices, rendered with the real components and stylesheet from `master`
(before) and this branch (after), with identical fixtures. Rows marked "broken"
feed a deliberately invalid price. They are not production odds.

| Case | Before (master) | After |
| --- | --- | --- |
| Pick price 0.5 | `Odds 0.50` | no price |
| Saved price NaN | `Odds NaN` | no price |
| Saved price 2.10 | `Odds 2.10` | `Odds 2.10 when saved` |
| Paid price 0 | `0.00 median of 9 books` | "No bookmaker quote for this market" |
| Paid current / closing | "Price now" / "Closing price" | "Latest quote" / "Last quote before kickoff" |
| Multi bet, leg Infinity | `×Infinity`, `~0.00%` | no prices |
| Multi bet copy | "at best available prices" | "at the prices when this multi bet was built" |
| Trend price NaN | `@ NaN` | no price line |
| Bet of the Day price 0 | `0.00` | "Price not available yet" |

## 7. Tests

| Check | Result |
| --- | --- |
| `check-odds-presentation` (formatter, labels, boundary) | 42 pass |
| `check-odds-presentation-render` (every surface: valid, missing, invalid, locked, saved, settled) | 74 pass |
| `check-odds-presentation-browser` (6 surfaces × 5 widths: 320/375/414/768/1440) | pass |
| Sprint 03 checks updated for the new markup | 119 + 60 pass |
| `tsc --noEmit`, `next build` | pass |
| `npm run preflight` (site up) | 96/100 |
| Integration, individually, throwaway Postgres: tier-provenance 30, vip-premium-gate 30, betofday-targeting 7, personalization-db 65, match-centre-db 9, prediction-experience-db 9 | all pass |
| Routes smoke (home, today, genius, btts, vip, bet-of-the-day, multi-bets, match) | 200 |

The four preflight failures are baseline and unrelated: `check-house-banners`,
`check-goals-category`, `check-sitemap-scoping` (fail on `master`) and
`check-db-safety` (only because a local `.env` database identity is present).
Premium visibility: locked cards and locked saved rows render no price, market
or pick; `check-vip-premium-gate` passes unchanged.

## 8. Accessibility

Every price now reads "Decimal odds 1.85" to a screen reader and the visual lead
(`Odds`, `@`, `×`) is `aria-hidden`; a saved price reads "… when saved". The
browser check confirms the screen-reader text is present beside every price and
visually hidden, that price text is at least 11px, and that nothing is clipped
or overflows at 320–1440px, using prices up to 250.00 a leg and a ten-digit
product. Not run: an assistive-technology session; contrast is unchanged.

## 9. Performance

No new request, query or dependency. `OddsFigure` is a server component (no
client JS). Budgets pass (75 pages): shared JS 110.4 / 120 KB unchanged; match
page 157.3 / 160 KB (S04: 157.2); homepage 152.2 KB.

## 10. Cross-sprint compatibility

Sprint 01 saved snapshots are untouched: the saved price is still the snapshot,
never re-fetched, and a changed pick keeps its saved price and outcome. Sprint
02/03 match, status and kickoff code is untouched and their checks pass. Sprint
04 navigation is untouched and its checks pass.

## 11. Known limitations

- The paid card's `current` kind is still decided by `paidFeedData` (reliability
  owned) without an age check; this sprint only stops the label from claiming
  "now". A freshness rule belongs to that workstream.
- Multi-bet prices show no build time (would need a new field).
- Emails still print `@ x.xx` without the validity guard.
- Screenshots are component-level renders with demonstration data, not a
  production page capture.

## 12. Merge readiness

Ready for review. Merges cleanly into `master`; #184 needs its own rebase for
the match-page conflict regardless. Not merged or deployed.
