# Banker search-intent and registration correction

Search Console export (30 September–27 October): banker prediction recorded 14 clicks, 83 impressions and position 10.34. Banker prediction today recorded one click, 18 impressions and position 19.06. The page recorded 33 clicks and 201 impressions. Query and page tables are independent; no exact query-to-page mapping is claimed.

Live review found the Banker heading was simply Banker. More materially, signed-out cards explained that signup was free but their Upgrade to unlock buttons led to pricing.

## Change

- Clean Banker title and H1 become Banker Predictions Today / Banker predictions today. Yesterday/tomorrow states use their own day wording and retain their existing noindex policy.
- Populated Banker descriptions state the selected day, count, free registration, reasoning and public results instead of implying the anonymous reader can already see confidence ratings.
- The server's existing needsRegistration decision now supplies /register to locked cards. The card labels that destination Sign up free to unlock. Other locked cards keep /pricing and Upgrade to unlock by default.
- No entitlement check, protected pick, robots gate, sitemap eligibility, layout or advertising policy changes. The compact table remains locked as before; this corrects the detailed cards' existing CTA.

## Verification

135 prediction-view rendering checks, 203 SEO/semantics checks, advertising checks, TypeScript and diff whitespace checks passed. Added rendering assertions for the free registration CTA and preserved paid upgrade default. Tests do not query production or the provider.

This batch changes heading length and button text within existing styles. Desktop/mobile visual verification and production metadata/CTA checks remain pending. No browser screenshot or ranking uplift is claimed.
