# Adaptive competition coverage

How the scheduled generator decides which competitions to cover on a given day,
and what that costs in API-Football calls.

Code: `src/lib/leagues.ts` (`GENERATION_TIERS`), `src/lib/generation/coverage.ts`
(policy, pure), `src/lib/generation/queue.ts` (discovery I/O),
`src/lib/generation/worker.ts` (ordinary-run scope). Tests:
`npm run check:adaptive-coverage`.

## Why

On 21 September 2026 API-Football listed 160 fixtures, 4 of them in scope, and
the site carried 4 predictions. Generation was healthy; the fixed scope was too
narrow for an international-break day. The opposite failure was already there
on normal days: the discovery cursor walked all ~90 catalogued leagues, so
Kazakh, Belarusian and Baltic fixtures were generated every day whether the site
needed them or not.

## Tiers

| Tier | Competitions |
|---|---|
| **CORE** | Premier League, Championship, FA Cup, EFL Cup, La Liga, Copa del Rey, Serie A, Coppa Italia, Bundesliga, DFB Pokal, Ligue 1, Coupe de France, UCL, UEL, UECL, World Cup, Euro |
| **SECONDARY** | Portugal, Netherlands, Belgium, Turkey (league + cup each), Saudi Pro League, NPFL, Sweden, Norway, Czechia, Austria, Switzerland, Denmark, Poland, Greece, Scotland (league + cup each), Brazil Serie A |
| **FALLBACK** | Nations League, WC qualifiers (Europe, South America, Africa), Euro and AFCON qualifiers, Libertadores, Sudamericana, CAF CL, AFC CL Elite, international friendlies; 2. Bundesliga, Segunda, Serie B, Ligue 2, League One, League Two, EFL Trophy, Eerste Divisie, Liga Portugal 2, Scottish Championship, Superettan; Russia, Serbia, Croatia, Ukraine, Bulgaria, Romania (+ cups), Finland, Hungary, Israel, Ireland, Slovakia, Cyprus; Argentina, Brazil Serie B, Colombia, Liga MX, MLS, J1, K League 1, Egypt, South Africa |
| **DEEP_FALLBACK** | CAF Confederation Cup, Asian and CONCACAF qualifiers, 3. Liga, National League, Wales, Belarus, Kazakhstan, Estonia, Latvia, Lithuania, Armenia, Azerbaijan, Moldova, Bosnia, the smaller domestic cups (FAI, Icelandic, Cyprus, Israeli), Ecuador, Peru, Chile, China, Algeria, Ghana, J2, USL Championship |

Membership comes from 120 days of published predictions per league,
FixtureOddsCache bookmaker depth per league, and API-Football's live
current-season coverage flags. Every new competition had odds coverage on
2026-09-21. Youth, reserve and regional competitions are not in any tier,
even though they make up most of a quiet day's global slate.

### Senior women's competitions

Added 2026-09-22 after a live audit (`npm run research:womens-coverage` and
`research:womens-odds`). Bookmaker depth is measured on fixtures finished in
the last 7 days. The men's baseline is Premier League median 9 and Eredivisie 9.

| Tier | Competition (provider id) | Recent fixtures priced | Books median |
|---|---|---|---|
| SECONDARY | Women's Super League (44) | 6/6 | 6–7 |
| SECONDARY | Frauen-Bundesliga (82) | 5/6 | 8 |
| SECONDARY | Liga F (142) | 5/6 | 7 |
| SECONDARY | NWSL (254) | 5/6 | 8 |
| FALLBACK | UEFA Women's Champions League (525) | 0 of 6 a day out; provider odds coverage off | 0 |
| FALLBACK | Première Ligue (64) | 1/6 | 0 |
| FALLBACK | Damallsvenskan (549) | 6/6 | 5 |
| DEEP_FALLBACK | Super League Women, Belgium (146) | 4/4 | 5 |
| DEEP_FALLBACK | Brasileiro Women (74) | 2/2 | 6 |

Not added: Serie A Women (139), where the provider has predictions only (no
events, statistics or odds). Also not added: Toppserien (725), Eredivisie
Women (91), Frauenliga (484) and UEFA Europa Cup Women (1191), which are priced
on too few fixtures.

- **Ranking:** women's SECONDARY leagues sit at the end of SECONDARY, so every
  men's CORE and SECONDARY league outranks them for curation, Bet of the Day
  and digest highlights.
- **Thresholds:** they go through the same pipeline with the same thresholds
  as men's football: 5 bookmakers minimum, the 75% market-confirmation floor
  and the Bet of the Day price band.
- **UWCL is FALLBACK for data quality, not sporting importance.** The
  provider does not price it yet. SECONDARY fixtures count toward the
  CORE+SECONDARY ≥ 25 healthy threshold, so unpriced UWCL fixtures there would
  make a thin day look healthy and suppress the fallback sweep. As FALLBACK it
  is generated only when the slate widens. It is never a digest highlight, and
  it can't be market-confirmed or Bet of the Day until it is priced. Move it to
  SECONDARY once the provider covers it.
- **Push:**
  - The WSL can carry an immediate `TOP_PREDICTION` push on tier.
  - UWCL is in `TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY`: it pushes only when
    the prediction is published, unsettled and `MARKET_CONFIRMED`. That is the
    existing odds-agreement gate, applied as a requirement; no threshold is
    lowered for it. The broadcast records the prediction's provenance on the
    event, and dispatch reads it.
  - Every other women's league reaches the inbox only.
  - All are under the 1–3 daily cap.
- **Provider cost:**
  - The four SECONDARY leagues join the normal per-league discovery rotation
    (46 → 50 leagues). The cursor still makes 3 `/fixtures?league=` calls per
    discovery cycle, so each league is visited a little less often, and the
    calls per cycle don't change.
  - The five FALLBACK and DEEP_FALLBACK leagues are found mainly through the
    existing by-date sweep, and only while adaptive widening is active.
  - Every women's fixture that is generated then costs the normal
    per-fixture enrichment and odds calls, like any other fixture.
  - There is no new cron job and no new provider endpoint.
- **Name gate:** `SENIOR_WOMENS_COMPETITION_IDS` in `src/lib/leagues.ts` is the
  explicit list. Only inside those competitions is a "… W" / Women / Ladies /
  Fem team name accepted as a senior side. The same rule also filters
  CORE/SECONDARY discovery, which does not go through the fallback gate. U-age,
  B/II/III, reserve, youth, academy and Jong sides are refused everywhere, and a
  women's fixture in any other competition is still refused.

Every catalogued league is in exactly one tier (enforced at import).
`LEAGUE_PRIORITY_ORDER` is now the tiers concatenated. Its first 12 entries,
the paid-tier (VIP proxy) set, are unchanged and in the same order.

## Policy

| CORE+SECONDARY viable fixtures, next 48h | Scope |
|---|---|
| ≥ 25 | CORE+SECONDARY only. No fallback scan, no fallback generation. |
| 12–24 | Widen into FALLBACK until the usable slate reaches ~28. |
| < 12 | Widen into FALLBACK, then DEEP_FALLBACK only for what FALLBACK cannot supply, toward ~25. |

The thresholds live in `COVERAGE_POLICY`. The decision is re-made every cycle,
so there is no manual "international break mode". When CORE+SECONDARY clears
25 again, discovery stops sweeping, and ordinary generation excludes
fallback-tier ledger rows via `excludeLeagueApiIds`. Those rows are left in
place, not cancelled.

The target is a ceiling on widening, never a quota. A fallback fixture must pass
`fallbackQualityGate`, which checks:

- valid, distinct provider ids;
- a recognised fallback-tier competition;
- status `NS` and a parseable kickoff;
- both team names present, and no U21/B/II/Jong/reserve side, and no women's
  side unless the competition is in `SENIOR_WOMENS_COMPETITION_IDS`;
- not a configured cup recorded as unpriced;
- not already known to have zero bookmakers.

It then goes through the same `candidatesFromFixtures` rules and the same
generation gates as every other fixture. No confidence, market-confirmation or
quota threshold changes, and there is no fallback-specific prompt or
calibration.

## How "thin" is detected without spending quota

The per-league cursor now walks CORE+SECONDARY only: 46 competitions, a full
pass every ~16 cycles. The ledger (`GenerationAttempt`, plus predictions) is
therefore an up-to-date picture of the higher-tier slate. `countViableSlate`
counts it per tier with two database queries and **zero** provider calls.

## Provider cost

- **Busy day:** unchanged per-cycle cost (the cursor's batch of 3 per-league
  calls) and zero fallback calls. Across a day this is cheaper than before,
  because ~45 minor leagues are no longer scanned or generated.
- **Thin day:** one `/fixtures?date=` call per UTC date in the horizon (2–3).
  That single call per day returns every competition at once, where scanning
  per league would cost one call per competition. The sweep is held to one run
  per 60 minutes by an `AppLock` lease. It is skipped when the target is
  already met, when the discovery time budget is short, or when fewer than
  1,000 daily calls remain.
- **Worst case:** 24 sweeps × 3 dates = **72 calls/day**. Scanning the 75
  fallback competitions (47 FALLBACK + 28 DEEP_FALLBACK) per league every 15
  minutes would cost 7,200. Each
  fallback fixture that is generated then costs the normal ~11 calls. At most
  ~25 are selected per 48h window, so roughly 275–440 calls/day on a fully
  thin day, against 3,300–6,250 used on recent days and a 7,500 cap.

No schema change: the lease is a row in the existing `AppLock` table, next to
the discovery cursor.

## Observability

Discovery is now recorded as the `generation-discovery` job. Its run detail
carries `coverage`:

- mode;
- per-tier viable counts;
- higher-tier count;
- fallback already selected, and fallback queued this run (by tier);
- leagues scanned by tier (cursor) and competitions seen by tier (sweep);
- provider calls (cursor and sweep);
- gate refusals by reason;
- the widened or narrow reason.

/admin/jobs shows the latest decision in a "Competition coverage" card.
Ordinary generation's run summary names the scope it ran in.
