/**
 * What each preflight tier runs. Kept apart from scripts/preflight.ts so
 * scripts/check-db-safety.ts can assert the split without starting a run.
 * Adding a check: put it in PURE_STEPS only if it passes with NO_DATABASE_URL
 * and no network; a check that writes to the database belongs in
 * INTEGRATION_STEPS and must call assertIntegrationDatabase first.
 */
const RENDER = "tsx --tsconfig scripts/tsconfig.render.json";

/** Pure: in-memory stubs or no database access at all. Proven by running with NO_DATABASE_URL. */
export const PURE_STEPS = [
  "tsx scripts/check-paystack-entitlement.ts",
  "tsx scripts/check-subscription-entitlement.ts",
  "tsx scripts/check-onetime-fallback.ts",
  "tsx scripts/check-payment-observability.ts",
  "tsx scripts/check-combo-bet-copy.ts",
  "tsx scripts/check-homepage-featured.ts",
  "tsx scripts/check-adaptive-combo.ts",
  "tsx scripts/check-confidence-consistency.ts",
  "tsx scripts/check-brand-assets.ts",
  "tsx scripts/check-nav-width.ts",
  "tsx scripts/check-preview-banner.ts",
  "tsx scripts/check-kickoff-assert.ts",
  "tsx scripts/check-european-handicap.ts",
  "tsx scripts/check-vip-premium-quota.ts",
  "tsx scripts/check-admin-jobs.ts",
  "tsx scripts/check-enrichment-report.ts",
  "tsx scripts/check-paid-tier-grace.ts",
  "tsx scripts/check-adaptive-coverage.ts",
  "tsx scripts/check-senior-womens.ts",
  "tsx scripts/check-odds-breadth.ts",
  "tsx scripts/check-install-prompt.ts",
  "tsx scripts/check-push-onboarding.ts",
  "tsx scripts/check-notifications.ts",
  "tsx scripts/check-notification-targeting.ts",
  "tsx scripts/check-notification-digest.ts",
  "tsx scripts/check-inbox-history-cap.ts",
  "tsx scripts/check-db-safety.ts",
  "tsx scripts/check-betofday-lifecycle.ts",
  "tsx scripts/check-app-shell.ts",
  "tsx scripts/check-accumulator-tiers.ts",
  "tsx scripts/check-ad-placement.ts",
  "tsx scripts/check-auth-cookies.ts",
  "tsx scripts/check-signup-upsell.ts",
  "tsx scripts/check-google-one-tap.ts",
  `${RENDER} scripts/check-dashboard-logout.tsx`,
  "tsx scripts/check-password-reset.ts",
  "tsx scripts/check-disclosure-accuracy.ts",
  "tsx scripts/check-robots-scoping.ts",
  "tsx scripts/check-leg-compatibility.ts",
  "tsx scripts/check-digest.ts",
  "tsx scripts/check-insights.ts",
  "tsx scripts/check-seo.ts",
  "tsx scripts/check-matchfacts.ts",
  "tsx scripts/check-trend-cards.ts",
  "tsx scripts/check-theme-contrast.ts",
  "tsx scripts/check-bet-builder.ts",
  "tsx scripts/check-certainty-language.ts",
  "tsx scripts/check-generation.ts",
  "tsx scripts/check-providers.ts",
  "tsx scripts/check-settlement-time-basis.ts",
  `${RENDER} scripts/check-match-insights-render.tsx`,
  `${RENDER} scripts/check-match-render.tsx`,
  "tsc --noEmit -p tsconfig.json",
];

/** Read the live database; write nothing. Run under a read-only Postgres session. */
export const DB_READONLY_STEPS = [
  "tsx scripts/check-schema-sync.ts",
  "tsx scripts/check-feed-days.ts",
  "tsx scripts/check-prediction-slugs.ts",
];

/** Insert and delete their own rows. Each also calls assertIntegrationDatabase itself. */
export const INTEGRATION_STEPS = [
  "tsx scripts/check-tier-provenance.ts",
  "tsx scripts/check-vip-premium-gate.ts",
  "tsx scripts/check-betofday-targeting.ts",
];

