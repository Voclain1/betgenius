# League results in initial HTML

LeagueResults previously emitted only a loading placeholder before its client effect fetched two complete daily fixture slates. For competitions already covered by the homepage's shared recent-results snapshot, the league page now supplies that competition's rows to the same component during server rendering.

This reuses the existing snapshot lease, 15-minute refresh interval, 200-call daily ceiling and quota-headroom gate. It adds no separate refresh policy or provider endpoint. Visits may trigger the same shared refresh that homepage visits trigger. Leagues outside the snapshot coverage retain the existing client feed; an explicit empty array renders the empty state immediately. Snapshot failures/empty data retain the existing snapshot service's behaviour; this change does not add an availability signal.

The same date grouping, 36-hour window, finished-status filtering, design and published-match link index remain. Snapshot-covered pages now get their results from the shared snapshot rather than a fresh per-visitor slate, so freshness follows that snapshot's policy. Client route changes are keyed by league to avoid reusing another league's result state. The fallback feed now treats non-2xx responses as failures rather than reporting them as an empty successful feed.

## Validation

- New offline server-render check: 9 assertions cover visible teams, published match links, no loading placeholder for supplied rows, league/window/status filtering, explicit empty snapshots and uncovered-league loading.
- Existing recent-results policy checks: all passed.
- Existing SEO/semantics checks: 195 passed, 0 failed.
- Advertising checks: OK.
- TypeScript and diff whitespace checks: passed.
- No database/provider calls were made by these tests.
- Desktop/mobile visual review remains pending: the browser binary download failed in this environment. Real database-backed page rendering and production verification remain pending too.

Run the new check with `TSX_TSCONFIG_PATH=scripts/tsconfig.render.json node --import tsx scripts/check-league-results-render.tsx`. This change improves initial content delivery; no ranking uplift is claimed.
