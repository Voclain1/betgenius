# Structured Data Validation

**Scope:** Homepage, match, league, team and H2H templates

**Reviewed:** 10 September 2026
**Reference:** Google Search Central structured-data guidance and Schema.org vocabulary.

## Decisions

- The homepage exposes `Organization` and homepage-only `WebSite` nodes. Both use the same BetGenius identity.
- No `SearchAction` is declared because the navigation search does not have a crawlable query-results URL.
- Match pages use `SportsEvent`, only with values already stored and rendered by the page.
- A `SportsEvent` without a complete stored venue/address remains descriptive Schema.org markup but is not claimed as eligible for Google's Event rich result, whose required fields include `startDate` and `location`. Production testing must record this distinction.
- A league is represented as event competition context (`superEvent`), not as `organizer`. The real host organization is not available in the data, so none is invented.
- Team and league feeds deduplicate multiple prediction markets into one event node per fixture.
- H2H, team, league and match pages expose canonical breadcrumb trails matching visible navigation hierarchy.
- `FAQPage`, review, ticket `Offer` and generic `Article` markup remain absent because the pages do not qualify for those claims.

## Template checks

| Template | Markup | Visible-data alignment | Local automated gate |
| --- | --- | --- | --- |
| Homepage | Organization, WebSite | Brand name, canonical origin and logo come from shared site configuration | Website publisher references the Organization ID; no false SearchAction |
| Match | BreadcrumbList, SportsEvent | Teams, kickoff, competition, venue, status and public description come from the rendered fixture data | Identities, dates, URL, location omission and gated-copy cases checked; rich-result eligibility depends on complete venue data |
| League | BreadcrumbList, deduplicated SportsEvent list | Events correspond to fixtures/predictions shown on the page | Multiple market rows collapse to one fixture event |
| Team | BreadcrumbList, deduplicated SportsEvent list | Events correspond to the team's published fixture cards | Same deduplication and public-pick rule as league |
| H2H | BreadcrumbList | Final crumb names and links to the visible pairing page | Canonical breadcrumb URL checked |

## Release validation still required

1. Deploy an isolated preview containing the SEO changes.
2. Test one real URL per template with Google's Rich Results Test or URL Inspection.
3. Record errors and warnings separately; unsupported types are not rich-result failures.
4. Confirm structured values are also visible to a signed-out visitor.
5. Repeat on production after deployment and monitor Search Console enhancement/manual-action reports.
