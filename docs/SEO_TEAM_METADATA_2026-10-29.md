# Team search metadata

Team pages previously titled themselves with only the club name. Their descriptions always claimed settled results even when all published picks were pending. They already contain predictions, profile information and, where available, upcoming fixtures.

The title now names the available intent: `<club> Predictions & Fixtures` when the displayed profile has upcoming fixtures; otherwise `<club> Predictions & Results` when published rows include settled outcomes; otherwise `<club> Predictions`. Descriptions use the same inventory and avoid missing-fixture and pending-only result claims. The fixture count is the bounded list shown by the profile, not a count of every future match.

Metadata shares the existing React-cached getTeamProfile read with the body. No football-provider requests, access-rule changes, new URLs, canonical changes or visible UI changes are introduced. The metadata calculation waits for the profile read that the page already performs; production latency should be observed. Actual ranking/CTR effects require Search Console evidence; none is claimed here. Team-query search volumes remain unverified because the research quota was exhausted.

## Previous release verification

After PR #124 merged, live requests confirmed `/predictions` declares `https://www.betgenius.ng/predictions`, and the sitemap index lists all seven children on `https://www.betgenius.ng`. This verifies those outputs, not Google's selected canonical or indexing response.

## Validation

203 SEO/semantics checks passed, including fixture availability, pending-only results and singular pick wording. Advertising checks passed. TypeScript and diff checks passed. No database/provider-backed rendering was performed; this change affects metadata only.
