# Issue #237 — five-day generation, pre-prediction match pages, SEO integrity, duplicate review, rollout flags

One sprint, one PR. Everything new is **default off or behaviour-preserving** except the generation horizon (see "Behaviour changes").

## 1. Audit (what the code actually did)

| Area | Finding |
|---|---|
| Horizon | `inEarlyGenerationWindow` reused the discovery horizon (CORE 14d, SECONDARY 10d, FALLBACK 7d, DEEP 5d), so early generation/publication ran 10–14 days out. It is used by `earlyGeneration`, `earlyPublication` (twice, incl. the atomic publish in `predictions.ts`), and `earlyOdds` (odds warming). `periodPredictions.picksArriveFrom` used `EARLY_GENERATION_UNTIL_HOURS` (336). |
| Match page | `/predictions/match/[slug]` resolved only via `getPublishedByMatchSlug`; no published row → 200 empty shell, `noindex`. |
| Sitemap | `matches.xml` listed only published fixtures that pass `assessMatchEvidence`; page robots and sitemap each re-derived the decision. |
| Schema | `sportsEventJsonLd` emitted `superEvent: {"@type":"SportsEvent", name: <league>}` — a competition node with no `startDate`/`location`, exactly what Search Console flagged. |
| Duplicates | Bulk publish published first, then returned `DUPLICATE_FIXTURE: <db id>` which the UI showed in `alert()`. The single-row route had no check. Two simultaneous publishes could both pass (READ COMMITTED). |
| Rollout env | `merge-rollout-env.py` preserved 3 flags; PR #235 flags (`MARKET_*`, `FREE_TIER_NEUTRAL_BANDS`) were reset from the incoming secret on every deploy. |
| La Liga URL | See §6. |

## 2. What changed

**A. Generation horizon** (`src/lib/generation/earlyFixturePolicy.ts`)
- `generationHorizonHours()`: CORE/SECONDARY/FALLBACK/unknown **120h**, DEEP_FALLBACK **72h**; the 48h final lane is untouched.
- `inEarlyDiscoveryWindow()` keeps 14/10/7/5 days; used only by odds warming and discovery queueing, so provider-call volume and quota behaviour are unchanged (no new API calls anywhere).
- `inEarlyGenerationWindow()` = after 48h **and** inside the generation horizon; every automatic entrypoint (queue selection, early publication scan, atomic publish) goes through it. Drafts already created outside the window are never deleted or rewritten; auto-publication simply stops considering them until they enter the window.
- Admin exception: `POST /api/admin/generate/early-run` `{matchKeys:[≤3]}`, admin session only (the cron secret is rejected), fixture must be captured, inside its discovery window, with a **fresh actual quote**. Output is an ordinary reviewable draft; it cannot auto-publish outside the 5-day window.
- Checkpoint policy: 72–48h remains the ordinary review point; a verified publishable pick earlier than 72h is not blocked once it is inside 120h. Published picks are untouched.

**B/C. Match previews** (`MATCH_PREVIEW_MODE` = `off` | `noindex` | `on`, default **off**)
- `src/lib/matchPreview.ts`: resolves an upcoming `UpcomingFixture` (status NS, future) by slug with a day‑bounded query; re-derives the slug per candidate; **collision → no page**; fixture with any published pick is a published page, never a preview (one canonical URL); an unknown slug 301s to the fixture's current page when exactly one current page exists for the same home/away pairing (stateless, **no schema change**; ambiguous → no page).
- `MatchPreviewPage`: kickoff, competition, venue/round when cached, recent form, venue splits, table, H2H, "Prediction not published yet". No pick, confidence, market, odds, lineup, injury or editorial text; no draft/paid row is read. h1 says "match preview".
- `src/lib/matchIndexability.ts`: the **one** decision. Page `robots` (published and preview) and `matches.xml` both call it. Preview indexable only if mode `on`, CORE/SECONDARY, kickoff within 14 days, and `assessMatchEvidence` substantive on the evidence shown (analysis signal never claimed).
- Sitemap: preview + published merged, deduped by slug; preview `lastmod` = newest fetchedAt of the evidence caches that fixture uses (not rediscovery time); 3 evidence reads per 250 fixtures, query count independent of fixture count.
- `UpcomingPreviews` on league pages lists only previews the sitemap would list.
- `superEvent` removed; `sport: "Soccer"` added. No offers/organizer/venue invented.
- No Indexing API / URL submission added.

**D. Duplicate publishing** — `src/lib/duplicatePublication.ts`, bulk route, admin queue
- Dry run (`dryRun:true`) returns side-by-side reviews (match, kickoff, existing vs proposed: market, selection, category, confidence, odds; SAME / CONFLICTING / DISTINCT) before anything is written.
- Publish re-checks **inside the transaction** under a per-fixture advisory lock; undecided duplicates fail closed; override needs a ≥8 char reason and is recorded (`JobRun` job `duplicate-publication-override`). Single-row route also fails closed. Nothing is ever deleted/unpublished/rewritten. Unrelated rows in a bulk call still publish. No `alert()`, no database ids in UI text.

**E. Rollout flags** — `merge-rollout-env.py` also preserves `MARKET_SELECTION_MODE`, `MARKET_QUALITY_RANKING`, `FREE_TIER_NEUTRAL_BANDS`, `MATCH_PREVIEW_MODE` (missing → off, invalid/duplicate → abort without echoing values, atomic 0600 replace). `deploy-vps.yml` verifies all seven in the container.

**F. Measurement** — admin-only `GET /api/admin/early-metrics`: discovery/generation/publication lead-time histograms (30 d), status counts, failed attempt reasons, indexable previews = sitemap count. Shadow market quality: existing `/admin/market-quality`.

## 3. Behaviour changes to review
1. Early generation/publication now starts at ≤120h (DEEP ≤72h) instead of ≤336h. Discovery/odds warming unchanged.
2. `picksArriveFrom` (weekend/midweek early view) moves from 14 to 5 days with it.
3. Bulk publish of a second FEATURED single now requires a decision (was: publish then warn).
4. `superEvent` is gone from `SportsEvent` JSON-LD site-wide.

## 4. Validation actually executed (this branch)
- `tsc --noEmit` clean; `next build` succeeds against a disposable Postgres.
- New `scripts/check-match-preview.tsx` (69 assertions: indexability matrix, parity page↔sitemap for every fixture, collision, postponed, published-ownership, alias redirects, bounded queries, no leakage, schema, duplicate classification, source guards) and `scripts/check-duplicate-publication-postgres.ts` (real Postgres: review, fail-closed, audited override, concurrent publish — verified to FAIL when the advisory lock is removed).
- Extended `check-early-fixtures` (14/10/7/5/3/2/1‑day boundaries, tiers, reschedule, override), `check-rollout-env.py`.
- Updated three suites that encoded the old behaviour (`check-early-odds`, `check-period-predictions`, `check-goals-generation`) and `check-market-quality-postgres` (old "publish with warning" → review flow).
- Full `scripts/check-*` sweep: after fixes, every remaining failure is identical to master (22 of them, environment-dependent: no provider/secrets/browser), including with the disposable DB.
- Rendered check (signed-out Googlebot UA, `next start`): warm preview → no robots tag, canonical self, SportsEvent without `superEvent`; cold preview and unknown slug → `noindex, follow`; after inserting a published pick the **same URL** becomes "prediction", the preview notice disappears and the sitemap lists one URL; iPhone 13 viewport has no horizontal overflow.

## 5. Not done / limits (stated plainly)
- **No production data access** from this environment (no DB, GSC via Ahrefs returned "Insufficient plan"). The 30-day lead-time/stale-evidence baseline and index-state samples therefore were **not** produced; `/api/admin/early-metrics` computes them in production once deployed. No accuracy benefit is claimed.
- Not run: GitHub Actions matrix, live Search Console inspection, Chrome-driven browser suites needing `google-chrome`. Run CI on the PR.
- Google decides crawling/indexing; no SLA or rich-result promise.

## 6. La Liga `/predictions/league/la-liga-140`
League slug = `slugify(storedLeagueName)-id`; the page 200-s with `noindex` when no published row matches. If production stores the Spanish name the real slug differs from `la-liga-140`. Unverifiable without production data, so **no code change**. Check: `select distinct "leagueName" from "Prediction" where "leagueApiId"=140`, compare to the sitemap's `leagues.xml`, and inspect the sitemap URL (not the guessed one) in Search Console.

## 7. Rollout (nothing is changed by merging)
1. No database migration is required.
2. Deploy. All flags stay as preserved on the VPS; `MATCH_PREVIEW_MODE` defaults off. Verify via deploy step output (names/values of the 7 flags only).
3. Owner-authorised VPS ops: `MARKET_SELECTION_MODE=shadow`, `MARKET_QUALITY_RANKING=off`, `FREE_TIER_NEUTRAL_BANDS=off`.
4. Preview soft launch: `MATCH_PREVIEW_MODE=noindex` → inspect pages and `/api/admin/early-metrics` → `on` for indexing.
5. **Rollback**: set `MATCH_PREVIEW_MODE=off` (pages revert to prior shell, sitemap drops previews); horizon rollback = revert `EARLY_GENERATION_UNTIL_HOURS` to 336 (one constant).
