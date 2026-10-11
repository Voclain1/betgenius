# European-club coverage

How clubs playing in Europe this season get predictions for their domestic
league matches when their league is outside the daily scope, and why that lane
is strict.

Code: `src/lib/europeanClubs.ts` (policy, pure),
`src/lib/europeanClubsPipeline.ts` (database and provider I/O),
`runEuropeanClubGeneration` in `src/lib/generation/worker.ts` (the run).
Tests: `npm run check:european-clubs`.

## Why

Adaptive coverage (`docs/ADAPTIVE_COMPETITION_COVERAGE.md`) puts the Azerbaijan
Premyer Liqa and the Welsh Premier League in DEEP_FALLBACK. Those tiers are
only generated when CORE+SECONDARY has fewer than 12 usable fixtures in the
next 48h, which in practice means international breaks. So Qarabağ's and The
New Saints' league matches were never covered on a normal weekend, even in a
season when they played in the Champions League or Conference League. They are
the clubs in those leagues that a reader recognises.

The owner's conditions for the fix: give these clubs more attention, be strict
about it, and leave the existing setup exactly as it was.

## Who qualifies

A club that played a **main-stage** round of the Champions League, Europa
League or Conference League this season: any league-stage matchday, the
knockout-round play-offs, or a later knockout round. Clubs knocked out in
qualifying do not count, and nor does the pre-league "Play-offs" round.

The list is read from the `GenerationAttempt` ledger rows the discovery cursor
already writes for those three competitions (they are CORE, so every fixture is
seen). It costs no provider calls. The season starts on 1 July. Until the
league stage begins in mid-September the list is empty and the lane does
nothing.

Only the club's **domestic league** fixtures are considered, and only in a
catalogued FALLBACK or DEEP_FALLBACK men's league. CORE and SECONDARY leagues
are already covered every day. Cups are left out, because rotated squads
against lower-division sides make poor evidence.

## How strict

Three gates, in order. Nothing in the existing pipeline is loosened: the market
numbers are the Market-Confirmed and paid-tier constants, imported.

| Gate | When | Rules |
|---|---|---|
| Fixture | Sweep, no provider calls | Valid ids, scheduled, 12–48h before kickoff, senior sides only, not already covered by any prediction or ledger row, not known to have zero bookmakers |
| Market value | Before any model call or enrichment fetch | Full 1X2 market quoted by at least 5 bookmakers; a selection **backing the European club** (win or double chance) priced between 75% and ~87% after removing the bookmaker margin; quote under 90 minutes old |
| Drafts | After generation | Each draft must be Market-Confirmed: model ≥ 75%, market ≥ 75%, gap ≤ 10pp, ≥ 5 books, quote ≤ 2h. It must also not be shorter than ~87% (fair odds 1.15) |

- **The value band.** At ~87% or above (fair odds 1.15 or shorter) a pick
  carries no value. Below 75% the market does not rate the club in this match.
  A fixture outside the band is never generated, so no quota or model call is
  spent on it.
- **At most one pick per fixture.** The lane asks the model for several markets,
  as the VIP pass does, so the draft gate has more than one selection to judge.
  It keeps only the best survivor, by `compareMarketConfirmed`. Every other
  draft is archived. When nothing passes, everything is archived.
- **Never auto-published.** The kept draft is an ordinary FEATURED pick in
  `PENDING_REVIEW`, published by a human like every other ordinary pick.
- **One shot per fixture.** A fixture the lane has generated is never generated
  again. A run that throws before anything was judged backs the fixture off for
  3h instead.
- **Caps.**
  - At most 4 model calls per Lagos day.
  - One fixture per run.
  - At most 2 odds calls per run looking for a fixture worth generating.
  - The lane stands down below 1,500 remaining api-football calls. The
    fallback sweep's floor is 1,000, so the lane gives way first.

## Separate from the existing setup

- The lane **never writes the `GenerationAttempt` ledger.** Its attempt record
  is the `EUROPEAN_CLUB`-intent `AIJob`, as the Goals pass does it.
- These paths never see a lane fixture before it is generated, because they all
  read the ledger:
  - the ordinary worker;
  - Goals (which only targets ledger rows that have `SUCCEEDED`);
  - Bet of the Day targeting;
  - combo pools;
  - the odds workload.
- `countViableSlate` leaves lane predictions out, so the adaptive scope decision
  (healthy, thin or very thin, and how much to widen) is exactly what it would
  be without the lane.
- If ordinary generation takes a fixture first (a thin day widens into it), the
  lane sees the ledger row or the prediction and stands off.
- The only shared-code changes:
  - `EUROPEAN_CLUB` is a multi-market intent in `doublesTargeting.ts`;
  - no same-game double is assembled from its drafts (`generate.ts`);
  - the slate-count exclusion (`queue.ts`).

## Provider cost

Each poke does one of two things.

- **Sweep, every 3h:** one `/fixtures?date=` call per date in the 12–48h horizon
  (2–3 calls), returning every competition at once. The candidate list is
  stored in the `AppLock` row that holds the sweep lease. If every call fails,
  the previous list is kept and the sweep retries in 30 minutes.
- **Generate, otherwise:**
  - zero calls when nothing is eligible;
  - at most 2 odds calls to price a candidate;
  - about 11 calls plus one multi-market model call for the fixture generated.

Worst case per day: 8 sweeps × 3 = 24 calls, plus 4 fixtures × ~13 = ~52 calls.
That is about 76 calls a day against a 7,500 cap, and nothing at all while no
club qualifies.

## Scheduling

Add one cron-job.org entry. **Until it exists, the lane does nothing.** That is
the failure `docs/GENERATION_SCHEDULING.md` describes for Bet of the Day, which
was built and never scheduled. `/admin/jobs` lists `generate-european-clubs`,
which shows "never ran" until the entry exists.

| Endpoint | Schedule | Notes |
|---|---|---|
| `/api/admin/generate/run?european=1` | `15,45 * * * *` | GET, `Authorization: Bearer <CRON_SECRET>`, Africa/Lagos. Shares the generation lease: a poke that lands on another pass stands down harmlessly. |

## Reading a run

The run detail (`generate-european-clubs` in `/admin/jobs`) carries:

- `europeanClubs.sweep`: clubs known, by-date calls, the candidates found and
  the fixtures refused by reason;
- `europeanClubs.selection`: candidates eligible this run, skips by reason
  (attempted, backing off, already covered, inside lead time), and every
  fixture the market gate evaluated with its verdict;
- `europeanClubs.target`: the fixture generated, the club, and the selection
  and de-vigged price that justified it;
- `europeanClubs.judgement`: the kept draft (model, market, gap, books) and
  every archived draft with its reason.

`stoodDown` says in one line why a run generated nothing. Most runs generate
nothing, and that is expected.
