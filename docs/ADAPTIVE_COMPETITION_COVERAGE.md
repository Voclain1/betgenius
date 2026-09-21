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
2026-09-21. Youth, women's, reserve and regional competitions are not in
any tier, even though they make up most of a quiet day's global slate.

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
- both team names present, and no U21/B/II/Jong/women's/reserve side;
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
